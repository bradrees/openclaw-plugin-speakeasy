import { createHmac, timingSafeEqual } from "node:crypto";

import type {
  CanonicalInboundEvent,
  ConversationKind,
  CursorState,
  SpeakeasyAgentEventEnvelope,
  SpeakeasyTransport
} from "./types.js";
import { enrichCanonicalEvent } from "./mapping.js";
import { hasSeenEventId, rememberEventId } from "./utils.js";

export type WebsocketEnvelope =
  | {
      type: "ping" | "welcome" | "confirm_subscription";
      message?: unknown;
      identifier?: string;
    }
  | {
      type: "reject_subscription";
      identifier?: string;
    }
  | {
      message?: SpeakeasyAgentEventEnvelope | { error?: { code: string; recoverable?: boolean; recovery?: string } };
      identifier?: string;
    };

export function normalizePollingEvents(
  events: SpeakeasyAgentEventEnvelope[],
  conversationKinds: CursorState["conversationKinds"]
): CanonicalInboundEvent[] {
  return events.map((event) =>
    normalizeCanonicalEvent("polling", event, conversationKinds[String(event.topic_id ?? "")])
  );
}

export function normalizeWebhookEvent(
  event: SpeakeasyAgentEventEnvelope,
  conversationKinds: CursorState["conversationKinds"]
): CanonicalInboundEvent {
  return normalizeCanonicalEvent("webhook", event, conversationKinds[String(event.topic_id ?? "")]);
}

export function normalizeWebsocketMessage(params: {
  message: WebsocketEnvelope;
  conversationKinds: CursorState["conversationKinds"];
}):
  | { kind: "event"; event: CanonicalInboundEvent }
  | { kind: "noop" }
  | { kind: "recoverable-error"; code: string; recovery?: string } {
  if ("type" in params.message) {
    if (
      params.message.type === "ping" ||
      params.message.type === "welcome" ||
      params.message.type === "confirm_subscription"
    ) {
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
      code: (candidate.error as { code: string }).code,
      recovery: (candidate.error as { recovery?: string }).recovery
    };
  }

  return {
    kind: "event",
    event: normalizeCanonicalEvent(
      "websocket",
      candidate as SpeakeasyAgentEventEnvelope,
      params.conversationKinds[String((candidate as SpeakeasyAgentEventEnvelope).topic_id ?? "")]
    )
  };
}

export function normalizeCanonicalEvent(
  transport: SpeakeasyTransport,
  event: SpeakeasyAgentEventEnvelope,
  knownKind?: ConversationKind
): CanonicalInboundEvent {
  return enrichCanonicalEvent({
    transport,
    envelope: event,
    conversationKind: knownKind
  });
}

export function dedupeEvent(state: CursorState, eventId: string): { state: CursorState; duplicate: boolean } {
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

export function verifyWebhookSignature(params: {
  secret: string;
  rawBody: string;
  signatureHeader?: string | null;
}): boolean {
  const actual = createHmac("sha256", params.secret).update(params.rawBody).digest("hex");
  const provided = params.signatureHeader?.trim();

  if (!provided) {
    return false;
  }

  const actualBuffer = Buffer.from(actual, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");

  return actualBuffer.length === providedBuffer.length && timingSafeEqual(actualBuffer, providedBuffer);
}
