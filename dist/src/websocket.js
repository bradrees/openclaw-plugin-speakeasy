import { normalizeWebsocketMessage } from "./events.js";
import { delay } from "./utils.js";
export class SpeakeasyWebSocketConnection {
    params;
    abortController;
    socket;
    reconnectDelayMs = 1_000;
    constructor(params) {
        this.params = params;
    }
    async start() {
        this.abortController = new AbortController();
        await this.connect(this.abortController.signal);
    }
    async stop() {
        this.abortController?.abort();
        this.socket?.close();
    }
    async connect(signal) {
        while (!signal.aborted) {
            try {
                const WebSocketImpl = this.resolveWebSocketFactory();
                const cursor = await this.params.getCursor();
                const url = new URL("/cable", this.params.client.baseUrl);
                url.searchParams.set("agent_access_token", this.params.accessToken);
                const socket = new WebSocketImpl(url.toString());
                this.socket = socket;
                socket.addEventListener("open", () => {
                    socket.send(JSON.stringify({
                        command: "subscribe",
                        identifier: JSON.stringify({
                            channel: "AgentEventsChannel",
                            ...(cursor ? { cursor } : {})
                        })
                    }));
                });
                socket.addEventListener("message", async (event) => {
                    if (!event.data) {
                        return;
                    }
                    const parsed = JSON.parse(String(event.data));
                    const normalized = normalizeWebsocketMessage({
                        message: parsed,
                        conversationKinds: await this.params.getConversationKinds()
                    });
                    if (normalized.kind === "event") {
                        await this.params.onEvent(normalized.event);
                        await this.params.setCursor(normalized.event.id);
                        this.reconnectDelayMs = 1_000;
                        return;
                    }
                    if (normalized.kind === "recoverable-error") {
                        this.params.logger.warn("Speakeasy websocket requested polling recovery", {
                            code: normalized.code,
                            recovery: normalized.recovery
                        });
                        await this.params.onRecoverableGap(normalized.code);
                        socket.close();
                    }
                });
                socket.addEventListener("close", async () => {
                    if (signal.aborted) {
                        return;
                    }
                    this.params.logger.warn("Speakeasy websocket disconnected", {
                        reconnectDelayMs: this.reconnectDelayMs
                    });
                    await delay(this.reconnectDelayMs, signal).catch(() => undefined);
                    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 30_000);
                });
                return;
            }
            catch (error) {
                this.params.logger.warn("Speakeasy websocket connect failed", {
                    error: error instanceof Error ? error.message : String(error),
                    reconnectDelayMs: this.reconnectDelayMs
                });
                await delay(this.reconnectDelayMs, signal).catch(() => undefined);
                this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 30_000);
            }
        }
    }
    resolveWebSocketFactory() {
        if (this.params.websocketFactory) {
            return this.params.websocketFactory;
        }
        const candidate = globalThis.WebSocket;
        if (!candidate) {
            throw new Error("No global WebSocket implementation is available");
        }
        return candidate;
    }
}
//# sourceMappingURL=websocket.js.map