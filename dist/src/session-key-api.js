import { normalizeId } from "./utils.js";
export function buildConversationId(topicId, kind = "topic") {
    return `${kind}:${topicId}`;
}
export function parseConversationId(raw) {
    const match = /^(topic|direct):(.+)$/.exec(raw.trim());
    if (!match) {
        return null;
    }
    const [, kind, topicId] = match;
    if (!topicId) {
        return null;
    }
    return {
        kind: kind,
        topicId
    };
}
export function inferConversationKind(params) {
    if (params.explicitKind) {
        return params.explicitKind;
    }
    return "topic";
}
export function buildConversationRef(params) {
    const topicId = normalizeId(params.topic.id);
    if (!topicId) {
        throw new Error("Cannot build Speakeasy conversation without topic.id");
    }
    const kind = inferConversationKind({
        explicitKind: params.kind,
        topic: params.topic,
        participantsCount: params.participantsCount
    });
    const conversationId = buildConversationId(topicId, kind);
    const parentTopicId = normalizeId(params.topic.parent_topic_id);
    const parentConversationId = parentTopicId ? buildConversationId(parentTopicId, "topic") : undefined;
    return {
        kind,
        conversationId,
        baseConversationId: conversationId,
        parentConversationId,
        parentConversationCandidates: parentConversationId ? [parentConversationId] : [],
        providerIds: {
            topicId,
            parentTopicId,
            rootTopicId: normalizeId(params.topic.root_topic_id),
            spawnedFromChatId: normalizeId(params.topic.spawned_from_chat_id)
        }
    };
}
export function resolveSessionConversation(params) {
    const parsed = parseConversationId(params.rawId);
    if (!parsed) {
        return null;
    }
    const parentConversationCandidates = params.parentConversationId
        ? [params.parentConversationId]
        : [];
    return {
        id: buildConversationId(parsed.topicId, parsed.kind),
        baseConversationId: buildConversationId(parsed.topicId, parsed.kind),
        parentConversationCandidates
    };
}
//# sourceMappingURL=session-key-api.js.map