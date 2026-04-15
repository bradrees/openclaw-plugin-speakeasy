import { describe, expect, it, vi } from "vitest";

import { SpeakeasyApiClient } from "../src/client.js";
import { SpeakeasyOutboundService } from "../src/outbound.js";

describe("outbound", () => {
  it("sends topic messages", async () => {
    const createChat = vi.fn().mockResolvedValue({
      chat: {
        id: 20
      }
    });
    const client = {
      createChat,
      createDirectChat: vi.fn(),
      createDirectUpload: vi.fn(),
      uploadBytes: vi.fn(),
      extractTopicFromResponse: vi.fn(),
      extractChatFromResponse: (payload: { chat: { id: number } }) => payload.chat,
      topicIdFromTopic: vi.fn()
    } as unknown as SpeakeasyApiClient;

    const outbound = new SpeakeasyOutboundService(client);
    const result = await outbound.send({
      target: {
        kind: "topic",
        topicId: "10"
      },
      text: "hello"
    });

    expect(createChat).toHaveBeenCalled();
    expect(result).toEqual({
      topicId: "10",
      chatId: "20"
    });
  });

  it("edits and deletes messages", async () => {
    const updateChat = vi.fn().mockResolvedValue({});
    const deleteChat = vi.fn().mockResolvedValue(undefined);
    const client = {
      updateChat,
      deleteChat
    } as unknown as SpeakeasyApiClient;

    const outbound = new SpeakeasyOutboundService(client);
    await outbound.edit({
      topicId: "10",
      chatId: "20",
      text: "edited"
    });
    await outbound.delete({
      topicId: "10",
      chatId: "20"
    });

    expect(updateChat).toHaveBeenCalled();
    expect(deleteChat).toHaveBeenCalled();
  });
});
