import { describe, expect, it, vi } from "vitest";

import { SpeakeasyApiError } from "../src/client.js";
import { SpeakeasyPollingLoop } from "../src/polling.js";
import { MemoryCursorStore, encodeSpeakeasyCursor, updateCursorState } from "../src/utils.js";
import { buildConversationId, resolveSessionConversation } from "../src/session-key-api.js";

describe("session", () => {
  it("resolves stable session conversations with parent fallbacks", () => {
    const result = resolveSessionConversation({
      kind: "group",
      rawId: "topic:42",
      parentConversationId: buildConversationId("1")
    });

    expect(result).toEqual({
      id: buildConversationId("42"),
      baseConversationId: buildConversationId("42"),
      parentConversationCandidates: [buildConversationId("1")]
    });
  });

  it("persists cursor and recent events in memory", async () => {
    const store = new MemoryCursorStore();
    await updateCursorState(store, (state) => ({
      ...state,
      cursor: "abc",
      websocketResumeCursor: "abc",
      agentHandle: "agent@example.com",
      recentEventIds: ["evt-1"],
      conversationKinds: {
        "42": "topic"
      }
    }));

    await expect(store.read()).resolves.toEqual({
      cursor: "abc",
      websocketResumeCursor: "abc",
      agentHandle: "agent@example.com",
      recentEventIds: ["evt-1"],
      conversationKinds: {
        "42": "topic"
      }
    });
  });

  it("encodes opaque resume cursors from live event ids", () => {
    expect(encodeSpeakeasyCursor("123")).toBe("MTIz");
  });

  it("clears invalid event cursors before retrying polling", async () => {
    let cursor: string | undefined = "bad-cursor";
    const setCursor = vi.fn(async (next: string | undefined) => {
      cursor = next;
    });
    const pollEvents = vi
      .fn()
      .mockRejectedValueOnce(new SpeakeasyApiError("invalid cursor", 400, { error: "invalid cursor" }))
      .mockResolvedValue({
        events: [],
        next_cursor: "fresh-cursor"
      });

    const loop = new SpeakeasyPollingLoop({
      client: {
        pollEvents
      } as never,
      logger: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined
      },
      pollIntervalMs: 5,
      getCursor: async () => cursor,
      setCursor,
      getConversationKinds: async () => ({}),
      onEvent: async () => undefined
    });

    await loop.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await loop.stop();

    expect(setCursor).toHaveBeenCalledWith(undefined);
    expect(setCursor).toHaveBeenCalledWith("fresh-cursor");
    expect(pollEvents).toHaveBeenNthCalledWith(1, "bad-cursor", expect.any(AbortSignal));
    expect(pollEvents).toHaveBeenNthCalledWith(2, undefined, expect.any(AbortSignal));
  });
});
