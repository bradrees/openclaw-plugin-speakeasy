import { describe, expect, it, vi } from "vitest";

import { SpeakeasyApiClient } from "../src/client.js";
import { inferOutboundTarget, normalizeDirectHandle, SpeakeasyOutboundService } from "../src/outbound.js";

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

  it("normalizes email handles for originated direct messages", () => {
    expect(normalizeDirectHandle("user:chris@team.speakeasy.to")).toBe("chris@team.speakeasy.to");
    expect(normalizeDirectHandle("@kaye@powertoolsapp.com")).toBe("kaye@powertoolsapp.com");
    expect(normalizeDirectHandle("doug:direct:chris@team.speakeasy.to")).toBe("chris@team.speakeasy.to");

    expect(inferOutboundTarget("user:luke@team.speakeasy.to", {} as never)).toEqual({
      kind: "direct",
      handle: "luke@team.speakeasy.to"
    });
  });

  it("normalizes OpenClaw Speakeasy conversation ids to raw topic ids", () => {
    expect(inferOutboundTarget("doug:topic:185368433", {} as never)).toEqual({
      kind: "topic",
      topicId: "185368433"
    });
    expect(inferOutboundTarget("topic:185368433", {} as never)).toEqual({
      kind: "topic",
      topicId: "185368433"
    });
    expect(inferOutboundTarget("main:topic:185368433", {} as never)).toEqual({
      kind: "topic",
      topicId: "185368433"
    });
  });
});
