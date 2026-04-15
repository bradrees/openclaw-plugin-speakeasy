import type { ResolvedSpeakeasyAccount } from "./types.js";
export declare function buildAgentAuthHeaders(accessToken: string, extra?: Record<string, string>): HeadersInit;
export declare function refreshAccessToken(account: ResolvedSpeakeasyAccount, fetchImpl?: typeof fetch): Promise<string>;
export declare function hasAnySpeakeasyConfiguredState(raw: unknown): boolean;
export declare function hasAnySpeakeasyAuth(raw: unknown): boolean;
//# sourceMappingURL=auth.d.ts.map