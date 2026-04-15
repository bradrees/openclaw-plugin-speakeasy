import type { LoggerLike } from "./types.js";
import { SpeakeasyApiClient } from "./client.js";
import { normalizePollingEvents } from "./events.js";
import { delay, isAbortError } from "./utils.js";

type PollingLoopParams = {
  client: SpeakeasyApiClient;
  logger: LoggerLike;
  pollIntervalMs: number;
  getCursor: () => Promise<string | undefined>;
  setCursor: (cursor: string) => Promise<void>;
  getConversationKinds: () => Promise<Record<string, "topic" | "direct">>;
  onEvent: ReturnType<typeof normalizePollingEvents>[number] extends infer T
    ? (event: T) => Promise<void>
    : never;
};

export class SpeakeasyPollingLoop {
  private abortController?: AbortController;
  private running = false;

  constructor(private readonly params: PollingLoopParams) {}

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.abortController = new AbortController();
    this.running = true;
    void this.run(this.abortController.signal);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abortController?.abort();
  }

  private async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const cursor = await this.params.getCursor();
        const response = await this.params.client.pollEvents(cursor, signal);
        const conversationKinds = await this.params.getConversationKinds();
        const events = normalizePollingEvents(response.events, conversationKinds);

        for (const event of events) {
          await this.params.onEvent(event);
        }

        if (response.next_cursor) {
          await this.params.setCursor(response.next_cursor);
        }
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }

        this.params.logger.warn("Speakeasy polling failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      }

      await delay(this.params.pollIntervalMs, signal).catch((error) => {
        if (!isAbortError(error)) {
          throw error;
        }
      });
    }
  }
}
