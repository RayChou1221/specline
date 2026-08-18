import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePlatformList } from '../../lib/init.mjs';
import { PLATFORMS } from '../../lib/paths.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('dsh is not a deploy platform', () => {
  it('keeps PLATFORMS as the four IDEs and excludes dsh', () => {
    assert.deepEqual(PLATFORMS, ['cursor', 'claude', 'codex', 'opencode']);
    assert.equal(PLATFORMS.includes('dsh'), false);
    assert.equal(PLATFORMS.length, 4);
  });

  it('rejects parsePlatformList("dsh") as an unknown platform', () => {
    assert.throws(() => parsePlatformList('dsh'), /未知平台:\s*dsh/);
    assert.doesNotThrow(() => parsePlatformList('cursor'));
  });

  it('does not declare a dsh field on the root package.json', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    assert.equal(Object.hasOwn(pkg, 'dsh'), false);
    assert.equal(pkg.dsh, undefined);
  });

  it('does not ship adapters/dsh', () => {
    assert.equal(existsSync(join(ROOT, 'adapters', 'dsh')), false);
  });
});
