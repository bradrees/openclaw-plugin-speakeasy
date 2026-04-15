import type { IncomingMessage, ServerResponse } from "node:http";
import { type ChannelPlugin, type PluginRuntime } from "openclaw/plugin-sdk/core";
import type { ResolvedSpeakeasyAccount } from "./types.js";
export declare const WEBHOOK_ROUTE_PREFIX = "/plugins/openclaw-plugin-speakeasy/webhooks/";
export declare function setSpeakeasyRuntime(runtime: PluginRuntime): void;
export declare function handleSpeakeasyWebhookRoute(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
export declare const speakeasyChannelPlugin: ChannelPlugin<ResolvedSpeakeasyAccount>;
//# sourceMappingURL=channel.d.ts.map