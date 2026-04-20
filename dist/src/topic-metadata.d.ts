import type { ConversationKind, SpeakeasyNormalizedRecords, SpeakeasyParticipant, SpeakeasyTopic } from "./types.js";
export type SpeakeasyTopicPresentation = {
    kind: ConversationKind;
    targetId: string;
    label: string;
    groupSubject?: string;
    statusLabel: string;
    participantLabel?: string;
    otherParticipants: SpeakeasyParticipant[];
};
export declare function normalizeTopicSubject(subject: string | null | undefined): string | undefined;
export declare function isPlaceholderTopicSubject(subject: string | null | undefined): boolean;
export declare function getParticipantDisplayLabel(participant: SpeakeasyParticipant): string;
export declare function filterOtherParticipants(params: {
    participants?: SpeakeasyParticipant[];
    selfHandle?: string;
}): SpeakeasyParticipant[];
export declare function inferTopicConversationKind(params: {
    topic: SpeakeasyTopic;
    explicitKind?: ConversationKind;
    participants?: SpeakeasyParticipant[];
    participantsCount?: number;
    selfHandle?: string;
}): ConversationKind;
export declare function summarizeParticipantLabels(participants: SpeakeasyParticipant[]): string | undefined;
export declare function buildTopicPresentation(params: {
    topic: SpeakeasyTopic;
    explicitKind?: ConversationKind;
    participants?: SpeakeasyParticipant[];
    selfHandle?: string;
}): SpeakeasyTopicPresentation;
export declare function collectTopicParticipants(records: SpeakeasyNormalizedRecords | undefined, topicId: string): SpeakeasyParticipant[];
//# sourceMappingURL=topic-metadata.d.ts.map