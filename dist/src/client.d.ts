import type { DirectUploadRequest, DirectUploadResponse, LoggerLike, SpeakeasyAgentProfile, SpeakeasyChat, SpeakeasyChatWriteInput, SpeakeasyDirectChatCreateRequest, SpeakeasyHistoryResponse, SpeakeasyParticipant, SpeakeasyPollingEventsResponse, SpeakeasyTopic, SpeakeasyTopicsResponse } from "./types.js";
export declare class SpeakeasyApiError extends Error {
    readonly status: number;
    readonly body?: unknown | undefined;
    readonly retryable: boolean;
    constructor(message: string, status: number, body?: unknown | undefined, retryable?: boolean);
}
type RetryOptions = {
    attempts?: number;
    signal?: AbortSignal;
    idempotencyKey?: string;
};
export declare class SpeakeasyApiClient {
    private readonly options;
    constructor(options: {
        baseUrl: string;
        accessToken: string;
        fetchImpl?: typeof fetch;
        logger?: LoggerLike;
    });
    get fetchImpl(): typeof fetch;
    get baseUrl(): string;
    private request;
    getMe(signal?: AbortSignal): Promise<SpeakeasyAgentProfile>;
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
}
export {};
//# sourceMappingURL=client.d.ts.map