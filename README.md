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

## Architecture note

Child topics are mapped as separate conversations because Speakeasy documents them as normal topics with their own `topic_id`, `parent_topic_id`, `root_topic_id`, and `spawned_from_chat_id`. They are not nested message threads inside a single topic timeline. Treating them as OpenClaw `threadId` values would collapse a real standalone resource into a fake subresource and would break parent fallback, history reconstruction, and outbound routing.

## Limitations

- Speakeasy's public docs do not currently expose a definitive direct-topic flag on topic snapshots, so direct-chat classification falls back to explicit direct-chat creation plus lightweight heuristics.
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
