import type {
  ConversationKind,
  SpeakeasyNormalizedRecords,
  SpeakeasyParticipant,
  SpeakeasyTopic
} from "./types.js";
import { normalizeId } from "./utils.js";

const PLACEHOLDER_SUBJECTS = new Set(["untitled"]);

export type SpeakeasyTopicPresentation = {
  kind: ConversationKind;
  targetId: string;
  label: string;
  groupSubject?: string;
  statusLabel: string;
  participantLabel?: string;
  otherParticipants: SpeakeasyParticipant[];
};

export function normalizeTopicSubject(subject: string | null | undefined): string | undefined {
  const trimmed = subject?.trim();
  return trimmed ? trimmed : undefined;
}

export function isPlaceholderTopicSubject(subject: string | null | undefined): boolean {
  const normalized = normalizeTopicSubject(subject);

  if (!normalized) {
    return true;
  }

  return PLACEHOLDER_SUBJECTS.has(normalized.toLowerCase());
}

export function getParticipantDisplayLabel(participant: SpeakeasyParticipant): string {
  return participant.display_name?.trim() || participant.name?.trim() || participant.handle;
}

export function filterOtherParticipants(params: {
  participants?: SpeakeasyParticipant[];
  selfHandle?: string;
}): SpeakeasyParticipant[] {
  const selfHandle = params.selfHandle?.trim().toLowerCase();

  if (!params.participants?.length) {
    return [];
  }

  if (!selfHandle) {
    return [...params.participants];
  }

  return params.participants.filter((participant) => participant.handle.trim().toLowerCase() !== selfHandle);
}

export function inferTopicConversationKind(params: {
  topic: SpeakeasyTopic;
  explicitKind?: ConversationKind;
  participants?: SpeakeasyParticipant[];
  participantsCount?: number;
  selfHandle?: string;
}): ConversationKind {
  if (params.explicitKind) {
    return params.explicitKind;
  }

  if (!isPlaceholderTopicSubject(params.topic.subject)) {
    return "topic";
  }

  const others = filterOtherParticipants({
    participants: params.participants,
    selfHandle: params.selfHandle
  });
  const participantCount = params.participants?.length ?? params.participantsCount ?? 0;

  if (others.length === 1) {
    return "direct";
  }

  if (!params.selfHandle && participantCount === 2) {
    return "direct";
  }

  return "topic";
}

export function summarizeParticipantLabels(participants: SpeakeasyParticipant[]): string | undefined {
  const labels = participants.map(getParticipantDisplayLabel).filter(Boolean);

  if (labels.length === 0) {
    return undefined;
  }

  if (labels.length === 1) {
    return labels[0];
  }

  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }

  return `${labels[0]}, ${labels[1]}, +${labels.length - 2} more`;
}

export function buildTopicPresentation(params: {
  topic: SpeakeasyTopic;
  explicitKind?: ConversationKind;
  participants?: SpeakeasyParticipant[];
  selfHandle?: string;
}): SpeakeasyTopicPresentation {
  const topicId = normalizeId(params.topic.id);

  if (!topicId) {
    throw new Error("Cannot build Speakeasy topic presentation without topic.id");
  }

  const subject = normalizeTopicSubject(params.topic.subject);
  const otherParticipants = filterOtherParticipants({
    participants: params.participants,
    selfHandle: params.selfHandle
  });
  const participantLabel = summarizeParticipantLabels(otherParticipants);
  const kind = inferTopicConversationKind({
    topic: params.topic,
    explicitKind: params.explicitKind,
    participants: params.participants,
    selfHandle: params.selfHandle
  });

  if (kind === "direct") {
    const baseLabel = participantLabel ?? subject ?? topicId;
    return {
      kind,
      targetId: `direct:${topicId}`,
      label: `DM: ${baseLabel}`,
      statusLabel: "direct message",
      participantLabel,
      otherParticipants
    };
  }

  if (subject && !isPlaceholderTopicSubject(subject)) {
    return {
      kind,
      targetId: `topic:${topicId}`,
      label: subject,
      groupSubject: subject,
      statusLabel: "topic",
      participantLabel,
      otherParticipants
    };
  }

  if (participantLabel) {
    return {
      kind,
      targetId: `topic:${topicId}`,
      label: `Topic: ${participantLabel}`,
      statusLabel: "participant-derived topic",
      participantLabel,
      otherParticipants
    };
  }

  return {
    kind,
    targetId: `topic:${topicId}`,
    label: `Topic ${topicId}`,
    statusLabel: "topic",
    otherParticipants
  };
}

export function collectTopicParticipants(
  records: SpeakeasyNormalizedRecords | undefined,
  topicId: string
): SpeakeasyParticipant[] {
  const participants = Object.values(records?.participants?.data ?? {});

  return participants.filter((participant) => normalizeId(participant.topic_id) === topicId);
}
