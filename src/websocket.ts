import type { CanonicalInboundEvent, LoggerLike } from "./types.js";
import { SpeakeasyApiClient } from "./client.js";
import { normalizeWebsocketMessage, type WebsocketEnvelope } from "./events.js";
import { delay } from "./utils.js";

type WebSocketLike = {
  close: () => void;
  send: (data: string) => void;
  addEventListener: (name: string, listener: (event: { data?: string }) => void) => void;
  removeEventListener?: (name: string, listener: (event: { data?: string }) => void) => void;
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

export class SpeakeasyWebSocketConnection {
  private abortController?: AbortController;
  private socket?: WebSocketLike;
  private reconnectDelayMs = 1_000;

  constructor(private readonly params: WebSocketParams) {}

  async start(): Promise<void> {
    this.abortController = new AbortController();
    await this.connect(this.abortController.signal);
  }

  async stop(): Promise<void> {
    this.abortController?.abort();
    this.socket?.close();
  }

  private async connect(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const WebSocketImpl = this.resolveWebSocketFactory();
        const cursor = await this.params.getCursor();
        const url = new URL("/cable", this.params.client.baseUrl);
        url.searchParams.set("agent_access_token", this.params.accessToken);
        const socket = new WebSocketImpl(url.toString());
        this.socket = socket;

        await new Promise<void>((resolve, reject) => {
          let settled = false;
          let heartbeat: ReturnType<typeof setInterval> | undefined;

          const cleanup = () => {
            if (heartbeat) clearInterval(heartbeat);
            socket.removeEventListener?.("open", onOpen);
            socket.removeEventListener?.("message", onMessage);
            socket.removeEventListener?.("close", onClose);
            socket.removeEventListener?.("error", onError);
          };

          const finish = (fn: () => void) => {
            if (settled) return;
            settled = true;
            cleanup();
            fn();
          };

          const onOpen = () => {
            socket.send(JSON.stringify({
              command: "subscribe",
              identifier: JSON.stringify({
                channel: "AgentEventsChannel",
                ...(cursor ? { cursor } : {})
              })
            }));

            heartbeat = setInterval(() => {
              try {
                socket.send(JSON.stringify({ type: "ping", message: Date.now() }));
              } catch {}
            }, this.params.heartbeatMs);
          };

          const onMessage = async (event: { data?: string }) => {
            if (!event.data) return;
            const parsed = JSON.parse(String(event.data)) as WebsocketEnvelope;
            const normalized = normalizeWebsocketMessage({
              message: parsed,
              conversationKinds: await this.params.getConversationKinds()
            });

            if (normalized.kind === "noop") {
              if ((parsed as { type?: string }).type === "confirm_subscription") {
                this.params.logger.info("Speakeasy websocket subscribed", { cursor: cursor ?? null });
                this.reconnectDelayMs = 1_000;
                finish(resolve);
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
              await this.params.onRecoverableGap(normalized.code);
              finish(() => reject(new Error(`recoverable websocket gap: ${normalized.code}`)));
              try { socket.close(); } catch {}
            }
          };

          const onClose = () => {
            finish(() => reject(new Error("websocket closed")));
          };

          const onError = () => {
            finish(() => reject(new Error("websocket error")));
          };

          socket.addEventListener("open", onOpen);
          socket.addEventListener("message", onMessage);
          socket.addEventListener("close", onClose);
          socket.addEventListener("error", onError as (event: { data?: string }) => void);

          signal.addEventListener("abort", () => {
            try { socket.close(); } catch {}
            finish(resolve);
          }, { once: true });
        });

        return;
      } catch (error) {
        if (signal.aborted) return;
        this.params.logger.warn("Speakeasy websocket connect failed", {
          error: error instanceof Error ? error.message : String(error),
          reconnectDelayMs: this.reconnectDelayMs
        });
        await delay(this.reconnectDelayMs, signal).catch(() => undefined);
        this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 30_000);
      }
    }
  }

  private resolveWebSocketFactory(): WebSocketCtor {
    if (this.params.websocketFactory) {
      return this.params.websocketFactory;
    }

    const candidate = globalThis.WebSocket as unknown;

    if (!candidate) {
      throw new Error("No global WebSocket implementation is available");
    }

    return candidate as WebSocketCtor;
  }
}
