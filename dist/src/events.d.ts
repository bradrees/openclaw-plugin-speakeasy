import type { CanonicalInboundEvent, ConversationKind, CursorState, SpeakeasyAgentEventEnvelope, SpeakeasyTransport } from "./types.js";
export type WebsocketEnvelope = {
    type: "ping" | "welcome" | "confirm_subscription";
    message?: unknown;
    identifier?: string;
} | {
    type: "reject_subscription";
    identifier?: string;
} | {
    message?: SpeakeasyAgentEventEnvelope | {
        error?: {
            code: string;
            recoverable?: boolean;
            recovery?: string;
        };
    };
    identifier?: string;
};
export declare function normalizePollingEvents(events: SpeakeasyAgentEventEnvelope[], conversationKinds: CursorState["conversationKinds"]): CanonicalInboundEvent[];
export declare function normalizeWebhookEvent(event: SpeakeasyAgentEventEnvelope, conversationKinds: CursorState["conversationKinds"]): CanonicalInboundEvent;
export declare function normalizeWebsocketMessage(params: {
    message: WebsocketEnvelope;
    conversationKinds: CursorState["conversationKinds"];
}): {
    kind: "event";
    event: CanonicalInboundEvent;
} | {
    kind: "noop";
} | {
    kind: "recoverable-error";
    code: string;
    recovery?: string;
};
export declare function normalizeCanonicalEvent(transport: SpeakeasyTransport, event: SpeakeasyAgentEventEnvelope, knownKind?: ConversationKind): CanonicalInboundEvent;
export declare function dedupeEvent(state: CursorState, eventId: string): {
    state: CursorState;
    duplicate: boolean;
};
export declare function verifyWebhookSignature(params: {
    secret: string;
    rawBody: string;
    signatureHeader?: string | null;
}): boolean;
//# sourceMappingURL=events.d.ts.map