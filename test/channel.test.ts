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
  const startAccount = speakeasyChannelPlugin.gateway?.startAccount;
  const stopAccount = speakeasyChannelPlugin.gateway?.stopAccount;
  const applyAccountConfig = speakeasyChannelPlugin.setup?.applyAccountConfig;

  afterEach(async () => {
    await stopAccount?.({
      accountId: "default"
    } as never);
    globalThis.WebSocket = originalWebSocket;
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
});
