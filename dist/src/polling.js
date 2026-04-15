import { normalizePollingEvents } from "./events.js";
import { delay, isAbortError } from "./utils.js";
export class SpeakeasyPollingLoop {
    params;
    abortController;
    running = false;
    constructor(params) {
        this.params = params;
    }
    async start() {
        if (this.running) {
            return;
        }
        this.abortController = new AbortController();
        this.running = true;
        void this.run(this.abortController.signal);
    }
    async stop() {
        this.running = false;
        this.abortController?.abort();
    }
    async run(signal) {
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
            }
            catch (error) {
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
//# sourceMappingURL=polling.js.map