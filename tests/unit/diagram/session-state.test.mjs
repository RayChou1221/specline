import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  SessionStateError,
  assertSessionOwnership,
  classifyProcessOwnership,
  createSessionState,
  transitionSessionState,
} from '../../../lib/diagram/session-state.mjs';

function session(overrides = {}) {
  return createSessionState({
    sessionId: 'session-a',
    projectRoot: '/project/a',
    parentPid: 100,
    now: '2026-07-29T00:00:00.000Z',
    ...overrides,
  });
}

describe('session state transitions', () => {
  it('supports valid transitions and makes repeated transitions idempotent', () => {
    const starting = session();
    const active = transitionSessionState(starting, 'active', {
      now: '2026-07-29T00:01:00.000Z',
    });
    const repeated = transitionSessionState(active, 'active', {
      now: '2026-07-29T00:02:00.000Z',
    });

    assert.equal(active.sessionState, 'active');
    assert.strictEqual(repeated, active);
    assert.equal(active.lastActivityAt, '2026-07-29T00:01:00.000Z');
  });

  it('rejects invalid transitions and keeps stopped terminal', () => {
    assert.throws(
      () => transitionSessionState(session(), 'stopped'),
      (error) => error instanceof SessionStateError && error.code === 'INVALID_STATE_TRANSITION',
    );

    const stopped = transitionSessionState(
      transitionSessionState(
        transitionSessionState(session(), 'active'),
        'stopping',
      ),
      'stopped',
    );
    assert.strictEqual(transitionSessionState(stopped, 'stopped'), stopped);
    assert.throws(
      () => transitionSessionState(stopped, 'active'),
      (error) => error.code === 'INVALID_STATE_TRANSITION',
    );
  });

  it('keeps multiple sessions isolated by identity and project', () => {
    const first = session();
    const second = session({ sessionId: 'session-b', projectRoot: '/project/b' });

    assert.strictEqual(assertSessionOwnership(first, {
      sessionId: 'session-a',
      projectRoot: '/project/a',
    }), first);
    assert.throws(
      () => assertSessionOwnership(first, {
        sessionId: second.sessionId,
        projectRoot: second.projectRoot,
      }),
      (error) => error.code === 'SESSION_OWNERSHIP_MISMATCH',
    );
  });
});

describe('PID and parent ownership classification', () => {
  const record = {
    pid: 501,
    parentPid: 100,
    sessionId: 'session-a',
    processStartTime: 'token-1',
  };

  it('classifies a live exact match as owned', () => {
    assert.deepEqual(
      classifyProcessOwnership(record, {
        alive: true,
        pid: 501,
        parentPid: 100,
        processStartTime: 'token-1',
      }),
      { classification: 'owned', mayTerminate: true },
    );
  });

  it('classifies dead records as stale without granting termination', () => {
    assert.deepEqual(
      classifyProcessOwnership(record, { alive: false, pid: 501 }),
      { classification: 'stale_dead', mayTerminate: false },
    );
  });

  it('refuses reused PIDs and parent mismatches', () => {
    assert.deepEqual(
      classifyProcessOwnership(record, {
        alive: true,
        pid: 501,
        parentPid: 100,
        processStartTime: 'token-2',
      }),
      { classification: 'pid_reused', mayTerminate: false },
    );
    assert.deepEqual(
      classifyProcessOwnership(record, {
        alive: true,
        pid: 501,
        parentPid: 999,
        processStartTime: 'token-1',
      }),
      { classification: 'parent_mismatch', mayTerminate: false },
    );
  });

  it('refuses incomplete or differently numbered observations', () => {
    assert.deepEqual(
      classifyProcessOwnership(record, null),
      { classification: 'unverified', mayTerminate: false },
    );
    assert.deepEqual(
      classifyProcessOwnership(record, {
        alive: true,
        pid: 777,
        parentPid: 100,
        processStartTime: 'token-1',
      }),
      { classification: 'pid_mismatch', mayTerminate: false },
    );
  });
});
