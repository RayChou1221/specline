import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readLockFile,
  writeLockFile,
  isV1Lock,
  migrateV1ToV2,
} from '../../lib/lock.mjs';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

describe('lock v2', () => {
  it('writes and reads an intentionally empty schema-v2 platform list', () => {
    const dir = mkdtempSync(join(tmpdir(), 'specline-lock-'));
    try {
      writeLockFile(dir, {
        version: '2.2.0',
        synced_at: '2026-07-29T00:00:00.000Z',
        schema: 2,
        platforms: [],
        files: new Map([['specline/config.yaml', 'empty-hash']]),
      });

      const text = readFileSync(join(dir, 'specline', '.specline-lock.yaml'), 'utf-8');
      assert.match(text, /^schema: 2$/m);
      assert.match(text, /^platforms: \[\]$/m);

      const lock = readLockFile(dir);
      assert.deepEqual(lock.platforms, []);
      assert.equal(lock.schema, 2);
      assert.equal(isV1Lock(lock), false);
      assert.equal(lock.files.get('specline/config.yaml'), 'empty-hash');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the inline format for non-empty platform lists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'specline-lock-'));
    try {
      writeLockFile(dir, {
        version: '2.2.0',
        synced_at: '2026-07-29T00:00:00.000Z',
        schema: 2,
        platforms: ['cursor', 'claude'],
        files: new Map(),
      });

      const text = readFileSync(join(dir, 'specline', '.specline-lock.yaml'), 'utf-8');
      assert.match(text, /^platforms: \["cursor", "claude"\]$/m);
      assert.deepEqual(readLockFile(dir).platforms, ['cursor', 'claude']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('omits a truly absent v1 platform property', () => {
    const dir = mkdtempSync(join(tmpdir(), 'specline-lock-'));
    try {
      writeLockFile(dir, {
        version: '1.9.0',
        synced_at: '2026-07-29T00:00:00.000Z',
        files: new Map(),
      });

      const text = readFileSync(join(dir, 'specline', '.specline-lock.yaml'), 'utf-8');
      assert.doesNotMatch(text, /^platforms:/m);
      assert.equal(isV1Lock(readLockFile(dir)), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('v1 lock 自动迁移 v2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'specline-lock-'));
    try {
      mkdirSync(join(dir, 'specline'), { recursive: true });
      writeFileSync(join(dir, 'specline', '.specline-lock.yaml'), readFileSync(join(FIXTURES, 'lock-v1.yaml')));
      const lock = readLockFile(dir);
      assert.ok(isV1Lock(lock));
      migrateV1ToV2(lock, '2.0.0', ['cursor']);
      assert.equal(lock.schema, 2);
      assert.deepEqual(lock.platforms, ['cursor']);
      assert.equal(isV1Lock(lock), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
