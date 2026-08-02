import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertLocalSessionUrl,
  createDiagramRuntime,
} from '../../../lib/diagram/runtime.mjs';
import { startBridgeServer } from '../../../lib/diagram/http-server.mjs';

test('accepts only exact IPv4 loopback session URLs', () => {
  assert.equal(
    assertLocalSessionUrl('http://127.0.0.1:43123/sessions/abc/', 'abc'),
    'http://127.0.0.1:43123/sessions/abc/',
  );
  for (const url of [
    'http://localhost:43123/sessions/abc/',
    'http://0.0.0.0:43123/sessions/abc/',
    'https://127.0.0.1:43123/sessions/abc/',
    'http://example.com/sessions/abc/',
    'http://127.0.0.1:43123/sessions/abc/?remote=1',
  ]) {
    assert.throws(() => assertLocalSessionUrl(url, 'abc'), {
      code: 'REMOTE_ACCESS_BLOCKED',
    });
  }
});

test('allocates a temporary port on 127.0.0.1 only', async () => {
  const bridge = await startBridgeServer({
    sessionId: 'abc',
    token: 'secret',
    handlers: { state: async () => ({ ok: true }) },
    uiHandler: async () => ({
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><title>Local Draw.io</title>',
    }),
  });
  assert.equal(bridge.host, '127.0.0.1');
  assert.match(bridge.uiUrl, /^http:\/\/127\.0\.0\.1:\d+\/sessions\/abc\/$/);
  const ui = await fetch(bridge.uiUrl);
  assert.equal(ui.status, 200);
  assert.match(ui.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.doesNotMatch(await ui.text(), /https?:\/\/(?!127\.0\.0\.1)/);
  await bridge.close();
});

test('rejects a non-loopback HTTP boundary before spawning upstream', async () => {
  let spawned = false;
  let closed = false;
  const runtime = createDiagramRuntime({
    attachTriggers: false,
    startHttp: async () => ({
      origin: 'http://localhost:4000',
      uiUrl: 'http://localhost:4000/sessions/session-a/',
      close: async () => { closed = true; },
    }),
    spawnUpstream: async () => { spawned = true; },
  });
  await assert.rejects(runtime.startSession({ sessionId: 'session-a' }), {
    code: 'REMOTE_ACCESS_BLOCKED',
  });
  assert.equal(spawned, false);
  assert.equal(closed, true);
});
