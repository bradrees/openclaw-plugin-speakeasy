import { defineSetupPluginEntry, type OpenClawConfig } from "openclaw/plugin-sdk/core";

import { resolveSpeakeasyAccount } from "./config.js";
import { SpeakeasyApiClient } from "./client.js";
import { speakeasyChannelPlugin } from "./channel.js";
import type { LoggerLike, ResolvedSpeakeasyAccount, SetupProbeResult } from "./types.js";
import { createLogger } from "./utils.js";

export async function runSpeakeasySetup(params: {
  account: ResolvedSpeakeasyAccount;
  logger?: LoggerLike;
  allowRename?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<SetupProbeResult> {
  const logger = params.logger ?? createLogger(`setup:${params.account.accountId}`, params.account.debugLogging);
  const client = new SpeakeasyApiClient({
    baseUrl: params.account.baseUrl,
    accessToken: params.account.accessToken,
    refreshToken: params.account.refreshToken,
    logger,
    fetchImpl: params.fetchImpl
  });
  logger.info("checking Speakeasy agent connectivity");
  const probe = await client.probeConnectivity();
  const profile = probe.profile;

  if (!profile) {
    logger.warn("Speakeasy agent profile endpoint is unavailable; skipping profile-dependent setup steps", {
      endpoint: probe.endpoint
    });
    return {
      ok: true,
      probe,
      rename: {
        attempted: false,
        status: "skipped",
        reason: "agent profile endpoint is unavailable; rename requires GET /api/v1/agent/me"
      }
    };
  }

  if (!params.account.botDisplayName || params.allowRename === false) {
    return {
      ok: true,
      probe,
      profile,
      rename: {
        attempted: false,
        status: "skipped",
        reason: params.account.botDisplayName ? "rename disabled for this probe" : "botDisplayName not configured"
      }
    };
  }

  if (profile.display_name === params.account.botDisplayName) {
    logger.info("Speakeasy display name already matches configuration", {
      displayName: profile.display_name
    });
    return {
      ok: true,
      probe,
      profile,
      rename: {
        attempted: true,
        status: "unchanged"
      }
    };
  }

  try {
    logger.info("updating Speakeasy display name", {
      from: profile.display_name,
      to: params.account.botDisplayName
    });
    const updated = await client.updateMe(params.account.botDisplayName);
    return {
      ok: true,
      probe,
      profile: updated,
      rename: {
        attempted: true,
        status: "updated"
      }
    };
  } catch (error) {
    logger.warn("failed to update Speakeasy display name", {
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      ok: true,
      probe,
      profile,
      rename: {
        attempted: true,
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

export async function verifySpeakeasyAccountFromConfig(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
  logger?: LoggerLike;
}): Promise<SetupProbeResult> {
  const account = resolveSpeakeasyAccount(params.cfg as unknown as Record<string, unknown>, params.accountId);
  return runSpeakeasySetup({
    account,
    logger: params.logger
  });
}

export default defineSetupPluginEntry(speakeasyChannelPlugin);
