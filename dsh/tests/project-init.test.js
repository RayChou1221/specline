import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildInitInvocation,
  createDefaultInitRunner,
  describeInitPolicy,
  formatUninitCommandText,
  handleUninitializedProject,
  INIT_CLI,
  shouldPromptInit,
} from '../lib/project-init.js';

function makeTempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe('shouldPromptInit', () => {
  it('allows asking on web and forbids asking on headless', () => {
    assert.equal(shouldPromptInit('web'), true);
    assert.equal(shouldPromptInit('headless'), false);
    assert.deepEqual(describeInitPolicy('web'), {
      prompt: true,
      allowInit: true,
      autoInit: false,
    });
    assert.deepEqual(describeInitPolicy('headless'), {
      prompt: false,
      allowInit: false,
      autoInit: false,
    });
  });
});

describe('buildInitInvocation', () => {
  it('runs specline init --platform none and never passes dsh', () => {
    const invocation = buildInitInvocation();
    assert.equal(invocation.command, 'specline');
    assert.deepEqual(invocation.args, ['init', '--platform', 'none']);
    assert.equal(invocation.args.includes('dsh'), false);
    assert.equal(invocation.args.some((a) => String(a).includes('dsh')), false);
  });
});

describe('handleUninitializedProject', () => {
  it('web consent runs init in the repo cwd via the runner then allows arming', async () => {
    const cwd = makeTempDir('dsh-init-consent-');
    const calls = [];
    try {
      const result = await handleUninitializedProject({
        kind: 'web',
        cwd,
        ask: async () => true,
        runner: (invocation) => {
          calls.push(invocation);
          return { status: 0 };
        },
      });
      assert.equal(result.prompted, true);
      assert.equal(result.ranInit, true);
      assert.equal(result.shouldArm, true);
      assert.equal(result.wroteDirectories, false);
      assert.equal(result.error, null);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].command, 'specline');
      assert.deepEqual(calls[0].args, ['init', '--platform', 'none']);
      assert.equal(calls[0].cwd, cwd);
      assert.equal(calls[0].args.includes('dsh'), false);
      assert.equal(existsSync(join(cwd, 'specline')), false);
      assert.deepEqual(readdirSync(cwd), []);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('web refusal does not write directories, run init, or arm', async () => {
    const cwd = makeTempDir('dsh-init-refuse-');
    const calls = [];
    try {
      mkdirSync(join(cwd, 'keep-empty'), { recursive: true });
      const before = readdirSync(cwd);
      const result = await handleUninitializedProject({
        kind: 'web',
        cwd,
        ask: async () => false,
        runner: (invocation) => {
          calls.push(invocation);
          return { status: 0 };
        },
      });
      assert.equal(result.prompted, true);
      assert.equal(result.declined, true);
      assert.equal(result.ranInit, false);
      assert.equal(result.shouldArm, false);
      assert.equal(result.wroteDirectories, false);
      assert.equal(calls.length, 0);
      assert.deepEqual(readdirSync(cwd), before);
      assert.equal(existsSync(join(cwd, 'specline')), false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('headless only errors: no prompt, no init, no arming', async () => {
    const cwd = makeTempDir('dsh-init-headless-');
    let asked = false;
    const calls = [];
    try {
      const result = await handleUninitializedProject({
        kind: 'headless',
        cwd,
        ask: async () => {
          asked = true;
          return true;
        },
        runner: (invocation) => {
          calls.push(invocation);
          return { status: 0 };
        },
      });
      assert.equal(shouldPromptInit('headless'), false);
      assert.equal(result.prompted, false);
      assert.equal(result.ranInit, false);
      assert.equal(result.shouldArm, false);
      assert.equal(result.wroteDirectories, false);
      assert.ok(result.error);
      assert.equal(asked, false);
      assert.equal(calls.length, 0);
      assert.equal(existsSync(join(cwd, 'specline')), false);
      assert.deepEqual(readdirSync(cwd), []);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('failed init does not arm', async () => {
    const cwd = makeTempDir('dsh-init-fail-');
    try {
      const result = await handleUninitializedProject({
        kind: 'web',
        cwd,
        ask: () => true,
        runner: () => ({ status: 1 }),
      });
      assert.equal(result.ranInit, true);
      assert.equal(result.shouldArm, false);
      assert.equal(result.wroteDirectories, false);
      assert.ok(result.error);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('formatUninitCommandText', () => {
  it('tells the user how to init, with newlines so DSH can expand the command card', () => {
    const text = formatUninitCommandText({ cwd: '/tmp/app' });
    assert.match(text, /还不是 Specline 项目/);
    assert.match(text, /\/tmp\/app/);
    assert.ok(text.includes('\n'));
    assert.ok(text.includes(INIT_CLI));
    assert.equal(text.includes('dsh'), false);
  });

  it('explains a specline folder that is missing config.yaml', () => {
    const text = formatUninitCommandText({
      cwd: '/tmp/app',
      hasSpeclineDir: true,
    });
    assert.match(text, /已经找到 specline\//);
    assert.match(text, /config\.yaml/);
    assert.ok(text.includes(INIT_CLI));
    assert.equal(text.includes('已取消初始化'), false);
  });
});

describe('createDefaultInitRunner', () => {
  it('spawns specline init --platform none in the repo cwd', async () => {
    const calls = [];
    const runner = createDefaultInitRunner((command, args, options) => {
      calls.push({ command, args: [...args], cwd: options.cwd });
      return { status: 0 };
    });
    const result = await runner({
      command: 'specline',
      args: ['init', '--platform', 'none'],
      cwd: '/tmp/app',
    });
    assert.equal(result.status, 0);
    assert.deepEqual(calls, [{
      command: 'specline',
      args: ['init', '--platform', 'none'],
      cwd: '/tmp/app',
    }]);
  });
});
