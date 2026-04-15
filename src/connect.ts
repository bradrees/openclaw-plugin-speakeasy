import type { ResolvedSpeakeasyAccount } from "./types.js";

export type SpeakeasyConnectRequestResponse = {
  request_id?: string;
  code?: string;
  expires_at?: string;
  status?: string;
};

export type SpeakeasyTokenExchangeResponse = {
  access_token: string;
  refresh_token?: string;
  expires_at?: string;
};

export async function createConnectRequest(params: {
  baseUrl: string;
  userHandle: string;
  callbackUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<SpeakeasyConnectRequestResponse> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const response = await fetchImpl(new URL("/api/v1/agent_connect/requests", params.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      user_handle: params.userHandle,
      ...(params.callbackUrl ? { callback_url: params.callbackUrl } : {})
    })
  });

  if (!response.ok) {
    throw new Error(`Speakeasy connect request failed with HTTP ${response.status}`);
  }

  return (await response.json()) as SpeakeasyConnectRequestResponse;
}

export async function exchangeConnectCode(params: {
  baseUrl: string;
  code: string;
  fetchImpl?: typeof fetch;
}): Promise<SpeakeasyTokenExchangeResponse> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const response = await fetchImpl(new URL("/api/v1/agent_connect/exchanges", params.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      code: params.code
    })
  });

  if (!response.ok) {
    throw new Error(`Speakeasy connect exchange failed with HTTP ${response.status}`);
  }

  const json = (await response.json()) as SpeakeasyTokenExchangeResponse;
  if (!json.access_token) {
    throw new Error("Speakeasy connect exchange did not include access_token");
  }
  return json;
}

export function withFreshTokens(
  account: ResolvedSpeakeasyAccount,
  tokens: SpeakeasyTokenExchangeResponse
): ResolvedSpeakeasyAccount {
  return {
    ...account,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? account.refreshToken
  };
}
