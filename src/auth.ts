import type { ResolvedSpeakeasyAccount, SpeakeasyAuthRefreshResult } from "./types.js";

export function buildAgentAuthHeaders(accessToken: string, extra?: Record<string, string>): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-AUTH-TOKEN": accessToken,
    ...extra
  };
}

export async function refreshAccessToken(
  account: ResolvedSpeakeasyAccount,
  fetchImpl: typeof fetch = fetch
): Promise<SpeakeasyAuthRefreshResult> {
  if (!account.refreshToken) {
    throw new Error("Cannot refresh Speakeasy access token without refreshToken");
  }

  const response = await fetchImpl(new URL("/api/v1/agent_sessions/refresh", account.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      refresh_token: account.refreshToken
    })
  });

  if (!response.ok) {
    throw new Error(`Speakeasy refresh failed with HTTP ${response.status}`);
  }

  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    agent_handle?: string;
  };

  if (!json.access_token) {
    throw new Error("Speakeasy refresh response did not include access_token");
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    agentHandle:
      (typeof json.agent_handle === "string" ? json.agent_handle.trim().toLowerCase() : undefined) ??
      resolveAgentHandleFromAccessToken(json.access_token)
  };
}

export function decodeSpeakeasyAccessToken(accessToken: string): Record<string, unknown> | null {
  const [, payload] = accessToken.split(".");

  if (!payload) {
    return null;
  }

  try {
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function resolveAgentHandleFromAccessToken(accessToken: string): string | undefined {
  const payload = decodeSpeakeasyAccessToken(accessToken);
  const candidate =
    (typeof payload?.agent_handle === "string" ? payload.agent_handle : undefined) ??
    (typeof payload?.account_handle === "string" ? payload.account_handle : undefined);

  return candidate?.trim().toLowerCase() || undefined;
}

export function resolveSpeakeasyAccessTokenExpiry(accessToken: string): number | undefined {
  const payload = decodeSpeakeasyAccessToken(accessToken);

  if (typeof payload?.expires_at === "string") {
    const parsed = Date.parse(payload.expires_at);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  if (typeof payload?.exp === "number" && Number.isFinite(payload.exp)) {
    return payload.exp * 1000;
  }

  return undefined;
}

export function isSpeakeasyAccessTokenExpired(
  accessToken: string,
  options: {
    now?: number;
    skewMs?: number;
  } = {}
): boolean {
  const expiresAt = resolveSpeakeasyAccessTokenExpiry(accessToken);

  if (expiresAt === undefined) {
    return false;
  }

  return expiresAt <= (options.now ?? Date.now()) + (options.skewMs ?? 30_000);
}

type OpenClawConfigLike = {
  channels?: {
    speakeasy?: {
      accounts?: Record<string, Partial<ResolvedSpeakeasyAccount>>;
    };
  };
};

export function hasAnySpeakeasyConfiguredState(raw: unknown): boolean {
  const cfg = raw as OpenClawConfigLike;
  const accounts = cfg.channels?.speakeasy?.accounts ?? {};

  return Object.values(accounts).some((account) => Boolean(account.baseUrl && account.accessToken));
}

export function hasAnySpeakeasyAuth(raw: unknown): boolean {
  const cfg = raw as OpenClawConfigLike;
  const accounts = cfg.channels?.speakeasy?.accounts ?? {};

  return Object.values(accounts).some((account) => Boolean(account.accessToken));
}
