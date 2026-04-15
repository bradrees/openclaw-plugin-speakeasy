export type SpeakeasyConnectRequestResponse = {
  request_id: number;
  poll_token: string;
};

export type SpeakeasyConnectStatusResponse = {
  request_id: number;
  status?: string;
  exchange_code?: string;
  expires_at?: string;
};

export type SpeakeasyTokenExchangeResponse = {
  access_token: string;
  refresh_token?: string;
  agent_handle?: string;
  webhook_secret?: string;
  expires_at?: string;
};

export async function createConnectRequest(params: {
  baseUrl: string;
  handle: string;
  requesterName: string;
  agentName?: string;
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
      handle: params.handle,
      requester_name: params.requesterName,
      ...(params.agentName ? { agent_name: params.agentName } : {}),
      ...(params.callbackUrl ? { callback_url: params.callbackUrl } : {})
    })
  });

  if (!response.ok) {
    throw new Error(`Speakeasy connect request failed with HTTP ${response.status}`);
  }

  return (await response.json()) as SpeakeasyConnectRequestResponse;
}

export async function pollConnectRequest(params: {
  baseUrl: string;
  requestId: number;
  pollToken: string;
  fetchImpl?: typeof fetch;
}): Promise<SpeakeasyConnectStatusResponse> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const url = new URL(`/api/v1/agent_connect/requests/${params.requestId}`, params.baseUrl);
  url.searchParams.set("poll_token", params.pollToken);
  const response = await fetchImpl(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`Speakeasy connect poll failed with HTTP ${response.status}`);
  }
  return (await response.json()) as SpeakeasyConnectStatusResponse;
}

export async function exchangeConnectCode(params: {
  baseUrl: string;
  requestId: number;
  exchangeCode: string;
  fetchImpl?: typeof fetch;
}): Promise<SpeakeasyTokenExchangeResponse> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const response = await fetchImpl(new URL("/api/v1/agent_sessions/exchange", params.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      request_id: params.requestId,
      exchange_code: params.exchangeCode
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
