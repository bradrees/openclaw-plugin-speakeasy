import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("openclaw/plugin-sdk/core", () => ({
  buildChannelOutboundSessionRoute: vi.fn(),
  createChannelPluginBase: vi.fn((plugin) => plugin)
}));

vi.mock("openclaw/plugin-sdk/reply-payload", () => ({
  createNormalizedOutboundDeliverer: vi.fn((deliverer) => deliverer),
  deliverTextOrMediaReply: vi.fn(async () => undefined)
}));

vi.mock("openclaw/plugin-sdk/runtime-store", () => ({
  createPluginRuntimeStore: vi.fn(() => ({
    setRuntime: () => undefined,
    getRuntime: () => {
      throw new Error("runtime is not available in the channel gateway lifecycle test");
    }
  }))
}));

const { speakeasyChannelPlugin } = await import("../src/channel.js");

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readonly listeners = new Map<string, Array<(event?: { data?: string; error?: unknown; message?: string }) => void>>();
  readonly sent: string[] = [];
  closed = false;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(name: string, listener: (event?: { data?: string; error?: unknown; message?: string }) => void): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.emit("close");
  }

  emit(name: string, event?: { data?: string; error?: unknown; message?: string }): void {
    for (const listener of this.listeners.get(name) ?? []) {
      listener(event);
    }
  }
}

const cfg = {
  channels: {
    speakeasy: {
      accounts: {
        default: {
          enabled: true,
          baseUrl: "https://speakeasy.example.com",
          accessToken: "token",
          agentHandle: "agent@example.com",
          transport: "websocket",
          cursorStore: { kind: "memory" },
          allowDirectMessages: true,
          allowTopicMessages: true,
          mentionOnly: false,
          debugLogging: false,
          pollIntervalMs: 5_000,
          websocketHeartbeatMs: 30_000
        }
      }
    }
  }
};

async function waitFor(assertion: () => void, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("timed out waiting for channel gateway state");
}

