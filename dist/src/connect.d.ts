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
export declare function createConnectRequest(params: {
    baseUrl: string;
    handle: string;
    requesterName: string;
    agentName?: string;
    callbackUrl?: string;
    fetchImpl?: typeof fetch;
}): Promise<SpeakeasyConnectRequestResponse>;
export declare function pollConnectRequest(params: {
    baseUrl: string;
    requestId: number;
    pollToken: string;
    fetchImpl?: typeof fetch;
}): Promise<SpeakeasyConnectStatusResponse>;
export declare function exchangeConnectCode(params: {
    baseUrl: string;
    requestId: number;
    exchangeCode: string;
    fetchImpl?: typeof fetch;
}): Promise<SpeakeasyTokenExchangeResponse>;
//# sourceMappingURL=connect.d.ts.map