export const SESSION_STATES = Object.freeze([
  'starting',
  'active',
  'dirty',
  'syncing',
  'idle_held',
  'stopping',
  'stopped',
  'error',
]);

const TRANSITIONS = Object.freeze({
  starting: new Set(['active', 'error', 'stopping']),
  active: new Set(['dirty', 'syncing', 'idle_held', 'stopping', 'error']),
  dirty: new Set(['active', 'syncing', 'idle_held', 'stopping', 'error']),
  syncing: new Set(['active', 'dirty', 'stopping', 'error']),
  idle_held: new Set(['active', 'dirty', 'syncing', 'stopping', 'error']),
  stopping: new Set(['stopped', 'error']),
  stopped: new Set(),
  error: new Set(['stopping', 'stopped']),
});

export class SessionStateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SessionStateError';
    this.code = code;
  }
}

function requireString(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SessionStateError('INVALID_SESSION_METADATA', `${field} is required`);
  }
  return value;
}

function requirePid(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new SessionStateError('INVALID_SESSION_METADATA', `${field} must be a positive integer`);
  }
  return value;
}

function normalizeTimestamp(value) {
  const timestamp = value ?? new Date().toISOString();
  if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) {
    throw new SessionStateError('INVALID_SESSION_METADATA', 'now must be an ISO timestamp');
  }
  return timestamp;
}

export function createSessionState({
  sessionId,
  projectRoot,
  parentPid,
  now,
  revision = 0,
} = {}) {
  requireString(sessionId, 'sessionId');
  requireString(projectRoot, 'projectRoot');
  requirePid(parentPid, 'parentPid');
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new SessionStateError('INVALID_SESSION_METADATA', 'revision must be a non-negative integer');
  }

  const timestamp = normalizeTimestamp(now);
  return Object.freeze({
    sessionId,
    projectRoot,
    parentPid,
    sessionState: 'starting',
    revision,
    dirty: false,
    createdAt: timestamp,
    lastActivityAt: timestamp,
  });
}

export function transitionSessionState(session, nextState, {
  now,
  revision = session?.revision,
  dirty,
} = {}) {
  if (!session || typeof session !== 'object' || !TRANSITIONS[session.sessionState]) {
    throw new SessionStateError('INVALID_SESSION_STATE', 'Session state record is invalid');
  }
  if (!SESSION_STATES.includes(nextState)) {
    throw new SessionStateError('INVALID_SESSION_STATE', `Unknown session state: ${nextState}`);
  }
  if (session.sessionState === nextState) {
    return session;
  }
  if (!TRANSITIONS[session.sessionState].has(nextState)) {
    throw new SessionStateError(
      'INVALID_STATE_TRANSITION',
      `Cannot transition session from ${session.sessionState} to ${nextState}`,
    );
  }
  if (!Number.isSafeInteger(revision) || revision < session.revision) {
    throw new SessionStateError(
      'INVALID_REVISION',
      'Session revision must be a non-decreasing integer',
    );
  }

  const nextDirty = dirty ?? (
    nextState === 'dirty' ? true :
      nextState === 'active' && session.sessionState === 'syncing' ? false :
        session.dirty
  );

  return Object.freeze({
    ...session,
    sessionState: nextState,
    revision,
    dirty: nextState === 'stopped' ? false : Boolean(nextDirty),
    lastActivityAt: normalizeTimestamp(now),
  });
}

export function assertSessionOwnership(session, { sessionId, projectRoot } = {}) {
  if (
    !session ||
    session.sessionId !== sessionId ||
    session.projectRoot !== projectRoot
  ) {
    throw new SessionStateError(
      'SESSION_OWNERSHIP_MISMATCH',
      'Session does not belong to the requested identity and project',
    );
  }
  return session;
}

export function classifyProcessOwnership(record, observed) {
  if (
    !record ||
    !Number.isSafeInteger(record.pid) ||
    !Number.isSafeInteger(record.parentPid) ||
    typeof record.sessionId !== 'string' ||
    !record.sessionId ||
    typeof record.processStartTime !== 'string' ||
    !record.processStartTime
  ) {
    return { classification: 'unverified', mayTerminate: false };
  }
  if (!observed || typeof observed !== 'object') {
    return { classification: 'unverified', mayTerminate: false };
  }
  if (observed.alive === false) {
    return { classification: 'stale_dead', mayTerminate: false };
  }
  if (observed.alive !== true) {
    return { classification: 'unverified', mayTerminate: false };
  }
  if (observed.pid !== record.pid) {
    return { classification: 'pid_mismatch', mayTerminate: false };
  }
  if (observed.parentPid !== record.parentPid) {
    return { classification: 'parent_mismatch', mayTerminate: false };
  }
  if (observed.processStartTime !== record.processStartTime) {
    return { classification: 'pid_reused', mayTerminate: false };
  }
  return { classification: 'owned', mayTerminate: true };
}
