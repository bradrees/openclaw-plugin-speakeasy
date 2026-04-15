import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { handleSpeakeasyWebhookRoute, setSpeakeasyRuntime, speakeasyChannelPlugin } from "./channel.js";
import { SPEAKEASY_CHANNEL_JSON_SCHEMA } from "./config.js";
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
const speakeasyPluginEntry = defineChannelPluginEntry({
    id: "openclaw-plugin-speakeasy",
    name: "OpenClaw Speakeasy",
    description: "Speakeasy topic-first channel plugin for OpenClaw.",
    plugin: speakeasyChannelPlugin,
    configSchema: SPEAKEASY_CHANNEL_JSON_SCHEMA,
    setRuntime: setSpeakeasyRuntime,
    registerFull(api) {
        api.registerHttpRoute({
            path: "/plugins/openclaw-plugin-speakeasy/webhooks/",
            match: "prefix",
            auth: "plugin",
            handler: handleSpeakeasyWebhookRoute
        });
    }
});
export default speakeasyPluginEntry;
//# sourceMappingURL=index.js.map