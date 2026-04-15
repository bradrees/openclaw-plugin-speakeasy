import { describe, expect, it, vi } from "vitest";

import { runSpeakeasySetup } from "../src/setup.js";

describe("setup", () => {
  it("renames the agent when botDisplayName differs", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          agent_grant_id: 1,
          agent_account_id: 2,
          agent_handle: "agent@example.com",
          display_name: "Old Name",
          owner_account_id: 3,
          owner_handle: "owner@example.com",
          capabilities: {}
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          agent_grant_id: 1,
          agent_account_id: 2,
          agent_handle: "agent@example.com",
          display_name: "New Name",
          owner_account_id: 3,
          owner_handle: "owner@example.com",
          capabilities: {}
        })
      });

    const result = await runSpeakeasySetup({
      account: {
        accountId: "default",
        enabled: true,
        baseUrl: "https://example.com",
        accessToken: "token",
        botDisplayName: "New Name",
        transport: "websocket",
        cursorStore: { kind: "memory" },
        allowDirectMessages: true,
        allowTopicMessages: true,
        mentionOnly: false,
        debugLogging: false,
        pollIntervalMs: 5000,
        websocketHeartbeatMs: 30000
      },
      logger: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined
      },
      allowRename: true,
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    expect(result.rename.status).toBe("updated");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
