# `@bradrees/openclaw-plugin-speakeasy`

Standalone OpenClaw channel plugin for the Speakeasy external agent API.

It maps Speakeasy's topic hierarchy into OpenClaw without inventing a fake in-topic thread primitive:

- top-level topic -> first-class OpenClaw conversation
- child topic -> separate first-class OpenClaw conversation
- child topic parent -> parent conversation fallback metadata
- direct chat -> standalone conversation

## What it does

- connects Speakeasy via websocket, polling, or optional webhook delivery
- normalizes `chat.created`, `chat.updated`, `chat.deleted`, `topic.created`, and participant events
- sends, edits, deletes, and uploads chat attachments through the public Speakeasy API
- applies DM/topic allow/deny policy, mention-only mode, user/topic allowlists, and self-loop prevention
- exposes a public session-conversation resolver for stable OpenClaw session keys

## Required Speakeasy API capabilities

The plugin assumes the connected agent grant exposes:

- `event_polling`
- `event_websocket` for the preferred live transport
- `event_webhooks` only if webhook mode is enabled
- `topic_history`
- `topic_participants_read`
- `attachments` for file upload support
- `chat_idempotency`
- `profile_update` only when `botDisplayName` is configured

## Install

```bash
openclaw plugins install @bradrees/openclaw-plugin-speakeasy
openclaw gateway restart
```

## Example config

```json
{
  "channels": {
    "speakeasy": {
      "accounts": {
        "default": {
          "enabled": true,
          "baseUrl": "https://speakeasy.example.com",
          "accessToken": "spk_access_token",
          "refreshToken": "spk_refresh_token",
          "transport": "websocket",
          "cursorStore": {
            "kind": "file"
          },
          "allowDirectMessages": true,
          "allowTopicMessages": true,
          "mentionOnly": false,
          "allowedTopicIds": [
            "456",
            "789"
          ],
          "allowedUserHandles": [
            "owner@example.com",
            "ops@example.com"
          ],
          "botDisplayName": "OpenClaw Agent",
          "debugLogging": false
        }
      }
    }
  },
  "plugins": {
    "entries": {
      "openclaw-plugin-speakeasy": {
        "enabled": true,
        "config": {}
      }
    }
  }
}
```

## Transport model

- `websocket`: preferred. Uses Speakeasy's public ActionCable `AgentEventsChannel`, resumes from the stored cursor, and falls back to polling on replay gaps or rejected cursors.
- `polling`: baseline recovery transport. Uses `GET /api/v1/agent/events?cursor=...`.
- `webhook`: optional. Registers an OpenClaw plugin HTTP route and verifies `X-Agent-Signature`, but still runs polling as the replay safety net.

The package works without any public inbound URL because websocket and polling are first-class paths.

## Conversation mapping

- `topic:<topic_id>` is the canonical conversation id for normal topics.
- `direct:<topic_id>` is the canonical conversation id for direct chats when the plugin can positively classify the topic as direct.
- child topics never become `threadId` values.
- parent topic fallback is exposed through `parentConversationId` and `parentConversationCandidates`.
- provider metadata retains `topic_id`, `parent_topic_id`, `root_topic_id`, and `spawned_from_chat_id`.

## OpenClaw integration surfaces

The plugin exposes Speakeasy topic discovery through normal OpenClaw channel surfaces instead of a plugin-specific helper:

- `directory.listGroups` and `directory.listGroupsLive` expose live topic listing. They return explicit OpenClaw targets such as `topic:42` and `direct:7`.
- `directory.listGroupMembers` returns live participants for those same topic targets, so `openclaw directory groups members --group-id topic:42` can inspect a topic roster without a plugin-specific tool.
- `message` tool actions `channel-list` and `thread-list` return the same live topic list as a compatibility bridge for OpenClaw surfaces that ask for channel/thread listings.
- `message` tool action `read` fetches recent chats for a `topic:<topic_id>` or `direct:<topic_id>` target using `GET /api/v1/agent/topics/:topic_id/chats`.
- `resolver.resolveTargets` resolves bare topic ids plus friendly topic/DM labels back into those explicit targets for CLI and tool flows.
- `messaging.targetResolver` handles post-directory normalization for explicit `topic:` / `direct:` ids and bare numeric topic ids.
- inbound session labeling uses the same topic metadata helpers, so OpenClaw session/context surfaces see the same DM-aware labels that directory and resolver flows expose.

