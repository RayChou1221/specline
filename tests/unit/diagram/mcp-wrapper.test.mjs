import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createMcpWrapper,
  DIAGRAM_TOOLS,
} from '../../../lib/diagram/mcp-wrapper.mjs';

function fakeRuntime() {
  const states = new Map();
  let sequence = 0;
  return {
    async startSession() {
      const sessionId = `session-${++sequence}`;
      states.set(sessionId, {
        sessionId,
        sessionState: 'active',
        revision: 0,
        dirty: false,
        uiUrl: `http://127.0.0.1:4100${sequence}/sessions/${sessionId}/`,
        xml: '<mxGraphModel/>',
      });
      return states.get(sessionId);
    },
    status: (id) => states.get(id),
    getXml: (id) => states.get(id).xml,
    applyBrowserState(id, { baseRevision, xml }) {
      const state = states.get(id);
      assert.equal(baseRevision, state.revision);
      Object.assign(state, { revision: state.revision + 1, dirty: true, xml });
    },
    async sync(id, { expectedRevision } = {}) {
      const state = states.get(id);
      if (expectedRevision !== undefined) assert.equal(expectedRevision, state.revision);
      state.dirty = false;
      return state;
    },
    async stop(id, { save }) {
      states.delete(id);
      return { saved: save };
    },
  };
}

test('exposes only provider-neutral operations and routes only managed paths upstream', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'specline-wrapper-'));
  const calls = [];
  const wrapper = createMcpWrapper({
    projectRoot,
    runtime: fakeRuntime(),
    securityBoundary: { launch: true, bridgeAuth: true, managedPaths: true },
    upstream: {
      create: async (input) => { calls.push(['create', input]); return '<mxGraphModel/>'; },
      load: async (input) => { calls.push(['load', input]); return '<mxGraphModel/>'; },
      edit: async (input) => { calls.push(['edit', input]); return '<edited/>'; },
      persist: async (input) => calls.push(['persist', input]),
      export: async (input) => calls.push(['export', input]),
    },
  });

  assert.deepEqual(wrapper.listTools(), [...DIAGRAM_TOOLS]);
  assert.equal(wrapper.listTools().some((name) =>
    ['start_session', 'load_diagram', 'export_diagram'].includes(name)), false);
  const created = await wrapper.call('diagram.create', { slug: 'safe-diagram' });
  assert.match(created.uiUrl, /^http:\/\/127\.0\.0\.1:/);
  assert.match(calls[0][1].managedPath, /safe-diagram\/safe-diagram\.drawio$/);

  const edited = await wrapper.call('diagram.edit', {
    sessionId: created.sessionId,
    baseRevision: 0,
    operations: [{ operation: 'update', cell_id: '1', new_xml: '<mxCell/>' }],
  });
  assert.equal(edited.revision, 1);
  const exported = await wrapper.call('diagram.export', {
    sessionId: created.sessionId,
    baseRevision: 1,
    format: 'svg',
  });
  assert.match(exported.exportRelativePath, /safe-diagram\.svg$/);
  assert.match(calls.at(-1)[1].managedPath, /safe-diagram\/safe-diagram\.svg$/);

  assert.throws(() => wrapper.call('load_diagram', { path: '/etc/passwd' }), {
    code: 'TOOL_NOT_EXPOSED',
  });
  await assert.rejects(wrapper.call('diagram.load', { slug: '../escape' }), {
    code: 'INVALID_SLUG',
  });
  await rm(projectRoot, { recursive: true, force: true });
});

test('keeps tools sealed until every security boundary is verified', () => {
  assert.throws(() => createMcpWrapper({
    projectRoot: '/tmp/project',
    runtime: {},
    upstream: {},
    securityBoundary: { launch: true, bridgeAuth: false, managedPaths: true },
  }), { code: 'SECURITY_BOUNDARY_UNVERIFIED' });
});
