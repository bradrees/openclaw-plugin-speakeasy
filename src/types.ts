export type SpeakeasyTransport = "websocket" | "polling" | "webhook";
export type CursorStoreKind = "file" | "memory";
export type ConversationKind = "topic" | "direct";

export type SpeakeasyCursorStoreConfig = {
  kind: CursorStoreKind;
  path?: string;
};

export type SpeakeasyAccountConfig = {
  enabled: boolean;
  baseUrl: string;
  accessToken: string;
  refreshToken?: string;
  webhookSecret?: string;
  transport: SpeakeasyTransport;
  cursorStore: SpeakeasyCursorStoreConfig;
  allowDirectMessages: boolean;
  allowTopicMessages: boolean;
  mentionOnly: boolean;
  allowedTopicIds?: string[];
  allowedUserHandles?: string[];
  botDisplayName?: string;
  debugLogging: boolean;
  pollIntervalMs: number;
  websocketHeartbeatMs: number;
};

export type ResolvedSpeakeasyAccount = SpeakeasyAccountConfig & {
  accountId: string;
};

export type SpeakeasyCapabilities = {
  topic_hierarchy?: boolean;
  threaded_topic_create?: boolean;
  topic_history?: boolean;
  topic_participants_read?: boolean;
  topic_files_read?: boolean;
  typing_indicator?: boolean;
  attachments?: boolean;
  event_polling?: boolean;
  event_webhooks?: boolean;
  event_websocket?: boolean;
  chat_idempotency?: boolean;
  profile_update?: boolean;
};

export type SpeakeasyAgentProfile = {
  agent_grant_id: number;
  agent_account_id: number;
  agent_handle: string;
  display_name: string;
  owner_account_id: number;
  owner_handle: string;
  capabilities: SpeakeasyCapabilities;
};

export type SpeakeasyParticipant = {
  id: number | string;
  handle: string;
  name?: string | null;
  display_name?: string | null;
};

export type SpeakeasyTopic = {
  id: number | string;
  subject?: string | null;
  parent_topic_id?: number | string | null;
  root_topic_id?: number | string | null;
  spawned_from_chat_id?: number | string | null;
};

export type SpeakeasyAttachment = {
  filename?: string;
  url?: string;
  content_type?: string;
  byte_size?: number;
  signed_id?: string;
};

export type SpeakeasyChat = {
  id: number | string;
  topic_id: number | string;
  handle?: string;
  author_handle?: string;
  html?: string | null;
  plain?: string | null;
  deleted?: boolean;
  attachments?: SpeakeasyAttachment[];
  sgid?: string;
};

export type SpeakeasyTimeline = {
  id: number | string;
  topic_id?: number | string;
  tl_type?: string;
  tl_id?: number | string;
  author_handle?: string;
  reply_timeline_id?: number | string | null;
  thread_topic_id?: number | string | null;
  edited_at?: string | null;
};

export type SpeakeasyNormalizedRecords = {
  topics?: {
    data: Record<string, SpeakeasyTopic>;
  };
  chats?: {
    data: Record<string, SpeakeasyChat>;
  };
  timelines?: {
    data: Record<string, SpeakeasyTimeline>;
  };
  participants?: {
    data: Record<string, SpeakeasyParticipant>;
  };
  files?: {
    data: Record<string, unknown>;
  };
};

export type SpeakeasyHistoryResponse = {
  records: SpeakeasyNormalizedRecords;
  next_cursor: string | null;
};

export type SpeakeasyTopicsResponse = {
  records: SpeakeasyNormalizedRecords;
  next_cursor?: string | null;
};

export type SpeakeasyAgentEventPayload = {
  topic?: SpeakeasyTopic;
  chat?: SpeakeasyChat;
  timeline?: SpeakeasyTimeline;
  participant?: SpeakeasyParticipant;
};

export type SpeakeasyAgentEventEnvelope = {
  id: number;
  event_id: number;
  event_type:
    | "chat.created"
    | "chat.updated"
    | "chat.deleted"
    | "topic.created"
    | "participant.added"
    | "participant.removed"
    | "grant.revoked";
  occurred_at: string;
  topic_id?: number | string | null;
  chat_id?: number | string | null;
  actor_handle?: string | null;
  payload: SpeakeasyAgentEventPayload;
};

export type SpeakeasyPollingEventsResponse = {
  events: SpeakeasyAgentEventEnvelope[];
  next_cursor: string;
};

export type SpeakeasyDirectChatCreateRequest = {
  handle: string;
  chat: {
    text?: string;
    html?: string;
    sgid?: string;
  };
};

export type SpeakeasyChatWriteInput = {
  text?: string;
  html?: string;
  sgid?: string;
  reply_timeline_id?: string;
};

export type DirectUploadRequest = {
  blob: {
    filename: string;
    byte_size: number;
    checksum: string;
    content_type: string;
    metadata?: Record<string, unknown>;
  };
};

export type DirectUploadResponse = {
  signed_id: string;
  direct_upload: {
    url: string;
    headers: Record<string, string>;
  };
};

export type CanonicalConversationRef = {
  kind: ConversationKind;
  conversationId: string;
  baseConversationId: string;
  parentConversationId?: string;
  parentConversationCandidates: string[];
  providerIds: {
    topicId: string;
    parentTopicId?: string;
    rootTopicId?: string;
    spawnedFromChatId?: string;
  };
};

export type CanonicalInboundEvent = {
  transport: SpeakeasyTransport;
  id: string;
  type: SpeakeasyAgentEventEnvelope["event_type"];
  occurredAt: string;
  actorHandle?: string;
  conversation: CanonicalConversationRef;
  topic?: SpeakeasyTopic;
  chat?: SpeakeasyChat;
  timeline?: SpeakeasyTimeline;
  participant?: SpeakeasyParticipant;
  raw: SpeakeasyAgentEventEnvelope;
};

export type SessionConversationResolution = {
  id: string;
  baseConversationId: string;
  parentConversationCandidates: string[];
};

export type CursorState = {
  cursor?: string;
  websocketResumeCursor?: string;
  recentEventIds: string[];
  conversationKinds: Record<string, ConversationKind>;
};

export type InboundPolicyDecision = {
  allowed: boolean;
  reason?: string;
};

export type SetupProbeResult = {
  ok: boolean;
  profile: SpeakeasyAgentProfile;
  rename:
    | {
        attempted: false;
        status: "skipped";
        reason: string;
      }
    | {
        attempted: true;
        status: "updated" | "unchanged" | "failed";
        error?: string;
      };
};

export type LoggerLike = {
  debug: (message: string, extra?: Record<string, unknown>) => void;
  info: (message: string, extra?: Record<string, unknown>) => void;
  warn: (message: string, extra?: Record<string, unknown>) => void;
  error: (message: string, extra?: Record<string, unknown>) => void;
};

export type RuntimeMessageSink = (event: CanonicalInboundEvent) => Promise<void>;
