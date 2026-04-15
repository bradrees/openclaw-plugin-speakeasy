import type { LoggerLike, SpeakeasyAccountConfig } from "./types.js";
import { SpeakeasyApiClient } from "./client.js";
export type OutboundTarget = {
    kind: "topic";
    topicId: string;
} | {
    kind: "direct";
    handle: string;
};
export declare class SpeakeasyOutboundService {
    private readonly client;
    private readonly logger?;
    constructor(client: SpeakeasyApiClient, logger?: LoggerLike | undefined);
    send(params: {
        target: OutboundTarget;
        text?: string;
        html?: string;
        file?: {
            filename: string;
            bytes: Uint8Array;
            contentType: string;
        };
        replyTimelineId?: string;
    }): Promise<{
        topicId: string;
        chatId?: string;
    }>;
    edit(params: {
        topicId: string;
        chatId: string;
        text?: string;
        html?: string;
    }): Promise<void>;
    delete(params: {
        topicId: string;
        chatId: string;
    }): Promise<void>;
}
export declare function inferOutboundTarget(input: string, _account: SpeakeasyAccountConfig): OutboundTarget;
//# sourceMappingURL=outbound.d.ts.map