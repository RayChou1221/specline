import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { readLockFile, writeLockFile } from '../../lib/lock.mjs';
import {
  migrateLockIfNeeded,
  planSyncWithEphemeralLock,
  runSync,
} from '../../lib/sync.mjs';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tempDirs = new Set();

function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.add(dir);
  return dir;
}

function normalizeResult(result) {
  return {
    plan: [...result.plan].sort((a, b) => a.path.localeCompare(b.path)),
    stats: result.stats,
    migrated: result.migrated,
  };
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.clear();
});

describe('sync v2 migrate', () => {
  it('migrateLockIfNeeded 输出迁移摘要', () => {
    const dir = tempDir('specline-sync-v2-');
    mkdirSync(join(dir, 'specline'), { recursive: true });
    mkdirSync(join(dir, '.cursor'), { recursive: true });
    copyFileSync(join(ROOT, 'tests/fixtures/lock-v1.yaml'), join(dir, 'specline', '.specline-lock.yaml'));
    copyFileSync(join(ROOT, 'tests/fixtures/platforms.yaml'), join(dir, 'specline', 'platforms.yaml'));

    const logs = [];
    const { migrated, lockData } = migrateLockIfNeeded(dir, '2.0.0', (m) => logs.push(m));
    assert.strictEqual(migrated, true);
    assert.ok(logs.some((l) => l.includes('v1→v2')));
    assert.strictEqual(lockData?.schema, 2);
    assert.ok(lockData?.platforms?.includes('cursor'));
  });

  it('v2 lock 不重复迁移', () => {
    const dir = tempDir('specline-sync-v2-skip-');
    mkdirSync(join(dir, 'specline'), { recursive: true });
    const lockPath = join(dir, 'specline', '.specline-lock.yaml');
    copyFileSync(join(ROOT, 'tests/fixtures/lock-v2.yaml'), lockPath);

    const { migrated } = migrateLockIfNeeded(dir, '2.0.0', () => {});
    assert.strictEqual(migrated, false);
  });

  it('ephemeral v1 migration is clone-safe, zero-write, and equivalent to disk dry-run', () => {
    const dir = tempDir('specline-sync-v1-ephemeral-');
    mkdirSync(join(dir, 'specline'), { recursive: true });
    mkdirSync(join(dir, '.claude', 'skills'), { recursive: true });
    const lockPath = join(dir, 'specline', '.specline-lock.yaml');
    copyFileSync(join(ROOT, 'tests/fixtures/lock-v1.yaml'), lockPath);

    const input = readLockFile(dir);
    const inputSnapshot = {
      schema: input.schema,
      platforms: input.platforms,
      files: [...input.files],
    };
    const lockBefore = readFileSync(lockPath);
    const ephemeral = planSyncWithEphemeralLock(dir, input, {
      platforms: ['claude'],
      packageRoot: ROOT,
    });

    assert.strictEqual(ephemeral.migrated, true);
    assert.strictEqual(input.schema, inputSnapshot.schema);
    assert.strictEqual(input.platforms, inputSnapshot.platforms);
    assert.deepStrictEqual([...input.files], inputSnapshot.files);
    assert.ok(readFileSync(lockPath).equals(lockBefore));
    assert.ok(!existsSync(join(dir, 'specline', 'platforms.yaml')));

    const diskDryRun = runSync(dir, {
      platforms: ['claude'],
      packageRoot: ROOT,
      dryRun: true,
    });
    assert.deepStrictEqual(
      normalizeResult(ephemeral),
      normalizeResult(diskDryRun),
    );
    assert.ok(readFileSync(lockPath).equals(lockBefore));
    assert.ok(!existsSync(join(dir, 'specline', 'platforms.yaml')));
  });

  it('real v1 sync writes schema 2 and materializes detected configured platforms', () => {
    const dir = tempDir('specline-sync-v1-real-');
    mkdirSync(join(dir, 'specline'), { recursive: true });
    mkdirSync(join(dir, '.claude', 'skills'), { recursive: true });
    copyFileSync(
      join(ROOT, 'tests/fixtures/lock-v1.yaml'),
      join(dir, 'specline', '.specline-lock.yaml'),
    );

    const result = runSync(dir, { platforms: [], packageRoot: ROOT });

    assert.strictEqual(result.migrated, true);
    const lock = readLockFile(dir);
    assert.strictEqual(lock.schema, 2);
    assert.deepStrictEqual(lock.platforms, ['claude']);
    assert.match(
      readFileSync(join(dir, 'specline', 'platforms.yaml'), 'utf-8'),
      /-\s+claude/,
    );
  });

  it('rejects corrupt authoritative v2 platform metadata before mutation', () => {
    const cases = [
      { name: 'unknown', platforms: ['cursor', 'future-platform'], pattern: /unsupported platform/ },
      { name: 'non-string', platforms: ['cursor', 7], pattern: /unsupported platform/ },
    ];

    for (const testCase of cases) {
      const dir = tempDir(`specline-sync-v2-corrupt-${testCase.name}-`);
      mkdirSync(join(dir, 'specline'), { recursive: true });
      const lockData = {
        version: '2.2.0',
        synced_at: '2026-01-01T00:00:00.000Z',
        schema: 2,
        platforms: testCase.platforms,
        files: new Map(),
      };
      const before = existsSync(join(dir, 'specline/platforms.yaml'));

      assert.throws(
        () => planSyncWithEphemeralLock(dir, lockData, { packageRoot: ROOT }),
        testCase.pattern,
      );
      assert.strictEqual(existsSync(join(dir, 'specline/platforms.yaml')), before);
    }
  });

  it('rejects malformed and unknown disk platform syntax without rewriting state', () => {
    const malformedValues = [
      'platforms: cursor',
      'platforms: ["cursor",]',
      'platforms: ["future-platform"]',
    ];

    for (const platformLine of malformedValues) {
      const dir = tempDir('specline-sync-v2-malformed-');
      mkdirSync(join(dir, 'specline'), { recursive: true });
      const lockPath = join(dir, 'specline/.specline-lock.yaml');
      writeFileSync(lockPath, [
        'version: "2.2.0"',
        'synced_at: "2026-01-01T00:00:00.000Z"',
        'schema: 2',
        platformLine,
        'files:',
        '',
      ].join('\n'));
      const lockBefore = readFileSync(lockPath);

      assert.throws(
        () => runSync(dir, { packageRoot: ROOT }),
        /Invalid lock data/,
      );
      assert.ok(readFileSync(lockPath).equals(lockBefore));
      assert.ok(!existsSync(join(dir, 'specline/platforms.yaml')));
    }
  });

  it('v2 lock fallback and authoritative empty remain schema 2 without YAML', () => {
    const dir = tempDir('specline-sync-v2-empty-');
    mkdirSync(join(dir, 'specline'), { recursive: true });
    mkdirSync(join(dir, '.cursor'), { recursive: true });
    const preservedPath = '.cursor/commands/preserved.md';
    mkdirSync(dirname(join(dir, preservedPath)), { recursive: true });
    writeFileSync(join(dir, preservedPath), 'preserved\n');
    writeLockFile(dir, {
      version: '2.2.0',
      synced_at: '2026-01-01T00:00:00.000Z',
      schema: 2,
      platforms: [],
      files: new Map([[preservedPath, 'sha256:exact-empty-authority']]),
    });

    const result = runSync(dir, { packageRoot: ROOT });

    assert.strictEqual(result.migrated, false);
    const lock = readLockFile(dir);
    assert.strictEqual(lock.schema, 2);
    assert.deepStrictEqual(lock.platforms, []);
    assert.strictEqual(
      lock.files.get(preservedPath),
      'sha256:exact-empty-authority',
    );
    assert.ok(existsSync(join(dir, preservedPath)));
    assert.ok(!existsSync(join(dir, 'specline', 'platforms.yaml')));
  });
});
