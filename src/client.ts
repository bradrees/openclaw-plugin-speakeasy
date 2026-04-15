import type {
  DirectUploadRequest,
  DirectUploadResponse,
  LoggerLike,
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
import { buildAgentAuthHeaders } from "./auth.js";
import { createIdempotencyKey, delay, normalizeId } from "./utils.js";

export class SpeakeasyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
    readonly retryable = false
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
  constructor(
    private readonly options: {
      baseUrl: string;
      accessToken: string;
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

  private async request<T>(
    path: string,
    init: RequestInit,
    retryOptions: RetryOptions = {}
  ): Promise<T> {
    const attempts = retryOptions.attempts ?? 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
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
          const retryable = response.status >= 500 || response.status === 429;
          throw new SpeakeasyApiError(
            `Speakeasy request failed: ${init.method ?? "GET"} ${path} -> ${response.status}`,
            response.status,
            responseBody,
            retryable
          );
        }

        if (response.status === 204) {
          return undefined as T;
        }

        return (await response.json()) as T;
      } catch (error) {
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
        await delay(250 * attempt, retryOptions.signal);
      }
    }

    throw lastError;
  }

  getMe(signal?: AbortSignal): Promise<SpeakeasyAgentProfile> {
    return this.request("/api/v1/agent/me", { method: "GET" }, { signal });
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
