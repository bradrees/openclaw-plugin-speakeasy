import { describe, expect, it } from "vitest";
import { dedupeEvent, evaluateInboundPolicy, normalizePollingEvents, normalizeWebsocketMessage } from "../src/index.js";
const baseEnvelope = {
    id: 1,
    event_id: 1,
    event_type: "chat.created",
    occurred_at: "2026-04-15T00:00:00Z",
    topic_id: 10,
    chat_id: 20,
    actor_handle: "person@example.com",
    payload: {
        topic: {
            id: 10,
            parent_topic_id: null,
            root_topic_id: 10,
            spawned_from_chat_id: null
        },
        chat: {
            id: 20,
            topic_id: 10,
            author_handle: "person@example.com",
            plain: "hello @bot",
            html: "<div>hello @bot</div>",
            deleted: false,
            attachments: []
        }
    }
};
describe("events", () => {
    it("normalizes polling envelopes", () => {
        const [event] = normalizePollingEvents([baseEnvelope], {});
        expect(event).toBeDefined();
        expect(event.transport).toBe("polling");
        expect(event.conversation.conversationId).toBe("topic:10");
    });
    it("normalizes websocket envelopes", () => {
        const result = normalizeWebsocketMessage({
            message: {
                message: baseEnvelope
            },
            conversationKinds: {}
        });
        expect(result.kind).toBe("event");
        if (result.kind === "event") {
            expect(result.event.transport).toBe("websocket");
            expect(result.event.id).toBe("1");
        }
    });
    it("dedupes repeated event ids", () => {
        const first = dedupeEvent({
            recentEventIds: [],
            conversationKinds: {}
        }, "1");
        const second = dedupeEvent(first.state, "1");
        expect(first.duplicate).toBe(false);
        expect(second.duplicate).toBe(true);
    });
    it("filters self-authored and mention-only traffic", () => {
        const directDecision = evaluateInboundPolicy({
            event: normalizePollingEvents([baseEnvelope], {})[0],
            account: {
                accountId: "default",
                enabled: true,
                baseUrl: "https://example.com",
                accessToken: "token",
                botDisplayName: "@bot",
                transport: "websocket",
                cursorStore: { kind: "memory" },
                allowDirectMessages: true,
                allowTopicMessages: true,
                mentionOnly: true,
                debugLogging: false,
                pollIntervalMs: 5000,
                websocketHeartbeatMs: 30000
            }
        });
        expect(directDecision.allowed).toBe(true);
        const selfDecision = evaluateInboundPolicy({
            event: normalizePollingEvents([baseEnvelope], {})[0],
            account: {
                accountId: "default",
                enabled: true,
                baseUrl: "https://example.com",
                accessToken: "token",
                transport: "websocket",
                cursorStore: { kind: "memory" },
                allowDirectMessages: true,
                allowTopicMessages: true,
                mentionOnly: false,
                debugLogging: false,
                pollIntervalMs: 5000,
                websocketHeartbeatMs: 30000
            },
            agentHandle: "person@example.com"
        });
        expect(selfDecision.allowed).toBe(false);
        expect(selfDecision.reason).toContain("self-authored");
    });
});
//# sourceMappingURL=events.test.js.map