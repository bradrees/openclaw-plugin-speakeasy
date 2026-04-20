import type { ResolvedSpeakeasyAccount, SpeakeasyAuthRefreshResult } from "./types.js";
export declare class SpeakeasyAuthRefreshError extends Error {
    readonly status: number;
    readonly body?: unknown | undefined;
    constructor(message: string, status: number, body?: unknown | undefined);
}
export declare function buildAgentAuthHeaders(accessToken: string, extra?: Record<string, string>): HeadersInit;
export declare function refreshAccessToken(account: ResolvedSpeakeasyAccount, fetchImpl?: typeof fetch): Promise<SpeakeasyAuthRefreshResult>;
export declare function decodeSpeakeasyAccessToken(accessToken: string): Record<string, unknown> | null;
export declare function resolveAgentHandleFromAccessToken(accessToken: string): string | undefined;
export declare function resolveSpeakeasyAccessTokenExpiry(accessToken: string, fallbackExpiresAt?: string): number | undefined;
export declare function resolveSpeakeasyAccessTokenExpiryText(accessToken: string, fallbackExpiresAt?: string): string | undefined;
export declare function isSpeakeasyAccessTokenExpired(accessToken: string, options?: {
    now?: number;
    skewMs?: number;
    expiresAt?: string;
}): boolean;
export declare function hasAnySpeakeasyConfiguredState(raw: unknown): boolean;
export declare function hasAnySpeakeasyAuth(raw: unknown): boolean;
//# sourceMappingURL=auth.d.ts.map