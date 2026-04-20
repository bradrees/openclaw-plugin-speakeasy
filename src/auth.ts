import type { ResolvedSpeakeasyAccount, SpeakeasyAuthRefreshResult } from "./types.js";

export class SpeakeasyAuthRefreshError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown
  ) {
    super(message);
    this.name = "SpeakeasyAuthRefreshError";
  }
}

export function buildAgentAuthHeaders(accessToken: string, extra?: Record<string, string>): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-AUTH-TOKEN": accessToken,
    Authorization: `Bearer ${accessToken}`,
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
    headers: buildAgentAuthHeaders(account.accessToken),
    body: JSON.stringify({
      refresh_token: account.refreshToken
    })
  });

  if (!response.ok) {
    throw new SpeakeasyAuthRefreshError(
      `Speakeasy refresh failed: POST /api/v1/agent_sessions/refresh -> ${response.status}`,
      response.status,
      await safeJson(response)
    );
  }

  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    agent_handle?: string;
    expires_at?: string;
  };

  if (!json.access_token) {
    throw new Error("Speakeasy refresh response did not include access_token");
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt:
      normalizeSpeakeasyTimestamp(json.expires_at) ?? resolveSpeakeasyAccessTokenExpiryText(json.access_token),
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

export function resolveSpeakeasyAccessTokenExpiry(
  accessToken: string,
  fallbackExpiresAt?: string
): number | undefined {
  const payload = decodeSpeakeasyAccessToken(accessToken);

  if (typeof payload?.expires_at === "string") {
    return parseSpeakeasyTimestamp(payload.expires_at);
  }

  if (typeof payload?.exp === "number" && Number.isFinite(payload.exp)) {
    return payload.exp * 1000;
  }

  return parseSpeakeasyTimestamp(fallbackExpiresAt);
}

export function resolveSpeakeasyAccessTokenExpiryText(
  accessToken: string,
  fallbackExpiresAt?: string
): string | undefined {
  const payload = decodeSpeakeasyAccessToken(accessToken);

  if (typeof payload?.expires_at === "string") {
    return normalizeSpeakeasyTimestamp(payload.expires_at);
  }

  if (typeof payload?.exp === "number" && Number.isFinite(payload.exp)) {
    return new Date(payload.exp * 1000).toISOString();
  }

  return normalizeSpeakeasyTimestamp(fallbackExpiresAt);
}

export function isSpeakeasyAccessTokenExpired(
  accessToken: string,
  options: {
    now?: number;
    skewMs?: number;
    expiresAt?: string;
  } = {}
): boolean {
  const expiresAt = resolveSpeakeasyAccessTokenExpiry(accessToken, options.expiresAt);

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

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function parseSpeakeasyTimestamp(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeSpeakeasyTimestamp(value: string | undefined): string | undefined {
  return parseSpeakeasyTimestamp(value) === undefined ? undefined : value?.trim();
}
