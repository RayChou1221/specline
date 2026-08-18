/**
 * Native DSH session injection for the orchestrator prompt.
 * Prefer agent/session-start; if that hook misses the first model packet,
 * inject on this session's first agent/pre-step. Never uses Claude/Codex
 * hook adapters.
 */

export const SESSION_START_HOOK = 'agent/session-start';
export const PRE_STEP_HOOK = 'agent/pre-step';

export function shouldInjectOrchestrator(
  parentSession?: string | null,
): boolean {
  return parentSession == null || parentSession === '';
}

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
export function createSessionInjectTracker(): SessionInjectTracker {
  const injected = new Set<string>();
  const preStepCount = new Map<string, number>();

  return {
    handle(event: SessionInjectEvent): boolean {
      if (!shouldInjectOrchestrator(event.parentSession)) {
        return false;
      }

      if (event.hook === SESSION_START_HOOK) {
        if (event.missedFirstPacket) {
          return false;
        }
        if (injected.has(event.sessionId)) {
          return false;
        }
        injected.add(event.sessionId);
        return true;
      }

      if (event.hook === PRE_STEP_HOOK) {
        const count = (preStepCount.get(event.sessionId) ?? 0) + 1;
        preStepCount.set(event.sessionId, count);
        if (injected.has(event.sessionId)) {
          return false;
        }
        if (count !== 1) {
          return false;
        }
        injected.add(event.sessionId);
        return true;
      }

      return false;
    },
  };
}
