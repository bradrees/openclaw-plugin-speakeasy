import { z } from "zod";
export const DEFAULT_ACCOUNT_ID = "default";
export const DEFAULT_POLL_INTERVAL_MS = 5_000;
export const DEFAULT_WEBSOCKET_HEARTBEAT_MS = 30_000;
const cursorStoreSchema = z
    .object({
    kind: z.enum(["file", "memory"]).default("file"),
    path: z.string().trim().min(1).optional()
})
    .default({ kind: "file" });
const accountSchema = z
    .object({
    enabled: z.boolean().default(true),
    baseUrl: z
        .string()
        .trim()
        .url("baseUrl must be a valid absolute URL")
        .transform((value) => value.replace(/\/+$/, "")),
    accessToken: z.string().trim().min(1, "accessToken is required"),
    refreshToken: z.string().trim().min(1).optional(),
    expiresAt: z.string().trim().min(1).optional(),
    webhookSecret: z.string().trim().min(1).optional(),
    agentHandle: z.string().trim().min(1).optional(),
    transport: z.enum(["websocket", "polling", "webhook"]).default("websocket"),
    cursorStore: cursorStoreSchema,
    allowDirectMessages: z.boolean().default(true),
    allowTopicMessages: z.boolean().default(true),
    mentionOnly: z.boolean().default(false),
    allowedTopicIds: z.array(z.string().trim().min(1)).optional(),
    allowedUserHandles: z.array(z.string().trim().min(1)).optional(),
    botDisplayName: z.string().trim().min(1).optional(),
    debugLogging: z.boolean().default(false),
    pollIntervalMs: z.number().int().min(1_000).default(DEFAULT_POLL_INTERVAL_MS),
    websocketHeartbeatMs: z.number().int().min(1_000).default(DEFAULT_WEBSOCKET_HEARTBEAT_MS)
})
    .superRefine((value, ctx) => {
    if (!value.allowDirectMessages && !value.allowTopicMessages) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "At least one of allowDirectMessages or allowTopicMessages must be true"
        });
    }
    if (value.transport === "webhook" && !value.webhookSecret) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "webhookSecret is required when transport is webhook",
            path: ["webhookSecret"]
        });
    }
    if (value.cursorStore.kind === "file" && value.cursorStore.path === "") {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "cursorStore.path cannot be blank",
            path: ["cursorStore", "path"]
        });
    }
});
export const speakeasyChannelSchema = z.object({
    accounts: z.record(z.string().min(1), accountSchema).default({})
});
export const SPEAKEASY_CHANNEL_JSON_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
        accounts: {
            type: "object",
            minProperties: 1,
            additionalProperties: {
                type: "object",
                additionalProperties: false,
                properties: {
                    enabled: { type: "boolean" },
                    baseUrl: { type: "string", format: "uri" },
                    accessToken: { type: "string", minLength: 1 },
                    refreshToken: { type: "string" },
                    expiresAt: { type: "string" },
                    webhookSecret: { type: "string" },
                    agentHandle: { type: "string" },
                    transport: { type: "string", enum: ["websocket", "polling", "webhook"] },
                    cursorStore: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                            kind: { type: "string", enum: ["file", "memory"] },
                            path: { type: "string" }
                        },
                        required: ["kind"]
                    },
                    allowDirectMessages: { type: "boolean" },
                    allowTopicMessages: { type: "boolean" },
                    mentionOnly: { type: "boolean" },
                    allowedTopicIds: { type: "array", items: { type: "string" } },
                    allowedUserHandles: { type: "array", items: { type: "string" } },
                    botDisplayName: { type: "string" },
                    debugLogging: { type: "boolean" },
                    pollIntervalMs: { type: "integer", minimum: 1000 },
                    websocketHeartbeatMs: { type: "integer", minimum: 1000 }
                },
                required: ["baseUrl", "accessToken"]
            }
        }
    },
    required: ["accounts"]
};
export function parseSpeakeasyAccount(raw, accountId = DEFAULT_ACCOUNT_ID) {
    const parsed = accountSchema.parse(raw);
    return {
        accountId,
        ...parsed
    };
}
export function validateSpeakeasyAccount(raw, accountId = DEFAULT_ACCOUNT_ID) {
    const result = accountSchema.safeParse(raw);
    if (result.success) {
        return {
            ok: true,
            value: {
                accountId,
                ...result.data
            }
        };
    }
    return {
        ok: false,
        errors: result.error.issues.map((issue) => {
            const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
            return `${path}${issue.message}`;
        })
    };
}
export function readSpeakeasyChannelSection(cfg) {
    const rawSection = cfg.channels?.speakeasy ?? {};
    return speakeasyChannelSchema.parse(rawSection);
}
export function resolveSpeakeasyAccount(cfg, accountId) {
    const section = readSpeakeasyChannelSection(cfg);
    const resolvedAccountId = accountId && section.accounts[accountId] ? accountId : Object.keys(section.accounts)[0] ?? DEFAULT_ACCOUNT_ID;
    const rawAccount = section.accounts[resolvedAccountId];
    if (!rawAccount) {
        throw new Error(`No Speakeasy account is configured for accountId "${resolvedAccountId}"`);
    }
    return parseSpeakeasyAccount(rawAccount, resolvedAccountId);
}
export function listSpeakeasyAccountIds(cfg) {
    return Object.keys(readSpeakeasyChannelSection(cfg).accounts);
}
export function writeSpeakeasyAccount(cfg, account) {
    const channels = { ...(cfg.channels ?? {}) };
    const section = readSpeakeasyChannelSection(cfg);
    channels.speakeasy = {
        accounts: {
            ...section.accounts,
            [account.accountId]: {
                ...account
            }
        }
    };
    const storedAccount = channels.speakeasy.accounts[account.accountId];
    if (storedAccount) {
        delete storedAccount.accountId;
    }
    return {
        ...cfg,
        channels
    };
}
export function buildConfigValidationError(errors) {
    return new Error(`Invalid Speakeasy config:\n- ${errors.join("\n- ")}`);
}
//# sourceMappingURL=config.js.map