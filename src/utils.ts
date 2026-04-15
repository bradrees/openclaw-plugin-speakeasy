import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import type { CursorState, LoggerLike, ResolvedSpeakeasyAccount } from "./types.js";

const RECENT_EVENT_LIMIT = 250;

export class MemoryCursorStore {
  private state: CursorState = {
    recentEventIds: [],
    conversationKinds: {}
  };

  async read(): Promise<CursorState> {
    return structuredClone(this.state);
  }

  async write(state: CursorState): Promise<void> {
    this.state = structuredClone(state);
  }
}

export class FileCursorStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<CursorState> {
    try {
      const content = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(content) as Partial<CursorState>;
      return {
        cursor: parsed.cursor,
        websocketResumeCursor: parsed.websocketResumeCursor,
        recentEventIds: Array.isArray(parsed.recentEventIds) ? parsed.recentEventIds : [],
        conversationKinds: parsed.conversationKinds ?? {}
      };
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;

      if (nodeError.code === "ENOENT") {
        return {
          recentEventIds: [],
          conversationKinds: {}
        };
      }

      throw error;
    }
  }

  async write(state: CursorState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(tempPath, JSON.stringify(state, null, 2), "utf8");
    await rename(tempPath, this.filePath);
  }
}

export type CursorStoreLike = Pick<MemoryCursorStore, "read" | "write">;

export function resolveDefaultStatePath(account: ResolvedSpeakeasyAccount): string {
  const safeId = account.accountId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(tmpdir(), "openclaw-plugin-speakeasy", `${safeId}.json`);
}

export function createCursorStore(account: ResolvedSpeakeasyAccount): CursorStoreLike {
  if (account.cursorStore.kind === "memory") {
    return new MemoryCursorStore();
  }

  return new FileCursorStore(account.cursorStore.path ?? resolveDefaultStatePath(account));
}

export async function updateCursorState(
  store: CursorStoreLike,
  updater: (current: CursorState) => CursorState | Promise<CursorState>
): Promise<CursorState> {
  const current = await store.read();
  const next = await updater(current);
  await store.write(next);
  return next;
}

export function rememberEventId(state: CursorState, eventId: string): CursorState {
  const recentEventIds = [eventId, ...state.recentEventIds.filter((value) => value !== eventId)].slice(
    0,
    RECENT_EVENT_LIMIT
  );

  return {
    ...state,
    recentEventIds
  };
}

export function hasSeenEventId(state: CursorState, eventId: string): boolean {
  return state.recentEventIds.includes(eventId);
}

export function createLogger(scope: string, enabled = false): LoggerLike {
  const emit = (level: "debug" | "info" | "warn" | "error", message: string, extra?: Record<string, unknown>) => {
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

export function createIdempotencyKey(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

export function stableChecksumBase64(buffer: Uint8Array): string {
  return createHash("md5").update(buffer).digest("base64");
}

export function normalizeId(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  return String(value);
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);

    const abortHandler = () => {
      clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    };

    signal?.addEventListener("abort", abortHandler, { once: true });
  });
}
