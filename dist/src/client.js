import { buildAgentAuthHeaders } from "./auth.js";
import { createIdempotencyKey, delay, normalizeId } from "./utils.js";
export class SpeakeasyApiError extends Error {
    status;
    body;
    retryable;
    constructor(message, status, body, retryable = false) {
        super(message);
        this.status = status;
        this.body = body;
        this.retryable = retryable;
        this.name = "SpeakeasyApiError";
    }
}
export class SpeakeasyApiClient {
    options;
    constructor(options) {
        this.options = options;
    }
    get fetchImpl() {
        return this.options.fetchImpl ?? fetch;
    }
    get baseUrl() {
        return this.options.baseUrl;
    }
    async request(path, init, retryOptions = {}) {
        const attempts = retryOptions.attempts ?? 3;
        let lastError;
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            try {
                const headers = buildAgentAuthHeaders(this.options.accessToken, {
                    ...init.headers,
                    ...(retryOptions.idempotencyKey ? { "Idempotency-Key": retryOptions.idempotencyKey } : {})
                });
                const response = await this.fetchImpl(new URL(path, this.options.baseUrl), {
                    ...init,
                    headers,
                    ...(retryOptions.signal ? { signal: retryOptions.signal } : {})
                });
                if (!response.ok) {
                    const responseBody = await safeJson(response);
                    const retryable = response.status >= 500 || response.status === 429;
                    throw new SpeakeasyApiError(`Speakeasy request failed: ${init.method ?? "GET"} ${path} -> ${response.status}`, response.status, responseBody, retryable);
                }
                if (response.status === 204) {
                    return undefined;
                }
                return (await response.json());
            }
            catch (error) {
                lastError = error;
                const retryable = error instanceof SpeakeasyApiError ? error.retryable : error instanceof TypeError;
                if (!retryable || attempt === attempts) {
                    throw error;
                }
                this.options.logger?.warn("retrying Speakeasy API request", {
                    attempt,
                    path
                });
                await delay(250 * attempt, retryOptions.signal);
            }
        }
        throw lastError;
    }
    getMe(signal) {
        return this.request("/api/v1/agent/me", { method: "GET" }, { signal });
    }
    updateMe(displayName, signal) {
        return this.request("/api/v1/agent/me", {
            method: "PATCH",
            body: JSON.stringify({
                display_name: displayName
            })
        }, {
            signal,
            idempotencyKey: createIdempotencyKey("agent-profile")
        });
    }
    listTopics(signal) {
        return this.request("/api/v1/agent/topics", { method: "GET" }, { signal });
    }
    getTopic(topicId, signal) {
        return this.request(`/api/v1/agent/topics/${topicId}`, { method: "GET" }, { signal });
    }
    getParticipants(topicId, signal) {
        return this.request(`/api/v1/agent/topics/${topicId}/participants`, { method: "GET" }, { signal });
    }
    getChats(topicId, cursor, signal) {
        const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
        return this.request(`/api/v1/agent/topics/${topicId}/chats${suffix}`, { method: "GET" }, { signal });
    }
    getChat(topicId, chatId, signal) {
        return this.request(`/api/v1/agent/topics/${topicId}/chats/${chatId}`, { method: "GET" }, { signal });
    }
    createChat(topicId, chat, options = {}) {
        return this.request(`/api/v1/agent/topics/${topicId}/chats`, {
            method: "POST",
            body: JSON.stringify({
                chat
            })
        }, {
            ...options,
            idempotencyKey: options.idempotencyKey ?? createIdempotencyKey(`chat-create-${topicId}`)
        });
    }
    updateChat(topicId, chatId, chat, options = {}) {
        return this.request(`/api/v1/agent/topics/${topicId}/chats/${chatId}`, {
            method: "PATCH",
            body: JSON.stringify({
                chat
            })
        }, {
            ...options,
            idempotencyKey: options.idempotencyKey ?? createIdempotencyKey(`chat-update-${topicId}-${chatId}`)
        });
    }
    deleteChat(topicId, chatId, options = {}) {
        return this.request(`/api/v1/agent/topics/${topicId}/chats/${chatId}`, {
            method: "DELETE"
        }, {
            ...options,
            idempotencyKey: options.idempotencyKey ?? createIdempotencyKey(`chat-delete-${topicId}-${chatId}`)
        });
    }
    createDirectChat(payload, options = {}) {
        return this.request("/api/v1/agent/direct_chats", {
            method: "POST",
            body: JSON.stringify(payload)
        }, {
            ...options,
            idempotencyKey: options.idempotencyKey ?? createIdempotencyKey(`direct-chat-${payload.handle}`)
        });
    }
    pollEvents(cursor, signal) {
        const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
        return this.request(`/api/v1/agent/events${suffix}`, { method: "GET" }, { signal });
    }
    createDirectUpload(payload, signal) {
        return this.request("/api/v1/files", {
            method: "POST",
            body: JSON.stringify(payload)
        }, {
            signal,
            idempotencyKey: createIdempotencyKey("direct-upload")
        });
    }
    async uploadBytes(params) {
        const response = await this.fetchImpl(params.url, {
            method: "PUT",
            headers: params.headers,
            body: Buffer.from(params.body),
            ...(params.signal ? { signal: params.signal } : {})
        });
        if (!response.ok) {
            throw new SpeakeasyApiError(`Direct upload failed with HTTP ${response.status}`, response.status, undefined, false);
        }
    }
    extractTopicFromResponse(payload) {
        if (payload.topic) {
            return payload.topic;
        }
        const records = payload.records;
        return records?.topics ? Object.values(records.topics.data)[0] : undefined;
    }
    extractChatFromResponse(payload) {
        if (payload.chat) {
            return payload.chat;
        }
        const records = payload.records;
        return records?.chats ? Object.values(records.chats.data)[0] : undefined;
    }
    topicIdFromTopic(topic) {
        return normalizeId(topic?.id);
    }
}
async function safeJson(response) {
    try {
        return await response.json();
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=client.js.map