import { describe, expect, it } from "vitest";

import { MemoryCursorStore, updateCursorState } from "../src/utils.js";
import { resolveSessionConversation } from "../src/session-key-api.js";

describe("session", () => {
  it("resolves stable session conversations with parent fallbacks", () => {
    const result = resolveSessionConversation({
      kind: "group",
      rawId: "topic:42",
      parentConversationId: "topic:1"
    });

    expect(result).toEqual({
      id: "topic:42",
      baseConversationId: "topic:42",
      parentConversationCandidates: ["topic:1"]
    });
  });

  it("persists cursor and recent events in memory", async () => {
    const store = new MemoryCursorStore();
    await updateCursorState(store, (state) => ({
      ...state,
      cursor: "abc",
      recentEventIds: ["evt-1"],
      conversationKinds: {
        "42": "topic"
      }
    }));

    await expect(store.read()).resolves.toEqual({
      cursor: "abc",
      recentEventIds: ["evt-1"],
      conversationKinds: {
        "42": "topic"
      }
    });
  });
});
