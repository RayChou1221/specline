import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  getCombinedUpstreamManifest,
  getSharedSpeclineManifest,
  pathIsSharedManaged,
} from '../../lib/deploy.mjs';
import { PLATFORMS } from '../../lib/paths.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const MANAGED_RUNTIME_PREFIXES = [
  'specline/runtime/diagram',
  'specline/runtime/drawio',
  'specline/runtime/diagram.mjs',
  'specline/runtime/paths.mjs',
];

const PLATFORM_DRAWIO_MCP_PATHS = [
  '.cursor/mcp.json',
  '.mcp.json',
  '.codex/config.toml',
];

function isManagedDiagramRuntimePath(relPath) {
  return MANAGED_RUNTIME_PREFIXES.some(
    (prefix) => relPath === prefix || relPath.startsWith(`${prefix}/`),
  );
}

test('shared deploy manifest excludes managed diagram and drawio runtime paths', () => {
  const manifest = getSharedSpeclineManifest(root);
  const keys = [...manifest.keys()];

  for (const key of keys) {
    assert.equal(
      isManagedDiagramRuntimePath(key),
      false,
      `unexpected managed diagram runtime path in shared manifest: ${key}`,
    );
  }

  assert.equal(pathIsSharedManaged('specline/runtime/drawio/manifest.json'), false);
  assert.equal(pathIsSharedManaged('specline/runtime/diagram/runtime.mjs'), false);
  assert.equal(pathIsSharedManaged('specline/runtime/diagram.mjs'), false);
});

test('combined deploy manifest does not package diagram runtime or silent drawio MCP', () => {
  const manifest = getCombinedUpstreamManifest(PLATFORMS, root);
  const keys = [...manifest.keys()];

  for (const key of keys) {
    assert.equal(
      isManagedDiagramRuntimePath(key),
      false,
      `unexpected managed diagram runtime path in combined manifest: ${key}`,
    );
  }

  for (const mcpPath of PLATFORM_DRAWIO_MCP_PATHS) {
    assert.equal(
      manifest.has(mcpPath),
      false,
      `deploy must not silently write platform drawio MCP config: ${mcpPath}`,
    );
  }

  // opencode.json may be deployed for the plugin merge, but must not embed drawio MCP
  const opencodeEntry = manifest.get('opencode.json');
  if (opencodeEntry?.content) {
    assert.equal(
      /drawio|specline-diagram|next-ai-drawio/i.test(opencodeEntry.content),
      false,
      'opencode.json deploy content must not embed drawio MCP',
    );
  }
});
