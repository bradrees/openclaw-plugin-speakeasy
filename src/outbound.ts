import type { LoggerLike, SpeakeasyAccountConfig } from "./types.js";
import { SpeakeasyApiClient } from "./client.js";
import { createIdempotencyKey, stableChecksumBase64 } from "./utils.js";

export type OutboundTarget =
  | {
      kind: "topic";
      topicId: string;
    }
  | {
      kind: "direct";
      handle: string;
    };

export class SpeakeasyOutboundService {
  constructor(
    private readonly client: SpeakeasyApiClient,
    private readonly logger?: LoggerLike
  ) {}

  async send(params: {
    target: OutboundTarget;
    text?: string;
    html?: string;
    file?: {
      filename: string;
      bytes: Uint8Array;
      contentType: string;
    };
    replyTimelineId?: string;
  }): Promise<{ topicId: string; chatId?: string }> {
    let sgid: string | undefined;

    if (params.file) {
      const upload = await this.client.createDirectUpload({
        blob: {
          filename: params.file.filename,
          byte_size: params.file.bytes.byteLength,
          checksum: stableChecksumBase64(params.file.bytes),
          content_type: params.file.contentType,
          metadata: {}
        }
      });
      await this.client.uploadBytes({
        url: upload.direct_upload.url,
        headers: upload.direct_upload.headers,
        body: params.file.bytes
      });
      sgid = upload.signed_id;
    }

    if (params.target.kind === "direct") {
      const response = await this.client.createDirectChat(
        {
          handle: params.target.handle,
          chat: {
            text: params.text,
            html: params.html,
            sgid
          }
        },
        {
          idempotencyKey: createIdempotencyKey(`direct-send-${params.target.handle}`)
        }
      );
      const topic = this.client.extractTopicFromResponse(response);
      const chat = this.client.extractChatFromResponse(response);
      const topicId = this.client.topicIdFromTopic(topic);

      if (!topicId) {
        throw new Error("Speakeasy direct chat response did not include a topic id");
      }

      return {
        topicId,
        chatId: chat?.id ? String(chat.id) : undefined
      };
    }

    const response = await this.client.createChat(
      params.target.topicId,
      {
        text: params.text,
        html: params.html,
        sgid,
        reply_timeline_id: params.replyTimelineId
      },
      {
        idempotencyKey: createIdempotencyKey(`topic-send-${params.target.topicId}`)
      }
    );
    const chat = this.client.extractChatFromResponse(response);
    this.logger?.debug("sent Speakeasy chat", {
      topicId: params.target.topicId,
      chatId: chat?.id
    });
    return {
      topicId: params.target.topicId,
      chatId: chat?.id ? String(chat.id) : undefined
    };
  }

  async setTyping(params: {
    topicId: string;
    typing: boolean;
  }): Promise<void> {
    await this.client.setTyping(params.topicId, params.typing);
  }

  async edit(params: {
    topicId: string;
    chatId: string;
    text?: string;
    html?: string;
  }): Promise<void> {
    await this.client.updateChat(
      params.topicId,
      params.chatId,
      {
        text: params.text,
        html: params.html
      },
      {
        idempotencyKey: createIdempotencyKey(`edit-${params.topicId}-${params.chatId}`)
      }
    );
  }

  async delete(params: { topicId: string; chatId: string }): Promise<void> {
    await this.client.deleteChat(params.topicId, params.chatId, {
      idempotencyKey: createIdempotencyKey(`delete-${params.topicId}-${params.chatId}`)
    });
  }
}

export function normalizeDirectHandle(input: string): string {
  return input.trim().replace(/^user:/i, "").replace(/^@/, "");
}

export function inferOutboundTarget(input: string, _account: SpeakeasyAccountConfig): OutboundTarget {
  const directHandle = normalizeDirectHandle(input);

  if (directHandle.includes("@")) {
    return {
      kind: "direct",
      handle: directHandle
    };
  }

  return {
    kind: "topic",
    topicId: input.replace(/^topic:/, "").replace(/^direct:/, "")
  };
}
