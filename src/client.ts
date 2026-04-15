import type {
  DirectUploadRequest,
  DirectUploadResponse,
  LoggerLike,
  SpeakeasyConnectivityProbe,
  SpeakeasyAgentProfile,
  SpeakeasyChat,
  SpeakeasyChatWriteInput,
  SpeakeasyDirectChatCreateRequest,
  SpeakeasyHistoryResponse,
  SpeakeasyParticipant,
  SpeakeasyPollingEventsResponse,
  SpeakeasyTopic,
  SpeakeasyTopicsResponse
} from "./types.js";
import { buildAgentAuthHeaders, refreshAccessToken } from "./auth.js";
import { createIdempotencyKey, delay, normalizeId } from "./utils.js";

export class SpeakeasyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
    readonly retryable = false,
    readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = "SpeakeasyApiError";
  }
}

type RetryOptions = {
  attempts?: number;
  signal?: AbortSignal;
  idempotencyKey?: string;
};

export class SpeakeasyApiClient {
  private refreshPromise?: Promise<string>;
  private authCooldownUntil = 0;
  private consecutiveAuthFailures = 0;

  constructor(
    private readonly options: {
      baseUrl: string;
      accessToken: string;
      refreshToken?: string;
      fetchImpl?: typeof fetch;
      logger?: LoggerLike;
    }
  ) {}

  get fetchImpl(): typeof fetch {
    return this.options.fetchImpl ?? fetch;
  }

  get baseUrl(): string {
    return this.options.baseUrl;
  }

