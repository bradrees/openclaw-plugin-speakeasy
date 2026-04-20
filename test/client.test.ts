import { describe, expect, it, vi } from "vitest";

import { SpeakeasyApiClient, SpeakeasyApiError } from "../src/client.js";

function createJwt(expiresInMs: number, extra: Record<string, unknown> = {}): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      exp: Math.floor((Date.now() + expiresInMs) / 1000),
      ...extra
    })
  ).toString("base64url");

  return `${header}.${payload}.`;
}

function createLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
}

describe("client auth", () => {
  it("uses the configured access token for initial requests", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        records: {
          topics: {
            data: {}
          }
        }
      })
    });

    const client = new SpeakeasyApiClient({
      baseUrl: "https://speakeasy.example.com",
      accessToken: "initial-token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: createLogger()
    });

    await client.listTopics();

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("/api/v1/agent/topics", "https://speakeasy.example.com"),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "X-AUTH-TOKEN": "initial-token"
        })
      })
    );
  });

  it("refreshes expired access tokens before sending the request", async () => {
    const expiredAccessToken = createJwt(-60_000);
    const freshAccessToken = createJwt(10 * 60_000, {
      agent_handle: "agent@example.com"
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: freshAccessToken,
          refresh_token: "rotated-refresh-token"
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          records: {
            topics: {
              data: {}
            }
          }
        })
      });
    const onAuthUpdated = vi.fn();

    const client = new SpeakeasyApiClient({
      baseUrl: "https://speakeasy.example.com",
      accessToken: expiredAccessToken,
      refreshToken: "refresh-token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: createLogger(),
      onAuthUpdated
    });

    await client.listTopics();

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      new URL("/api/v1/agent_sessions/refresh", "https://speakeasy.example.com"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-AUTH-TOKEN": expiredAccessToken,
          Authorization: `Bearer ${expiredAccessToken}`
        }),
        body: JSON.stringify({
          refresh_token: "refresh-token"
        })
      })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      new URL("/api/v1/agent/topics", "https://speakeasy.example.com"),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "X-AUTH-TOKEN": freshAccessToken
        })
      })
    );
    expect(onAuthUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: freshAccessToken,
        refreshToken: "rotated-refresh-token",
        expiresAt: expect.any(String),
        agentHandle: "agent@example.com"
      })
    );
  });

  it("refreshes opaque access tokens when persisted expiresAt is expired", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "next-access-token",
          refresh_token: "next-refresh-token",
          expires_at: "2026-04-20T00:10:00Z"
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          records: {
            topics: {
              data: {}
            }
          }
        })
      });
    const onAuthUpdated = vi.fn();

    const client = new SpeakeasyApiClient({
      baseUrl: "https://speakeasy.example.com",
      accessToken: "opaque-access-token",
      refreshToken: "refresh-token",
      expiresAt: "2026-04-19T23:59:00Z",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: createLogger(),
      onAuthUpdated
    });

    await client.listTopics();

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      new URL("/api/v1/agent_sessions/refresh", "https://speakeasy.example.com"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-AUTH-TOKEN": "opaque-access-token",
          Authorization: "Bearer opaque-access-token"
        }),
        body: JSON.stringify({
          refresh_token: "refresh-token"
        })
      })
    );
    expect(onAuthUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "next-access-token",
        refreshToken: "next-refresh-token",
        expiresAt: "2026-04-20T00:10:00Z"
      })
    );
  });

  it("syncs newer auth state before requests so stale clients do not reuse rotated refresh tokens", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        records: {
          topics: {
            data: {}
          }
        }
      })
    });

    const client = new SpeakeasyApiClient({
      baseUrl: "https://speakeasy.example.com",
      accessToken: createJwt(-60_000),
      refreshToken: "stale-refresh-token",
      expiresAt: "2026-04-19T23:59:00Z",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: createLogger(),
      syncAuthState: async () => ({
        accessToken: "fresh-access-token",
        refreshToken: "fresh-refresh-token",
        expiresAt: "2099-04-20T00:10:00Z"
      })
    });

    await client.listTopics();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("/api/v1/agent/topics", "https://speakeasy.example.com"),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "X-AUTH-TOKEN": "fresh-access-token",
          Authorization: "Bearer fresh-access-token"
        })
      })
    );
  });

  it("retries the request after a 401 and stores rotated refresh state", async () => {
    const logger = createLogger();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          error: "expired"
        }),
        headers: {
          get: () => null
        }
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "next-access-token",
          refresh_token: "next-refresh-token",
          agent_handle: "agent@example.com"
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          records: {
            topics: {
              data: {}
            }
          }
        })
      });
    const onAuthUpdated = vi.fn();

    const client = new SpeakeasyApiClient({
      baseUrl: "https://speakeasy.example.com",
      accessToken: "stale-access-token",
      refreshToken: "refresh-token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger,
      onAuthUpdated
    });

    await client.listTopics();

    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      new URL("/api/v1/agent/topics", "https://speakeasy.example.com"),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "X-AUTH-TOKEN": "next-access-token"
        })
      })
    );
    expect(onAuthUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "next-access-token",
        refreshToken: "next-refresh-token",
        agentHandle: "agent@example.com"
      })
    );
    expect(logger.warn).toHaveBeenCalledWith("Speakeasy access token rejected; attempting refresh", {
      path: "/api/v1/agent/topics"
    });
  });

  it("logs manual reauth and enters cooldown when refresh is rejected", async () => {
    const logger = createLogger();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          error: "expired"
        }),
        headers: {
          get: () => null
        }
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          error: "invalid refresh"
        })
      });

    const client = new SpeakeasyApiClient({
      baseUrl: "https://speakeasy.example.com",
      accessToken: "stale-access-token",
      refreshToken: "stale-refresh-token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger
    });

    await expect(client.listTopics()).rejects.toBeInstanceOf(SpeakeasyApiError);
    await expect(client.listTopics()).rejects.toMatchObject({
      status: 401
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      "Speakeasy automatic auth recovery is unavailable; manual reauth is required",
      expect.objectContaining({
        reason: "refresh rejected by Speakeasy",
        path: "/api/v1/agent/topics",
        status: 401
      })
    );
  });

  it("enters manual reauth cooldown when proactive refresh is rejected", async () => {
    const logger = createLogger();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          error: "invalid refresh"
        })
      });

    const client = new SpeakeasyApiClient({
      baseUrl: "https://speakeasy.example.com",
      accessToken: createJwt(-60_000),
      refreshToken: "stale-refresh-token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger
    });

    await expect(client.listTopics()).rejects.toMatchObject({
      status: 401,
      code: "manual_reauth_required"
    });
    await expect(client.listTopics()).rejects.toMatchObject({
      status: 401
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "Speakeasy automatic auth recovery is unavailable; manual reauth is required",
      expect.objectContaining({
        reason: "refresh rejected by Speakeasy",
        trigger: "GET /api/v1/agent/topics",
        status: 401
      })
    );
  });
});
