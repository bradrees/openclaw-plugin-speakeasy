import { describe, expect, it, vi } from "vitest";
vi.mock("openclaw/plugin-sdk/core", () => ({
    buildChannelOutboundSessionRoute: vi.fn(),
    createChannelPluginBase: vi.fn((plugin) => plugin),
    defineSetupPluginEntry: vi.fn((plugin) => plugin)
}));
vi.mock("openclaw/plugin-sdk/reply-payload", () => ({
    createNormalizedOutboundDeliverer: vi.fn((deliverer) => deliverer),
    deliverTextOrMediaReply: vi.fn(async () => undefined)
}));
vi.mock("openclaw/plugin-sdk/runtime-store", () => ({
    createPluginRuntimeStore: vi.fn(() => ({
        setRuntime: () => undefined,
        getRuntime: () => {
            throw new Error("runtime is not available in the setup test");
        },
        tryGetRuntime: () => undefined
    }))
}));
const { runSpeakeasySetup } = await import("../src/setup.js");
describe("setup", () => {
    it("renames the agent when botDisplayName differs", async () => {
        const fetchImpl = vi
            .fn()
            .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                agent_grant_id: 1,
                agent_account_id: 2,
                agent_handle: "agent@example.com",
                display_name: "Old Name",
                owner_account_id: 3,
                owner_handle: "owner@example.com",
                capabilities: {}
            })
        })
            .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                agent_grant_id: 1,
                agent_account_id: 2,
                agent_handle: "agent@example.com",
                display_name: "New Name",
                owner_account_id: 3,
                owner_handle: "owner@example.com",
                capabilities: {}
            })
        });
        const result = await runSpeakeasySetup({
            account: {
                accountId: "default",
                enabled: true,
                baseUrl: "https://example.com",
                accessToken: "token",
                botDisplayName: "New Name",
                transport: "websocket",
                cursorStore: { kind: "memory" },
                allowDirectMessages: true,
                allowTopicMessages: true,
                mentionOnly: false,
                debugLogging: false,
                pollIntervalMs: 5000,
                websocketHeartbeatMs: 30000
            },
            logger: {
                debug: () => undefined,
                info: () => undefined,
                warn: () => undefined,
                error: () => undefined
            },
            allowRename: true,
            fetchImpl: fetchImpl
        });
        expect(result.rename.status).toBe("updated");
        expect(result.probe.endpoint).toBe("agent/me");
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
    it("falls back to topics connectivity when /agent/me is unavailable", async () => {
        const fetchImpl = vi
            .fn()
            .mockResolvedValueOnce({
            ok: false,
            status: 404,
            json: async () => ({
                error: "not found"
            })
        })
            .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                records: {
                    topics: {
                        data: {
                            "10": {
                                id: 10
                            }
                        }
                    }
                }
            })
        });
        const result = await runSpeakeasySetup({
            account: {
                accountId: "default",
                enabled: true,
                baseUrl: "https://example.com",
                accessToken: "token",
                botDisplayName: "New Name",
                transport: "websocket",
                cursorStore: { kind: "memory" },
                allowDirectMessages: true,
                allowTopicMessages: true,
                mentionOnly: false,
                debugLogging: false,
                pollIntervalMs: 5000,
                websocketHeartbeatMs: 30000
            },
            logger: {
                debug: () => undefined,
                info: () => undefined,
                warn: () => undefined,
                error: () => undefined
            },
            allowRename: true,
            fetchImpl: fetchImpl
        });
        expect(result.probe).toEqual({
            endpoint: "agent/topics",
            degraded: true,
            warning: "GET /api/v1/agent/me was unavailable or rate limited; connectivity verified with GET /api/v1/agent/topics instead.",
            topicCount: 1
        });
        expect(result.rename.status).toBe("skipped");
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
    it("falls back to topics connectivity when /agent/me is rate limited", async () => {
        const fetchImpl = vi
            .fn()
            .mockResolvedValueOnce({
            ok: false,
            status: 429,
            json: async () => ({
                error: "rate limited"
            })
        })
            .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                records: {
                    topics: {
                        data: {
                            "10": {
                                id: 10
                            }
                        }
                    }
                }
            })
        });
        const result = await runSpeakeasySetup({
            account: {
                accountId: "default",
                enabled: true,
                baseUrl: "https://example.com",
                accessToken: "token",
                botDisplayName: "New Name",
                transport: "websocket",
                cursorStore: { kind: "memory" },
                allowDirectMessages: true,
                allowTopicMessages: true,
                mentionOnly: false,
                debugLogging: false,
                pollIntervalMs: 5000,
                websocketHeartbeatMs: 30000
            },
            logger: {
                debug: () => undefined,
                info: () => undefined,
                warn: () => undefined,
                error: () => undefined
            },
            allowRename: true,
            fetchImpl: fetchImpl
        });
        expect(result.probe).toEqual({
            endpoint: "agent/topics",
            degraded: true,
            warning: "GET /api/v1/agent/me was unavailable or rate limited; connectivity verified with GET /api/v1/agent/topics instead.",
            topicCount: 1
        });
        expect(result.rename.status).toBe("skipped");
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
});
//# sourceMappingURL=setup.test.js.map