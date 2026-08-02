/**
 * Cross-platform sync — integration tests (black-box, Spec-driven)
 *
 * Covers Scenarios from:
 *   - Requirement: Sync 向后兼容
 *   - Requirement: Lock File V2 (v1→v2 migration)
 *   - Requirement: Hook 精简 (用户自定义 hook 保留)
 *   - Requirement: 错误与边界处理 (lock 损坏, 旧 gate 文件)
 */
import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  appendFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(PROJECT_ROOT, 'cli.mjs');
const FIXTURE_DIR = join(PROJECT_ROOT, 'tests', 'fixtures');
const tempDirs = new Set();

function run(args, opts = {}) {
  const r = spawnSync('node', [CLI, ...args], {
    cwd: opts.cwd || PROJECT_ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
    env: { ...process.env, ...(opts.env || {}) },
  });
  return {
    out: ((r.stdout || '') + (r.stderr || '')).trim(),
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
    code: r.status ?? 1,
  };
}

function tmpProject() {
  const dir = mkdtempSync(join(tmpdir(), 'specline-sync-'));
  tempDirs.add(dir);
  return dir;
}

function initProject(platform = 'cursor') {
  const dir = tmpProject();
  const r = run(['init', dir, '--platform', platform], { env: { CI: '1' } });
  assert.strictEqual(r.code, 0, `init failed: ${r.out}`);
  return dir;
}

function sha256(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function addLockedFile(dir, relativePath, content, hash = sha256(content)) {
  const filePath = join(dir, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
  const lockPath = join(dir, 'specline', '.specline-lock.yaml');
  appendFileSync(lockPath, `  ${relativePath}: ${hash}\n`);
  return { filePath, hash, lockPath };
}

function lockHasExactEntry(lockText, relativePath, hash) {
  return lockText.split('\n').some((line) => line.trim() === `${relativePath}: ${hash}`);
}

function snapshotTree(root) {
  const result = new Map();
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      const relativePath = fullPath.slice(root.length + 1);
      if (entry.isDirectory()) {
        result.set(`${relativePath}/`, '<directory>');
        visit(fullPath);
      } else {
        result.set(relativePath, readFileSync(fullPath));
      }
    }
  }
  visit(root);
  return result;
}

function assertTreeEqual(actual, expected, message) {
  assert.deepStrictEqual([...actual.keys()].sort(), [...expected.keys()].sort(), `${message}: paths`);
  for (const [path, expectedValue] of expected) {
    const actualValue = actual.get(path);
    if (Buffer.isBuffer(expectedValue)) {
      assert.ok(Buffer.isBuffer(actualValue) && actualValue.equals(expectedValue), `${message}: ${path}`);
    } else {
      assert.strictEqual(actualValue, expectedValue, `${message}: ${path}`);
    }
  }
}

function assertPlatformError(args, expectedPattern) {
  const dir = tmpProject();
  const before = snapshotTree(dir);
  const commandArgs = args.map((arg) => arg === '$PROJECT' ? dir : arg);
  if (!args.includes('$PROJECT')) commandArgs.push(dir);
  const r = run(commandArgs, { cwd: dir, env: { CI: '1' } });
  assert.notStrictEqual(r.code, 0, `command should fail: ${r.out}`);
  assert.match(r.out, expectedPattern);
  assertTreeEqual(snapshotTree(dir), before, 'invalid platform arguments must not write state');
}

