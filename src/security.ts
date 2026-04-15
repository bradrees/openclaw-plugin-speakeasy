import type { CanonicalInboundEvent, InboundPolicyDecision, ResolvedSpeakeasyAccount } from "./types.js";

function normalizeHandle(handle: string | undefined): string | undefined {
  return handle?.trim().toLowerCase();
}

export function shouldIgnoreSelfEvent(params: {
  event: CanonicalInboundEvent;
  agentHandle?: string;
}): boolean {
  const eventHandle = normalizeHandle(params.event.chat?.author_handle ?? params.event.actorHandle);
  const agentHandle = normalizeHandle(params.agentHandle);

  return Boolean(eventHandle && agentHandle && eventHandle === agentHandle);
}

export function evaluateInboundPolicy(params: {
  event: CanonicalInboundEvent;
  account: ResolvedSpeakeasyAccount;
  agentHandle?: string;
}): InboundPolicyDecision {
  if (shouldIgnoreSelfEvent(params)) {
    return {
      allowed: false,
      reason: "self-authored event"
    };
  }

  if (params.event.conversation.kind === "direct" && !params.account.allowDirectMessages) {
    return {
      allowed: false,
      reason: "direct messages are disabled"
    };
  }

  if (params.event.conversation.kind === "topic" && !params.account.allowTopicMessages) {
    return {
      allowed: false,
      reason: "topic messages are disabled"
    };
  }

  const allowedTopicIds = params.account.allowedTopicIds?.map((value) => value.trim());
  const topicId = params.event.conversation.providerIds.topicId;

  if (allowedTopicIds && !allowedTopicIds.includes(topicId)) {
    return {
      allowed: false,
      reason: `topic ${topicId} is not allowlisted`
    };
  }

  const actorHandle = normalizeHandle(params.event.chat?.author_handle ?? params.event.actorHandle);
  const allowedHandles = params.account.allowedUserHandles?.map((value) => value.trim().toLowerCase());

  if (allowedHandles && actorHandle && !allowedHandles.includes(actorHandle)) {
    return {
      allowed: false,
      reason: `${actorHandle} is not allowlisted`
    };
  }

  if (params.account.mentionOnly && params.event.conversation.kind !== "direct") {
    const body = `${params.event.chat?.plain ?? ""}\n${params.event.chat?.html ?? ""}`.toLowerCase();
    const mentionCandidates = [
      params.agentHandle?.toLowerCase(),
      params.account.botDisplayName?.toLowerCase()
    ].filter((value): value is string => Boolean(value));
    const mentioned = mentionCandidates.some((candidate) => body.includes(candidate));

    if (!mentioned) {
      return {
        allowed: false,
        reason: "mention-only mode rejected the event"
      };
    }
  }

  return {
    allowed: true
  };
}
