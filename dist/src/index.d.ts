import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { handleSpeakeasyWebhookRoute, setSpeakeasyRuntime, speakeasyChannelPlugin } from "./channel.js";
export { handleSpeakeasyWebhookRoute, setSpeakeasyRuntime, speakeasyChannelPlugin };
export * from "./client.js";
export * from "./config.js";
export * from "./events.js";
export * from "./mapping.js";
export * from "./outbound.js";
export * from "./session-key-api.js";
export * from "./setup.js";
export * from "./security.js";
export * from "./types.js";
export * from "./utils.js";
declare const speakeasyPluginEntry: ReturnType<typeof defineChannelPluginEntry>;
export default speakeasyPluginEntry;
//# sourceMappingURL=index.d.ts.map