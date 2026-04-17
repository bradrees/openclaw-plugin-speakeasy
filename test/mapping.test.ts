import { describe, expect, it } from "vitest";

import {
  buildConversationId,
  mapDirectChatToConversation,
  mapTopicToConversation
} from "../src/index.js";

describe("mapping", () => {
  it("maps a top-level topic to its own conversation", () => {
    const result = mapTopicToConversation({
      topic: {
        id: 42,
        parent_topic_id: null,
        root_topic_id: 42,
        spawned_from_chat_id: null
      }
    });

    expect(result.conversationId).toBe(buildConversationId("42"));
    expect(result.baseConversationId).toBe(buildConversationId("42"));
    expect(result.parentConversationCandidates).toEqual([]);
  });

  it("maps a child topic to a separate conversation with parent fallback", () => {
    const result = mapTopicToConversation({
      topic: {
        id: 99,
        parent_topic_id: 42,
        root_topic_id: 42,
        spawned_from_chat_id: 12
      }
    });

    expect(result.conversationId).toBe(buildConversationId("99"));
    expect(result.parentConversationId).toBe(buildConversationId("42"));
    expect(result.parentConversationCandidates).toEqual([buildConversationId("42")]);
  });

  it("maps direct chats to standalone conversations", () => {
    const result = mapDirectChatToConversation({
      id: 7,
      parent_topic_id: null,
      root_topic_id: 7,
      spawned_from_chat_id: null
    });

    expect(result.kind).toBe("direct");
    expect(result.conversationId).toBe(buildConversationId("7", "direct"));
  });
});
