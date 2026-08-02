import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { writeLockFile, readLockFile } from '../../lib/lock.mjs';
import {
  planSyncWithEphemeralLock,
  runSync,
} from '../../lib/sync.mjs';

const tempDirs = new Set();

function sha256(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.add(dir);
  return dir;
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function createPackageRoot() {
  const root = tempDir('specline-sync-package-');
  write(join(root, 'package.json'), '{"version":"9.8.7"}\n');
  write(join(root, 'core/gates/pipeline-gate.sh'), '#!/bin/sh\n');
  write(join(root, 'core/gates/contract-check.mjs'), 'export default true;\n');
  write(join(root, 'core/templates/execution-contract.md'), '# Contract\n');
  write(join(root, 'core/templates/specline/config.yaml'), 'human_gate_policy: minimal\n');
  write(join(root, 'adapters/cursor/hooks.json'), '{"hooks":{}}\n');
  write(
    join(root, 'adapters/claude/hooks/hooks.json'),
    '{"hooks":{"SessionStart":[]}}\n',
  );
  write(join(root, 'adapters/codex/agent.toml.hbs'), 'name = "{{name}}"\n');
  write(join(root, 'adapters/codex/hooks.json'), '{"hooks":{}}\n');
  return root;
}

function createProject(platforms, files = new Map()) {
  const dir = tempDir('specline-sync-project-');
  mkdirSync(join(dir, 'specline'), { recursive: true });
  if (platforms !== null) {
    write(
      join(dir, 'specline/platforms.yaml'),
      platforms.length
        ? `platforms:\n${platforms.map((p) => `  - ${p}`).join('\n')}\n`
        : 'platforms: []\n',
    );
  }
  writeLockFile(dir, {
    version: '2.2.0',
    synced_at: '2026-01-01T00:00:00.000Z',
    schema: 2,
    platforms: platforms ?? [],
    files,
  });
  return dir;
}

function snapshotTree(root) {
  const snapshot = new Map();
  function visit(dir, relative = '') {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) visit(full, rel);
      else snapshot.set(rel, readFileSync(full));
    }
  }
  visit(root);
  return snapshot;
}

