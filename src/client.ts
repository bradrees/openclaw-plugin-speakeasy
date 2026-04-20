import type {
  DirectUploadRequest,
  DirectUploadResponse,
  LoggerLike,
  SpeakeasyAuthRefreshResult,
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
import {
  SpeakeasyAuthRefreshError,
  buildAgentAuthHeaders,
  isSpeakeasyAccessTokenExpired,
  refreshAccessToken,
  resolveSpeakeasyAccessTokenExpiryText
} from "./auth.js";
import { createIdempotencyKey, delay, normalizeId } from "./utils.js";

const AUTH_COOLDOWN_MS = 60_000;

export class SpeakeasyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
    readonly retryable = false,
    readonly retryAfterMs?: number,
    readonly code?: string
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
  private refreshPromise?: Promise<SpeakeasyAuthRefreshResult>;
  private authCooldownUntil = 0;
  private consecutiveAuthFailures = 0;

  constructor(
    private readonly options: {
      baseUrl: string;
      accessToken: string;
      refreshToken?: string;
      expiresAt?: string;
      fetchImpl?: typeof fetch;
      logger?: LoggerLike;
      onAuthUpdated?: (auth: SpeakeasyAuthRefreshResult) => Promise<void> | void;
      syncAuthState?: () =>
        | Promise<
            | {
                accessToken: string;
                refreshToken?: string;
                expiresAt?: string;
                agentHandle?: string;
              }
            | undefined
          >
        | {
            accessToken: string;
            refreshToken?: string;
            expiresAt?: string;
            agentHandle?: string;
          }
        | undefined;
    }
  ) {}

  get fetchImpl(): typeof fetch {
    return this.options.fetchImpl ?? fetch;
  }

  get baseUrl(): string {
    return this.options.baseUrl;
  }

  get accessToken(): string {
    return this.options.accessToken;
  }

  private async syncAuthState(): Promise<void> {
    const next = await this.options.syncAuthState?.();

    if (!next) {
      return;
    }

    const credentialsChanged =
      next.accessToken !== this.options.accessToken || next.refreshToken !== this.options.refreshToken;

    this.options.accessToken = next.accessToken;
    this.options.refreshToken = next.refreshToken;
    this.options.expiresAt = next.expiresAt;

    if (credentialsChanged) {
      this.consecutiveAuthFailures = 0;
      this.authCooldownUntil = 0;
    }
  }

  async ensureFreshAccessToken(reason: string): Promise<string> {
    await this.syncAuthState();

    if (
      !this.options.refreshToken ||
      !isSpeakeasyAccessTokenExpired(this.options.accessToken, { expiresAt: this.options.expiresAt })
    ) {
      return this.options.accessToken;
    }

    this.options.logger?.info("Speakeasy access token expired; refreshing before request", {
      reason
    });
    try {
      await this.refreshAccessToken();
    } catch (error) {
      if (this.isRefreshRejected(error)) {
        throw this.enterManualReauthCooldown({
          reason: "refresh rejected by Speakeasy",
          trigger: reason,
          error
        });
      }

      throw error;
    }

    return this.options.accessToken;
  }

  private async refreshAccessToken(): Promise<SpeakeasyAuthRefreshResult> {
    await this.syncAuthState();

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
        this.options.expiresAt = next.expiresAt ?? resolveSpeakeasyAccessTokenExpiryText(next.accessToken);
        this.consecutiveAuthFailures = 0;
        this.authCooldownUntil = 0;
        if (this.options.onAuthUpdated) {
          try {
            await this.options.onAuthUpdated({
              accessToken: this.options.accessToken,
              refreshToken: this.options.refreshToken,
              ...(this.options.expiresAt ? { expiresAt: this.options.expiresAt } : {}),
              ...(next.agentHandle ? { agentHandle: next.agentHandle } : {})
            });
          } catch (error) {
            this.options.logger?.warn("failed to persist refreshed Speakeasy auth", {
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
        this.options.logger?.info("refreshed Speakeasy access token after 401");
        return {
          accessToken: this.options.accessToken,
          refreshToken: this.options.refreshToken,
          ...(this.options.expiresAt ? { expiresAt: this.options.expiresAt } : {}),
          ...(next.agentHandle ? { agentHandle: next.agentHandle } : {})
        };
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
        await this.syncAuthState();

        if (this.authCooldownUntil > Date.now()) {
          throw new SpeakeasyApiError(
            `Speakeasy auth cooling down until ${new Date(this.authCooldownUntil).toISOString()}`,
            401,
            undefined,
            false,
            this.authCooldownUntil - Date.now(),
            "auth_cooldown"
          );
        }
        const accessToken = await this.ensureFreshAccessToken(`${init.method ?? "GET"} ${path}`);
        const headers = buildAgentAuthHeaders(accessToken, {
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
          const retryable = response.status >= 500 || response.status === 429;
          const retryAfterMs = parseRetryAfterMs(response.headers?.get?.("retry-after") ?? null);
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
          if (error.code === "manual_reauth_required" || error.code === "auth_cooldown") {
            throw error;
          }

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

              if (this.isRefreshRejected(refreshError)) {
                throw this.enterManualReauthCooldown({
                  reason: "refresh rejected by Speakeasy",
                  path,
                  error: refreshError
                });
              }
            }
          }

          if (this.consecutiveAuthFailures >= 2) {
            this.authCooldownUntil = Date.now() + AUTH_COOLDOWN_MS;
            this.options.logger?.warn("Speakeasy auth entering cooldown after repeated 401 responses", {
              path,
              cooldownMs: AUTH_COOLDOWN_MS,
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
          path,
          backoffMs:
            error instanceof SpeakeasyApiError && error.retryAfterMs !== undefined
              ? error.retryAfterMs
              : 250 * attempt
        });
        await delay(
          error instanceof SpeakeasyApiError && error.retryAfterMs !== undefined
            ? error.retryAfterMs
            : 250 * attempt,
          retryOptions.signal
        );
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

    return this.probeTopicsConnectivity(
      signal,
      "GET /api/v1/agent/me was unavailable or rate limited; connectivity verified with GET /api/v1/agent/topics instead."
    );
  }

  async probeTopicsConnectivity(signal?: AbortSignal, warning?: string): Promise<SpeakeasyConnectivityProbe> {
    const topics = await this.listTopics(signal);
    const topicCount = Object.keys(topics.records.topics?.data ?? {}).length;

    return {
      endpoint: "agent/topics",
      degraded: Boolean(warning),
      ...(warning ? { warning } : {}),
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
    return this.request(`/api/v1/agent/events${suffix}`, { method: "GET" }, { signal, attempts: 1 });
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

  private isRefreshRejected(error: unknown): error is SpeakeasyAuthRefreshError {
    return (
      error instanceof SpeakeasyAuthRefreshError &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 429
    );
  }

  private enterManualReauthCooldown(params: {
    reason: string;
    path?: string;
    trigger?: string;
    error?: unknown;
  }): SpeakeasyApiError {
    const status =
      params.error instanceof SpeakeasyAuthRefreshError ? params.error.status : 401;
    const message = "Speakeasy automatic auth recovery is unavailable; manual reauth is required";

    this.authCooldownUntil = Date.now() + AUTH_COOLDOWN_MS;
    this.consecutiveAuthFailures = 0;

    this.options.logger?.warn(message, {
      reason: params.reason,
      ...(params.path ? { path: params.path } : {}),
      ...(params.trigger ? { trigger: params.trigger } : {}),
      status,
      cooldownMs: AUTH_COOLDOWN_MS
    });

    return new SpeakeasyApiError(
      message,
      status,
      {
        reason: params.reason,
        ...(params.path ? { path: params.path } : {}),
        ...(params.trigger ? { trigger: params.trigger } : {})
      },
      false,
      AUTH_COOLDOWN_MS,
      "manual_reauth_required"
    );
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
