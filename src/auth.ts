import type { ResolvedSpeakeasyAccount } from "./types.js";

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
): Promise<string> {
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

  const json = (await response.json()) as { access_token?: string };

  if (!json.access_token) {
    throw new Error("Speakeasy refresh response did not include access_token");
  }

  return json.access_token;
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