This is the best current plugin-side integration point because the OpenClaw channel SDK exposes directory + resolver hooks, but not a separate dedicated "list remote topics" surface for channel plugins.

### Agent usage

When asking an OpenClaw agent to inspect Speakeasy topology, direct it to use the Speakeasy directory surface:

```text
Use the Speakeasy channel directory. List groups for openclaw-plugin-speakeasy, then list group members for the returned topic/direct target that looks relevant.
```

The known-good CLI path is:

```bash
openclaw directory groups list --channel openclaw-plugin-speakeasy --json
openclaw directory groups members --channel openclaw-plugin-speakeasy --group-id topic:<topic_id> --json
openclaw message read --channel openclaw-plugin-speakeasy --target direct:<topic_id> --json
```

Use the returned ids (`topic:<topic_id>` or `direct:<topic_id>`) as message targets. Do not rely on stored session ids as the source of truth for current topics, and do not use the generic `openclaw message channel list` / `openclaw message thread list` CLI wrappers for Speakeasy because those are still Discord/guild-shaped in current OpenClaw core.

For checking replies, read the existing topic or DM target. Reading by email handle is supported only when the plugin can find an existing direct topic for that handle; `read` does not create a DM as a side effect.

To originate a DM when no `direct:<topic_id>` exists yet, send to the email-style Speakeasy handle directly:

```text
Send a Speakeasy DM to chris@team.speakeasy.to asking for today's daily update.
```

The plugin resolves that as a direct target and calls Speakeasy's direct-chat creation API, which creates or reuses the underlying direct topic.

## DM naming and status

- direct topics with placeholder subjects such as `Untitled` are renamed from participants when the plugin can read topic participants
- direct topics are exposed with explicit `direct:<topic_id>` targets and `DM: ...` labels
- account status snapshots now surface a `dmPolicy` value of `enabled`, `allowlisted`, or `disabled`

## Architecture note

Child topics are mapped as separate conversations because Speakeasy documents them as normal topics with their own `topic_id`, `parent_topic_id`, `root_topic_id`, and `spawned_from_chat_id`. They are not nested message threads inside a single topic timeline. Treating them as OpenClaw `threadId` values would collapse a real standalone resource into a fake subresource and would break parent fallback, history reconstruction, and outbound routing.

## Limitations

- Speakeasy's public topic snapshots do not currently expose a definitive direct-topic flag, so direct-chat classification still relies on explicit `direct:` targets plus participant/subject heuristics.
- OpenClaw's generic `message channel list` and `message thread list` CLI subcommands are still Discord-shaped today, so the plugin exposes live topic discovery through `openclaw directory groups list` and `openclaw directory groups members` instead. The model-facing `message` tool can also use the plugin-owned `channel-list` / `thread-list` actions.
- OpenClaw's channel SDK currently exposes directory and resolver hooks for this, but not a separate topic-browser API, so topic enumeration is intentionally surfaced through those existing channel interfaces.
- webhook mode assumes the OpenClaw gateway host exposes the plugin route directly
- attachment upload is implemented through direct-upload + `chat.sgid`, but inline media rendering depends on the receiving Speakeasy client

## Local development

```bash
yarn
yarn build
yarn test
```

## Public API usage

The package only uses documented Speakeasy endpoints:

- `GET /api/v1/agent/me`
- `PATCH /api/v1/agent/me`
- `GET /api/v1/agent/topics`
- `GET /api/v1/agent/topics/:topic_id`
- `GET /api/v1/agent/topics/:topic_id/chats`
- `GET /api/v1/agent/topics/:topic_id/chats/:chat_id`
- `GET /api/v1/agent/topics/:topic_id/participants`
- `POST /api/v1/agent/topics/:topic_id/chats`
- `PATCH /api/v1/agent/topics/:topic_id/chats/:chat_id`
- `DELETE /api/v1/agent/topics/:topic_id/chats/:chat_id`
- `POST /api/v1/agent/direct_chats`
- `GET /api/v1/agent/events`
- `GET /cable?agent_access_token=<token>`
- `POST /api/v1/files`
