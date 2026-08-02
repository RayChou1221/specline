import { strict as assert } from 'node:assert';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  pathBelongsToAnyPlatform,
  pathBelongsToPlatform,
  pathIsInSyncScope,
  pathIsSharedManaged,
  validateManagedRelativePath,
  readPlatformsYaml,
  readProjectPlatforms,
} from '../../lib/deploy.mjs';

const tempDirs = [];

function makeProject() {
  const projectDir = mkdtempSync(join(tmpdir(), 'specline-platforms-'));
  tempDirs.push(projectDir);
  return projectDir;
}

function writeYaml(projectDir, body) {
  mkdirSync(join(projectDir, 'specline'), { recursive: true });
  writeFileSync(join(projectDir, 'specline', 'platforms.yaml'), body);
}

function writeLock(projectDir, body) {
  mkdirSync(join(projectDir, 'specline'), { recursive: true });
  writeFileSync(join(projectDir, 'specline', '.specline-lock.yaml'), body);
}

function addFalsePositivePlatformPaths(projectDir) {
  for (const rel of ['.claude', '.codex', '.agents/skills', '.opencode']) {
    mkdirSync(join(projectDir, rel), { recursive: true });
  }
  writeFileSync(join(projectDir, 'opencode.json'), '{}\n');
}

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop(), { recursive: true, force: true });
});

describe('configured platform resolution', () => {
  it('distinguishes missing, block-list, and explicit-empty YAML', () => {
    const projectDir = makeProject();
    assert.equal(readPlatformsYaml(projectDir), null);

    writeYaml(projectDir, 'platforms:\n  - claude\n  - cursor\n');
    assert.deepEqual(readPlatformsYaml(projectDir), ['claude', 'cursor']);

    writeYaml(projectDir, 'platforms: []\n');
    assert.deepEqual(readPlatformsYaml(projectDir), []);
  });

  it('uses YAML as the first authoritative source without directory union', () => {
    const projectDir = makeProject();
    addFalsePositivePlatformPaths(projectDir);
    writeLock(projectDir, 'schema: 2\nplatforms: ["codex", "opencode"]\nfiles:\n');

    writeYaml(projectDir, 'platforms:\n  - cursor\n');
    assert.deepEqual(readProjectPlatforms(projectDir), ['cursor']);

    writeYaml(projectDir, 'platforms: []\n');
    assert.deepEqual(readProjectPlatforms(projectDir), []);
  });

  it('uses a v2 lock list or empty list when YAML is missing', () => {
    const projectDir = makeProject();
    addFalsePositivePlatformPaths(projectDir);

    writeLock(projectDir, 'schema: 2\nplatforms: ["claude"]\nfiles:\n');
    assert.deepEqual(readProjectPlatforms(projectDir), ['claude']);

    writeLock(projectDir, 'schema: 2\nplatforms: []\nfiles:\n');
    assert.deepEqual(readProjectPlatforms(projectDir), []);
  });

  it('uses legacy detection only without authoritative metadata', () => {
    const legacyProject = makeProject();
    mkdirSync(join(legacyProject, '.claude'), { recursive: true });
    mkdirSync(join(legacyProject, '.agents', 'skills'), { recursive: true });
    assert.deepEqual(readProjectPlatforms(legacyProject), ['claude', 'codex']);

    const emptyProject = makeProject();
    assert.deepEqual(readProjectPlatforms(emptyProject), ['cursor']);
  });
});

