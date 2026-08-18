/**
 * Human Gate policy for Web vs Headless.
 *
 * Pure function: callers that read project `specline/config.yaml` live
 * elsewhere. This module never writes config (no Settings card).
 *
 * Existing pipeline HG table (must not flatten minimal to skip HG3):
 *   full     → HG1 approval, HG2 conditional (warnings>0 && errors=0), HG3 approval
 *   minimal  → HG1/HG2 autoPass, HG3 approval
 *   none     → all autoPass
 * Headless this round: always autoPass + warn, never writeConfig.
 */
export type RuntimeKind = 'web' | 'headless';
export type HumanGatePolicy = 'full' | 'minimal' | 'none';
export type HumanGateName = 'HG1' | 'HG2' | 'HG3';
export type HumanGateReviewContext = {
    warnings?: number;
    errors?: number;
};
export type HumanGateDecision = {
    autoPass: boolean;
    warn: boolean;
    writeConfig: false;
    approval: boolean;
};
/**
 * Decide whether a Human Gate auto-passes or needs `ctx.approval`.
 * Never writes `specline/config.yaml`.
 */
export declare function resolveHumanGate(kind: RuntimeKind, policy: HumanGatePolicy, gateName: HumanGateName | string, ctx?: HumanGateReviewContext): HumanGateDecision;
