/**
 * Native DSH session injection for the orchestrator prompt.
 * Prefer agent/session-start; if that hook misses the first model packet,
 * inject on this session's first agent/pre-step. Never uses Claude/Codex
 * hook adapters.
 */
export declare const SESSION_START_HOOK = "agent/session-start";
export declare const PRE_STEP_HOOK = "agent/pre-step";
export declare function shouldInjectOrchestrator(parentSession?: string | null): boolean;
export type SessionInjectEvent = {
    hook: string;
    sessionId: string;
    parentSession?: string | null;
    /** True when agent/session-start did not complete before the first model request. */
    missedFirstPacket?: boolean;
};
export type SessionInjectTracker = {
    handle(event: SessionInjectEvent): boolean;
};
/**
 * Per-session injector. Parent (empty parentSession) only.
 * session-start injects when it caught the first packet; otherwise the
 * first pre-step for that session injects once.
 */
export declare function createSessionInjectTracker(): SessionInjectTracker;
