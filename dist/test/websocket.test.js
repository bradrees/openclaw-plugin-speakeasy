import { afterEach, describe, expect, it, vi } from "vitest";
import { SpeakeasyWebSocketConnection } from "../src/websocket.js";
class FakeWebSocket {
    url;
    static instances = [];
    listeners = new Map();
    sent = [];
    closed = false;
    constructor(url) {
        this.url = url;
        FakeWebSocket.instances.push(this);
    }
    addEventListener(name, listener) {
        this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
    }
    send(data) {
        this.sent.push(data);
    }
    close() {
        if (this.closed) {
            return;
        }
        this.closed = true;
        this.emit("close");
    }
    emit(name, event) {
        for (const listener of this.listeners.get(name) ?? []) {
            listener(event);
        }
    }
}
function createConnection(overrides = {}) {
    return new SpeakeasyWebSocketConnection({
        client: {
            baseUrl: "https://speakeasy.example.com"
        },
        accessToken: "token",
        logger: {
            debug: () => undefined,
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined
        },
        heartbeatMs: 1_000,
        getCursor: async () => "opaque-cursor",
        getConversationKinds: async () => ({}),
        onEvent: async () => undefined,
        onRecoverableGap: async () => undefined,
        websocketFactory: FakeWebSocket,
        ...overrides
    });
}
describe("websocket", () => {
    afterEach(() => {
        FakeWebSocket.instances = [];
        vi.useRealTimers();
    });
    it("reconnects after an unexpected close", async () => {
        vi.useFakeTimers();
        const connection = createConnection();
        await connection.start();
        expect(FakeWebSocket.instances).toHaveLength(1);
        const first = FakeWebSocket.instances[0];
        first.emit("open");
        first.close();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(FakeWebSocket.instances).toHaveLength(2);
        await connection.stop();
    });
    it("closes and reconnects stale sockets after heartbeat timeout", async () => {
        vi.useFakeTimers();
        const connection = createConnection();
        await connection.start();
        const first = FakeWebSocket.instances[0];
        first.emit("open");
        await vi.advanceTimersByTimeAsync(2_000);
        expect(first.closed).toBe(true);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(FakeWebSocket.instances).toHaveLength(2);
        await connection.stop();
    });
    it("backs off reconnects while polling catches up from websocket gaps", async () => {
        vi.useFakeTimers();
        const onRecoverableGap = vi.fn(async () => undefined);
        const connection = createConnection({
            onRecoverableGap
        });
        await connection.start();
        const first = FakeWebSocket.instances[0];
        first.emit("open");
        first.emit("message", {
            data: JSON.stringify({
                message: {
                    error: {
                        code: "cursor_gap",
                        recoverable: true,
                        recovery: "poll"
                    }
                }
            })
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(onRecoverableGap).toHaveBeenCalledWith("cursor_gap");
        expect(first.closed).toBe(true);
        await vi.advanceTimersByTimeAsync(9_999);
        expect(FakeWebSocket.instances).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(FakeWebSocket.instances).toHaveLength(2);
        await connection.stop();
    });
});
//# sourceMappingURL=websocket.test.js.map