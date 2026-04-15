import { buildConversationId, buildConversationRef, inferConversationKind } from "./session-key-api.js";
import { normalizeId } from "./utils.js";
export function mapTopicToConversation(params) {
    return buildConversationRef({
        topic: params.topic,
        kind: params.kind,
        participantsCount: params.participants?.length
    });
}
export function mapDirectChatToConversation(topic) {
    return buildConversationRef({
        topic,
        kind: "direct"
    });
}
export function mapEventToConversation(params) {
    const topic = params.envelope.payload.topic ??
        {
            id: params.envelope.topic_id ?? "",
            parent_topic_id: null,
            root_topic_id: params.envelope.topic_id ?? null,
            spawned_from_chat_id: null
        };
    return mapTopicToConversation({
        topic,
        kind: params.conversationKind,
        participants: params.participants
    });
}
export function buildProviderMessageId(topicId, chatId) {
    return `chat:${topicId}:${chatId}`;
}
export function buildParentConversationCandidates(topic) {
    const parentTopicId = normalizeId(topic.parent_topic_id);
    return parentTopicId ? [buildConversationId(parentTopicId, "topic")] : [];
}
export function detectConversationKind(params) {
    return inferConversationKind({
        explicitKind: params.knownKind,
        topic: params.topic,
        participantsCount: params.participants?.length
    });
}
export function enrichCanonicalEvent(params) {
    const topic = params.envelope.payload.topic ??
        {
            id: params.envelope.topic_id ?? "unknown",
            parent_topic_id: null,
            root_topic_id: params.envelope.topic_id ?? null,
            spawned_from_chat_id: null
        };
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
//# sourceMappingURL=mapping.js.map