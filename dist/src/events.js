import { createHmac, timingSafeEqual } from "node:crypto";
import { enrichCanonicalEvent } from "./mapping.js";
import { hasSeenEventId, rememberEventId } from "./utils.js";
export function normalizePollingEvents(events, conversationKinds) {
    return events.map((event) => normalizeCanonicalEvent("polling", event, conversationKinds[String(event.topic_id ?? "")]));
}
export function normalizeWebhookEvent(event, conversationKinds) {
    return normalizeCanonicalEvent("webhook", event, conversationKinds[String(event.topic_id ?? "")]);
}
export function normalizeWebsocketMessage(params) {
    if ("type" in params.message) {
        if (params.message.type === "ping" ||
            params.message.type === "welcome" ||
            params.message.type === "confirm_subscription") {
            return { kind: "noop" };
        }
        if (params.message.type === "reject_subscription") {
            return { kind: "recoverable-error", code: "rejected" };
        }
    }
    const candidate = params.message.message;
    if (!candidate) {
        return { kind: "noop" };
    }
    if (typeof candidate === "object" && candidate !== null && "error" in candidate && candidate.error) {
        return {
            kind: "recoverable-error",
            code: candidate.error.code,
            recovery: candidate.error.recovery
        };
    }
    return {
        kind: "event",
        event: normalizeCanonicalEvent("websocket", candidate, params.conversationKinds[String(candidate.topic_id ?? "")])
    };
}
export function normalizeCanonicalEvent(transport, event, knownKind) {
    return enrichCanonicalEvent({
        transport,
        envelope: event,
        conversationKind: knownKind
    });
}
export function dedupeEvent(state, eventId) {
    if (hasSeenEventId(state, eventId)) {
        return {
            state,
            duplicate: true
        };
    }
    return {
        state: rememberEventId(state, eventId),
        duplicate: false
    };
}
export function verifyWebhookSignature(params) {
    const actual = createHmac("sha256", params.secret).update(params.rawBody).digest("hex");
    const provided = params.signatureHeader?.trim();
    if (!provided) {
        return false;
    }
    const actualBuffer = Buffer.from(actual, "utf8");
    const providedBuffer = Buffer.from(provided, "utf8");
    return actualBuffer.length === providedBuffer.length && timingSafeEqual(actualBuffer, providedBuffer);
}
//# sourceMappingURL=events.js.map