describe("channel gateway", () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;
  const startAccount = speakeasyChannelPlugin.gateway?.startAccount;
  const stopAccount = speakeasyChannelPlugin.gateway?.stopAccount;
  const applyAccountConfig = speakeasyChannelPlugin.setup?.applyAccountConfig;
  const listGroups = speakeasyChannelPlugin.directory?.listGroups;
  const listGroupsLive = speakeasyChannelPlugin.directory?.listGroupsLive;
  const listGroupMembers = speakeasyChannelPlugin.directory?.listGroupMembers;
  const actions = speakeasyChannelPlugin.actions;
  const messageToolHints = speakeasyChannelPlugin.agentPrompt?.messageToolHints;
  const resolveTargets = speakeasyChannelPlugin.resolver?.resolveTargets;
  const buildAccountSnapshot = speakeasyChannelPlugin.status?.buildAccountSnapshot;

  afterEach(async () => {
    await stopAccount?.({
      accountId: "default"
    } as never);
    globalThis.WebSocket = originalWebSocket;
    globalThis.fetch = originalFetch;
    FakeWebSocket.instances = [];
  });

  it("keeps gateway accounts alive until abort and replaces orphaned transports", async () => {
    expect(startAccount).toBeTypeOf("function");
    globalThis.WebSocket = FakeWebSocket as never;

    const firstAbort = new AbortController();
    let firstSettled = false;
    const firstStart = startAccount!({
      cfg,
      accountId: "default",
      abortSignal: firstAbort.signal
    } as never).finally(() => {
      firstSettled = true;
    });

    await waitFor(() => {
      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(firstSettled).toBe(false);
    });

    const firstSocket = FakeWebSocket.instances[0]!;
    const secondAbort = new AbortController();
    let secondSettled = false;
    const secondStart = startAccount!({
      cfg,
      accountId: "default",
      abortSignal: secondAbort.signal
    } as never).finally(() => {
      secondSettled = true;
    });

    await waitFor(() => {
      expect(firstSocket.closed).toBe(true);
      expect(FakeWebSocket.instances).toHaveLength(2);
      expect(secondSettled).toBe(false);
    });

    secondAbort.abort();
    await secondStart;
    expect(FakeWebSocket.instances[1]!.closed).toBe(true);

    firstAbort.abort();
    await firstStart;
    expect(firstSettled).toBe(true);
  });

  it("preserves refresh credentials and existing settings when setup reapplies account auth", () => {
    expect(applyAccountConfig).toBeTypeOf("function");

    const updated = applyAccountConfig!({
      cfg: {
        channels: {
          speakeasy: {
            accounts: {
              default: {
                enabled: true,
                baseUrl: "https://speakeasy.example.com",
                accessToken: "old-access-token",
                refreshToken: "old-refresh-token",
                webhookSecret: "existing-webhook-secret",
                agentHandle: "agent@example.com",
                transport: "polling",
                cursorStore: { kind: "memory" },
                allowDirectMessages: false,
                allowTopicMessages: true,
                mentionOnly: true,
                debugLogging: true,
                pollIntervalMs: 9_000,
                websocketHeartbeatMs: 45_000
              }
            }
          }
        }
      } as never,
      accountId: "default",
      input: {
        url: "https://speakeasy.example.com",
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token"
      }
    } as never);

    expect(updated.channels?.speakeasy?.accounts?.default).toMatchObject({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      webhookSecret: "existing-webhook-secret",
      agentHandle: "agent@example.com",
      transport: "polling",
      allowDirectMessages: false,
      allowTopicMessages: true,
      mentionOnly: true,
      debugLogging: true,
      pollIntervalMs: 9_000,
      websocketHeartbeatMs: 45_000
    });
  });

  it("surfaces DM policy in account snapshots", async () => {
    expect(buildAccountSnapshot).toBeTypeOf("function");

    await expect(buildAccountSnapshot!({
      cfg,
      account: {
        ...cfg.channels.speakeasy.accounts.default
      },
      probe: {
        endpoint: "agent/topics",
        degraded: false,
        topicCount: 2
      }
    } as never)).resolves.toMatchObject({
      dmPolicy: "enabled",
      probeEndpoint: "agent/topics"
    });
  });

  it("tells agents to use directory groups for Speakeasy topic discovery", () => {
    expect(messageToolHints).toBeTypeOf("function");

    const hints = messageToolHints!({
      cfg,
      accountId: "default"
    } as never);

    expect(hints.join("\n")).toContain("directory groups");
    expect(hints.join("\n")).toContain("openclaw-plugin-speakeasy");
    expect(hints.join("\n")).toContain("may require `--guild-id`");
  });

  it("lists live Speakeasy topics with DM-aware labels", async () => {
    expect(listGroups).toBeTypeOf("function");
    expect(listGroupsLive).toBeTypeOf("function");

    globalThis.fetch = vi.fn(async (url: URL | RequestInfo) => {
      const href = String(url);

      if (href.endsWith("/api/v1/agent/topics")) {
        return new Response(JSON.stringify({
          records: {
            topics: {
              data: {
                "7": {
                  id: 7,
                  subject: "Untitled",
                  parent_topic_id: null,
                  root_topic_id: 7,
                  spawned_from_chat_id: null
                },
                "42": {
                  id: 42,
                  subject: "Release planning",
                  parent_topic_id: null,
                  root_topic_id: 42,
                  spawned_from_chat_id: null
                }
              }
            }
          }
        }), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        });
      }

      if (href.endsWith("/api/v1/agent/topics/7/participants")) {
        return new Response(JSON.stringify({
          records: {
            participants: {
              data: {
                "1": {
                  id: 1,
                  handle: "agent@example.com",
                  display_name: "OpenClaw Agent"
                },
                "2": {
                  id: 2,
                  handle: "alice@example.com",
                  display_name: "Alice Example"
                }
              }
            }
          }
        }), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        });
      }

      throw new Error(`unexpected fetch: ${href}`);
    }) as never;

    const entries = await listGroups!({
      cfg,
      accountId: "default",
      runtime: {} as never
    } as never);

    expect(entries).toEqual([
      expect.objectContaining({
        kind: "group",
        id: "direct:7",
        name: "DM: Alice Example"
      }),
      expect.objectContaining({
        kind: "group",
        id: "topic:42",
        name: "Release planning"
      })
    ]);

    await expect(listGroupsLive!({
      cfg,
      accountId: "default",
      query: "release",
      runtime: {} as never
    } as never)).resolves.toEqual([
      expect.objectContaining({
        id: "topic:42",
        name: "Release planning"
      })
    ]);
  });

  it("lists group members for explicit Speakeasy topic and direct targets", async () => {
    expect(listGroupMembers).toBeTypeOf("function");

    globalThis.fetch = vi.fn(async (url: URL | RequestInfo) => {
      const href = String(url);

      if (href.endsWith("/api/v1/agent/topics/7/participants")) {
        return new Response(JSON.stringify({
          records: {
            participants: {
              data: {
                "1": {
                  id: 1,
                  handle: "agent@example.com",
                  display_name: "OpenClaw Agent"
                },
                "2": {
                  id: 2,
                  handle: "alice@example.com",
                  display_name: "Alice Example"
                }
              }
            }
          }
        }), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        });
      }

      throw new Error(`unexpected fetch: ${href}`);
    }) as never;

    await expect(listGroupMembers!({
      cfg,
      accountId: "default",
      groupId: "direct:7",
      runtime: {} as never
    } as never)).resolves.toEqual([
      {
        kind: "user",
        id: "alice@example.com",
        name: "Alice Example",
        handle: "alice@example.com",
        raw: {
          topicId: "7",
          participantId: 2,
          displayName: "Alice Example"
        }
      },
      {
        kind: "user",
        id: "agent@example.com",
        name: "OpenClaw Agent",
        handle: "agent@example.com",
        raw: {
          topicId: "7",
          participantId: 1,
          displayName: "OpenClaw Agent"
        }
      }
    ]);

    await expect(listGroupMembers!({
      cfg,
      accountId: "default",
      groupId: "doug:topic:7",
      runtime: {} as never
    } as never)).resolves.toHaveLength(2);
  });

  it("resolves topic ids and friendly DM names through the plugin resolver", async () => {
    expect(resolveTargets).toBeTypeOf("function");

    globalThis.fetch = vi.fn(async (url: URL | RequestInfo) => {
      const href = String(url);

      if (href.endsWith("/api/v1/agent/topics")) {
        return new Response(JSON.stringify({
          records: {
            topics: {
              data: {
                "7": {
                  id: 7,
                  subject: "Untitled",
                  parent_topic_id: null,
                  root_topic_id: 7,
                  spawned_from_chat_id: null
                },
                "42": {
                  id: 42,
                  subject: "Release planning",
                  parent_topic_id: null,
                  root_topic_id: 42,
                  spawned_from_chat_id: null
                }
              }
            }
          }
        }), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        });
      }

      if (href.endsWith("/api/v1/agent/topics/7/participants")) {
        return new Response(JSON.stringify({
          records: {
            participants: {
              data: {
                "1": {
                  id: 1,
                  handle: "agent@example.com",
                  display_name: "OpenClaw Agent"
                },
                "2": {
                  id: 2,
                  handle: "alice@example.com",
                  display_name: "Alice Example"
                }
              }
            }
          }
        }), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        });
      }

      throw new Error(`unexpected fetch: ${href}`);
    }) as never;

    await expect(resolveTargets!({
      cfg,
      accountId: "default",
      kind: "group",
      inputs: ["42", "Alice Example"],
      runtime: {} as never
    } as never)).resolves.toEqual([
      {
        input: "42",
        resolved: true,
        id: "topic:42",
        name: "Topic 42",
        note: "topic id"
      },
      {
        input: "Alice Example",
        resolved: true,
        id: "direct:7",
        name: "DM: Alice Example",
        note: "direct message"
      }
    ]);
  });

  it("exposes topic listing through message channel and thread list actions", async () => {
    expect(actions?.handleAction).toBeTypeOf("function");
    expect(actions?.describeMessageTool({ cfg } as never)?.actions).toEqual([
      "channel-list",
      "thread-list"
    ]);

    globalThis.fetch = vi.fn(async (url: URL | RequestInfo) => {
      const href = String(url);

      if (href.endsWith("/api/v1/agent/topics")) {
        return new Response(JSON.stringify({
          records: {
            topics: {
              data: {
                "42": {
                  id: 42,
                  subject: "Release planning",
                  parent_topic_id: null,
                  root_topic_id: 42,
                  spawned_from_chat_id: null
                }
              }
            }
          }
        }), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        });
      }

      throw new Error(`unexpected fetch: ${href}`);
    }) as never;

    const channelList = await actions!.handleAction!({
      channel: "openclaw-plugin-speakeasy",
      action: "channel-list",
      cfg,
      params: {},
      accountId: "default"
    } as never);
    const threadList = await actions!.handleAction!({
      channel: "openclaw-plugin-speakeasy",
      action: "thread-list",
      cfg,
      params: {},
      accountId: "default"
    } as never);

    expect(channelList.details).toMatchObject({
      ok: true,
      action: "channel-list",
      topics: [
        {
          id: "topic:42",
          name: "Release planning"
        }
      ]
    });
    expect(threadList.details).toMatchObject({
      ok: true,
      action: "thread-list",
      topics: [
        {
          id: "topic:42",
          name: "Release planning"
        }
      ]
    });
  });
});
