import { createIdempotencyKey, stableChecksumBase64 } from "./utils.js";
export class SpeakeasyOutboundService {
    client;
    logger;
    constructor(client, logger) {
        this.client = client;
        this.logger = logger;
    }
    async send(params) {
        let sgid;
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
            const response = await this.client.createDirectChat({
                handle: params.target.handle,
                chat: {
                    text: params.text,
                    html: params.html,
                    sgid
                }
            }, {
                idempotencyKey: createIdempotencyKey(`direct-send-${params.target.handle}`)
            });
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
        const response = await this.client.createChat(params.target.topicId, {
            text: params.text,
            html: params.html,
            sgid,
            reply_timeline_id: params.replyTimelineId
        }, {
            idempotencyKey: createIdempotencyKey(`topic-send-${params.target.topicId}`)
        });
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
    async setTyping(params) {
        await this.client.setTyping(params.topicId, params.typing);
    }
    async edit(params) {
        await this.client.updateChat(params.topicId, params.chatId, {
            text: params.text,
            html: params.html
        }, {
            idempotencyKey: createIdempotencyKey(`edit-${params.topicId}-${params.chatId}`)
        });
    }
    async delete(params) {
        await this.client.deleteChat(params.topicId, params.chatId, {
            idempotencyKey: createIdempotencyKey(`delete-${params.topicId}-${params.chatId}`)
        });
    }
}
export function inferOutboundTarget(input, _account) {
    if (input.includes("@")) {
        return {
            kind: "direct",
            handle: input
        };
    }
    return {
        kind: "topic",
        topicId: input.replace(/^topic:/, "").replace(/^direct:/, "")
    };
}
//# sourceMappingURL=outbound.js.map