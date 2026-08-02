import assert from 'node:assert/strict';
import test from 'node:test';
import { createDiagramRuntime } from '../../../lib/diagram/runtime.mjs';

test('isolates process, state, token, port, revision, and cleanup per session', async () => {
  const secrets = new Map();
  const alive = new Map();
  const killed = [];
  let port = 42000;
  let pid = 700;
  const runtime = createDiagramRuntime({
    parentPid: 99,
    attachTriggers: false,
    randomId: (() => {
      let id = 0;
      return () => `session-${++id}`;
    })(),
    randomToken: (() => {
      let id = 0;
      return () => `secret-${++id}`;
    })(),
    startHttp: async ({ sessionId, token, handlers }) => {
      const assignedPort = ++port;
      secrets.set(sessionId, { token, handlers, port: assignedPort });
      return {
        port: assignedPort,
        origin: `http://127.0.0.1:${assignedPort}`,
        uiUrl: `http://127.0.0.1:${assignedPort}/sessions/${sessionId}/`,
        close: async () => {},
      };
    },
    spawnUpstream: async ({ sessionId, parentPid }) => {
      const assignedPid = ++pid;
      const record = {
        pid: assignedPid,
        parentPid,
        processStartTime: `start-${sessionId}`,
      };
      alive.set(assignedPid, { ...record, sessionId, alive: true });
      return record;
    },
    observeProcess: async (processId) => alive.get(processId),
    killProcess: async (processId, signal) => {
      killed.push([processId, signal]);
      alive.get(processId).alive = false;
    },
    sleep: async () => {},
  });

  const first = await runtime.startSession({
    diagramIdentity: { slug: 'first' },
    initialXml: '<first/>',
  });
  const second = await runtime.startSession({
    diagramIdentity: { slug: 'second' },
    initialXml: '<second/>',
  });
  assert.notEqual(first.sessionId, second.sessionId);
  assert.notEqual(first.pid, second.pid);
  assert.notEqual(first.port, second.port);
  assert.notEqual(secrets.get(first.sessionId).token, secrets.get(second.sessionId).token);
  assert.equal(JSON.stringify(first).includes('secret-'), false);

  runtime.applyBrowserState(first.sessionId, { baseRevision: 0, xml: '<manual/>' });
  assert.equal(runtime.status(first.sessionId).revision, 1);
  assert.equal(runtime.status(second.sessionId).revision, 0);

  await runtime.stop(first.sessionId, { save: false });
  assert.deepEqual(killed, [[first.pid, 'SIGTERM']]);
  assert.equal(runtime.list().length, 1);
  assert.equal(runtime.status(second.sessionId).sessionId, second.sessionId);
});