after(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Requirement: Sync 向后兼容
// ---------------------------------------------------------------------------

describe('Sync 向后兼容', () => {
  it('Scenario: 活跃 pipeline 状态不变', () => {
    const dir = initProject();

    const changesDir = join(dir, 'specline', 'changes', 'foo');
    mkdirSync(changesDir, { recursive: true });
    const pipelineState = { stage: 'coding', tasks: [{ id: 1, status: 'in_progress' }] };
    const pipelinePath = join(changesDir, '.pipeline-state.json');
    writeFileSync(pipelinePath, JSON.stringify(pipelineState, null, 2));
    const before = readFileSync(pipelinePath, 'utf-8');

    const r = run(['sync', dir], { env: { CI: '1' } });
    assert.strictEqual(r.code, 0, r.out);

    const after = readFileSync(pipelinePath, 'utf-8');
    assert.strictEqual(after, before, '.pipeline-state.json should be byte-identical');
  });

  it('Scenario: Spec 工件不被 sync 触碰', () => {
    const dir = initProject();

    const specDir = join(dir, 'specline', 'specs', 'my-spec');
    mkdirSync(specDir, { recursive: true });
    const specContent = '# My Spec\n\nThis is a user spec.\n';
    writeFileSync(join(specDir, 'spec.md'), specContent);

    const changeDir = join(dir, 'specline', 'changes', 'my-change');
    mkdirSync(changeDir, { recursive: true });
    const proposalContent = '# Proposal\n\nUser proposal.\n';
    writeFileSync(join(changeDir, 'proposal.md'), proposalContent);

    const r = run(['sync', dir], { env: { CI: '1' } });
    assert.strictEqual(r.code, 0, r.out);

    assert.strictEqual(
      readFileSync(join(specDir, 'spec.md'), 'utf-8'),
      specContent,
      'spec.md unchanged',
    );
    assert.strictEqual(
      readFileSync(join(changeDir, 'proposal.md'), 'utf-8'),
      proposalContent,
      'proposal.md unchanged',
    );
  });

  it('Scenario: MODIFIED_ONLY 的 skill 不被强制覆盖', () => {
    const dir = initProject('cursor');

    const skillsDir = join(dir, '.cursor', 'skills');
    if (!existsSync(skillsDir)) return;

    const skillDirs = readdirSync(skillsDir).filter((d) => {
      try { return statSync(join(skillsDir, d)).isDirectory(); } catch { return false; }
    });

    const pipelineDir = skillDirs.find((d) => d.includes('pipeline'));
    if (!pipelineDir) return;

    const skillPath = join(skillsDir, pipelineDir, 'SKILL.md');
    const original = readFileSync(skillPath, 'utf-8');
    const modified = original + '\n<!-- user customization -->\n';
    writeFileSync(skillPath, modified);

    const r = run(['sync', dir], { env: { CI: '1' } });
    assert.strictEqual(r.code, 0, r.out);

    const afterSync = readFileSync(skillPath, 'utf-8');
    assert.strictEqual(
      afterSync,
      modified,
      'User-modified skill content should be preserved byte-for-byte',
    );
    assert.match(
      r.out,
      /已跳过（本地修改）/,
      `Should report the documented local-modification summary. Output: ${r.out.slice(0, 300)}`,
    );
  });

  it('Scenario: sync 后旧 hook 脚本被清理', () => {
    const dir = initProject('cursor');

    const legacyHooks = [
      'specline-phase-guard.sh',
      'specline-agent-guard.sh',
      'specline-reminder.sh',
      'specline-auto-format.sh',
    ];
    const hooksDir = join(dir, '.cursor', 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    const legacyHookContent = '#!/bin/bash\nexit 0\n';
    for (const hook of legacyHooks) {
      writeFileSync(join(hooksDir, hook), legacyHookContent);
    }

    const lockPath = join(dir, 'specline', '.specline-lock.yaml');
    if (existsSync(lockPath)) {
      let lock = readFileSync(lockPath, 'utf-8');
      for (const hook of legacyHooks) {
        lock += `  .cursor/hooks/${hook}: ${sha256(legacyHookContent)}\n`;
      }
      writeFileSync(lockPath, lock);
    }

    const r = run(['sync', dir], { env: { CI: '1' } });
    assert.strictEqual(r.code, 0, r.out);

    for (const hook of legacyHooks) {
      assert.ok(
        !existsSync(join(hooksDir, hook)),
        `${hook} should be removed after sync`,
      );
    }
  });

  it('Scenario: 旧 gate 文件标记 UPSTREAM_REMOVED', () => {
    const dir = initProject('cursor');

    const oldGatePath = join(dir, '.cursor', 'hooks', 'specline-pipeline-gate.sh');
    mkdirSync(dirname(oldGatePath), { recursive: true });
    const oldGateContent = '#!/bin/bash\nexit 0\n';
    writeFileSync(oldGatePath, oldGateContent);

    const lockPath = join(dir, 'specline', '.specline-lock.yaml');
    if (existsSync(lockPath)) {
      appendFileSync(
        lockPath,
        `  .cursor/hooks/specline-pipeline-gate.sh: ${sha256(oldGateContent)}\n`,
      );
    }

    const r = run(['sync', dir], { env: { CI: '1' } });
    assert.strictEqual(r.code, 0, r.out);

    assert.ok(
      !existsSync(oldGatePath),
      'Old gate script in .cursor/hooks/ should be removed',
    );
  });

  it('Scenario: 上游已移除的 scope 内旧 gate 文件被清理', () => {
    const dir = initProject('cursor');

    const relativeGatePath = '.cursor/hooks/specline-pipeline-gate.sh';
    const oldGatePath = join(dir, relativeGatePath);
    mkdirSync(dirname(oldGatePath), { recursive: true });
    const oldGateContent = '#!/bin/bash\n# legacy gate\nexit 0\n';
    writeFileSync(oldGatePath, oldGateContent);

    const lockPath = join(dir, 'specline', '.specline-lock.yaml');
    if (existsSync(lockPath)) {
      appendFileSync(
        lockPath,
        `  ${relativeGatePath}: ${sha256(oldGateContent)}\n`,
      );
    }

    const r = run(['sync', dir], { env: { CI: '1' } });
    assert.strictEqual(r.code, 0, r.out);

    assert.ok(!existsSync(oldGatePath), 'In-scope upstream-removed gate file should be deleted');
    assert.ok(
      !readFileSync(lockPath, 'utf-8').includes(relativeGatePath),
      'Removed gate file should also be removed from the lock',
    );
    assert.match(
      r.out,
      /(上游.*移除|UPSTREAM_REMOVED)/i,
      `Should report upstream removal. Output: ${r.out.slice(0, 300)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Requirement: Hook 精简 (sync path)
// ---------------------------------------------------------------------------

describe('Hook 精简 (sync)', () => {
  it('Scenario: 用户自定义 hook 保留', () => {
    const dir = initProject('cursor');

    const hooksPath = join(dir, '.cursor', 'hooks.json');
    const hooks = JSON.parse(readFileSync(hooksPath, 'utf-8'));

    hooks['customUserHook'] = [
      {
        event: 'customUserHook',
        command: 'echo user-hook',
      },
    ];
    writeFileSync(hooksPath, JSON.stringify(hooks, null, 2));

    const r = run(['sync', dir], { env: { CI: '1' } });
    assert.strictEqual(r.code, 0, r.out);

    const afterHooks = JSON.parse(readFileSync(hooksPath, 'utf-8'));
    assert.ok(
      afterHooks.customUserHook,
      'User custom hook should be preserved after sync',
    );
  });
});

// ---------------------------------------------------------------------------
// Requirement: Lock File V2 (v1 migration via sync)
// ---------------------------------------------------------------------------

describe('Lock File V2 (sync migration)', () => {
  it('Scenario: v1 lock 自动迁移到 v2', () => {
    const dir = initProject('cursor');
    const lockPath = join(dir, 'specline', '.specline-lock.yaml');

    const fixtureV1 = join(FIXTURE_DIR, 'lock-v1.yaml');
    if (existsSync(fixtureV1)) {
      copyFileSync(fixtureV1, lockPath);
    } else {
      writeFileSync(
        lockPath,
        [
          'version: "1.4.0"',
          'files:',
          '  .cursor/skills/specline-pipeline/SKILL.md: sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
          '  .cursor/hooks/specline-pipeline-gate.sh: sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          '',
        ].join('\n'),
      );
    }

    const r = run(['sync', dir], { env: { CI: '1' } });
    assert.strictEqual(r.code, 0, r.out);

    const lock = readFileSync(lockPath, 'utf-8');
    assert.match(lock, /schema:\s*2/, 'Lock should be upgraded to schema 2');
    assert.match(lock, /platforms:/, 'Lock should have platforms field');
    assert.match(lock, /cursor/, 'Lock should infer cursor platform');
  });
});

// ---------------------------------------------------------------------------
// Requirement: 错误与边界处理 (sync-specific)
// ---------------------------------------------------------------------------

describe('错误与边界处理 (sync)', () => {
  it('Scenario: Lock 文件损坏', () => {
    const dir = initProject('cursor');
    const lockPath = join(dir, 'specline', '.specline-lock.yaml');

    writeFileSync(lockPath, '{{{{invalid yaml content::::');

    const r = run(['sync', dir], { env: { CI: '1' } });
    assert.notStrictEqual(r.code, 0, 'sync should fail with corrupt lock');
    assert.ok(
      r.out.toLowerCase().includes('lock') ||
        r.out.toLowerCase().includes('损坏') ||
        r.out.toLowerCase().includes('corrupt') ||
        r.out.includes('--force'),
      `Should hint about lock corruption or --force. Output: ${r.out.slice(0, 300)}`,
    );
  });

  it('Scenario: sync --dry-run 不修改任何文件', () => {
    const dir = initProject('cursor');
    const lockPath = join(dir, 'specline', '.specline-lock.yaml');
    const lockBefore = readFileSync(lockPath, 'utf-8');

    const r = run(['sync', '--dry-run', dir], { env: { CI: '1' } });
    assert.strictEqual(r.code, 0, r.out);

    const lockAfter = readFileSync(lockPath, 'utf-8');
    assert.strictEqual(lockAfter, lockBefore, 'Lock file unchanged after --dry-run');
  });

  it('Scenario: sync --platform 过滤仅同步指定平台', () => {
    const dir = tmpProject();
    run(['init', dir, '--platform', 'cursor,claude'], { env: { CI: '1' } });

    const claudeSettings = join(dir, '.claude', 'settings.json');
    const settingsBefore = existsSync(claudeSettings)
      ? readFileSync(claudeSettings, 'utf-8')
      : null;

    const r = run(['sync', '--platform', 'cursor', dir], { env: { CI: '1' } });
    assert.strictEqual(r.code, 0, r.out);

    if (settingsBefore !== null) {
      assert.strictEqual(
        readFileSync(claudeSettings, 'utf-8'),
        settingsBefore,
        'Claude settings unchanged when syncing only cursor',
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Change: fix-sync-platform-scope — public CLI contracts
// ---------------------------------------------------------------------------

describe('configured platform authority and default sync scope', () => {
  it('Scenario: YAML 阻止 false-positive 平台目录误激活', () => {
    const dir = initProject('cursor');
    const yamlPath = join(dir, 'specline', 'platforms.yaml');
    writeFileSync(yamlPath, 'platforms:\n  - cursor\n');
    for (const path of ['.claude/skills', '.codex', '.agents/skills', '.opencode']) {
      mkdirSync(join(dir, path), { recursive: true });
    }
    writeFileSync(join(dir, 'opencode.json'), '{}\n');

    const omitted = [
      addLockedFile(dir, '.claude/commands/false-positive.md', 'claude sentinel\n'),
      addLockedFile(dir, '.codex/false-positive.md', 'codex sentinel\n'),
      addLockedFile(dir, '.agents/skills/false-positive/SKILL.md', 'agents sentinel\n'),
      addLockedFile(dir, '.opencode/false-positive.md', 'opencode sentinel\n'),
    ];
    const r = run(['sync', dir], { env: { CI: '1' } });
    assert.strictEqual(r.code, 0, r.out);
    const lockAfter = readFileSync(omitted[0].lockPath, 'utf-8');
    for (const item of omitted) {
      assert.ok(existsSync(item.filePath), `${item.filePath} is outside configured scope`);
      assert.ok(lockHasExactEntry(lockAfter, item.filePath.slice(dir.length + 1), item.hash));
      assert.ok(!r.out.includes(item.filePath.slice(dir.length + 1)));
    }
  });

  it('Scenario: 默认 sync 同步全部 configured platforms', () => {
    const dir = initProject('cursor,claude');
    const cursor = addLockedFile(dir, '.cursor/commands/default-all-cursor.md', 'cursor baseline\n');
    const claude = addLockedFile(dir, '.claude/commands/default-all-claude.md', 'claude baseline\n');
    const r = run(['sync', dir], { env: { CI: '1' } });
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(!existsSync(cursor.filePath), 'default sync should process configured Cursor');
    assert.ok(!existsSync(claude.filePath), 'default sync should process configured Claude');
    assert.match(r.out, /(上游.*移除|UPSTREAM_REMOVED)/i);
  });

  it('Scenario: YAML authoritative empty 仅同步共享文件', () => {
    const dir = initProject('none');
    for (const path of ['.cursor', '.claude/skills', '.codex', '.agents/skills', '.opencode']) {
      mkdirSync(join(dir, path), { recursive: true });
    }
    writeFileSync(join(dir, 'opencode.json'), '{}\n');
    const cursor = addLockedFile(dir, '.cursor/commands/empty-yaml-sentinel.md', 'keep\n');
    const r = run(['sync', dir], { env: { CI: '1' } });
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(existsSync(cursor.filePath));
    assert.ok(lockHasExactEntry(readFileSync(cursor.lockPath, 'utf-8'), '.cursor/commands/empty-yaml-sentinel.md', cursor.hash));
    assert.ok(!r.out.includes('.cursor/commands/empty-yaml-sentinel.md'));
  });

  it('Scenario: YAML 缺失时 v2 lock platforms 是唯一 authority', () => {
    const dir = initProject('claude,codex');
    rmSync(join(dir, 'specline', 'platforms.yaml'));
    mkdirSync(join(dir, '.cursor'), { recursive: true });
    mkdirSync(join(dir, '.opencode'), { recursive: true });
    const claude = addLockedFile(dir, '.claude/commands/v2-claude.md', 'claude\n');
    const codex = addLockedFile(dir, '.agents/skills/v2-codex/SKILL.md', 'codex\n');
    const cursor = addLockedFile(dir, '.cursor/commands/v2-cursor-omitted.md', 'cursor\n');
    const r = run(['sync', dir], { env: { CI: '1' } });
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(!existsSync(claude.filePath));
    assert.ok(!existsSync(codex.filePath));
    assert.ok(existsSync(cursor.filePath));
    assert.ok(!r.out.includes('.cursor/commands/v2-cursor-omitted.md'));
  });

  it('Scenario: YAML 缺失时 v2 lock platforms: [] 保持 authority', () => {
    const dir = initProject('none');
    const yamlPath = join(dir, 'specline', 'platforms.yaml');
    rmSync(yamlPath);
    mkdirSync(join(dir, '.cursor'), { recursive: true });
    mkdirSync(join(dir, '.claude'), { recursive: true });
    const cursor = addLockedFile(dir, '.cursor/commands/v2-empty-sentinel.md', 'keep\n');
    const r = run(['sync', dir], { env: { CI: '1' } });
    assert.strictEqual(r.code, 0, r.out);
    const lockAfter = readFileSync(cursor.lockPath, 'utf-8');
    assert.match(lockAfter, /^schema:\s*2$/m);
    assert.match(lockAfter, /^platforms:\s*\[\]\s*$/m);
    assert.ok(existsSync(cursor.filePath));
    assert.ok(lockHasExactEntry(lockAfter, '.cursor/commands/v2-empty-sentinel.md', cursor.hash));
  });
});

describe('scoped sync state and removal boundaries', () => {
  it('Scenario: scoped sync 精确保留 scope 外文件、lock hash 和 membership', () => {
    const dir = initProject('cursor,claude');
    const yamlPath = join(dir, 'specline', 'platforms.yaml');
    const yamlBefore = readFileSync(yamlPath, 'utf-8');
    const oldHash = `sha256:${'7a'.repeat(32)}`;
    const claude = addLockedFile(
      dir,
      '.claude/commands/scoped-preservation.md',
      'locally modified bytes must remain exact\n',
      oldHash,
    );
    const fileBefore = readFileSync(claude.filePath);

    const r = run(['sync', '--platform', 'cursor', dir], { env: { CI: '1' } });
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(readFileSync(claude.filePath).equals(fileBefore));
    const lockAfter = readFileSync(claude.lockPath, 'utf-8');
    assert.ok(lockHasExactEntry(lockAfter, '.claude/commands/scoped-preservation.md', oldHash));
    assert.strictEqual(readFileSync(yamlPath, 'utf-8'), yamlBefore);
    assert.match(lockAfter, /platforms:.*cursor.*claude/);
    assert.ok(!r.out.includes('.claude/commands/scoped-preservation.md'));
  });

  it('Scenario: UPSTREAM_REMOVED 仅清理当前 target platform', () => {
    const dir = initProject('cursor,claude');
    const cursor = addLockedFile(dir, '.cursor/commands/in-scope-removed.md', 'cursor baseline\n');
    const claude = addLockedFile(dir, '.claude/commands/out-of-scope-removed.md', 'claude baseline\n');
    const r = run(['sync', '--platform', 'cursor', dir], { env: { CI: '1' } });
    assert.strictEqual(r.code, 0, r.out);
    const lockAfter = readFileSync(cursor.lockPath, 'utf-8');
    assert.ok(!existsSync(cursor.filePath), 'unmodified in-scope removed file should be deleted');
    assert.ok(!lockAfter.includes('.cursor/commands/in-scope-removed.md'));
    assert.match(r.out, /(上游.*移除|UPSTREAM_REMOVED)/i);
    assert.ok(existsSync(claude.filePath), 'out-of-scope removed file must remain');
    assert.ok(lockHasExactEntry(lockAfter, '.claude/commands/out-of-scope-removed.md', claude.hash));
    assert.ok(!r.out.includes('.claude/commands/out-of-scope-removed.md'));
  });

  it('Scenario: scoped dry-run 与真实 sync 使用同一 scope 且零修改', () => {
    const dir = initProject('cursor,claude');
    addLockedFile(dir, '.cursor/commands/dry-run-cursor.md', 'cursor\n');
    addLockedFile(dir, '.claude/commands/dry-run-claude.md', 'claude\n');
    const before = snapshotTree(dir);
    const r = run(['sync', '--dry-run', '--platform', 'cursor', dir], { env: { CI: '1' } });
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(r.out.includes('.cursor/commands/dry-run-cursor.md'));
    assert.ok(!r.out.includes('.claude/commands/dry-run-claude.md'));
    assertTreeEqual(snapshotTree(dir), before, 'scoped dry-run must be byte-for-byte immutable');
  });
});

describe('sync platform validation and legacy dry-run', () => {
  it('Scenario: sync --platform 缺值失败且零写入', () => {
    assertPlatformError(['sync', '$PROJECT', '--platform'], /--platform.*(值|value).*(cursor|claude|codex|opencode)/is);
  });

  it('Scenario: sync --platform invalid 失败且指出无效项', () => {
    assertPlatformError(['sync', '--platform', 'cursor,invalid'], /invalid.*(无效|invalid|支持|valid)/is);
  });

  it('Scenario: sync --platform none 被拒绝', () => {
    assertPlatformError(['sync', '--platform', 'none'], /none.*(不支持|不可|invalid|not supported)/is);
  });

  it('Scenario: init --platform none 保持兼容并记录 authoritative empty', () => {
    const dir = initProject('none');
    assert.match(readFileSync(join(dir, 'specline', 'platforms.yaml'), 'utf-8'), /platforms:\s*(?:\[\]\s*)?$/m);
    const lock = readFileSync(join(dir, 'specline', '.specline-lock.yaml'), 'utf-8');
    assert.match(lock, /^schema:\s*2$/m);
    assert.match(lock, /^platforms:\s*\[\]\s*$/m);
    for (const platformPath of ['.cursor', '.claude', '.agents', '.opencode']) {
      assert.ok(!existsSync(join(dir, platformPath)), `${platformPath} should not be deployed`);
    }
  });

  it('Scenario: no-lock legacy CLI dry-run 零创建并提示 migration', () => {
    const dir = tmpProject();
    writeFileSync(join(dir, '.specline-config.yaml'), 'version: "1"\n');
    const before = snapshotTree(dir);
    const r = run(['sync', '--dry-run', dir], { cwd: dir, env: { CI: '1' } });
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, /(legacy|旧版|迁移|migrat)/i);
    assertTreeEqual(snapshotTree(dir), before, 'legacy no-lock dry-run must create nothing');
    assert.ok(!existsSync(join(dir, 'specline', '.specline-lock.yaml')));
    assert.ok(!existsSync(join(dir, 'specline', 'platforms.yaml')));
  });
});
