import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decideLegacySyncMode,
  parseSyncPlatformList,
} from '../../lib/sync-options.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(ROOT, 'cli.mjs');
const tempDirs = new Set();

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'specline-sync-cli-'));
  tempDirs.add(dir);
  return dir;
}

function run(args, cwd = ROOT) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, CI: '1' },
    timeout: 30_000,
  });
}

function snapshotTree(root) {
  const snapshot = new Map();
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      const relativePath = fullPath.slice(root.length + 1);
      if (entry.isDirectory()) {
        snapshot.set(`${relativePath}/`, null);
        walk(fullPath);
      } else {
        snapshot.set(relativePath, readFileSync(fullPath));
      }
    }
  }
  walk(root);
  return snapshot;
}

function assertTreeEqual(actual, expected) {
  assert.deepStrictEqual([...actual.keys()].sort(), [...expected.keys()].sort());
  for (const [path, value] of expected) {
    const actualValue = actual.get(path);
    if (Buffer.isBuffer(value)) assert.ok(actualValue.equals(value), path);
    else assert.strictEqual(actualValue, value, path);
  }
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.clear();
});

describe('strict sync platform parsing', () => {
  it('rejects missing, blank, empty-token, unknown, mixed-invalid, and none', () => {
    for (const value of [undefined, '', '  ', 'cursor,', ',cursor', 'cursor,,claude']) {
      assert.throws(() => parseSyncPlatformList(value), /--platform|空值/);
    }
    assert.throws(() => parseSyncPlatformList('unknown'), /unknown.*无效|无效.*unknown/i);
    assert.throws(() => parseSyncPlatformList('cursor,invalid'), /invalid.*无效|无效.*invalid/i);
    assert.throws(() => parseSyncPlatformList('none'), /不支持.*none|none.*仅适用/i);
    assert.throws(() => parseSyncPlatformList('all,cursor'), /all.*单独/i);
  });

  it('normalizes legal lists, deduplicates, and expands all in stable order', () => {
    assert.deepStrictEqual(
      parseSyncPlatformList(' codex,Cursor,claude,cursor '),
      ['cursor', 'claude', 'codex'],
    );
    assert.deepStrictEqual(
      parseSyncPlatformList('all'),
      ['cursor', 'claude', 'codex', 'opencode'],
    );
  });

  it('keeps legacy migration mode selection pure and explicit', () => {
    assert.strictEqual(
      decideLegacySyncMode({ hasLock: true, hasLegacyMarker: true, dryRun: true }),
      'locked',
    );
    assert.strictEqual(
      decideLegacySyncMode({ hasLock: false, hasLegacyMarker: false, dryRun: false }),
      'uninitialized',
    );
    assert.strictEqual(
      decideLegacySyncMode({ hasLock: false, hasLegacyMarker: true, dryRun: false }),
      'legacy-real',
    );
    assert.strictEqual(
      decideLegacySyncMode({ hasLock: false, hasLegacyMarker: true, dryRun: true }),
      'legacy-dry-run',
    );
  });
});

describe('sync CLI option wiring', () => {
  it('fails bare and invalid --platform before writing project state', () => {
    for (const args of [
      ['sync', '--platform'],
      ['sync', '--platform', '--dry-run'],
      ['sync', '--platform', ''],
      ['sync', '--platform', 'cursor,invalid'],
      ['sync', '--platform', 'none'],
    ]) {
      const dir = tempDir();
      const before = snapshotTree(dir);
      const result = run([...args, dir], dir);
      assert.notStrictEqual(result.status, 0, `${args.join(' ')} should fail`);
      assert.match(result.stderr, /platform|none|invalid|无效/i);
      assertTreeEqual(snapshotTree(dir), before);
    }
  });

  it('legacy no-lock dry-run plans in memory and creates no state', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '.specline-config.yaml'), 'version: "1"\n');
    const before = snapshotTree(dir);

    const result = run(['sync', '--dry-run', '--platform', 'cursor,cursor', dir], dir);

    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /(旧版|迁移|migrat)/i);
    assertTreeEqual(snapshotTree(dir), before);
    assert.ok(!existsSync(join(dir, 'specline')));
    assert.ok(!existsSync(join(dir, '.cursor')));
  });

  it('legacy no-lock real sync still creates migration state', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '.specline-config.yaml'), 'version: "1"\n');

    const result = run(['sync', '--platform', 'cursor', dir], dir);

    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.ok(existsSync(join(dir, 'specline', '.specline-lock.yaml')));
    assert.ok(existsSync(join(dir, 'specline', 'platforms.yaml')));
  });

  it('init none remains valid and help explains configured versus run scope', () => {
    const dir = tempDir();
    mkdirSync(dir, { recursive: true });
    const init = run(['init', '--platform', 'none', dir], dir);
    assert.strictEqual(init.status, 0, init.stderr || init.stdout);
    assert.match(
      readFileSync(join(dir, 'specline', '.specline-lock.yaml'), 'utf-8'),
      /^platforms:\s*\[\]\s*$/m,
    );

    const help = run(['--help']);
    assert.strictEqual(help.status, 0);
    assert.match(help.stdout, /全部已配置平台/);
    assert.match(help.stdout, /不改变已配置平台成员关系/);
    assert.match(help.stdout, /不支持 none/);
  });
});
