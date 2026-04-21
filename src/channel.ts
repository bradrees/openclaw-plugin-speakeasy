import type { IncomingMessage, ServerResponse } from "node:http";

import {
  buildChannelOutboundSessionRoute,
  createChannelPluginBase,
  type ChannelPlugin,
  type ChannelDirectoryEntry,
  type ChannelMessageActionName,
  type OpenClawConfig,
  type PluginRuntime
} from "openclaw/plugin-sdk/core";
import {
  createNormalizedOutboundDeliverer,
  deliverTextOrMediaReply,
  type OutboundReplyPayload
} from "openclaw/plugin-sdk/reply-payload";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";

import {
  SPEAKEASY_CHANNEL_JSON_SCHEMA,
  resolveSpeakeasyAccount,
  validateSpeakeasyAccount,
  writeSpeakeasyAccount
} from "./config.js";
import { resolveAgentHandleFromAccessToken, resolveSpeakeasyAccessTokenExpiryText } from "./auth.js";
import { SpeakeasyApiClient } from "./client.js";
import { dedupeEvent, normalizeWebhookEvent, verifyWebhookSignature } from "./events.js";
import { inferOutboundTarget, SpeakeasyOutboundService } from "./outbound.js";
import { SpeakeasyPollingLoop } from "./polling.js";
import { parseConversationId, resolveSessionConversation } from "./session-key-api.js";
import { evaluateInboundPolicy } from "./security.js";
import {
  buildTopicPresentation,
  collectTopicParticipants,
  getParticipantDisplayLabel,
  isPlaceholderTopicSubject
} from "./topic-metadata.js";
import type {
  CanonicalInboundEvent,
  LoggerLike,
  ResolvedSpeakeasyAccount,
  SpeakeasyParticipant,
  SpeakeasyAuthRefreshResult,
  SpeakeasyConnectivityProbe
} from "./types.js";
import {
  createCursorStore,
  createLogger,
  createIdempotencyKey,
  encodeSpeakeasyCursor,
  normalizeId,
  updateCursorState
} from "./utils.js";
import { SpeakeasyWebSocketConnection } from "./websocket.js";
import { mapTopicToConversation } from "./mapping.js";

const runtimeStore = createPluginRuntimeStore<PluginRuntime>(
  "Speakeasy runtime is not initialized yet. OpenClaw should call setRuntime() during plugin registration."
);

const webhookTargets = new Map<
  string,
  {
    account: ResolvedSpeakeasyAccount;
    handleEvent: (event: CanonicalInboundEvent) => Promise<void>;
  }
>();

export const WEBHOOK_ROUTE_PREFIX = "/plugins/openclaw-plugin-speakeasy/webhooks/";

type RunningTransport = {
  stop: () => Promise<void>;
};

const runningTransports = new Map<string, RunningTransport>();

