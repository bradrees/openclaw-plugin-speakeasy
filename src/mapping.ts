import type {
  CanonicalConversationRef,
  CanonicalInboundEvent,
  ConversationKind,
  SpeakeasyAgentEventEnvelope,
  SpeakeasyParticipant,
  SpeakeasyTopic
} from "./types.js";
import { buildConversationId, buildConversationRef, inferConversationKind } from "./session-key-api.js";
import { normalizeId } from "./utils.js";

export function mapTopicToConversation(params: {
  topic: SpeakeasyTopic;
  kind?: ConversationKind;
  participants?: SpeakeasyParticipant[];
}): CanonicalConversationRef {
  return buildConversationRef({
    topic: params.topic,
    kind: params.kind,
    participantsCount: params.participants?.length
  });
}

export function mapDirectChatToConversation(topic: SpeakeasyTopic): CanonicalConversationRef {
  return buildConversationRef({
    topic,
    kind: "direct"
  });
}

export function mapEventToConversation(params: {
  envelope: SpeakeasyAgentEventEnvelope;
  conversationKind?: ConversationKind;
  participants?: SpeakeasyParticipant[];
}): CanonicalConversationRef {
  const topic =
    params.envelope.payload.topic ??
    ({
      id: params.envelope.topic_id ?? "",
      parent_topic_id: null,
      root_topic_id: params.envelope.topic_id ?? null,
      spawned_from_chat_id: null
    } satisfies SpeakeasyTopic);

  return mapTopicToConversation({
    topic,
    kind: params.conversationKind,
    participants: params.participants
  });
}

export function buildProviderMessageId(topicId: string, chatId: string): string {
  return `chat:${topicId}:${chatId}`;
}

export function buildParentConversationCandidates(topic: SpeakeasyTopic): string[] {
  const parentTopicId = normalizeId(topic.parent_topic_id);
  return parentTopicId ? [buildConversationId(parentTopicId, "topic")] : [];
}

export function detectConversationKind(params: {
  topic: SpeakeasyTopic;
  participants?: SpeakeasyParticipant[];
  knownKind?: ConversationKind;
}): ConversationKind {
  return inferConversationKind({
    explicitKind: params.knownKind,
    topic: params.topic,
    participantsCount: params.participants?.length
  });
}

export function enrichCanonicalEvent(params: {
  transport: CanonicalInboundEvent["transport"];
  envelope: SpeakeasyAgentEventEnvelope;
  conversationKind?: ConversationKind;
  participants?: SpeakeasyParticipant[];
}): CanonicalInboundEvent {
  const topic =
    params.envelope.payload.topic ??
    ({
      id: params.envelope.topic_id ?? "unknown",
      parent_topic_id: null,
      root_topic_id: params.envelope.topic_id ?? null,
      spawned_from_chat_id: null
    } satisfies SpeakeasyTopic);

  return {
    transport: params.transport,
    id: String(params.envelope.event_id),
    type: params.envelope.event_type,
    occurredAt: params.envelope.occurred_at,
    actorHandle: params.envelope.actor_handle ?? undefined,
    conversation: mapTopicToConversation({
      topic,
      kind: params.conversationKind,
      participants: params.participants
    }),
    topic: params.envelope.payload.topic,
    chat: params.envelope.payload.chat,
    timeline: params.envelope.payload.timeline,
    participant: params.envelope.payload.participant,
    raw: params.envelope
  };
}
