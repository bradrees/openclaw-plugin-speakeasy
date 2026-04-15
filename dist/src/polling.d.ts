import type { LoggerLike } from "./types.js";
import { SpeakeasyApiClient } from "./client.js";
import { normalizePollingEvents } from "./events.js";
type PollingLoopParams = {
    client: SpeakeasyApiClient;
    logger: LoggerLike;
    pollIntervalMs: number;
    getCursor: () => Promise<string | undefined>;
    setCursor: (cursor: string | undefined) => Promise<void>;
    getConversationKinds: () => Promise<Record<string, "topic" | "direct">>;
    onEvent: ReturnType<typeof normalizePollingEvents>[number] extends infer T ? (event: T) => Promise<void> : never;
};
export declare class SpeakeasyPollingLoop {
    private readonly params;
    private abortController?;
    private running;
    constructor(params: PollingLoopParams);
    start(): Promise<void>;
    stop(): Promise<void>;
    private run;
}
export {};
//# sourceMappingURL=polling.d.ts.map