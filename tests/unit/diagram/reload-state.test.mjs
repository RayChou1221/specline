import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { mutateDiagramPlatformConfig } from '../../../lib/diagram/platform-adapters.mjs';

test('first configuration requires one reload and repeat is idempotent', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'diagram-reload-'));
  const first = await mutateDiagramPlatformConfig({ platform: 'cursor', projectRoot, approved: true, currentPlatform: 'cursor' });
  assert.equal(first.reloadState, 'reload_required');
  const second = await mutateDiagramPlatformConfig({ platform: 'cursor', projectRoot, approved: true, currentPlatform: 'cursor' });
  assert.equal(second.changed, false);
  assert.equal(second.reloadState, 'not_required');
  assert.match(await readFile(join(projectRoot, '.cursor', 'mcp.json'), 'utf8'), /specline-diagram/);
});

test('additional platform requires independent permission', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'diagram-permission-'));
  await assert.rejects(() => mutateDiagramPlatformConfig({
    platform: 'claude', projectRoot, approved: true, currentPlatform: 'cursor', explicitPlatformApproval: false,
  }), { code: 'PLATFORM_PERMISSION_REQUIRED' });
});
