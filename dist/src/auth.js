export function buildAgentAuthHeaders(accessToken, extra) {
    return {
        "Content-Type": "application/json",
        "X-AUTH-TOKEN": accessToken,
        ...extra
    };
}
export async function refreshAccessToken(account, fetchImpl = fetch) {
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
    const json = (await response.json());
    if (!json.access_token) {
        throw new Error("Speakeasy refresh response did not include access_token");
    }
    return json.access_token;
}
export function decodeSpeakeasyAccessToken(accessToken) {
    const [, payload] = accessToken.split(".");
    if (!payload) {
        return null;
    }
    try {
        const decoded = Buffer.from(payload, "base64url").toString("utf8");
        const parsed = JSON.parse(decoded);
        return parsed && typeof parsed === "object" ? parsed : null;
    }
    catch {
        return null;
    }
}
export function resolveAgentHandleFromAccessToken(accessToken) {
    const payload = decodeSpeakeasyAccessToken(accessToken);
    const candidate = (typeof payload?.agent_handle === "string" ? payload.agent_handle : undefined) ??
        (typeof payload?.account_handle === "string" ? payload.account_handle : undefined);
    return candidate?.trim().toLowerCase() || undefined;
}
export function hasAnySpeakeasyConfiguredState(raw) {
    const cfg = raw;
    const accounts = cfg.channels?.speakeasy?.accounts ?? {};
    return Object.values(accounts).some((account) => Boolean(account.baseUrl && account.accessToken));
}
export function hasAnySpeakeasyAuth(raw) {
    const cfg = raw;
    const accounts = cfg.channels?.speakeasy?.accounts ?? {};
    return Object.values(accounts).some((account) => Boolean(account.accessToken));
}
//# sourceMappingURL=auth.js.map