function assertSnapshotEqual(actual, expected) {
  assert.deepStrictEqual([...actual.keys()].sort(), [...expected.keys()].sort());
  for (const [path, content] of expected) {
    assert.ok(actual.get(path)?.equals(content), `${path} changed`);
  }
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

describe('scope-aware sync planning and execution', () => {
  it('defaults targets to configured platforms and authoritative empty is shared-only', () => {
    const packageRoot = createPackageRoot();
    const configured = createProject(['cursor', 'claude']);
    const configuredPlan = planSyncWithEphemeralLock(
      configured,
      readLockFile(configured),
      { packageRoot },
    ).plan.map((item) => item.path);

    assert.ok(configuredPlan.includes('.cursor/hooks.json'));
    assert.ok(configuredPlan.includes('.claude/settings.json'));
    assert.ok(configuredPlan.includes('specline/config.yaml'));
    assert.ok(!configuredPlan.some((path) => path.startsWith('.codex/')));

    const empty = createProject([]);
    mkdirSync(join(empty, '.cursor'), { recursive: true });
    const emptyPlan = planSyncWithEphemeralLock(
      empty,
      readLockFile(empty),
      { packageRoot },
    ).plan.map((item) => item.path);

    assert.ok(emptyPlan.includes('specline/config.yaml'));
    assert.ok(!emptyPlan.some((path) => path.startsWith('.cursor/')));
    assert.ok(!emptyPlan.some((path) => path.startsWith('.claude/')));
  });

  it('ephemeral planning clones input, writes nothing, and matches runSync dry-run', () => {
    const packageRoot = createPackageRoot();
    const cursorPath = '.cursor/commands/removed.md';
    const claudePath = '.claude/commands/omitted.md';
    const files = new Map([
      [cursorPath, sha256('cursor local\n')],
      [claudePath, sha256('claude local\n')],
    ]);
    const dir = createProject(['cursor', 'claude'], files);
    write(join(dir, cursorPath), 'cursor local\n');
    write(join(dir, claudePath), 'claude local\n');

    const lockData = readLockFile(dir);
    const inputEntries = [...lockData.files];
    const inputPlatforms = [...lockData.platforms];
    const before = snapshotTree(dir);
    const ephemeral = planSyncWithEphemeralLock(dir, lockData, {
      platforms: ['cursor'],
      packageRoot,
    });

    assert.deepStrictEqual([...lockData.files], inputEntries);
    assert.deepStrictEqual(lockData.platforms, inputPlatforms);
    assertSnapshotEqual(snapshotTree(dir), before);
    assert.ok(ephemeral.plan.some(
      (item) => item.path === cursorPath && item.type === 'UPSTREAM_REMOVED',
    ));
    assert.ok(!ephemeral.plan.some((item) => item.path === claudePath));

    const diskDryRun = runSync(dir, {
      platforms: ['cursor'],
      packageRoot,
      dryRun: true,
    });
    assert.deepStrictEqual(
      normalizeResult(ephemeral),
      normalizeResult(diskDryRun),
    );
    assertSnapshotEqual(snapshotTree(dir), before);
    assert.throws(
      () => planSyncWithEphemeralLock(dir, lockData, { dryRun: true }),
      /Unsupported sync planning option/,
    );
  });

  it('rejects traversal lock keys during planning and real sync without mutation', () => {
    const packageRoot = createPackageRoot();
    const dir = createProject(['cursor']);
    const outsidePath = join(dirname(dir), 'specline-sync-traversal-victim.txt');
    tempDirs.add(outsidePath);
    writeFileSync(outsidePath, 'outside sentinel\n');
    const maliciousPath = `.cursor/../../${outsidePath.split('/').pop()}`;
    const lockData = readLockFile(dir);
    lockData.files.set(maliciousPath, 'sha256:malicious');
    writeLockFile(dir, lockData);
    const lockBefore = readFileSync(join(dir, 'specline/.specline-lock.yaml'));
    const yamlBefore = readFileSync(join(dir, 'specline/platforms.yaml'));

    assert.throws(
      () => planSyncWithEphemeralLock(dir, lockData, { platforms: ['cursor'], packageRoot }),
      /unsafe managed path/,
    );
    assert.strictEqual(readFileSync(outsidePath, 'utf-8'), 'outside sentinel\n');
    assert.throws(
      () => runSync(dir, { platforms: ['cursor'], packageRoot }),
      /unsafe managed path/,
    );
    assert.strictEqual(readFileSync(outsidePath, 'utf-8'), 'outside sentinel\n');
    assert.ok(readFileSync(join(dir, 'specline/.specline-lock.yaml')).equals(lockBefore));
    assert.ok(readFileSync(join(dir, 'specline/platforms.yaml')).equals(yamlBefore));
  });

  it('rejects external symlinked platform and shared prefixes in planning and real sync', () => {
    const packageRoot = createPackageRoot();
    const cases = [
      {
        name: 'platform',
        platforms: ['cursor'],
        prefix: '.cursor',
        sentinel: 'hooks.json',
        content: '{"outside":true}\n',
      },
      {
        name: 'shared',
        platforms: [],
        prefix: 'specline/bin',
        sentinel: 'gate.sh',
        content: '# outside sentinel\n',
      },
    ];

    for (const testCase of cases) {
      const dir = createProject(testCase.platforms);
      const outside = tempDir(`specline-sync-${testCase.name}-outside-`);
      const outsideSentinel = join(outside, testCase.sentinel);
      writeFileSync(outsideSentinel, testCase.content);
      symlinkSync(outside, join(dir, testCase.prefix), 'dir');
      const lockPath = join(dir, 'specline/.specline-lock.yaml');
      const yamlPath = join(dir, 'specline/platforms.yaml');
      const lockBefore = readFileSync(lockPath);
      const yamlBefore = readFileSync(yamlPath);
      const lockData = readLockFile(dir);

      assert.throws(
        () => planSyncWithEphemeralLock(dir, lockData, { packageRoot }),
        /Unsafe managed path/,
      );
      assert.strictEqual(readFileSync(outsideSentinel, 'utf-8'), testCase.content);
      assert.ok(readFileSync(lockPath).equals(lockBefore));
      assert.ok(readFileSync(yamlPath).equals(yamlBefore));

      assert.throws(
        () => runSync(dir, { packageRoot }),
        /Unsafe managed path/,
      );
      assert.strictEqual(readFileSync(outsideSentinel, 'utf-8'), testCase.content);
      assert.ok(readFileSync(lockPath).equals(lockBefore));
      assert.ok(readFileSync(yamlPath).equals(yamlBefore));
    }
  });

  it('propagates upstream removal unlink failures and preserves the lock baseline', () => {
    const packageRoot = createPackageRoot();
    const removedPath = '.cursor/commands/removed.md';
    const baseline = 'sha256:removed-baseline';
    const dir = createProject(['cursor'], new Map([[removedPath, baseline]]));
    mkdirSync(join(dir, removedPath), { recursive: true });
    const lockPath = join(dir, 'specline/.specline-lock.yaml');
    const lockBefore = readFileSync(lockPath);
    const yamlBefore = readFileSync(join(dir, 'specline/platforms.yaml'));

    assert.throws(
      () => runSync(dir, { platforms: ['cursor'], packageRoot }),
      (error) => error?.code === 'EISDIR' || error?.code === 'EPERM',
    );
    assert.ok(existsSync(join(dir, removedPath)));
    assert.ok(readFileSync(lockPath).equals(lockBefore));
    assert.ok(readFileSync(join(dir, 'specline/platforms.yaml')).equals(yamlBefore));
    assert.strictEqual(readLockFile(dir).files.get(removedPath), baseline);
  });

  it('merges scoped lock updates while preserving omitted hashes and membership', () => {
    const packageRoot = createPackageRoot();
    const cursorPath = '.cursor/commands/in-scope.md';
    const claudePath = '.claude/commands/out-of-scope.md';
    const claudeHash = 'sha256:EXACT-CLAUDE-HASH';
    const dir = createProject(
      ['cursor', 'claude'],
      new Map([
        [cursorPath, sha256('remove me\n')],
        [claudePath, claudeHash],
      ]),
    );
    write(join(dir, cursorPath), 'remove me\n');
    write(join(dir, claudePath), 'preserve me byte-for-byte\n');
    const yamlBefore = readFileSync(join(dir, 'specline/platforms.yaml'));
    const claudeBefore = readFileSync(join(dir, claudePath));

    const result = runSync(dir, { platforms: ['cursor'], packageRoot });

    assert.ok(result.plan.some(
      (item) => item.path === cursorPath && item.type === 'UPSTREAM_REMOVED',
    ));
    assert.ok(!existsSync(join(dir, cursorPath)));
    assert.ok(readFileSync(join(dir, claudePath)).equals(claudeBefore));
    assert.ok(readFileSync(join(dir, 'specline/platforms.yaml')).equals(yamlBefore));
    const lock = readLockFile(dir);
    assert.deepStrictEqual(lock.platforms, ['cursor', 'claude']);
    assert.strictEqual(lock.files.get(claudePath), claudeHash);
    assert.ok(!lock.files.has(cursorPath));
  });

  it('allows an unconfigured target without changing configured membership', () => {
    const packageRoot = createPackageRoot();
    const dir = createProject(['cursor']);
    const yamlBefore = readFileSync(join(dir, 'specline/platforms.yaml'));

    runSync(dir, { platforms: ['claude'], packageRoot });

    assert.ok(existsSync(join(dir, '.claude/settings.json')));
    assert.ok(readFileSync(join(dir, 'specline/platforms.yaml')).equals(yamlBefore));
    assert.deepStrictEqual(readLockFile(dir).platforms, ['cursor']);
  });

  it('preserves v2 authoritative empty through a real sync without platform cleanup', () => {
    const packageRoot = createPackageRoot();
    const cursorPath = '.cursor/commands/preserved.md';
    const exactHash = 'sha256:UNCHANGED-OUTSIDE-EMPTY-SCOPE';
    const dir = createProject(null, new Map([[cursorPath, exactHash]]));
    mkdirSync(join(dir, '.cursor'), { recursive: true });
    write(join(dir, cursorPath), 'keep\n');

    runSync(dir, { packageRoot });

    const lockText = readFileSync(join(dir, 'specline/.specline-lock.yaml'), 'utf-8');
    const lock = readLockFile(dir);
    assert.match(lockText, /^platforms:\s*\[\]\s*$/m);
    assert.deepStrictEqual(lock.platforms, []);
    assert.strictEqual(lock.files.get(cursorPath), exactHash);
    assert.ok(existsSync(join(dir, cursorPath)));
    assert.ok(!existsSync(join(dir, 'specline/platforms.yaml')));
  });

  it('keeps protected paths and legacy Codex Skill files safe', () => {
    const packageRoot = createPackageRoot();
    const protectedPath = 'specline/changes/active/proposal.md';
    const legacySkill = '.codex/skills/legacy/SKILL.md';
    const protectedContent = '# user proposal\n';
    const legacyContent = '# legacy user skill\n';
    const dir = createProject(
      ['codex'],
      new Map([
        [protectedPath, sha256(protectedContent)],
        [legacySkill, sha256(legacyContent)],
      ]),
    );
    write(join(dir, protectedPath), protectedContent);
    write(join(dir, legacySkill), legacyContent);
    const protectedBefore = readFileSync(join(dir, protectedPath));
    const legacyBefore = readFileSync(join(dir, legacySkill));

    const result = runSync(dir, { platforms: ['codex'], packageRoot });

    assert.ok(!result.plan.some((item) => item.path === protectedPath));
    assert.ok(!result.plan.some((item) => item.path === legacySkill));
    assert.ok(readFileSync(join(dir, protectedPath)).equals(protectedBefore));
    assert.ok(readFileSync(join(dir, legacySkill)).equals(legacyBefore));
    const lock = readLockFile(dir);
    assert.strictEqual(lock.files.get(protectedPath), sha256(protectedContent));
    assert.ok(!lock.files.has(legacySkill));
  });
});
