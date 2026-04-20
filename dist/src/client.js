import { buildAgentAuthHeaders, isSpeakeasyAccessTokenExpired, refreshAccessToken } from "./auth.js";
import { createIdempotencyKey, delay, normalizeId } from "./utils.js";
export class SpeakeasyApiError extends Error {
    status;
    body;
    retryable;
    retryAfterMs;
    constructor(message, status, body, retryable = false, retryAfterMs) {
        super(message);
        this.status = status;
        this.body = body;
        this.retryable = retryable;
        this.retryAfterMs = retryAfterMs;
        this.name = "SpeakeasyApiError";
    }
}
export class SpeakeasyApiClient {
    options;
    refreshPromise;
    authCooldownUntil = 0;
    consecutiveAuthFailures = 0;
    constructor(options) {
        this.options = options;
    }
    get fetchImpl() {
        return this.options.fetchImpl ?? fetch;
    }
    get baseUrl() {
        return this.options.baseUrl;
    }
    get accessToken() {
        return this.options.accessToken;
    }
    async ensureFreshAccessToken(reason) {
        if (!this.options.refreshToken || !isSpeakeasyAccessTokenExpired(this.options.accessToken)) {
            return this.options.accessToken;
        }
        this.options.logger?.info("Speakeasy access token expired; refreshing before request", {
            reason
        });
        await this.refreshAccessToken();
        return this.options.accessToken;
    }
    async refreshAccessToken() {
        if (!this.options.refreshToken) {
            throw new Error("Cannot refresh Speakeasy access token without refreshToken");
        }
        if (!this.refreshPromise) {
            this.refreshPromise = (async () => {
                const next = await refreshAccessToken({
                    accountId: "runtime",
                    enabled: true,
                    baseUrl: this.options.baseUrl,
                    accessToken: this.options.accessToken,
                    refreshToken: this.options.refreshToken,
                    transport: "polling",
                    cursorStore: { kind: "memory" },
                    allowDirectMessages: true,
                    allowTopicMessages: true,
                    mentionOnly: false,
                    debugLogging: false,
                    pollIntervalMs: 5000,
                    websocketHeartbeatMs: 30000
                }, this.fetchImpl);
                this.options.accessToken = next.accessToken;
                this.options.refreshToken = next.refreshToken ?? this.options.refreshToken;
                this.consecutiveAuthFailures = 0;
                this.authCooldownUntil = 0;
                if (this.options.onAuthUpdated) {
                    try {
                        await this.options.onAuthUpdated({
                            accessToken: this.options.accessToken,
                            refreshToken: this.options.refreshToken,
                            ...(next.agentHandle ? { agentHandle: next.agentHandle } : {})
                        });
                    }
                    catch (error) {
                        this.options.logger?.warn("failed to persist refreshed Speakeasy auth", {
                            error: error instanceof Error ? error.message : String(error)
                        });
                    }
                }
                this.options.logger?.info("refreshed Speakeasy access token after 401");
                return {
                    accessToken: this.options.accessToken,
                    refreshToken: this.options.refreshToken,
                    ...(next.agentHandle ? { agentHandle: next.agentHandle } : {})
                };
            })().finally(() => {
                this.refreshPromise = undefined;
            });
        }
        return this.refreshPromise;
    }
    async request(path, init, retryOptions = {}) {
        const attempts = retryOptions.attempts ?? 3;
        let lastError;
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            try {
                if (this.authCooldownUntil > Date.now()) {
                    throw new SpeakeasyApiError(`Speakeasy auth cooling down until ${new Date(this.authCooldownUntil).toISOString()}`, 401, undefined, false, this.authCooldownUntil - Date.now());
                }
                const accessToken = await this.ensureFreshAccessToken(`${init.method ?? "GET"} ${path}`);
                const headers = buildAgentAuthHeaders(accessToken, {
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
                    const retryAfterMs = parseRetryAfterMs(response.headers?.get?.("retry-after") ?? null);
                    throw new SpeakeasyApiError(`Speakeasy request failed: ${init.method ?? "GET"} ${path} -> ${response.status}`, response.status, responseBody, retryable, retryAfterMs);
                }
                if (response.status === 204) {
                    return undefined;
                }
                return (await response.json());
            }
            catch (error) {
                if (error instanceof SpeakeasyApiError && error.status === 401) {
                    this.consecutiveAuthFailures += 1;
                    if (this.options.refreshToken && attempt === 1) {
                        this.options.logger?.warn("Speakeasy access token rejected; attempting refresh", { path });
                        try {
                            await this.refreshAccessToken();
                            continue;
                        }
                        catch (refreshError) {
                            this.options.logger?.warn("Speakeasy access token refresh failed", {
                                path,
                                error: refreshError instanceof Error ? refreshError.message : String(refreshError)
                            });
                        }
                    }
                    if (this.consecutiveAuthFailures >= 2) {
                        this.authCooldownUntil = Date.now() + 60_000;
                        this.options.logger?.warn("Speakeasy auth entering cooldown after repeated 401 responses", {
                            path,
                            cooldownMs: 60_000,
                            consecutiveAuthFailures: this.consecutiveAuthFailures
                        });
                    }
                }
                lastError = error;
                const retryable = error instanceof SpeakeasyApiError ? error.retryable : error instanceof TypeError;
                if (!retryable || attempt === attempts) {
                    throw error;
                }
                this.options.logger?.warn("retrying Speakeasy API request", {
                    attempt,
                    path,
                    backoffMs: error instanceof SpeakeasyApiError && error.retryAfterMs !== undefined
                        ? error.retryAfterMs
                        : 250 * attempt
                });
                await delay(error instanceof SpeakeasyApiError && error.retryAfterMs !== undefined
                    ? error.retryAfterMs
                    : 250 * attempt, retryOptions.signal);
            }
        }
        throw lastError;
    }
    getMe(signal) {
        return this.request("/api/v1/agent/me", { method: "GET" }, { signal });
    }
    async getMeIfAvailable(signal) {
        try {
            return await this.request("/api/v1/agent/me", { method: "GET" }, { signal, attempts: 1 });
        }
        catch (error) {
            if (error instanceof SpeakeasyApiError && (error.status === 404 || error.status === 429)) {
                this.options.logger?.warn("Speakeasy agent profile endpoint is unavailable for probing", {
                    path: "/api/v1/agent/me",
                    status: error.status,
                    fallback: "/api/v1/agent/topics"
                });
                return undefined;
            }
            throw error;
        }
    }
    async probeConnectivity(signal) {
        const profile = await this.getMeIfAvailable(signal);
        if (profile) {
            return {
                endpoint: "agent/me",
                degraded: false,
                profile
            };
        }
        return this.probeTopicsConnectivity(signal, "GET /api/v1/agent/me was unavailable or rate limited; connectivity verified with GET /api/v1/agent/topics instead.");
    }
    async probeTopicsConnectivity(signal, warning) {
        const topics = await this.listTopics(signal);
        const topicCount = Object.keys(topics.records.topics?.data ?? {}).length;
        return {
            endpoint: "agent/topics",
            degraded: Boolean(warning),
            ...(warning ? { warning } : {}),
            topicCount
        };
    }
    setTyping(topicId, typing, signal) {
        return this.request(`/api/v1/agent/topics/${topicId}/typing`, {
            method: "PATCH",
            body: JSON.stringify({ typing })
        }, {
            signal,
            idempotencyKey: createIdempotencyKey(`typing-${topicId}-${typing ? "on" : "off"}`),
            attempts: 1
        });
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
        return this.request(`/api/v1/agent/events${suffix}`, { method: "GET" }, { signal, attempts: 1 });
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
function parseRetryAfterMs(value) {
    if (!value)
        return undefined;
    const secs = Number(value);
    if (Number.isFinite(secs) && secs >= 0)
        return Math.round(secs * 1000);
    const at = Date.parse(value);
    if (Number.isFinite(at)) {
        const delta = at - Date.now();
        return delta > 0 ? delta : 0;
    }
    return undefined;
}
//# sourceMappingURL=client.js.map