import type { CanonicalInboundEvent, InboundPolicyDecision, ResolvedSpeakeasyAccount } from "./types.js";
export declare function shouldIgnoreSelfEvent(params: {
    event: CanonicalInboundEvent;
    agentHandle?: string;
}): boolean;
export declare function evaluateInboundPolicy(params: {
    event: CanonicalInboundEvent;
    account: ResolvedSpeakeasyAccount;
    agentHandle?: string;
}): InboundPolicyDecision;
//# sourceMappingURL=security.d.ts.map