  private async refreshAccessToken(): Promise<string> {
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

        this.options.accessToken = next;
        this.consecutiveAuthFailures = 0;
        this.authCooldownUntil = 0;
        this.options.logger?.info("refreshed Speakeasy access token after 401");
        return next;
      })().finally(() => {
        this.refreshPromise = undefined;
      });
    }

    return this.refreshPromise;
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    retryOptions: RetryOptions = {}
  ): Promise<T> {
    const attempts = retryOptions.attempts ?? 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        if (this.authCooldownUntil > Date.now()) {
          throw new SpeakeasyApiError(
            `Speakeasy auth cooling down until ${new Date(this.authCooldownUntil).toISOString()}`,
            401,
            undefined,
            false,
            this.authCooldownUntil - Date.now()
          );
        }
        const headers = buildAgentAuthHeaders(this.options.accessToken, {
          ...(init.headers as Record<string, string> | undefined),
          ...(retryOptions.idempotencyKey ? { "Idempotency-Key": retryOptions.idempotencyKey } : {})
        });
        const response = await this.fetchImpl(new URL(path, this.options.baseUrl), {
          ...init,
          headers,
          ...(retryOptions.signal ? { signal: retryOptions.signal } : {})
        });

        if (!response.ok) {
          const responseBody = await safeJson(response);
          const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
          const retryable = response.status >= 500;
          throw new SpeakeasyApiError(
            `Speakeasy request failed: ${init.method ?? "GET"} ${path} -> ${response.status}`,
            response.status,
            responseBody,
            retryable,
            retryAfterMs
          );
        }

        if (response.status === 204) {
          return undefined as T;
        }

        return (await response.json()) as T;
      } catch (error) {
        if (error instanceof SpeakeasyApiError && error.status === 401) {
          this.consecutiveAuthFailures += 1;

          if (this.options.refreshToken && attempt === 1) {
            this.options.logger?.warn("Speakeasy access token rejected; attempting refresh", { path });
            try {
              await this.refreshAccessToken();
              continue;
            } catch (refreshError) {
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
        const retryable =
          error instanceof SpeakeasyApiError ? error.retryable : error instanceof TypeError;

        if (!retryable || attempt === attempts) {
          throw error;
        }

        this.options.logger?.warn("retrying Speakeasy API request", {
          attempt,
          path
        });
        await delay(error instanceof SpeakeasyApiError && error.retryAfterMs ? error.retryAfterMs : 250 * attempt, retryOptions.signal);
      }
    }

    throw lastError;
  }

  getMe(signal?: AbortSignal): Promise<SpeakeasyAgentProfile> {
    return this.request("/api/v1/agent/me", { method: "GET" }, { signal });
  }

  async getMeIfAvailable(signal?: AbortSignal): Promise<SpeakeasyAgentProfile | undefined> {
    try {
      return await this.request("/api/v1/agent/me", { method: "GET" }, { signal, attempts: 1 });
    } catch (error) {
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

  async probeConnectivity(signal?: AbortSignal): Promise<SpeakeasyConnectivityProbe> {
    const profile = await this.getMeIfAvailable(signal);

    if (profile) {
      return {
        endpoint: "agent/me",
        degraded: false,
        profile
      };
    }

    const topics = await this.listTopics(signal);
    const topicCount = Object.keys(topics.records.topics?.data ?? {}).length;

    return {
      endpoint: "agent/topics",
      degraded: true,
      warning:
        "GET /api/v1/agent/me was unavailable or rate limited; connectivity verified with GET /api/v1/agent/topics instead.",
      topicCount
    };
  }

  setTyping(topicId: string, typing: boolean, signal?: AbortSignal): Promise<void> {
    return this.request(
      `/api/v1/agent/topics/${topicId}/typing`,
      {
        method: "PATCH",
        body: JSON.stringify({ typing })
      },
      {
        signal,
        idempotencyKey: createIdempotencyKey(`typing-${topicId}-${typing ? "on" : "off"}`),
        attempts: 1
      }
    );
  }

  updateMe(displayName: string, signal?: AbortSignal): Promise<SpeakeasyAgentProfile> {
    return this.request(
      "/api/v1/agent/me",
      {
        method: "PATCH",
        body: JSON.stringify({
          display_name: displayName
        })
      },
      {
        signal,
        idempotencyKey: createIdempotencyKey("agent-profile")
      }
    );
  }

  listTopics(signal?: AbortSignal): Promise<SpeakeasyTopicsResponse> {
    return this.request("/api/v1/agent/topics", { method: "GET" }, { signal });
  }

  getTopic(topicId: string, signal?: AbortSignal): Promise<{ records: { topics?: { data: Record<string, SpeakeasyTopic> } } }> {
    return this.request(`/api/v1/agent/topics/${topicId}`, { method: "GET" }, { signal });
  }

  getParticipants(topicId: string, signal?: AbortSignal): Promise<{ records: { participants?: { data: Record<string, SpeakeasyParticipant> } } }> {
    return this.request(`/api/v1/agent/topics/${topicId}/participants`, { method: "GET" }, { signal });
  }

  getChats(topicId: string, cursor?: string, signal?: AbortSignal): Promise<SpeakeasyHistoryResponse> {
    const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return this.request(`/api/v1/agent/topics/${topicId}/chats${suffix}`, { method: "GET" }, { signal });
  }

  getChat(topicId: string, chatId: string, signal?: AbortSignal): Promise<{ records: { chats?: { data: Record<string, SpeakeasyChat> } } }> {
    return this.request(`/api/v1/agent/topics/${topicId}/chats/${chatId}`, { method: "GET" }, { signal });
  }

  createChat(
    topicId: string,
    chat: SpeakeasyChatWriteInput,
    options: RetryOptions = {}
  ): Promise<{ records?: unknown; chat?: SpeakeasyChat }> {
    return this.request(
      `/api/v1/agent/topics/${topicId}/chats`,
      {
        method: "POST",
        body: JSON.stringify({
          chat
        })
      },
      {
        ...options,
        idempotencyKey: options.idempotencyKey ?? createIdempotencyKey(`chat-create-${topicId}`)
      }
    );
  }

  updateChat(
    topicId: string,
    chatId: string,
    chat: SpeakeasyChatWriteInput,
    options: RetryOptions = {}
  ): Promise<{ records?: unknown; chat?: SpeakeasyChat }> {
    return this.request(
      `/api/v1/agent/topics/${topicId}/chats/${chatId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          chat
        })
      },
      {
        ...options,
        idempotencyKey: options.idempotencyKey ?? createIdempotencyKey(`chat-update-${topicId}-${chatId}`)
      }
    );
  }

  deleteChat(topicId: string, chatId: string, options: RetryOptions = {}): Promise<void> {
    return this.request(
      `/api/v1/agent/topics/${topicId}/chats/${chatId}`,
      {
        method: "DELETE"
      },
      {
        ...options,
        idempotencyKey: options.idempotencyKey ?? createIdempotencyKey(`chat-delete-${topicId}-${chatId}`)
      }
    );
  }

  createDirectChat(payload: SpeakeasyDirectChatCreateRequest, options: RetryOptions = {}): Promise<{
    records?: unknown;
    topic?: SpeakeasyTopic;
    chat?: SpeakeasyChat;
  }> {
    return this.request(
      "/api/v1/agent/direct_chats",
      {
        method: "POST",
        body: JSON.stringify(payload)
      },
      {
        ...options,
        idempotencyKey: options.idempotencyKey ?? createIdempotencyKey(`direct-chat-${payload.handle}`)
      }
    );
  }

  pollEvents(cursor?: string, signal?: AbortSignal): Promise<SpeakeasyPollingEventsResponse> {
    const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return this.request(`/api/v1/agent/events${suffix}`, { method: "GET" }, { signal });
  }

  createDirectUpload(payload: DirectUploadRequest, signal?: AbortSignal): Promise<DirectUploadResponse> {
    return this.request(
      "/api/v1/files",
      {
        method: "POST",
        body: JSON.stringify(payload)
      },
      {
        signal,
        idempotencyKey: createIdempotencyKey("direct-upload")
      }
    );
  }

  async uploadBytes(params: {
    url: string;
    headers: Record<string, string>;
    body: Uint8Array;
    signal?: AbortSignal;
  }): Promise<void> {
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

  extractTopicFromResponse(payload: { records?: unknown; topic?: SpeakeasyTopic }): SpeakeasyTopic | undefined {
    if (payload.topic) {
      return payload.topic;
    }

    const records = payload.records as { topics?: { data: Record<string, SpeakeasyTopic> } } | undefined;
    return records?.topics ? Object.values(records.topics.data)[0] : undefined;
  }

  extractChatFromResponse(payload: { records?: unknown; chat?: SpeakeasyChat }): SpeakeasyChat | undefined {
    if (payload.chat) {
      return payload.chat;
    }

    const records = payload.records as { chats?: { data: Record<string, SpeakeasyChat> } } | undefined;
    return records?.chats ? Object.values(records.chats.data)[0] : undefined;
  }

  topicIdFromTopic(topic: SpeakeasyTopic | undefined): string | undefined {
    return normalizeId(topic?.id);
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}


function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return Math.round(secs * 1000);
  const at = Date.parse(value);
  if (Number.isFinite(at)) {
    const delta = at - Date.now();
    return delta > 0 ? delta : 0;
  }
  return undefined;
}
