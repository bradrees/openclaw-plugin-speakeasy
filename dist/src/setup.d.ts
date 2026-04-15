import { type OpenClawConfig } from "openclaw/plugin-sdk/channel-core";
import type { LoggerLike, ResolvedSpeakeasyAccount, SetupProbeResult } from "./types.js";
export declare function runSpeakeasySetup(params: {
    account: ResolvedSpeakeasyAccount;
    logger?: LoggerLike;
    allowRename?: boolean;
    fetchImpl?: typeof fetch;
}): Promise<SetupProbeResult>;
export declare function verifySpeakeasyAccountFromConfig(params: {
    cfg: OpenClawConfig;
    accountId?: string | null;
    logger?: LoggerLike;
}): Promise<SetupProbeResult>;
declare const _default: {
    plugin: import("openclaw/plugin-sdk/channel-core").ChannelPlugin<ResolvedSpeakeasyAccount>;
};
export default _default;
//# sourceMappingURL=setup.d.ts.map