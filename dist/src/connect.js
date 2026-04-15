export async function createConnectRequest(params) {
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

export async function exchangeConnectCode(params) {
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
  account,
  tokens) {
  return {
    ...account,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? account.refreshToken
  };
}
