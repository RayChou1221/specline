import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserSync } from '../../../lib/diagram/browser-sync.mjs';

test('tracks browser revisions and persists the latest state', async () => {
  const writes = [];
  const sync = createBrowserSync({
    sessionId: 'session-a',
    initialXml: '<old/>',
    requestBrowserState: async ({ revision }) => ({ revision, xml: '<manual/>' }),
    persist: async (state) => writes.push(state),
    now: () => 42,
  });

  const state = await sync.sync();
  assert.equal(state.revision, 1);
  assert.equal(state.dirty, false);
  assert.equal(sync.getXml(), '<manual/>');
  assert.deepEqual(writes, [{ sessionId: 'session-a', revision: 1, xml: '<manual/>' }]);
});

test('fails closed on revision conflict and synchronization timeout', async () => {
  const sync = createBrowserSync({
    sessionId: 'session-a',
    initialRevision: 2,
    requestBrowserState: () => new Promise(() => {}),
  });

  assert.throws(
    () => sync.applyState({ baseRevision: 1, xml: '<stale/>' }),
    { code: 'REVISION_CONFLICT' },
  );
  await assert.rejects(sync.sync({ timeoutMs: 5 }), { code: 'SYNC_TIMEOUT' });
});
