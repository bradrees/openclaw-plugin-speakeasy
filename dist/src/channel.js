import { buildChannelOutboundSessionRoute, createChannelPluginBase } from "openclaw/plugin-sdk/core";
import { dispatchInboundReplyWithBase } from "openclaw/plugin-sdk/channel-inbound";
import { createNormalizedOutboundDeliverer, deliverTextOrMediaReply } from "openclaw/plugin-sdk/reply-payload";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
import { SPEAKEASY_CHANNEL_JSON_SCHEMA, resolveSpeakeasyAccount, validateSpeakeasyAccount, writeSpeakeasyAccount } from "./config.js";
import { SpeakeasyApiClient } from "./client.js";
import { normalizeWebhookEvent, verifyWebhookSignature } from "./events.js";
import { inferOutboundTarget, SpeakeasyOutboundService } from "./outbound.js";
import { SpeakeasyPollingLoop } from "./polling.js";
import { resolveSessionConversation } from "./session-key-api.js";
import { evaluateInboundPolicy } from "./security.js";
import { createCursorStore, createLogger, createIdempotencyKey, updateCursorState } from "./utils.js";
import { SpeakeasyWebSocketConnection } from "./websocket.js";
const runtimeStore = createPluginRuntimeStore("Speakeasy runtime is not initialized yet. OpenClaw should call setRuntime() during plugin registration.");
const webhookTargets = new Map();
export const WEBHOOK_ROUTE_PREFIX = "/plugins/openclaw-plugin-speakeasy/webhooks/";
const runningTransports = new Map();
export function setSpeakeasyRuntime(runtime) {
    runtimeStore.setRuntime(runtime);
}
export async function handleSpeakeasyWebhookRoute(req, res) {
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
    if (!target.account.webhookSecret ||
        !verifyWebhookSignature({
            secret: target.account.webhookSecret,
            rawBody,
            ...(signatureValue ? { signatureHeader: signatureValue } : {})
        })) {
        res.statusCode = 401;
        res.end("invalid webhook signature");
        return true;
    }
    const payload = JSON.parse(rawBody);
    const event = normalizeWebhookEvent(payload, {});
    await target.handleEvent(event);
    res.statusCode = 202;
    res.end("accepted");
    return true;
}
function createAccountLogger(account) {
    return createLogger(`account:${account.accountId}`, account.debugLogging);
}
async function buildReplyDeliverer(params) {
    const client = new SpeakeasyApiClient({
        baseUrl: params.account.baseUrl,
        accessToken: params.account.accessToken,
        logger: params.logger
    });
    const outbound = new SpeakeasyOutboundService(client, params.logger);
    const target = params.event.conversation.kind === "direct"
        ? { kind: "topic", topicId: params.event.conversation.providerIds.topicId }
        : { kind: "topic", topicId: params.event.conversation.providerIds.topicId };
    return createNormalizedOutboundDeliverer(async (payload) => {
        await deliverTextOrMediaReply({
            payload,
            text: payload.text ?? "",
            sendText: async (text) => {
                await outbound.send({
                    target,
                    text,
                    ...(payload.replyToId ? { replyTimelineId: payload.replyToId } : {})
                });
            },
            sendMedia: async ({ mediaUrl, caption }) => {
                const file = await fetchRemoteMedia(mediaUrl);
                await outbound.send({
                    target,
                    ...(caption ? { text: caption } : {}),
                    file
                });
            }
        });
    });
}
async function dispatchInboundEvent(params) {
    const runtime = runtimeStore.getRuntime();
    const policy = evaluateInboundPolicy({
        event: params.event,
        account: params.account
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
        ChatType: params.event.conversation.kind === "direct" ? "direct" : "group",
        ConversationLabel: params.event.topic?.subject ??
            params.event.conversation.providerIds.topicId,
        GroupSubject: params.event.topic?.subject ?? undefined,
        From: params.event.chat?.author_handle ?? params.event.actorHandle ?? "unknown",
        To: params.event.conversation.conversationId,
        Body: params.event.chat?.plain ??
            stripHtml(params.event.chat?.html ?? ""),
        SenderId: params.event.chat?.author_handle ?? params.event.actorHandle ?? undefined,
        SenderName: params.event.participant?.display_name ??
            params.event.participant?.name ??
            undefined,
        Timestamp: Date.parse(params.event.occurredAt) || Date.now(),
        NativeChannelId: params.event.conversation.providerIds.topicId,
        ThreadParentId: params.event.conversation.parentConversationId,
        CurrentMessageId: params.event.chat?.id && params.event.topic?.id
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
    await dispatchInboundReplyWithBase({
        cfg: params.cfg,
        channel: "speakeasy",
        accountId: params.account.accountId,
        route,
        storePath,
        ctxPayload,
        core: runtime,
        deliver,
        onRecordError: (error) => {
            params.logger.error("failed to record Speakeasy inbound session", {
                error: error instanceof Error ? error.message : String(error)
            });
        },
        onDispatchError: (error, info) => {
            params.logger.error("failed to dispatch Speakeasy reply", {
                kind: info.kind,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    });
}
async function startAccountRuntime(params) {
    const logger = createAccountLogger(params.account);
    const client = new SpeakeasyApiClient({
        baseUrl: params.account.baseUrl,
        accessToken: params.account.accessToken,
        logger
    });
    const store = createCursorStore(params.account);
    const handleEvent = async (event) => {
        await updateCursorState(store, (state) => ({
            ...state,
            cursor: event.id,
            conversationKinds: {
                ...state.conversationKinds,
                [event.conversation.providerIds.topicId]: event.conversation.kind
            }
        }));
        await dispatchInboundEvent({
            cfg: params.cfg,
            account: params.account,
            event,
            logger
        });
    };
    const pollingLoop = new SpeakeasyPollingLoop({
        client,
        logger,
        pollIntervalMs: params.account.pollIntervalMs,
        getCursor: async () => (await store.read()).cursor,
        setCursor: async (cursor) => {
            await updateCursorState(store, (state) => ({ ...state, cursor }));
        },
        getConversationKinds: async () => (await store.read()).conversationKinds,
        onEvent: handleEvent
    });
    let websocket;
    if (params.account.transport === "websocket") {
        websocket = new SpeakeasyWebSocketConnection({
            client,
            accessToken: params.account.accessToken,
            logger,
            heartbeatMs: params.account.websocketHeartbeatMs,
            getCursor: async () => (await store.read()).cursor,
            setCursor: async (cursor) => {
                await updateCursorState(store, (state) => ({
                    ...state,
                    cursor,
                    websocketResumeCursor: cursor
                }));
            },
            getConversationKinds: async () => (await store.read()).conversationKinds,
            onEvent: handleEvent,
            onRecoverableGap: async () => {
                await pollingLoop.start();
            }
        });
        await websocket.start();
    }
    else {
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
    ...createChannelPluginBase({
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
        configSchema: SPEAKEASY_CHANNEL_JSON_SCHEMA,
        setup: {
            applyAccountConfig: ({ cfg, accountId, input }) => {
                const validation = validateSpeakeasyAccount({
                    baseUrl: input.url,
                    accessToken: input.accessToken ?? input.token,
                    botDisplayName: input.name
                });
                if (!validation.ok) {
                    throw new Error(validation.errors.join("; "));
                }
                return writeSpeakeasyAccount(cfg, {
                    ...validation.value,
                    accountId
                });
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
            const channels = cfg.channels;
            return Object.keys(channels?.speakeasy?.accounts ?? { default: {} });
        },
        resolveAccount: (cfg, accountId) => resolveSpeakeasyAccount(cfg, accountId),
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
            const client = new SpeakeasyApiClient({
                baseUrl: account.baseUrl,
                accessToken: account.accessToken,
                logger: createAccountLogger(account)
            });
            return client.getMe();
        },
        buildAccountSnapshot: async ({ account, probe }) => ({
            accountId: account.accountId,
            enabled: account.enabled,
            configured: Boolean(account.baseUrl && account.accessToken),
            connected: Boolean(probe),
            baseUrl: account.baseUrl,
            mode: account.transport,
            profile: probe
        }),
        logSelfId: ({ runtime, account }) => {
            console.log(`speakeasy:${account.accountId}`);
        }
    },
    gateway: {
        startAccount: async ({ cfg, accountId }) => {
            const account = resolveSpeakeasyAccount(cfg, accountId);
            const running = await startAccountRuntime({
                cfg,
                account
            });
            runningTransports.set(account.accountId, running);
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
            const account = resolveSpeakeasyAccount(ctx.cfg, ctx.accountId);
            const client = new SpeakeasyApiClient({
                baseUrl: account.baseUrl,
                accessToken: account.accessToken,
                logger: createAccountLogger(account)
            });
            const outbound = new SpeakeasyOutboundService(client);
            const result = await outbound.send({
                target: inferOutboundTarget(ctx.to, account),
                text: ctx.text,
                replyTimelineId: ctx.replyToId ?? undefined
            });
            return {
                channel: "speakeasy",
                to: result.topicId,
                id: result.chatId ?? createIdempotencyKey("speakeasy-send"),
                messageId: result.chatId ?? createIdempotencyKey("speakeasy-send")
            };
        },
        sendMedia: async (ctx) => {
            const account = resolveSpeakeasyAccount(ctx.cfg, ctx.accountId);
            const client = new SpeakeasyApiClient({
                baseUrl: account.baseUrl,
                accessToken: account.accessToken,
                logger: createAccountLogger(account)
            });
            const outbound = new SpeakeasyOutboundService(client);
            const file = await fetchRemoteMedia(ctx.mediaUrl ?? "");
            const result = await outbound.send({
                target: inferOutboundTarget(ctx.to, account),
                text: ctx.text,
                file
            });
            return {
                channel: "speakeasy",
                to: result.topicId,
                id: result.chatId ?? createIdempotencyKey("speakeasy-media"),
                messageId: result.chatId ?? createIdempotencyKey("speakeasy-media")
            };
        }
    },
    security: {
        collectWarnings: ({ account }) => {
            const warnings = [];
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
        normalizeTarget: (raw) => raw.trim(),
        resolveInboundConversation: ({ conversationId }) => conversationId
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
                    to: parsed.id.replace(/^(topic|direct):/, "")
                }
                : null;
        },
        resolveSessionConversation: ({ rawId }) => resolveSessionConversation({
            kind: "group",
            rawId
        }),
        resolveParentConversationCandidates: ({ rawId }) => resolveSessionConversation({
            kind: "group",
            rawId
        })?.parentConversationCandidates ?? null,
        resolveSessionTarget: ({ id }) => id,
        parseExplicitTarget: ({ raw }) => {
            const trimmed = raw.trim();
            if (trimmed.startsWith("topic:") || trimmed.startsWith("direct:")) {
                return {
                    to: trimmed,
                    chatType: trimmed.startsWith("direct:") ? "direct" : "group"
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
        inferTargetChatType: ({ to }) => (to.includes("@") ? "direct" : "group"),
        resolveOutboundSessionRoute: ({ cfg, agentId, target }) => {
            const parsed = resolveSessionConversation({
                kind: "group",
                rawId: target
            });
            const conversationId = parsed?.id ?? target;
            const peerKind = conversationId.startsWith("direct:") ? "direct" : "group";
            return buildChannelOutboundSessionRoute({
                cfg,
                agentId,
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
        resolveConversationRef: ({ conversationId, parentConversationId }) => parentConversationId ? { conversationId, parentConversationId } : { conversationId },
        buildModelOverrideParentCandidates: ({ parentConversationId }) => parentConversationId ? [parentConversationId] : []
    },
    resolver: {
        resolveTargets: async ({ inputs, kind }) => inputs.map((input) => ({
            input,
            resolved: true,
            id: kind === "user" ? input : input.replace(/^(topic|direct):/, ""),
            name: input
        }))
    }
};
async function fetchRemoteMedia(mediaUrl) {
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
async function readRawBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
}
function stripHtml(html) {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
//# sourceMappingURL=channel.js.map