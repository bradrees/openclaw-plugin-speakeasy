import type { CanonicalInboundEvent, LoggerLike } from "./types.js";
import { SpeakeasyApiClient } from "./client.js";
type WebSocketLike = {
    close: () => void;
    send: (data: string) => void;
    addEventListener: (name: string, listener: (event: {
        data?: string;
    }) => void) => void;
};
type WebSocketCtor = new (url: string) => WebSocketLike;
type WebSocketParams = {
    client: SpeakeasyApiClient;
    accessToken: string;
    logger: LoggerLike;
    heartbeatMs: number;
    getCursor: () => Promise<string | undefined>;
    getConversationKinds: () => Promise<Record<string, "topic" | "direct">>;
    onEvent: (event: CanonicalInboundEvent) => Promise<void>;
    onRecoverableGap: (reason: string) => Promise<void>;
    websocketFactory?: WebSocketCtor;
};
export declare class SpeakeasyWebSocketConnection {
    private readonly params;
    private abortController?;
    private socket?;
    private reconnectDelayMs;
    constructor(params: WebSocketParams);
    start(): Promise<void>;
    stop(): Promise<void>;
    private connect;
    private resolveWebSocketFactory;
}
export {};
//# sourceMappingURL=websocket.d.ts.map