import { normalizeWebsocketMessage } from "./events.js";
export class SpeakeasyWebSocketConnection {
    params;
    abortController;
    socket;
    reconnectTimer;
    heartbeatTimer;
    connecting = false;
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
        this.clearReconnectTimer();
        this.clearHeartbeatWatchdog();
        this.socket?.close();
    }
    async connect(signal) {
        if (signal.aborted || this.connecting) {
            return;
        }
        this.connecting = true;
        try {
            const WebSocketImpl = this.resolveWebSocketFactory();
            const cursor = await this.params.getCursor();
            const url = new URL("/cable", this.params.client.baseUrl);
            url.searchParams.set("agent_access_token", this.params.accessToken);
            const socket = new WebSocketImpl(url.toString());
            let reconnectFloorMs = 0;
            this.socket = socket;
            socket.addEventListener("open", () => {
                this.reconnectDelayMs = 1_000;
                this.noteSocketActivity(socket);
                socket.send(JSON.stringify({
                    command: "subscribe",
                    identifier: JSON.stringify({
                        channel: "AgentEventsChannel",
                        ...(cursor ? { cursor } : {})
                    })
                }));
            });
            socket.addEventListener("message", (event) => {
                void this.handleMessage(socket, event?.data, async (reason) => {
                    reconnectFloorMs = Math.max(reconnectFloorMs, Math.max(this.params.heartbeatMs, 10_000));
                    await this.params.onRecoverableGap(reason);
                    socket.close();
                }).catch((error) => {
                    this.params.logger.warn("Speakeasy websocket message handling failed", {
                        error: error instanceof Error ? error.message : String(error)
                    });
                    socket.close();
                });
            });
            socket.addEventListener("error", (event) => {
                this.params.logger.warn("Speakeasy websocket transport error", {
                    error: event?.error instanceof Error
                        ? event.error.message
                        : event?.message ?? "unknown websocket error"
                });
            });
            socket.addEventListener("close", () => {
                if (this.socket === socket) {
                    this.socket = undefined;
                }
                this.clearHeartbeatWatchdog();
                if (signal.aborted) {
                    return;
                }
                if (reconnectFloorMs > this.reconnectDelayMs) {
                    this.reconnectDelayMs = reconnectFloorMs;
                }
                this.params.logger.warn("Speakeasy websocket disconnected", {
                    reconnectDelayMs: this.reconnectDelayMs
                });
                this.scheduleReconnect(signal);
            });
        }
        catch (error) {
            if (!signal.aborted) {
                this.params.logger.warn("Speakeasy websocket connect failed", {
                    error: error instanceof Error ? error.message : String(error),
                    reconnectDelayMs: this.reconnectDelayMs
                });
                this.scheduleReconnect(signal);
            }
        }
        finally {
            this.connecting = false;
        }
    }
    async handleMessage(socket, rawData, onRecoverableGap) {
        if (!rawData) {
            return;
        }
        this.noteSocketActivity(socket);
        const parsed = JSON.parse(String(rawData));
        const normalized = normalizeWebsocketMessage({
            message: parsed,
            conversationKinds: await this.params.getConversationKinds()
        });
        if (normalized.kind === "noop") {
            if (parsed.type === "confirm_subscription") {
                this.params.logger.info("Speakeasy websocket subscribed");
                this.reconnectDelayMs = 1_000;
            }
            return;
        }
        if (normalized.kind === "event") {
            await this.params.onEvent(normalized.event);
            this.reconnectDelayMs = 1_000;
            return;
        }
        if (normalized.kind === "recoverable-error") {
            this.params.logger.warn("Speakeasy websocket requested polling recovery", {
                code: normalized.code,
                recovery: normalized.recovery
            });
            await onRecoverableGap(normalized.code);
        }
    }
    scheduleReconnect(signal) {
        if (signal.aborted || this.reconnectTimer) {
            return;
        }
        const reconnectDelayMs = this.reconnectDelayMs;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 30_000);
            void this.connect(signal);
        }, reconnectDelayMs);
    }
    clearReconnectTimer() {
        if (!this.reconnectTimer) {
            return;
        }
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
    }
    noteSocketActivity(socket) {
        if (this.socket !== socket) {
            return;
        }
        this.clearHeartbeatWatchdog();
        if (this.params.heartbeatMs <= 0) {
            return;
        }
        this.heartbeatTimer = setTimeout(() => {
            if (this.socket !== socket) {
                return;
            }
            this.params.logger.warn("Speakeasy websocket heartbeat timed out", {
                heartbeatMs: this.params.heartbeatMs
            });
            socket.close();
        }, this.params.heartbeatMs * 2);
    }
    clearHeartbeatWatchdog() {
        if (!this.heartbeatTimer) {
            return;
        }
        clearTimeout(this.heartbeatTimer);
        this.heartbeatTimer = undefined;
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