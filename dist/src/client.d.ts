import type { DirectUploadRequest, DirectUploadResponse, LoggerLike, SpeakeasyAuthRefreshResult, SpeakeasyConnectivityProbe, SpeakeasyAgentProfile, SpeakeasyChat, SpeakeasyChatWriteInput, SpeakeasyDirectChatCreateRequest, SpeakeasyHistoryResponse, SpeakeasyParticipant, SpeakeasyPollingEventsResponse, SpeakeasyTopic, SpeakeasyTopicsResponse } from "./types.js";
export declare class SpeakeasyApiError extends Error {
    readonly status: number;
    readonly body?: unknown | undefined;
    readonly retryable: boolean;
    readonly retryAfterMs?: number | undefined;
    readonly code?: string | undefined;
    constructor(message: string, status: number, body?: unknown | undefined, retryable?: boolean, retryAfterMs?: number | undefined, code?: string | undefined);
}
type RetryOptions = {
    attempts?: number;
    signal?: AbortSignal;
    idempotencyKey?: string;
};
export declare class SpeakeasyApiClient {
    private readonly options;
    private refreshPromise?;
    private authCooldownUntil;
    private consecutiveAuthFailures;
    constructor(options: {
        baseUrl: string;
        accessToken: string;
        refreshToken?: string;
        expiresAt?: string;
        fetchImpl?: typeof fetch;
        logger?: LoggerLike;
        onAuthUpdated?: (auth: SpeakeasyAuthRefreshResult) => Promise<void> | void;
    });
    get fetchImpl(): typeof fetch;
    get baseUrl(): string;
    get accessToken(): string;
    ensureFreshAccessToken(reason: string): Promise<string>;
    private refreshAccessToken;
    private request;
    getMe(signal?: AbortSignal): Promise<SpeakeasyAgentProfile>;
    getMeIfAvailable(signal?: AbortSignal): Promise<SpeakeasyAgentProfile | undefined>;
    probeConnectivity(signal?: AbortSignal): Promise<SpeakeasyConnectivityProbe>;
    probeTopicsConnectivity(signal?: AbortSignal, warning?: string): Promise<SpeakeasyConnectivityProbe>;
    setTyping(topicId: string, typing: boolean, signal?: AbortSignal): Promise<void>;
    updateMe(displayName: string, signal?: AbortSignal): Promise<SpeakeasyAgentProfile>;
    listTopics(signal?: AbortSignal): Promise<SpeakeasyTopicsResponse>;
    getTopic(topicId: string, signal?: AbortSignal): Promise<{
        records: {
            topics?: {
                data: Record<string, SpeakeasyTopic>;
            };
        };
    }>;
    getParticipants(topicId: string, signal?: AbortSignal): Promise<{
        records: {
            participants?: {
                data: Record<string, SpeakeasyParticipant>;
            };
        };
    }>;
    getChats(topicId: string, cursor?: string, signal?: AbortSignal): Promise<SpeakeasyHistoryResponse>;
    getChat(topicId: string, chatId: string, signal?: AbortSignal): Promise<{
        records: {
            chats?: {
                data: Record<string, SpeakeasyChat>;
            };
        };
    }>;
    createChat(topicId: string, chat: SpeakeasyChatWriteInput, options?: RetryOptions): Promise<{
        records?: unknown;
        chat?: SpeakeasyChat;
    }>;
    updateChat(topicId: string, chatId: string, chat: SpeakeasyChatWriteInput, options?: RetryOptions): Promise<{
        records?: unknown;
        chat?: SpeakeasyChat;
    }>;
    deleteChat(topicId: string, chatId: string, options?: RetryOptions): Promise<void>;
    createDirectChat(payload: SpeakeasyDirectChatCreateRequest, options?: RetryOptions): Promise<{
        records?: unknown;
        topic?: SpeakeasyTopic;
        chat?: SpeakeasyChat;
    }>;
    pollEvents(cursor?: string, signal?: AbortSignal): Promise<SpeakeasyPollingEventsResponse>;
    createDirectUpload(payload: DirectUploadRequest, signal?: AbortSignal): Promise<DirectUploadResponse>;
    uploadBytes(params: {
        url: string;
        headers: Record<string, string>;
        body: Uint8Array;
        signal?: AbortSignal;
    }): Promise<void>;
    extractTopicFromResponse(payload: {
        records?: unknown;
        topic?: SpeakeasyTopic;
    }): SpeakeasyTopic | undefined;
    extractChatFromResponse(payload: {
        records?: unknown;
        chat?: SpeakeasyChat;
    }): SpeakeasyChat | undefined;
    topicIdFromTopic(topic: SpeakeasyTopic | undefined): string | undefined;
    private isRefreshRejected;
    private enterManualReauthCooldown;
}
export {};
//# sourceMappingURL=client.d.ts.map