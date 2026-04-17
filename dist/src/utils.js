import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
const RECENT_EVENT_LIMIT = 250;
export class MemoryCursorStore {
    state = {
        recentEventIds: [],
        conversationKinds: {}
    };
    async read() {
        return structuredClone(this.state);
    }
    async write(state) {
        this.state = structuredClone(state);
    }
}
export class FileCursorStore {
    filePath;
    constructor(filePath) {
        this.filePath = filePath;
    }
    async read() {
        try {
            const content = await readFile(this.filePath, "utf8");
            const parsed = JSON.parse(content);
            return {
                cursor: parsed.cursor,
                websocketResumeCursor: parsed.websocketResumeCursor,
                agentHandle: typeof parsed.agentHandle === "string" ? parsed.agentHandle : undefined,
                recentEventIds: Array.isArray(parsed.recentEventIds) ? parsed.recentEventIds : [],
                conversationKinds: parsed.conversationKinds ?? {}
            };
        }
        catch (error) {
            const nodeError = error;
            if (nodeError.code === "ENOENT") {
                return {
                    recentEventIds: [],
                    conversationKinds: {}
                };
            }
            throw error;
        }
    }
    async write(state) {
        await mkdir(dirname(this.filePath), { recursive: true });
        const tempPath = `${this.filePath}.${randomUUID()}.tmp`;
        await writeFile(tempPath, JSON.stringify(state, null, 2), "utf8");
        await rename(tempPath, this.filePath);
    }
}
export function resolveDefaultStatePath(account) {
    const safeId = account.accountId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(tmpdir(), "openclaw-plugin-speakeasy", `${safeId}.json`);
}
export function createCursorStore(account) {
    if (account.cursorStore.kind === "memory") {
        return new MemoryCursorStore();
    }
    return new FileCursorStore(account.cursorStore.path ?? resolveDefaultStatePath(account));
}
export async function updateCursorState(store, updater) {
    const current = await store.read();
    const next = await updater(current);
    await store.write(next);
    return next;
}
export function rememberEventId(state, eventId) {
    const recentEventIds = [eventId, ...state.recentEventIds.filter((value) => value !== eventId)].slice(0, RECENT_EVENT_LIMIT);
    return {
        ...state,
        recentEventIds
    };
}
export function hasSeenEventId(state, eventId) {
    return state.recentEventIds.includes(eventId);
}
export function createLogger(scope, enabled = false) {
    const emit = (level, message, extra) => {
        if (level === "debug" && !enabled) {
            return;
        }
        const payload = extra ? ` ${JSON.stringify(extra)}` : "";
        const line = `[openclaw-plugin-speakeasy:${scope}] ${message}${payload}`;
        if (level === "warn") {
            console.warn(line);
            return;
        }
        if (level === "error") {
            console.error(line);
            return;
        }
        console.log(line);
    };
    return {
        debug: (message, extra) => emit("debug", message, extra),
        info: (message, extra) => emit("info", message, extra),
        warn: (message, extra) => emit("warn", message, extra),
        error: (message, extra) => emit("error", message, extra)
    };
}
export function createIdempotencyKey(prefix) {
    return `${prefix}-${randomUUID()}`;
}
export function sha256Hex(input) {
    return createHash("sha256").update(input).digest("hex");
}
export function stableChecksumBase64(buffer) {
    return createHash("md5").update(buffer).digest("base64");
}
export function normalizeId(value) {
    if (value === null || value === undefined) {
        return undefined;
    }
    return String(value);
}
export function encodeSpeakeasyCursor(value) {
    const normalized = normalizeId(value);
    if (!normalized) {
        return undefined;
    }
    return Buffer.from(normalized, "utf8").toString("base64url");
}
export function isAbortError(error) {
    return error instanceof Error && error.name === "AbortError";
}
export function delay(ms, signal) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(resolve, ms);
        const abortHandler = () => {
            clearTimeout(timeout);
            reject(new DOMException("Aborted", "AbortError"));
        };
        signal?.addEventListener("abort", abortHandler, { once: true });
    });
}
//# sourceMappingURL=utils.js.map