describe('platform path scope', () => {
  it('classifies platform-owned and shared managed paths', () => {
    assert.equal(pathBelongsToPlatform('.cursor/skills/a/SKILL.md', 'cursor'), true);
    assert.equal(pathBelongsToPlatform('.agents/skills/a/SKILL.md', 'codex'), true);
    assert.equal(pathBelongsToPlatform('opencode.json', 'opencode'), true);
    assert.equal(pathBelongsToPlatform('opencode.json.backup', 'opencode'), false);
    assert.equal(pathBelongsToAnyPlatform('.claude/settings.json'), true);
    assert.equal(pathBelongsToAnyPlatform('specline/bin/gate.sh'), false);
    assert.equal(pathIsSharedManaged('specline/bin/gate.sh'), true);
    assert.equal(pathIsSharedManaged('specline/config.yaml'), true);
    assert.equal(pathIsSharedManaged('specline/templates/execution-contract.md'), true);
    assert.equal(pathIsSharedManaged('specline/changes/user.md'), false);
  });

  it('includes shared paths and requested platforms only', () => {
    assert.equal(pathIsInSyncScope('specline/bin/gate.sh', []), true);
    assert.equal(pathIsInSyncScope('.claude/settings.json', []), false);
    assert.equal(pathIsInSyncScope('.claude/settings.json', ['claude']), true);
    assert.equal(pathIsInSyncScope('.cursor/hooks.json', ['claude']), false);
    assert.equal(pathIsInSyncScope('unknown/user-file', ['cursor']), false);
  });

  it('validates canonical platform and shared managed paths', () => {
    const projectDir = makeProject();
    mkdirSync(join(projectDir, '.cursor', 'skills', 'a'), { recursive: true });
    mkdirSync(join(projectDir, 'specline', 'bin'), { recursive: true });
    writeFileSync(join(projectDir, '.cursor', 'skills', 'a', 'SKILL.md'), '# skill\n');
    writeFileSync(join(projectDir, 'specline', 'bin', 'gate.sh'), '#!/bin/sh\n');
    assert.equal(
      validateManagedRelativePath(projectDir, '.cursor/skills/a/SKILL.md'),
      '.cursor/skills/a/SKILL.md',
    );
    assert.equal(
      validateManagedRelativePath(projectDir, 'specline/bin/gate.sh'),
      'specline/bin/gate.sh',
    );
    assert.equal(pathBelongsToPlatform('.cursor/hooks.json', 'cursor', projectDir), true);
    assert.equal(pathIsSharedManaged('specline/config.yaml', projectDir), true);
  });

  it('accepts a canonicalized projectDir and missing leaves under normal ancestors', () => {
    const container = makeProject();
    const projectDir = join(container, 'actual-project');
    const projectAlias = join(container, 'project-alias');
    mkdirSync(join(projectDir, '.cursor'), { recursive: true });
    symlinkSync(projectDir, projectAlias, 'dir');

    assert.equal(
      validateManagedRelativePath(projectAlias, '.cursor/missing/leaf.md'),
      '.cursor/missing/leaf.md',
    );
    assert.equal(pathIsInSyncScope('.cursor/missing/leaf.md', ['cursor'], projectAlias), true);
  });

  it('rejects symlinked platform and shared ancestors, including internal links', () => {
    const projectDir = makeProject();
    const externalPlatform = makeProject();
    const externalShared = makeProject();
    mkdirSync(join(projectDir, 'specline'), { recursive: true });
    mkdirSync(join(projectDir, 'internal-target'), { recursive: true });
    symlinkSync(externalPlatform, join(projectDir, '.cursor'), 'dir');
    symlinkSync(externalShared, join(projectDir, 'specline', 'bin'), 'dir');
    symlinkSync(join(projectDir, 'internal-target'), join(projectDir, '.claude'), 'dir');

    for (const [key, platforms] of [
      ['.cursor/victim.md', ['cursor']],
      ['specline/bin/victim.md', []],
      ['.claude/missing.md', ['claude']],
    ]) {
      assert.equal(validateManagedRelativePath(projectDir, key), null, key);
      assert.equal(pathIsInSyncScope(key, platforms, projectDir), false, key);
    }
  });

  it('rejects malicious platform, shared, absolute, and separator-variant keys', () => {
    const projectDir = makeProject();
    const malicious = [
      '.cursor/../../victim',
      'specline/bin/../../../victim',
      '.claude/./settings.json',
      'specline//bin/gate.sh',
      '.',
      '..',
      '.cursor\\..\\..\\victim',
      'specline\\bin\\..\\..\\victim',
      '/tmp/victim',
      'C:\\tmp\\victim',
      '\\\\server\\share\\victim',
      '',
    ];

    for (const key of malicious) {
      assert.equal(validateManagedRelativePath(projectDir, key), null, key);
      assert.equal(pathBelongsToAnyPlatform(key, projectDir), false, key);
      assert.equal(pathIsSharedManaged(key, projectDir), false, key);
      assert.equal(pathIsInSyncScope(key, ['cursor', 'claude', 'codex', 'opencode'], projectDir), false, key);
    }
  });
});
