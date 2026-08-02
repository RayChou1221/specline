import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  attachLifecycleTriggers,
  createLifecycleController,
  stopAllSessions,
} from '../../../lib/diagram/lifecycle.mjs';

const owned = {
  pid: 101,
  parentPid: 10,
  sessionId: 'a',
  processStartTime: 'start-a',
};

test('cleanup is idempotent, bounded, and terminates only owned PIDs', async () => {
  const signals = [];
  let alive = true;
  const controller = createLifecycleController({
    sessionId: 'a',
    children: [
      owned,
      { ...owned, pid: 202, sessionId: 'other', processStartTime: 'recorded' },
    ],
    sync: async () => {},
    closeHttp: async () => {},
    removeState: async () => {},
    observeProcess: async (pid) => pid === 101 ?
      { ...owned, alive } :
      { pid, parentPid: 10, processStartTime: 'different', alive: true },
    killProcess: async (pid, signal) => {
      signals.push([pid, signal]);
      if (pid === 101 && signal === 'SIGTERM') alive = false;
    },
    sleep: async () => {},
  });

  const first = controller.stop({ save: true });
  const second = controller.stop({ save: true });
  assert.strictEqual(first, second);
  assert.equal((await first).saved, true);
  assert.deepEqual(signals, [[101, 'SIGTERM']]);
});

test('sync failure never claims the session was saved', async () => {
  const controller = createLifecycleController({
    sessionId: 'a',
    sync: async () => { throw new Error('browser unavailable'); },
    closeHttp: async () => {},
    observeProcess: async () => ({ alive: false }),
    killProcess: async () => {},
  });
  await assert.rejects(controller.stop({ save: true }), { code: 'SYNC_TIMEOUT' });
});

test('stop-all requires approval for the exact session set', async () => {
  const stopped = [];
  const sessions = ['a', 'b'].map((sessionId) => ({
    sessionId,
    controller: { stop: async () => stopped.push(sessionId) },
  }));
  await assert.rejects(stopAllSessions(sessions), { code: 'CONSENT_REQUIRED' });
  await assert.rejects(
    stopAllSessions(sessions, { approved: true, approvedSessionIds: ['a'] }),
    { code: 'CONSENT_REQUIRED' },
  );
  await stopAllSessions(sessions, {
    approved: true,
    approvedSessionIds: ['b', 'a'],
  });
  assert.deepEqual(stopped.sort(), ['a', 'b']);
});

test('EOF, SIGTERM, parent exit, and 30-minute idle trigger current-session cleanup', async () => {
  async function captureReason(trigger) {
    const input = new EventEmitter();
    const processObject = new EventEmitter();
    let tick;
    let reason;
    const detach = attachLifecycleTriggers({
      controller: {
        stopping: false,
        stop: async (options) => { reason = options.reason; },
      },
      input,
      processObject,
      parentAlive: trigger === 'parent_exit' ? () => false : () => true,
      idle: { lastActivityAt: () => trigger === 'idle_timeout' ? 0 : 99 },
      now: () => trigger === 'idle_timeout' ? 30 * 60 * 1_000 : 100,
      setIntervalFn: (callback) => {
        tick = callback;
        return { unref() {} };
      },
      clearIntervalFn: () => {},
    });
    if (trigger === 'stdin_eof') input.emit('end');
    if (trigger === 'sigterm') processObject.emit('SIGTERM');
    if (trigger === 'parent_exit' || trigger === 'idle_timeout') tick();
    await new Promise((resolve) => setImmediate(resolve));
    detach();
    return reason;
  }

  for (const trigger of ['stdin_eof', 'sigterm', 'parent_exit', 'idle_timeout']) {
    assert.equal(await captureReason(trigger), trigger);
  }
});
