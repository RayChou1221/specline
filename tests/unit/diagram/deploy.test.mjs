import assert from 'node:assert/strict';
import test from 'node:test';
import { getSharedSpeclineManifest, pathIsSharedManaged } from '../../../lib/deploy.mjs';

const root = new URL('../../..', import.meta.url).pathname;

test('shared deployment includes runtime, closure, notices, patches and launch companions', () => {
  const manifest = getSharedSpeclineManifest(root);
  for (const path of [
    'specline/runtime/drawio/manifest.json',
    'specline/runtime/drawio/dependency-lock.json',
    'specline/runtime/drawio/NOTICE.md',
    'specline/runtime/diagram/runtime.mjs',
    'specline/runtime/diagram/mcp-wrapper.mjs',
    'specline/runtime/diagram/platform-adapters.mjs',
    'specline/runtime/diagram.mjs',
  ]) assert.ok(manifest.has(path), path);
  assert.equal(pathIsSharedManaged('specline/runtime/drawio/manifest.json'), true);
  assert.equal([...manifest.keys()].some((path) => path.startsWith('specline/diagrams/')), false);
  assert.equal([...manifest.keys()].some((path) => /specline\/changes\/.*\/diagrams\//.test(path)), false);
});
