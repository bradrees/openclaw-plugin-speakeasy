import { z } from "zod";
import type { ResolvedSpeakeasyAccount } from "./types.js";
export declare const DEFAULT_ACCOUNT_ID = "default";
export declare const DEFAULT_POLL_INTERVAL_MS = 5000;
export declare const DEFAULT_WEBSOCKET_HEARTBEAT_MS = 30000;
export declare const speakeasyChannelSchema: z.ZodObject<{
    accounts: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodEffects<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        baseUrl: z.ZodEffects<z.ZodString, string, string>;
        accessToken: z.ZodString;
        refreshToken: z.ZodOptional<z.ZodString>;
        webhookSecret: z.ZodOptional<z.ZodString>;
        transport: z.ZodDefault<z.ZodEnum<["websocket", "polling", "webhook"]>>;
        cursorStore: z.ZodDefault<z.ZodObject<{
            kind: z.ZodDefault<z.ZodEnum<["file", "memory"]>>;
            path: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            kind: "file" | "memory";
            path?: string | undefined;
        }, {
            kind?: "file" | "memory" | undefined;
            path?: string | undefined;
        }>>;
        allowDirectMessages: z.ZodDefault<z.ZodBoolean>;
        allowTopicMessages: z.ZodDefault<z.ZodBoolean>;
        mentionOnly: z.ZodDefault<z.ZodBoolean>;
        allowedTopicIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        allowedUserHandles: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        botDisplayName: z.ZodOptional<z.ZodString>;
        debugLogging: z.ZodDefault<z.ZodBoolean>;
        pollIntervalMs: z.ZodDefault<z.ZodNumber>;
        websocketHeartbeatMs: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        baseUrl: string;
        accessToken: string;
        transport: "websocket" | "polling" | "webhook";
        cursorStore: {
            kind: "file" | "memory";
            path?: string | undefined;
        };
        allowDirectMessages: boolean;
        allowTopicMessages: boolean;
        mentionOnly: boolean;
        debugLogging: boolean;
        pollIntervalMs: number;
        websocketHeartbeatMs: number;
        refreshToken?: string | undefined;
        webhookSecret?: string | undefined;
    agentHandle?: string | undefined;
        allowedTopicIds?: string[] | undefined;
        allowedUserHandles?: string[] | undefined;
        botDisplayName?: string | undefined;
    }, {
        baseUrl: string;
        accessToken: string;
        enabled?: boolean | undefined;
        refreshToken?: string | undefined;
        webhookSecret?: string | undefined;
    agentHandle?: string | undefined;
        transport?: "websocket" | "polling" | "webhook" | undefined;
        cursorStore?: {
            kind?: "file" | "memory" | undefined;
            path?: string | undefined;
        } | undefined;
        allowDirectMessages?: boolean | undefined;
        allowTopicMessages?: boolean | undefined;
        mentionOnly?: boolean | undefined;
        allowedTopicIds?: string[] | undefined;
        allowedUserHandles?: string[] | undefined;
        botDisplayName?: string | undefined;
        debugLogging?: boolean | undefined;
        pollIntervalMs?: number | undefined;
        websocketHeartbeatMs?: number | undefined;
    }>, {
        enabled: boolean;
        baseUrl: string;
        accessToken: string;
        transport: "websocket" | "polling" | "webhook";
        cursorStore: {
            kind: "file" | "memory";
            path?: string | undefined;
        };
        allowDirectMessages: boolean;
        allowTopicMessages: boolean;
        mentionOnly: boolean;
        debugLogging: boolean;
        pollIntervalMs: number;
        websocketHeartbeatMs: number;
        refreshToken?: string | undefined;
        webhookSecret?: string | undefined;
    agentHandle?: string | undefined;
        allowedTopicIds?: string[] | undefined;
        allowedUserHandles?: string[] | undefined;
        botDisplayName?: string | undefined;
    }, {
        baseUrl: string;
        accessToken: string;
        enabled?: boolean | undefined;
        refreshToken?: string | undefined;
        webhookSecret?: string | undefined;
    agentHandle?: string | undefined;
        transport?: "websocket" | "polling" | "webhook" | undefined;
        cursorStore?: {
            kind?: "file" | "memory" | undefined;
            path?: string | undefined;
        } | undefined;
        allowDirectMessages?: boolean | undefined;
        allowTopicMessages?: boolean | undefined;
        mentionOnly?: boolean | undefined;
        allowedTopicIds?: string[] | undefined;
        allowedUserHandles?: string[] | undefined;
        botDisplayName?: string | undefined;
        debugLogging?: boolean | undefined;
        pollIntervalMs?: number | undefined;
        websocketHeartbeatMs?: number | undefined;
    }>>>;
}, "strip", z.ZodTypeAny, {
    accounts: Record<string, {
        enabled: boolean;
        baseUrl: string;
        accessToken: string;
        transport: "websocket" | "polling" | "webhook";
        cursorStore: {
            kind: "file" | "memory";
            path?: string | undefined;
        };
        allowDirectMessages: boolean;
        allowTopicMessages: boolean;
        mentionOnly: boolean;
        debugLogging: boolean;
        pollIntervalMs: number;
        websocketHeartbeatMs: number;
        refreshToken?: string | undefined;
        webhookSecret?: string | undefined;
    agentHandle?: string | undefined;
        allowedTopicIds?: string[] | undefined;
        allowedUserHandles?: string[] | undefined;
        botDisplayName?: string | undefined;
    }>;
}, {
    accounts?: Record<string, {
        baseUrl: string;
        accessToken: string;
        enabled?: boolean | undefined;
        refreshToken?: string | undefined;
        webhookSecret?: string | undefined;
    agentHandle?: string | undefined;
        transport?: "websocket" | "polling" | "webhook" | undefined;
        cursorStore?: {
            kind?: "file" | "memory" | undefined;
            path?: string | undefined;
        } | undefined;
        allowDirectMessages?: boolean | undefined;
        allowTopicMessages?: boolean | undefined;
        mentionOnly?: boolean | undefined;
        allowedTopicIds?: string[] | undefined;
        allowedUserHandles?: string[] | undefined;
        botDisplayName?: string | undefined;
        debugLogging?: boolean | undefined;
        pollIntervalMs?: number | undefined;
        websocketHeartbeatMs?: number | undefined;
    }> | undefined;
}>;
export type SpeakeasyChannelSection = z.infer<typeof speakeasyChannelSchema>;
export declare const SPEAKEASY_CHANNEL_JSON_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly properties: {
        readonly accounts: {
            readonly type: "object";
            readonly minProperties: 1;
            readonly additionalProperties: {
                readonly type: "object";
                readonly additionalProperties: false;
                readonly properties: {
                    readonly enabled: {
                        readonly type: "boolean";
                    };
                    readonly baseUrl: {
                        readonly type: "string";
                        readonly format: "uri";
                    };
                    readonly accessToken: {
                        readonly type: "string";
                        readonly minLength: 1;
                    };
                    readonly refreshToken: {
                        readonly type: "string";
                    };
                    readonly webhookSecret: {
                        readonly type: "string";
                    };
                    readonly transport: {
                        readonly type: "string";
                        readonly enum: readonly ["websocket", "polling", "webhook"];
                    };
                    readonly cursorStore: {
                        readonly type: "object";
                        readonly additionalProperties: false;
                        readonly properties: {
                            readonly kind: {
                                readonly type: "string";
                                readonly enum: readonly ["file", "memory"];
                            };
                            readonly path: {
                                readonly type: "string";
                            };
                        };
                        readonly required: readonly ["kind"];
                    };
                    readonly allowDirectMessages: {
                        readonly type: "boolean";
                    };
                    readonly allowTopicMessages: {
                        readonly type: "boolean";
                    };
                    readonly mentionOnly: {
                        readonly type: "boolean";
                    };
                    readonly allowedTopicIds: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                    };
                    readonly allowedUserHandles: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                    };
                    readonly botDisplayName: {
                        readonly type: "string";
                    };
                    readonly debugLogging: {
                        readonly type: "boolean";
                    };
                    readonly pollIntervalMs: {
                        readonly type: "integer";
                        readonly minimum: 1000;
                    };
                    readonly websocketHeartbeatMs: {
                        readonly type: "integer";
                        readonly minimum: 1000;
                    };
                };
                readonly required: readonly ["baseUrl", "accessToken"];
            };
        };
    };
    readonly required: readonly ["accounts"];
};
type OpenClawConfigLike = {
    channels?: Record<string, unknown>;
};
export declare function parseSpeakeasyAccount(raw: unknown, accountId?: string): ResolvedSpeakeasyAccount;
export declare function validateSpeakeasyAccount(raw: unknown, accountId?: string): {
    ok: true;
    value: ResolvedSpeakeasyAccount;
} | {
    ok: false;
    errors: string[];
};
export declare function readSpeakeasyChannelSection(cfg: OpenClawConfigLike): SpeakeasyChannelSection;
export declare function resolveSpeakeasyAccount(cfg: OpenClawConfigLike, accountId?: string | null): ResolvedSpeakeasyAccount;
export declare function listSpeakeasyAccountIds(cfg: OpenClawConfigLike): string[];
export declare function writeSpeakeasyAccount(cfg: OpenClawConfigLike, account: ResolvedSpeakeasyAccount): OpenClawConfigLike;
export declare function buildConfigValidationError(errors: string[]): Error;
export {};
//# sourceMappingURL=config.d.ts.map