import type { CanonicalConversationRef, CanonicalInboundEvent, ConversationKind, SpeakeasyAgentEventEnvelope, SpeakeasyParticipant, SpeakeasyTopic } from "./types.js";
export declare function mapTopicToConversation(params: {
    topic: SpeakeasyTopic;
    kind?: ConversationKind;
    participants?: SpeakeasyParticipant[];
}): CanonicalConversationRef;
export declare function mapDirectChatToConversation(topic: SpeakeasyTopic): CanonicalConversationRef;
export declare function mapEventToConversation(params: {
    envelope: SpeakeasyAgentEventEnvelope;
    conversationKind?: ConversationKind;
    participants?: SpeakeasyParticipant[];
}): CanonicalConversationRef;
export declare function buildProviderMessageId(topicId: string, chatId: string): string;
export declare function buildParentConversationCandidates(topic: SpeakeasyTopic): string[];
export declare function detectConversationKind(params: {
    topic: SpeakeasyTopic;
    participants?: SpeakeasyParticipant[];
    knownKind?: ConversationKind;
}): ConversationKind;
export declare function enrichCanonicalEvent(params: {
    transport: CanonicalInboundEvent["transport"];
    envelope: SpeakeasyAgentEventEnvelope;
    conversationKind?: ConversationKind;
    participants?: SpeakeasyParticipant[];
}): CanonicalInboundEvent;
//# sourceMappingURL=mapping.d.ts.map