import { afterEach, describe, expect, it, vi } from "vitest";

import { isSpeakeasyAccessTokenExpired } from "../src/auth.js";
import { SpeakeasyApiClient } from "../src/client.js";

function createAccessToken(expiresAt: string, extra: Record<string, unknown> = {}): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

  return `${encode({ alg: "none", typ: "JWT" })}.${encode({
    expires_at: expiresAt,
    account_handle: "agent@example.com",
    ...extra
  })}.sig`;
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: () => null
    },
    json: async () => body
  };
}

describe("auth", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("detects expired access tokens from JWT payloads", () => {
    const now = Date.parse("2026-04-20T00:00:00Z");
    const expiredToken = createAccessToken("2026-04-19T23:59:00Z");
    const freshToken = createAccessToken("2026-04-20T00:05:00Z");

    expect(isSpeakeasyAccessTokenExpired(expiredToken, { now, skewMs: 0 })).toBe(true);
    expect(isSpeakeasyAccessTokenExpired(freshToken, { now, skewMs: 0 })).toBe(false);
  });

  it("refreshes with rotated refresh tokens across repeated expiries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T00:00:00Z"));

    const initialToken = createAccessToken("2026-04-19T23:59:00Z");
    const firstRefreshToken = createAccessToken("2026-04-20T00:00:45Z");
    const secondRefreshToken = createAccessToken("2026-04-20T00:10:00Z");
    const refreshBodies: string[] = [];
    const requestTokens: string[] = [];
    const onAuthUpdated = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(String(input));

      if (url.pathname === "/api/v1/agent_sessions/refresh") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { refresh_token?: string };
        refreshBodies.push(body.refresh_token ?? "");

        if (body.refresh_token === "refresh-1") {
          return jsonResponse(200, {
            access_token: firstRefreshToken,
            refresh_token: "refresh-2"
          });
        }

        if (body.refresh_token === "refresh-2") {
          return jsonResponse(200, {
            access_token: secondRefreshToken,
            refresh_token: "refresh-3"
          });
        }

        throw new Error(`unexpected refresh token: ${body.refresh_token ?? "missing"}`);
      }

      if (url.pathname === "/api/v1/agent/topics") {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        requestTokens.push(headers["X-AUTH-TOKEN"] ?? headers["x-auth-token"] ?? "");
        return jsonResponse(200, {
          records: {
            topics: {
              data: {}
            }
          }
        });
      }

      throw new Error(`unexpected request: ${url.pathname}`);
    });

    const client = new SpeakeasyApiClient({
      baseUrl: "https://example.com",
      accessToken: initialToken,
      refreshToken: "refresh-1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined
      },
      onAuthUpdated
    });

    await client.listTopics();

    expect(refreshBodies).toEqual(["refresh-1"]);
    expect(requestTokens).toEqual([firstRefreshToken]);
    expect(onAuthUpdated).toHaveBeenNthCalledWith(1, {
      accessToken: firstRefreshToken,
      refreshToken: "refresh-2",
      agentHandle: "agent@example.com"
    });

    vi.setSystemTime(new Date("2026-04-20T00:01:30Z"));
    await client.listTopics();

    expect(refreshBodies).toEqual(["refresh-1", "refresh-2"]);
    expect(requestTokens).toEqual([firstRefreshToken, secondRefreshToken]);
    expect(onAuthUpdated).toHaveBeenNthCalledWith(2, {
      accessToken: secondRefreshToken,
      refreshToken: "refresh-3",
      agentHandle: "agent@example.com"
    });
  });
});
