import type { CursorState, LoggerLike, ResolvedSpeakeasyAccount } from "./types.js";
export declare class MemoryCursorStore {
    private state;
    read(): Promise<CursorState>;
    write(state: CursorState): Promise<void>;
}
export declare class FileCursorStore {
    private readonly filePath;
    constructor(filePath: string);
    read(): Promise<CursorState>;
    write(state: CursorState): Promise<void>;
}
export type CursorStoreLike = Pick<MemoryCursorStore, "read" | "write">;
export declare function resolveDefaultStatePath(account: ResolvedSpeakeasyAccount): string;
export declare function createCursorStore(account: ResolvedSpeakeasyAccount): CursorStoreLike;
export declare function updateCursorState(store: CursorStoreLike, updater: (current: CursorState) => CursorState | Promise<CursorState>): Promise<CursorState>;
export declare function rememberEventId(state: CursorState, eventId: string): CursorState;
export declare function hasSeenEventId(state: CursorState, eventId: string): boolean;
export declare function createLogger(scope: string, enabled?: boolean): LoggerLike;
export declare function createIdempotencyKey(prefix: string): string;
export declare function sha256Hex(input: string | Uint8Array): string;
export declare function stableChecksumBase64(buffer: Uint8Array): string;
export declare function normalizeId(value: string | number | null | undefined): string | undefined;
export declare function isAbortError(error: unknown): boolean;
export declare function delay(ms: number, signal?: AbortSignal): Promise<void>;
//# sourceMappingURL=utils.d.ts.map