export function setSpeakeasyRuntime(runtime: PluginRuntime): void {
  runtimeStore.setRuntime(runtime);
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

export async function handleSpeakeasyWebhookRoute(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (req.method !== "POST" || !req.url?.startsWith(WEBHOOK_ROUTE_PREFIX)) {
    return false;
  }

  const accountId = decodeURIComponent(req.url.slice(WEBHOOK_ROUTE_PREFIX.length).split("?")[0] ?? "");
  const target = webhookTargets.get(accountId);

  if (!target) {
    res.statusCode = 404;
    res.end("unknown Speakeasy webhook target");
    return true;
  }

  const rawBody = await readRawBody(req);
  const signature = req.headers["x-agent-signature"];
  const signatureValue = Array.isArray(signature) ? signature[0] : signature;

  if (
    !target.account.webhookSecret ||
    !verifyWebhookSignature({
      secret: target.account.webhookSecret,
      rawBody,
      ...(signatureValue ? { signatureHeader: signatureValue } : {})
    })
  ) {
    res.statusCode = 401;
    res.end("invalid webhook signature");
    return true;
  }

  const payload = JSON.parse(rawBody) as Parameters<typeof normalizeWebhookEvent>[0];
  const event = normalizeWebhookEvent(payload, {});
  await target.handleEvent(event);

  res.statusCode = 202;
  res.end("accepted");
  return true;
}

function createAccountLogger(account: ResolvedSpeakeasyAccount): LoggerLike {
  return createLogger(`account:${account.accountId}`, account.debugLogging);
}

function applyRefreshedAuthToAccount(account: ResolvedSpeakeasyAccount, auth: SpeakeasyAuthRefreshResult): void {
  account.accessToken = auth.accessToken;
  account.refreshToken = auth.refreshToken ?? account.refreshToken;
  account.expiresAt =
    auth.expiresAt ??
    resolveSpeakeasyAccessTokenExpiryText(auth.accessToken, account.expiresAt) ??
    account.expiresAt;
  account.agentHandle =
    auth.agentHandle ??
    account.agentHandle ??
    resolveAgentHandleFromAccessToken(auth.accessToken);
}

async function persistRefreshedAuth(params: {
  account: ResolvedSpeakeasyAccount;
  auth: SpeakeasyAuthRefreshResult;
  logger: LoggerLike;
}): Promise<void> {
  applyRefreshedAuthToAccount(params.account, params.auth);

  const runtime = runtimeStore.tryGetRuntime?.() ?? null;

  if (!runtime) {
    return;
  }

  const currentCfg = runtime.config.loadConfig();
  const currentAccount = resolveSpeakeasyAccount(
    currentCfg as unknown as Record<string, unknown>,
    params.account.accountId
  );
  const nextAccount = {
    ...currentAccount,
    accessToken: params.account.accessToken,
    refreshToken: params.account.refreshToken,
    ...(params.account.expiresAt ? { expiresAt: params.account.expiresAt } : {}),
    ...(params.account.agentHandle ? { agentHandle: params.account.agentHandle } : {})
  };

  if (
    currentAccount.accessToken === nextAccount.accessToken &&
    currentAccount.refreshToken === nextAccount.refreshToken &&
    currentAccount.expiresAt === nextAccount.expiresAt &&
    currentAccount.agentHandle === nextAccount.agentHandle
  ) {
    return;
  }

  await runtime.config.writeConfigFile(
    writeSpeakeasyAccount(currentCfg as unknown as Record<string, unknown>, nextAccount) as OpenClawConfig
  );

  params.logger.info("persisted refreshed Speakeasy auth", {
    accountId: params.account.accountId,
    refreshTokenRotated: currentAccount.refreshToken !== nextAccount.refreshToken
  });
}

function createAccountClient(params: {
  account: ResolvedSpeakeasyAccount;
  logger: LoggerLike;
  fetchImpl?: typeof fetch;
}): SpeakeasyApiClient {
  return new SpeakeasyApiClient({
    baseUrl: params.account.baseUrl,
    accessToken: params.account.accessToken,
    refreshToken: params.account.refreshToken,
    expiresAt: params.account.expiresAt,
    logger: params.logger,
    ...(params.fetchImpl ? { fetchImpl: params.fetchImpl } : {}),
    syncAuthState: () => {
      const runtime = runtimeStore.tryGetRuntime?.() ?? null;

      if (!runtime) {
        return {
          accessToken: params.account.accessToken,
          refreshToken: params.account.refreshToken,
          expiresAt: params.account.expiresAt,
          ...(params.account.agentHandle ? { agentHandle: params.account.agentHandle } : {})
        };
      }

      try {
        const latest = resolveSpeakeasyAccount(
          runtime.config.loadConfig() as unknown as Record<string, unknown>,
          params.account.accountId
        );

        params.account.accessToken = latest.accessToken;
        params.account.refreshToken = latest.refreshToken;
        params.account.expiresAt = latest.expiresAt;
        params.account.agentHandle = latest.agentHandle;

        return {
          accessToken: latest.accessToken,
          refreshToken: latest.refreshToken,
          expiresAt: latest.expiresAt,
          ...(latest.agentHandle ? { agentHandle: latest.agentHandle } : {})
        };
      } catch {
        return {
          accessToken: params.account.accessToken,
          refreshToken: params.account.refreshToken,
          expiresAt: params.account.expiresAt,
          ...(params.account.agentHandle ? { agentHandle: params.account.agentHandle } : {})
        };
      }
    },
    onAuthUpdated: async (auth) => {
      await persistRefreshedAuth({
        account: params.account,
        auth,
        logger: params.logger
      });
    }
  });
}

type SpeakeasyLiveTopicEntry = {
  topicId: string;
  topic: NonNullable<CanonicalInboundEvent["topic"]>;
  participants: SpeakeasyParticipant[];
  presentation: ReturnType<typeof buildTopicPresentation>;
};

const SPEAKEASY_LIST_ACTIONS = ["channel-list", "thread-list"] satisfies ChannelMessageActionName[];
const EXPLICIT_TARGET_RE = /^(?:topic|direct):.+$/;
const SESSION_TARGET_RE = /^doug:(?:topic|direct):.+$/;

function isSpeakeasyListAction(action: ChannelMessageActionName): action is (typeof SPEAKEASY_LIST_ACTIONS)[number] {
  return (SPEAKEASY_LIST_ACTIONS as readonly ChannelMessageActionName[]).includes(action);
}

function readOptionalStringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function readOptionalIntegerParam(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number.parseInt(value, 10)
        : undefined;

  if (typeof numberValue !== "number" || !Number.isFinite(numberValue) || numberValue <= 0) {
    return undefined;
  }

  return Math.trunc(numberValue);
}

function parseSpeakeasyExplicitTarget(raw: string): { to: string; chatType: "direct" | "group" } | null {
  const trimmed = raw.trim();

  if (trimmed.startsWith("direct:") || trimmed.startsWith("doug:direct:")) {
    return {
      to: trimmed,
      chatType: "direct"
    };
  }

  if (trimmed.startsWith("topic:") || trimmed.startsWith("doug:topic:")) {
    return {
      to: trimmed,
      chatType: "group"
    };
  }

  return null;
}

function resolveSpeakeasyDirectoryTopicId(groupId: string): string | null {
  const trimmed = groupId.trim();

  if (!trimmed) {
    return null;
  }

  const explicit = parseSpeakeasyExplicitTarget(trimmed);

  if (explicit) {
    return explicit.to.replace(/^(?:doug:)?(?:topic|direct):/, "");
  }

  const sessionConversation = parseConversationId(trimmed);

  if (sessionConversation?.topicId) {
    return sessionConversation.topicId;
  }

  return /^\d+$/.test(trimmed) ? trimmed : null;
}

function describeSpeakeasyDmPolicy(account: ResolvedSpeakeasyAccount): string {
  if (!account.allowDirectMessages) {
    return "disabled";
  }

  if (account.allowedUserHandles?.length) {
    return "allowlisted";
  }

  return "enabled";
}

async function resolveSpeakeasySelfHandle(params: {
  account: ResolvedSpeakeasyAccount;
  logger: LoggerLike;
}): Promise<string | undefined> {
  if (params.account.agentHandle) {
    return params.account.agentHandle;
  }

  try {
    const profile = await createAccountClient({
      account: params.account,
      logger: params.logger
    }).getMeIfAvailable();
    return profile?.agent_handle ?? params.account.agentHandle;
  } catch (error) {
    params.logger.debug("failed to resolve Speakeasy self handle for topic metadata", {
      error: error instanceof Error ? error.message : String(error)
    });
    return params.account.agentHandle;
  }
}

async function listSpeakeasyLiveTopics(params: {
  account: ResolvedSpeakeasyAccount;
  logger: LoggerLike;
}): Promise<SpeakeasyLiveTopicEntry[]> {
  const client = createAccountClient({
    account: params.account,
    logger: params.logger
  });
  const selfHandle = await resolveSpeakeasySelfHandle(params);
  const topicsResponse = await client.listTopics();
  const topics = Object.values(topicsResponse.records.topics?.data ?? {});

  const entries = await Promise.all(
    topics.map(async (topic) => {
      const topicId = normalizeId(topic.id);

      if (!topicId) {
        return null;
      }

      let participants = collectTopicParticipants(topicsResponse.records, topicId);

      if (participants.length === 0 && isPlaceholderTopicSubject(topic.subject)) {
        try {
          const participantResponse = await client.getParticipants(topicId);
          participants = Object.values(participantResponse.records.participants?.data ?? {});
        } catch (error) {
          params.logger.debug("failed to fetch Speakeasy topic participants for directory metadata", {
            topicId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      return {
        topicId,
        topic,
        participants,
        presentation: buildTopicPresentation({
          topic,
          participants,
          selfHandle
        })
      } satisfies SpeakeasyLiveTopicEntry;
    })
  );

  return entries
    .filter((entry): entry is SpeakeasyLiveTopicEntry => Boolean(entry))
    .sort((a, b) => a.presentation.label.localeCompare(b.presentation.label));
}

async function listSpeakeasyDirectoryGroups(params: {
  account: ResolvedSpeakeasyAccount;
  logger: LoggerLike;
  query?: string | null;
  limit?: number | null;
}): Promise<ChannelDirectoryEntry[]> {
  return (await listSpeakeasyLiveTopics({
    account: params.account,
    logger: params.logger
  }))
    .filter((entry) => matchesSpeakeasyLiveTopic(entry, params.query ?? ""))
    .slice(0, params.limit ?? Number.MAX_SAFE_INTEGER)
    .map(toSpeakeasyDirectoryEntry);
}

async function handleSpeakeasyListAction(params: {
  action: ChannelMessageActionName;
  cfg: OpenClawConfig;
  accountId?: string | null;
  actionParams: Record<string, unknown>;
}) {
  const account = resolveSpeakeasyAccount(
    params.cfg as unknown as Record<string, unknown>,
    params.accountId ?? undefined
  );
  const query = readOptionalStringParam(params.actionParams, "query");
  const limit = readOptionalIntegerParam(params.actionParams, "limit");
  const groups = await listSpeakeasyDirectoryGroups({
    account,
    logger: createAccountLogger(account),
    query,
    limit
  });

  const payload = {
    ok: true,
    channel: "speakeasy",
    action: params.action,
    topics: groups,
    groups,
    note:
      params.action === "thread-list"
        ? "Speakeasy topics are first-class conversations, not nested OpenClaw threadId values. This compatibility action returns the topic list."
        : undefined
  };

  return {
    details: payload,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

function matchesSpeakeasyLiveTopic(entry: SpeakeasyLiveTopicEntry, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  const candidates = new Set<string>([
    entry.presentation.targetId,
    entry.topicId,
    entry.presentation.label,
    entry.presentation.statusLabel,
    entry.topic.subject ?? "",
    entry.presentation.participantLabel ?? "",
    ...entry.participants.flatMap((participant) => [
      participant.handle,
      participant.display_name ?? "",
      participant.name ?? ""
    ])
  ]);

  for (const candidate of candidates) {
    if (candidate.trim().toLowerCase().includes(normalizedQuery)) {
      return true;
    }
  }

  return false;
}

function toSpeakeasyDirectoryEntry(entry: SpeakeasyLiveTopicEntry): ChannelDirectoryEntry {
  return {
    kind: "group",
    id: entry.presentation.targetId,
    name: entry.presentation.label,
    raw: {
      topicId: entry.topicId,
      subject: entry.topic.subject ?? null,
      conversationKind: entry.presentation.kind,
      statusLabel: entry.presentation.statusLabel,
      participants: entry.participants.map((participant) => ({
        handle: participant.handle,
        displayName: participant.display_name ?? participant.name ?? participant.handle
      }))
    }
  };
}

function toSpeakeasyMemberDirectoryEntry(params: {
  participant: SpeakeasyParticipant;
  topicId: string;
}): ChannelDirectoryEntry {
  return {
    kind: "user",
    id: params.participant.handle,
    name: getParticipantDisplayLabel(params.participant),
    handle: params.participant.handle,
    raw: {
      topicId: params.topicId,
      participantId: params.participant.id,
      displayName: params.participant.display_name ?? params.participant.name ?? null
    }
  };
}

async function resolveLiveTopicTarget(params: {
  entries?: SpeakeasyLiveTopicEntry[];
  account?: ResolvedSpeakeasyAccount;
  logger?: LoggerLike;
  input: string;
}): Promise<SpeakeasyLiveTopicEntry | null> {
  const normalizedInput = params.input.trim().toLowerCase();

  if (!normalizedInput) {
    return null;
  }

  const entries =
    params.entries ??
    (params.account && params.logger
      ? await listSpeakeasyLiveTopics({
          account: params.account,
          logger: params.logger
        })
      : []);

  return (
    entries.find((entry) => {
      const exactCandidates = [
        entry.presentation.targetId,
        entry.topicId,
        entry.presentation.label,
        entry.topic.subject ?? "",
        ...entry.participants.flatMap((participant) => [
          participant.handle,
          participant.display_name ?? "",
          participant.name ?? ""
        ])
      ];

      return exactCandidates.some((candidate) => candidate.trim().toLowerCase() === normalizedInput);
    }) ??
    entries.find((entry) => matchesSpeakeasyLiveTopic(entry, normalizedInput)) ??
    null
  );
}

async function enrichInboundEvent(params: {
  event: CanonicalInboundEvent;
  account: ResolvedSpeakeasyAccount;
  logger: LoggerLike;
  agentHandle?: string;
}): Promise<CanonicalInboundEvent> {
  const topicId = params.event.conversation.providerIds.topicId;

  if (!topicId) {
    return params.event;
  }

  let topic = params.event.topic;

  if (!topic) {
    try {
      topic = Object.values((await createAccountClient({
        account: params.account,
        logger: params.logger
      }).getTopic(topicId)).records.topics?.data ?? {})[0];
    } catch (error) {
      params.logger.debug("failed to hydrate Speakeasy topic snapshot for inbound event", {
        topicId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  if (!topic) {
    return params.event;
  }

  let participants = params.event.participants ?? [];
  const needsParticipants =
    participants.length === 0 &&
    (params.event.conversation.kind === "direct" || isPlaceholderTopicSubject(topic.subject));

  if (needsParticipants) {
    try {
      const participantResponse = await createAccountClient({
        account: params.account,
        logger: params.logger
      }).getParticipants(topicId);
      participants = Object.values(participantResponse.records.participants?.data ?? {});
    } catch (error) {
      params.logger.debug("failed to hydrate Speakeasy participants for inbound event", {
        topicId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const conversation = mapTopicToConversation({
    topic,
    kind:
      params.event.conversation.kind === "direct"
        ? "direct"
        : undefined,
    participants
  });

  return {
    ...params.event,
    conversation,
    topic,
    participants
  };
}

async function buildReplyDeliverer(params: {
  account: ResolvedSpeakeasyAccount;
  event: CanonicalInboundEvent;
  logger: LoggerLike;
}): Promise<(payload: unknown) => Promise<void>> {
  const client = createAccountClient({
    account: params.account,
    logger: params.logger
  });
  const outbound = new SpeakeasyOutboundService(client, params.logger);
  const target =
    params.event.conversation.kind === "direct"
      ? ({ kind: "topic", topicId: params.event.conversation.providerIds.topicId } as const)
      : ({ kind: "topic", topicId: params.event.conversation.providerIds.topicId } as const);

  return createNormalizedOutboundDeliverer(async (payload: OutboundReplyPayload) => {
    await deliverTextOrMediaReply({
      payload,
      text: payload.text ?? "",
      sendText: async (text) => {
        if (target.kind === "topic") {
          try { await outbound.setTyping({ topicId: target.topicId, typing: true }); } catch {}
        }
        try {
          await outbound.send({
            target,
            text,
            ...(payload.replyToId ? { replyTimelineId: payload.replyToId } : {})
          });
        } finally {
          if (target.kind === "topic") {
            try { await outbound.setTyping({ topicId: target.topicId, typing: false }); } catch {}
          }
        }
      },
      sendMedia: async ({ mediaUrl, caption }) => {
        if (target.kind === "topic") {
          try { await outbound.setTyping({ topicId: target.topicId, typing: true }); } catch {}
        }
        try {
          const file = await fetchRemoteMedia(mediaUrl);
          await outbound.send({
            target,
            ...(caption ? { text: caption } : {}),
            file
          });
        } finally {
          if (target.kind === "topic") {
            try { await outbound.setTyping({ topicId: target.topicId, typing: false }); } catch {}
          }
        }
      }
    });
  });
}

async function dispatchInboundEvent(params: {
  cfg: OpenClawConfig;
  account: ResolvedSpeakeasyAccount;
  event: CanonicalInboundEvent;
  logger: LoggerLike;
  agentHandle?: string;
}): Promise<void> {
  const runtime = runtimeStore.getRuntime();
  const presentation =
    params.event.topic
      ? buildTopicPresentation({
          topic: params.event.topic,
          explicitKind: params.event.conversation.kind === "direct" ? "direct" : undefined,
          participants: params.event.participants,
          selfHandle: params.agentHandle
        })
      : null;
  const policy = evaluateInboundPolicy({
    event: params.event,
    account: params.account,
    agentHandle: params.agentHandle
  });

  if (!policy.allowed) {
    params.logger.debug("dropping Speakeasy inbound event", {
      eventId: params.event.id,
      reason: policy.reason
    });
    return;
  }

  const route = runtime.channel.routing.resolveAgentRoute({
    cfg: params.cfg,
    channel: "speakeasy",
    accountId: params.account.accountId,
    peer: {
      kind: params.event.conversation.kind === "direct" ? "direct" : "group",
      id: params.event.conversation.baseConversationId
    },
    parentPeer: params.event.conversation.parentConversationId
      ? {
          kind: "group",
          id: params.event.conversation.parentConversationId
        }
      : null
  });

  const ctxPayload = runtime.channel.reply.finalizeInboundContext({
    Channel: "speakeasy",
    Surface: "speakeasy",
    Provider: "speakeasy",
    AccountId: params.account.accountId,
    ChatType: params.event.conversation.kind === "direct" ? "direct" : "group",
    ConversationLabel:
      presentation?.label ??
      params.event.topic?.subject ??
      params.event.conversation.providerIds.topicId,
    GroupSubject:
      params.event.conversation.kind === "direct"
        ? presentation?.statusLabel
        : presentation?.groupSubject ?? params.event.topic?.subject ?? undefined,
    From: params.event.chat?.author_handle ?? params.event.actorHandle ?? "unknown",
    To: params.event.conversation.conversationId,
    Body:
      params.event.chat?.plain ??
      stripHtml(params.event.chat?.html ?? ""),
    SenderId: params.event.chat?.author_handle ?? params.event.actorHandle ?? undefined,
    SenderName:
      params.event.participant?.display_name ??
      params.event.participant?.name ??
      undefined,
    Timestamp: Date.parse(params.event.occurredAt) || Date.now(),
    SessionKey: route.sessionKey,
    NativeChannelId: params.event.conversation.providerIds.topicId,
    OriginatingChannel: "speakeasy",
    OriginatingTo: params.event.conversation.conversationId,
    ThreadParentId: params.event.conversation.parentConversationId,
    CurrentMessageId:
      params.event.chat?.id && params.event.topic?.id
        ? `chat:${params.event.topic.id}:${params.event.chat.id}`
        : undefined
  });

  const storePath = runtime.channel.session.resolveStorePath(undefined, {
    agentId: route.agentId
  });
  const deliver = await buildReplyDeliverer({
    account: params.account,
    event: params.event,
    logger: params.logger
  });

  await runtime.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
    ctx: ctxPayload,
    onRecordError: (error) => {
      params.logger.error("failed to record Speakeasy inbound session", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  await runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: params.cfg,
    dispatcherOptions: {
      deliver,
      onError: (error, info) => {
        params.logger.error("failed to dispatch Speakeasy reply", {
          kind: info.kind,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  });
}

async function startAccountRuntime(params: {
  cfg: OpenClawConfig;
  account: ResolvedSpeakeasyAccount;
}): Promise<RunningTransport> {
  const logger = createAccountLogger(params.account);
  const client = createAccountClient({
    account: params.account,
    logger
  });
  const store = createCursorStore(params.account);
  const initialState = await store.read();
  let agentHandle =
    params.account.agentHandle ??
    initialState.agentHandle ??
    resolveAgentHandleFromAccessToken(params.account.accessToken);

  if (agentHandle && initialState.agentHandle !== agentHandle) {
    await updateCursorState(store, (state) => ({
      ...state,
      agentHandle
    }));
  }

  if (!agentHandle) {
    try {
      agentHandle = (await client.getMeIfAvailable())?.agent_handle;

      if (agentHandle) {
        await updateCursorState(store, (state) => ({
          ...state,
          agentHandle
        }));
      }
    } catch (error) {
      logger.warn("failed to resolve Speakeasy agent identity for loop prevention", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const handleEvent = async (event: CanonicalInboundEvent) => {
    const enrichedEvent = await enrichInboundEvent({
      event,
      account: params.account,
      logger,
      agentHandle
    });
    let duplicate = false;
    const resumeCursor =
      enrichedEvent.transport === "polling" ? undefined : encodeSpeakeasyCursor(enrichedEvent.id);

    await updateCursorState(store, (state) => {
      const deduped = dedupeEvent(state, enrichedEvent.id);
      duplicate = deduped.duplicate;

      return {
        ...deduped.state,
        ...(agentHandle ? { agentHandle } : {}),
        conversationKinds: {
          ...deduped.state.conversationKinds,
          [enrichedEvent.conversation.providerIds.topicId]: enrichedEvent.conversation.kind
        }
      };
    });

    if (duplicate) {
      if (resumeCursor) {
        await updateCursorState(store, (state) => ({
          ...state,
          cursor: resumeCursor,
          websocketResumeCursor: resumeCursor
        }));
      }

      logger.debug("skipping duplicate Speakeasy event", {
        eventId: enrichedEvent.id
      });
      return;
    }

    await dispatchInboundEvent({
      cfg: params.cfg,
      account: params.account,
      event: enrichedEvent,
      logger,
      agentHandle
    });

    if (resumeCursor) {
      await updateCursorState(store, (state) => ({
        ...state,
        cursor: resumeCursor,
        websocketResumeCursor: resumeCursor
      }));
    }
  };

  const pollingLoop = new SpeakeasyPollingLoop({
    client,
    logger,
    pollIntervalMs: params.account.pollIntervalMs,
    getCursor: async () => {
      const state = await store.read();
      return state.cursor ?? state.websocketResumeCursor;
    },
    setCursor: async (cursor) => {
      await updateCursorState(store, (state) => ({
        ...state,
        cursor,
        websocketResumeCursor: cursor
      }));
    },
    getConversationKinds: async () => (await store.read()).conversationKinds,
    onEvent: handleEvent
  });

  let websocket: SpeakeasyWebSocketConnection | undefined;

  if (params.account.transport === "websocket") {
    websocket = new SpeakeasyWebSocketConnection({
      client,
      getAccessToken: async () => client.ensureFreshAccessToken("websocket-connect"),
      logger,
      heartbeatMs: params.account.websocketHeartbeatMs,
      getCursor: async () => {
        const state = await store.read();
        return state.websocketResumeCursor ?? state.cursor;
      },
      getConversationKinds: async () => (await store.read()).conversationKinds,
      onEvent: handleEvent,
      onRecoverableGap: async (reason) => {
        if (reason === "invalid_cursor") {
          await updateCursorState(store, (state) => ({
            ...state,
            cursor: undefined,
            websocketResumeCursor: undefined
          }));
          await pollingLoop.start();
        } else {
          logger.warn("websocket gap did not request polling fallback", { reason });
        }
      }
    });
    await websocket.start();
  } else {
    await pollingLoop.start();
  }

  if (params.account.transport === "webhook") {
    webhookTargets.set(params.account.accountId, {
      account: params.account,
      handleEvent
    });
    await pollingLoop.start();
  }

  return {
    stop: async () => {
      webhookTargets.delete(params.account.accountId);
      await pollingLoop.stop();
      await websocket?.stop();
    }
  };
}

export const speakeasyChannelPlugin = {
  ...createChannelPluginBase<ResolvedSpeakeasyAccount>({
    id: "openclaw-plugin-speakeasy",
    meta: {
      id: "speakeasy",
      label: "Speakeasy",
      selectionLabel: "Speakeasy (plugin)",
      docsPath: "/channels/speakeasy",
      docsLabel: "speakeasy",
      blurb: "Topic-first Speakeasy channel integration.",
      order: 70,
      quickstartAllowFrom: true,
      markdownCapable: true
    },
    capabilities: {
      chatTypes: ["direct", "group"],
      edit: true,
      unsend: true,
      reply: true,
      media: true,
      threads: false
    },
    configSchema: SPEAKEASY_CHANNEL_JSON_SCHEMA as never,
    setup: {
      applyAccountConfig: ({ cfg, accountId, input }) => {
        const authInput = input as typeof input & { refreshToken?: string };
        const currentAccount =
          ((cfg as unknown as {
            channels?: {
              speakeasy?: {
                accounts?: Record<string, Record<string, unknown>>;
              };
            };
          }).channels?.speakeasy?.accounts?.[accountId] ?? {}) as Record<string, unknown>;
        const validation = validateSpeakeasyAccount({
          ...currentAccount,
          baseUrl: input.url,
          accessToken: input.accessToken ?? input.token,
          ...(authInput.refreshToken ? { refreshToken: authInput.refreshToken } : {}),
          botDisplayName: input.name
        });

        if (!validation.ok) {
          throw new Error(validation.errors.join("; "));
        }

        return writeSpeakeasyAccount(cfg as unknown as Record<string, unknown>, {
          ...validation.value,
          accountId
        }) as OpenClawConfig;
      },
      validateInput: ({ input }) => {
        const validation = validateSpeakeasyAccount({
          baseUrl: input.url,
          accessToken: input.accessToken ?? input.token,
          botDisplayName: input.name
        });

        return validation.ok ? null : validation.errors.join("; ");
      }
    }
  }),
  config: {
    listAccountIds: (cfg) => {
      const channels = (cfg as unknown as { channels?: { speakeasy?: { accounts?: Record<string, unknown> } } }).channels;
      return Object.keys(channels?.speakeasy?.accounts ?? { default: {} });
    },
    resolveAccount: (cfg, accountId) => resolveSpeakeasyAccount(cfg as unknown as Record<string, unknown>, accountId),
    defaultAccountId: () => "default",
    isEnabled: (account) => account.enabled,
    isConfigured: async (account) => Boolean(account.baseUrl && account.accessToken),
    describeAccount: (account) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: Boolean(account.baseUrl && account.accessToken),
      baseUrl: account.baseUrl,
      mode: account.transport
    })
  },
  status: {
    probeAccount: async ({ account }) => {
      const client = createAccountClient({
        account,
        logger: createAccountLogger(account)
      });
      return client.probeTopicsConnectivity();
    },
    buildAccountSnapshot: async ({ account, probe }) => {
      const connectivityProbe = probe as SpeakeasyConnectivityProbe | undefined;

      return {
        accountId: account.accountId,
        enabled: account.enabled,
        configured: Boolean(account.baseUrl && account.accessToken),
        connected: Boolean(connectivityProbe),
        baseUrl: account.baseUrl,
        mode: account.transport,
        dmPolicy: describeSpeakeasyDmPolicy(account),
        degraded: connectivityProbe?.degraded ?? false,
        probeEndpoint: connectivityProbe?.endpoint,
        profile: connectivityProbe?.profile ?? null,
        ...(connectivityProbe?.degraded
          ? { warning: connectivityProbe.warning, topicCount: connectivityProbe.topicCount }
          : {})
      };
    },
    logSelfId: ({ runtime, account }) => {
      console.log(`speakeasy:${account.accountId}`);
    }
  },
  gateway: {
    startAccount: async ({ cfg, accountId, abortSignal }) => {
      const account = resolveSpeakeasyAccount(cfg as unknown as Record<string, unknown>, accountId);
      const existing = runningTransports.get(account.accountId);

      if (existing) {
        await existing.stop();
        runningTransports.delete(account.accountId);
      }

      const running = await startAccountRuntime({
        cfg,
        account
      });
      runningTransports.set(account.accountId, running);

      if (!abortSignal) {
        return;
      }

      await waitForAbort(abortSignal);

      if (runningTransports.get(account.accountId) === running) {
        await running.stop();
        runningTransports.delete(account.accountId);
      }
    },
    stopAccount: async ({ accountId }) => {
      const running = runningTransports.get(accountId);
      await running?.stop();
      runningTransports.delete(accountId);
    }
  },
  outbound: {
    deliveryMode: "direct",
    sendText: async (ctx) => {
      const account = resolveSpeakeasyAccount(ctx.cfg as unknown as Record<string, unknown>, ctx.accountId);
      const client = createAccountClient({
        account,
        logger: createAccountLogger(account)
      });
      const outbound = new SpeakeasyOutboundService(client);
      const target = inferOutboundTarget(ctx.to, account);
      if (target.kind === "topic") {
        try {
          await outbound.setTyping({ topicId: target.topicId, typing: true });
        } catch {}
      }
      try {
        const result = await outbound.send({
          target,
          text: ctx.text,
          replyTimelineId: ctx.replyToId ?? undefined
        });
        return {
          channel: "speakeasy",
          to: result.topicId,
          id: result.chatId ?? createIdempotencyKey("speakeasy-send"),
          messageId: result.chatId ?? createIdempotencyKey("speakeasy-send")
        };
      } finally {
        if (target.kind === "topic") {
          try {
            await outbound.setTyping({ topicId: target.topicId, typing: false });
          } catch {}
        }
      }
    },
    sendMedia: async (ctx) => {
      const account = resolveSpeakeasyAccount(ctx.cfg as unknown as Record<string, unknown>, ctx.accountId);
      const client = createAccountClient({
        account,
        logger: createAccountLogger(account)
      });
      const outbound = new SpeakeasyOutboundService(client);
      const target = inferOutboundTarget(ctx.to, account);
      if (target.kind === "topic") {
        try {
          await outbound.setTyping({ topicId: target.topicId, typing: true });
        } catch {}
      }
      try {
        const file = await fetchRemoteMedia(ctx.mediaUrl ?? "");
        const result = await outbound.send({
          target,
          text: ctx.text,
          file
        });
        return {
          channel: "speakeasy",
          to: result.topicId,
          id: result.chatId ?? createIdempotencyKey("speakeasy-media"),
          messageId: result.chatId ?? createIdempotencyKey("speakeasy-media")
        };
      } finally {
        if (target.kind === "topic") {
          try {
            await outbound.setTyping({ topicId: target.topicId, typing: false });
          } catch {}
        }
      }
    }
  },
  security: {
    collectWarnings: ({ account }) => {
      const warnings: string[] = [];

      if (account.transport === "webhook" && !account.webhookSecret) {
        warnings.push("Webhook transport is configured without webhookSecret.");
      }

      if (account.mentionOnly && !account.allowTopicMessages) {
        warnings.push("mentionOnly has no effect while topic messages are disabled.");
      }

      return warnings;
    }
  },
  messaging: {
    normalizeTarget: (raw) => parseSpeakeasyExplicitTarget(raw)?.to ?? raw.trim(),
    resolveInboundConversation: ({ conversationId }) =>
      conversationId
        ? {
            conversationId
          }
        : null,
    resolveDeliveryTarget: ({ conversationId }) => {
      const parsed = resolveSessionConversation({
        kind: "group",
        rawId: conversationId
      });

      return parsed
        ? {
            to: parsed.id.replace(/^doug:(topic|direct):/, "")
          }
        : null;
    },
    resolveSessionConversation: ({ rawId }) =>
      resolveSessionConversation({
        kind: "group",
        rawId
      }),
    resolveParentConversationCandidates: ({ rawId }) =>
      resolveSessionConversation({
        kind: "group",
        rawId
      })?.parentConversationCandidates ?? null,
    resolveSessionTarget: ({ id }) => id,
    parseExplicitTarget: ({ raw }) => {
      const trimmed = raw.trim();
      const parsed = parseSpeakeasyExplicitTarget(trimmed);

      if (parsed) {
        return {
          to: parsed.to,
          chatType: parsed.chatType
        };
      }

      if (trimmed.includes("@")) {
        return {
          to: trimmed,
          chatType: "direct"
        };
      }

      return {
        to: trimmed,
        chatType: "group"
      };
    },
    inferTargetChatType: ({ to }) => parseSpeakeasyExplicitTarget(to)?.chatType ?? (to.includes("@") ? "direct" : "group"),
    targetResolver: {
      looksLikeId: (raw, normalized) =>
        EXPLICIT_TARGET_RE.test(raw.trim()) ||
        SESSION_TARGET_RE.test(raw.trim()) ||
        /^\d+$/.test((normalized ?? raw).trim()),
      hint: "<topic:ID|direct:ID|topic id|topic name|user handle>",
      resolveTarget: async ({ cfg, accountId, input, normalized, preferredKind }) => {
        const account = resolveSpeakeasyAccount(cfg as unknown as Record<string, unknown>, accountId ?? undefined);
        const logger = createAccountLogger(account);
        const parsed = parseSpeakeasyExplicitTarget(input);
        const normalizedInput = (normalized ?? input).trim();

        if (parsed) {
          return {
            to: parsed.to,
            kind: "group",
            display: parsed.chatType === "direct" ? `DM ${parsed.to.replace(/^(?:doug:)?direct:/, "")}` : parsed.to,
            source: "normalized"
          };
        }

        if (preferredKind !== "user" && /^\d+$/.test(normalizedInput)) {
          return {
            to: `topic:${normalizedInput}`,
            kind: "group",
            display: `Topic ${normalizedInput}`,
            source: "normalized"
          };
        }

        if (preferredKind === "user" && normalizedInput.includes("@")) {
          return {
            to: input.trim(),
            kind: "user",
            display: input.trim(),
            source: "normalized"
          };
        }

        if (preferredKind !== "user") {
          const match = await resolveLiveTopicTarget({
            account,
            logger,
            input
          });

          if (match) {
            return {
              to: match.presentation.targetId,
              kind: "group",
              display: `${match.presentation.label} (${match.presentation.statusLabel})`,
              source: "directory"
            };
          }
        }

        return null;
      }
    },
    formatTargetDisplay: ({ target, display }) => {
      if (display) {
        return display;
      }

      if (target.startsWith("direct:") || target.startsWith("doug:direct:")) {
        return `DM ${target.replace(/^(?:doug:)?direct:/, "")}`;
      }

      return target;
    },
    resolveOutboundSessionRoute: ({ cfg, agentId: _agentId, target }) => {
      const parsed = resolveSessionConversation({
        kind: "group",
        rawId: target
      });
      const conversationId = parsed?.id ?? target;
      const peerKind = (conversationId.startsWith("direct:") || conversationId.startsWith("doug:direct:")) ? "direct" : "group";

      return buildChannelOutboundSessionRoute({
        cfg,
        agentId: "doug",
        channel: "speakeasy",
        peer: {
          kind: peerKind,
          id: conversationId
        },
        chatType: peerKind === "direct" ? "direct" : "group",
        from: "speakeasy",
        to: conversationId
      });
    }
  },
  conversationBindings: {
    supportsCurrentConversationBinding: true,
    defaultTopLevelPlacement: "current",
    resolveConversationRef: ({ conversationId, parentConversationId }) =>
      parentConversationId ? { conversationId, parentConversationId } : { conversationId },
    buildModelOverrideParentCandidates: ({ parentConversationId }) =>
      parentConversationId ? [parentConversationId] : []
  },
  directory: {
    self: async ({ cfg, accountId }) => {
      const account = resolveSpeakeasyAccount(cfg as unknown as Record<string, unknown>, accountId ?? undefined);
      const logger = createAccountLogger(account);
      const selfHandle = await resolveSpeakeasySelfHandle({
        account,
        logger
      });

      if (!selfHandle) {
        return null;
      }

      return {
        kind: "user",
        id: selfHandle,
        name: account.botDisplayName,
        handle: selfHandle
      };
    },
    listGroups: async ({ cfg, accountId, query, limit }) => {
      const account = resolveSpeakeasyAccount(cfg as unknown as Record<string, unknown>, accountId ?? undefined);
      return listSpeakeasyDirectoryGroups({
        account,
        logger: createAccountLogger(account),
        query,
        limit
      });
    },
    listGroupsLive: async ({ cfg, accountId, query, limit }) => {
      const account = resolveSpeakeasyAccount(cfg as unknown as Record<string, unknown>, accountId ?? undefined);
      return listSpeakeasyDirectoryGroups({
        account,
        logger: createAccountLogger(account),
        query,
        limit
      });
    },
    listGroupMembers: async ({ cfg, accountId, groupId, limit }) => {
      const account = resolveSpeakeasyAccount(cfg as unknown as Record<string, unknown>, accountId ?? undefined);
      const logger = createAccountLogger(account);
      const topicId = resolveSpeakeasyDirectoryTopicId(groupId);

      if (!topicId) {
        throw new Error(`Unsupported Speakeasy group id: ${groupId}`);
      }

      const client = createAccountClient({
        account,
        logger
      });
      const participants = Object.values((await client.getParticipants(topicId)).records.participants?.data ?? {})
        .sort((left, right) =>
          getParticipantDisplayLabel(left).localeCompare(getParticipantDisplayLabel(right))
        )
        .slice(0, limit ?? Number.MAX_SAFE_INTEGER)
        .map((participant) =>
          toSpeakeasyMemberDirectoryEntry({
            participant,
            topicId
          })
        );

      return participants;
    }
  },
  actions: {
    describeMessageTool: () => ({
      actions: SPEAKEASY_LIST_ACTIONS
    }),
    supportsAction: ({ action }) =>
      isSpeakeasyListAction(action),
    handleAction: async ({ action, cfg, accountId, params }) => {
      if (!isSpeakeasyListAction(action)) {
        throw new Error(`Unsupported Speakeasy message action: ${action}`);
      }

      return handleSpeakeasyListAction({
        action,
        cfg,
        accountId,
        actionParams: params
      });
    }
  },
  resolver: {
    resolveTargets: async ({ cfg, accountId, inputs, kind }) => {
      const account = resolveSpeakeasyAccount(cfg as unknown as Record<string, unknown>, accountId ?? undefined);
      const logger = createAccountLogger(account);

      if (kind === "user") {
        return inputs.map((input) => ({
          input,
          resolved: Boolean(input.trim()),
          id: input.trim() || undefined,
          name: input.trim() || undefined,
          note: input.includes("@") ? "direct handle" : "unverified user target"
        }));
      }

      const liveTopics = await listSpeakeasyLiveTopics({
        account,
        logger
      });
      const resolved = await Promise.all(
        inputs.map(async (input) => {
          const parsed = parseSpeakeasyExplicitTarget(input);

          if (parsed) {
            return {
              input,
              resolved: true,
              id: parsed.to,
              name: parsed.to,
              note: parsed.chatType === "direct" ? "direct message" : "topic"
            };
          }

          if (/^\d+$/.test(input.trim())) {
            return {
              input,
              resolved: true,
              id: `topic:${input.trim()}`,
              name: `Topic ${input.trim()}`,
              note: "topic id"
            };
          }

          const match = await resolveLiveTopicTarget({
            entries: liveTopics,
            input
          });

          if (!match) {
            return {
              input,
              resolved: false,
              note: "no matching Speakeasy topic"
            };
          }

          return {
            input,
            resolved: true,
            id: match.presentation.targetId,
            name: match.presentation.label,
            note: match.presentation.statusLabel
          };
        })
      );

      return resolved;
    }
  }
} as ChannelPlugin<ResolvedSpeakeasyAccount>;

async function fetchRemoteMedia(mediaUrl: string): Promise<{
  filename: string;
  bytes: Uint8Array;
  contentType: string;
}> {
  const response = await fetch(mediaUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch outbound media: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  const filename = mediaUrl.split("/").pop() || "attachment";
  const bytes = new Uint8Array(await response.arrayBuffer());

  return {
    filename,
    bytes,
    contentType
  };
}

async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
