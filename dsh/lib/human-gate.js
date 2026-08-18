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
const HEADLESS_DECISION = {
    autoPass: true,
    warn: true,
    writeConfig: false,
    approval: false,
};
const WEB_AUTOPASS = {
    autoPass: true,
    warn: false,
    writeConfig: false,
    approval: false,
};
const WEB_APPROVAL = {
    autoPass: false,
    warn: false,
    writeConfig: false,
    approval: true,
};
const GATE_ALIASES = {
    HG1: 'HG1',
    HG2: 'HG2',
    HG3: 'HG3',
    HUMAN_GATE_1: 'HG1',
    HUMAN_GATE_2: 'HG2',
    HUMAN_GATE_3: 'HG3',
};
function normalizeGateName(gateName) {
    const key = String(gateName)
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, '_');
    const normalized = GATE_ALIASES[key];
    if (!normalized) {
        throw new TypeError(`unknown human gate: ${gateName}`);
    }
    return normalized;
}
function assertPolicy(policy) {
    if (policy !== 'full' && policy !== 'minimal' && policy !== 'none') {
        throw new TypeError(`unknown human_gate_policy: ${policy}`);
    }
}
function hg2NeedsApproval(ctx) {
    const warnings = ctx?.warnings ?? 0;
    const errors = ctx?.errors ?? 0;
    return warnings > 0 && errors === 0;
}
function resolveWebGate(policy, gateName, ctx) {
    if (policy === 'none') {
        return WEB_AUTOPASS;
    }
    if (policy === 'minimal') {
        if (gateName === 'HG3') {
            return WEB_APPROVAL;
        }
        return WEB_AUTOPASS;
    }
    // full
    if (gateName === 'HG2') {
        return hg2NeedsApproval(ctx) ? WEB_APPROVAL : WEB_AUTOPASS;
    }
    return WEB_APPROVAL;
}
/**
 * Decide whether a Human Gate auto-passes or needs `ctx.approval`.
 * Never writes `specline/config.yaml`.
 */
export function resolveHumanGate(kind, policy, gateName, ctx) {
    if (kind !== 'web' && kind !== 'headless') {
        throw new TypeError(`unknown runtime kind: ${kind}`);
    }
    assertPolicy(policy);
    const gate = normalizeGateName(gateName);
    if (kind === 'headless') {
        return HEADLESS_DECISION;
    }
    return resolveWebGate(policy, gate, ctx);
}
