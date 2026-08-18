import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ARM_STEPS, arm, isSpeclineProject } from '../lib/arming.js';

function makeTempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeSpeclineProject(dir) {
  mkdirSync(join(dir, 'specline'), { recursive: true });
  writeFileSync(join(dir, 'specline', 'config.yaml'), 'pipeline:\n  human_gate_policy: minimal\n');
}

function recordingActions() {
  const calls = [];
  return {
    calls,
    actions: {
      inject: (sessionId) => calls.push({ step: 'inject', sessionId }),
      mountRoleTools: (sessionId) => calls.push({ step: 'mountRoleTools', sessionId }),
      enableWriteGuard: (sessionId) => calls.push({ step: 'enableWriteGuard', sessionId }),
      bind: (sessionId) => calls.push({ step: 'bind', sessionId }),
    },
  };
}

describe('isSpeclineProject', () => {
  it('returns true when specline/config.yaml exists as a file', () => {
    const dir = makeTempDir('dsh-arm-project-');
    try {
      writeSpeclineProject(dir);
      assert.equal(isSpeclineProject(dir), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns false when specline/config.yaml is missing', () => {
    const dir = makeTempDir('dsh-arm-missing-');
    try {
      mkdirSync(join(dir, 'specline'), { recursive: true });
      assert.equal(isSpeclineProject(dir), false);
      assert.equal(isSpeclineProject(join(dir, 'no-such')), false);
      assert.equal(isSpeclineProject(''), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('inspectSpeclineProject and resolveSpeclineProjectDir', () => {
  it('reports a specline directory that is missing config.yaml', async () => {
    const { inspectSpeclineProject } = await import('../lib/arming.js');
    const dir = makeTempDir('dsh-arm-inspect-');
    try {
      mkdirSync(join(dir, 'specline'), { recursive: true });
      const inspection = inspectSpeclineProject(dir);
      assert.equal(inspection.hasSpeclineDir, true);
      assert.equal(inspection.hasConfig, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('walks up from a subdirectory to the repo with config.yaml', async () => {
    const { resolveSpeclineProjectDir } = await import('../lib/arming.js');
    const dir = makeTempDir('dsh-arm-walk-');
    try {
      writeSpeclineProject(dir);
      const nested = join(dir, 'apps', 'web');
      mkdirSync(nested, { recursive: true });
      assert.equal(resolveSpeclineProjectDir(nested), dir);
      assert.equal(resolveSpeclineProjectDir(dir), dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('arm', () => {
  it('refuses to arm when the directory is not a Specline project', () => {
    const dir = makeTempDir('dsh-arm-refuse-');
    const { calls, actions } = recordingActions();
    try {
      mkdirSync(join(dir, 'specline'), { recursive: true });
      const result = arm({
        projectDir: dir,
        sessionId: 'sess-current',
        actions,
      });
      assert.equal(result.armed, false);
      assert.equal(result.sessionId, null);
      assert.deepEqual(result.steps, []);
      assert.equal(result.reason, 'not-specline-project');
      assert.deepEqual(calls, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('injects, mounts role tools, enables write guard, and binds the current session', () => {
    const dir = makeTempDir('dsh-arm-ok-');
    const { calls, actions } = recordingActions();
    try {
      writeSpeclineProject(dir);
      const result = arm({
        projectDir: dir,
        sessionId: 'sess-current',
        actions,
      });
      assert.equal(result.armed, true);
      assert.equal(result.sessionId, 'sess-current');
      assert.deepEqual(result.steps, [...ARM_STEPS]);
      assert.deepEqual(
        calls.map((c) => c.step),
        ['inject', 'mountRoleTools', 'enableWriteGuard', 'bind'],
      );
      assert.ok(calls.every((c) => c.sessionId === 'sess-current'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not arm other sessions', () => {
    const dir = makeTempDir('dsh-arm-one-session-');
    const { calls, actions } = recordingActions();
    try {
      writeSpeclineProject(dir);
      arm({
        projectDir: dir,
        sessionId: 'sess-current',
        actions,
      });
      const ids = new Set(calls.map((c) => c.sessionId));
      assert.deepEqual([...ids], ['sess-current']);
      assert.equal(ids.has('sess-other'), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not create .dsh/skills', () => {
    const dir = makeTempDir('dsh-arm-no-skills-');
    try {
      writeSpeclineProject(dir);
      arm({
        projectDir: dir,
        sessionId: 'sess-current',
        actions: recordingActions().actions,
      });
      assert.equal(existsSync(join(dir, '.dsh', 'skills')), false);
      assert.equal(existsSync(join(dir, '.dsh')), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not write ~/.dsh progress', () => {
    const dir = makeTempDir('dsh-arm-no-home-');
    const home = makeTempDir('dsh-arm-home-');
    const prevHome = process.env.HOME;
    try {
      writeSpeclineProject(dir);
      process.env.HOME = home;
      arm({
        projectDir: dir,
        sessionId: 'sess-current',
        actions: recordingActions().actions,
      });
      assert.equal(existsSync(join(home, '.dsh')), false);
      assert.deepEqual(readdirSync(home), []);
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      rmSync(dir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});
