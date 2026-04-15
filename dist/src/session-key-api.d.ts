import type { CanonicalConversationRef, ConversationKind, SessionConversationResolution, SpeakeasyTopic } from "./types.js";
export declare function buildConversationId(topicId: string, kind?: ConversationKind): string;
export declare function parseConversationId(raw: string): {
    kind: ConversationKind;
    topicId: string;
} | null;
export declare function inferConversationKind(params: {
    explicitKind?: ConversationKind;
    topic?: SpeakeasyTopic;
    participantsCount?: number;
}): ConversationKind;
export declare function buildConversationRef(params: {
    topic: SpeakeasyTopic;
    kind?: ConversationKind;
    participantsCount?: number;
}): CanonicalConversationRef;
export declare function resolveSessionConversation(params: {
    kind: "group" | "channel";
    rawId: string;
    parentConversationId?: string | null;
}): SessionConversationResolution | null;
//# sourceMappingURL=session-key-api.d.ts.map