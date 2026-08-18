import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BOOT_POLICY,
  ROLE_TOOL_NAMES,
  USER_SLASH_SKILLS,
  apply,
  arm,
  buildDrawioPatchEntry,
  bundleEnablesDrawio,
  inject,
  isSpeclineProject,
  name,
  parentWriteAllowed,
  plugin,
  resolveGateInvocation,
  resolveHumanGate,
  shouldInjectOrchestrator,
  shouldPromptInit,
  visualizeUsesMcp,
} from '../lib/index.js';

const EXPECTED_SLASH_IDS = [
  'pipeline',
  'quickfix',
  'explore',
  'knowledge',
  'propose',
  'apply-change',
  'archive-change',
  'visualize',
  'diagram',
  'init-web',
];

function makeTempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeSpeclineProject(dir) {
  mkdirSync(join(dir, 'specline'), { recursive: true });
  writeFileSync(
    join(dir, 'specline', 'config.yaml'),
    'pipeline:\n  human_gate_policy: minimal\n',
  );
}

function createFakeCtx(overrides = {}) {
  const slashes = new Map();
  const tools = new Map();
  const providers = [];
  const calls = [];
  return {
    slashes,
    toolsMap: tools,
    providers,
    calls,
    slash: {
      register(name, handler, meta) {
        calls.push({ type: 'slash.register', name });
        slashes.set(name, { handler, meta });
      },
    },
    skills: {
      provide(provider) {
        calls.push({ type: 'skills.provide' });
        providers.push(provider);
      },
    },
    tools: {
      register(name, tool) {
        calls.push({ type: 'tools.register', name });
        tools.set(name, tool);
      },
      has(name) {
        return tools.has(name);
      },
    },
    ...overrides,
  };
}

describe('contract re-exports', () => {
  it('re-exports the public surface from the bundle entry', () => {
    assert.equal(typeof isSpeclineProject, 'function');
    assert.equal(typeof resolveGateInvocation, 'function');
    assert.equal(typeof shouldPromptInit, 'function');
    assert.equal(typeof resolveHumanGate, 'function');
    assert.equal(typeof parentWriteAllowed, 'function');
    assert.equal(typeof shouldInjectOrchestrator, 'function');
    assert.equal(typeof buildDrawioPatchEntry, 'function');
    assert.equal(typeof bundleEnablesDrawio, 'function');
    assert.equal(typeof visualizeUsesMcp, 'function');
    assert.ok(Array.isArray(USER_SLASH_SKILLS));
    assert.ok(Array.isArray(ROLE_TOOL_NAMES));
  });

  it('normalizes USER_SLASH_SKILLS slash names to specline-* skill ids', () => {
    assert.equal(USER_SLASH_SKILLS.length, 10);
    const normalized = USER_SLASH_SKILLS.map((skill) => skill.slash.replace(/^\//, ''));
    assert.deepEqual(
      USER_SLASH_SKILLS.map((skill) => skill.id),
      EXPECTED_SLASH_IDS,
    );
    for (const id of EXPECTED_SLASH_IDS) {
      assert.ok(normalized.includes(`specline-${id}`), `missing specline-${id}`);
    }
    assert.ok(normalized.includes('specline-pipeline'));
    assert.equal(
      USER_SLASH_SKILLS.find((skill) => skill.id === 'pipeline').slash,
      '/specline-pipeline',
    );
  });

  it('keeps role-tool names as the ten specline_* tools', () => {
    assert.equal(ROLE_TOOL_NAMES.length, 10);
    assert.ok(ROLE_TOOL_NAMES.includes('specline_spec_creator'));
    assert.ok(ROLE_TOOL_NAMES.includes('specline_backend_dev'));
  });
});

describe('profile boot', () => {
  it('registers ten slashes and a SkillProvider, not role tools', () => {
    const ctx = createFakeCtx();
    const surface = apply(ctx);

    assert.equal(typeof plugin, 'function');
    assert.equal(ctx.slashes.size, 10);
    assert.deepEqual(
      [...ctx.slashes.keys()],
      USER_SLASH_SKILLS.map((skill) => skill.slash),
    );
    assert.equal(ctx.providers.length, 1);
    assert.equal(ctx.calls.some((call) => call.type === 'skills.provide'), true);

    const provider = ctx.providers[0];
    assert.equal(provider['user-invocable'], true);
    assert.equal(provider['disable-model-invocation'], true);
    assert.equal(provider.get('specline-pipeline').slash, '/specline-pipeline');
    assert.equal(provider.get('/specline-pipeline').id, 'pipeline');
    assert.equal(provider.get('specline-pipeline').skillDir, 'specline-pipeline');

    for (const name of ROLE_TOOL_NAMES) {
      assert.equal(ctx.tools.has(name), false);
      assert.equal(
        ctx.calls.some((call) => call.type === 'tools.register' && call.name === name),
        false,
      );
    }
    assert.equal(surface.roleToolsRegistered, false);
    assert.equal(BOOT_POLICY.injectUsingSpecline, false);
    assert.equal(BOOT_POLICY.registerPreset, false);
    assert.equal(
      ctx.calls.some((call) => String(call.type).includes('preset')),
      false,
    );
  });

  it('exports Cordis named inject so unwrapExports does not drop dependencies', () => {
    assert.equal(name, 'dsh-specline');
    assert.deepEqual([...inject], ['commands']);
    assert.equal(plugin, apply);
  });

  it('does not read ctx.config or other uninjected services on a Cordis-like proxy', () => {
    const registered = [];
    const target = {
      commands: {
        layers: {
          effect() {
            return () => {};
          },
        },
        register(definition) {
          if (!this || !this.layers) {
            throw new TypeError("Cannot read properties of undefined (reading 'layers')");
          }
          registered.push(definition);
          return this.layers.effect();
        },
      },
      effect(callback) {
        const result = callback();
        if (result && typeof result.next === 'function') {
          let step = result.next();
          while (!step.done) step = result.next();
        }
      },
    };
    const ctx = new Proxy(target, {
      get(inner, prop) {
        if (prop === 'commands' || prop === 'effect') return inner[prop];
        throw new Error(`cannot get property "${String(prop)}" without inject`);
      },
    });

    const surface = apply(ctx);
    assert.equal(registered.length, 10);
    assert.deepEqual(
      registered.map((item) => item.name),
      USER_SLASH_SKILLS.map((skill) => skill.skillDir),
    );
    assert.equal(registered[0].name, 'specline-pipeline');
    assert.match(registered[0].name, /^[a-z][a-z0-9_-]*$/);
    assert.equal(surface.roleToolsRegistered, false);
  });

  it('steers a follow-up turn instead of flashing a cancelled init prompt', async () => {
    const steered = [];
    const registered = [];
    const dir = makeTempDir('dsh-index-folder-only-');
    try {
      mkdirSync(join(dir, 'specline'), { recursive: true });
      const ctx = {
        commands: {
          register(definition) {
            registered.push(definition);
            return () => {};
          },
        },
      };
      apply(ctx);
      const explore = registered.find((item) => item.name === 'specline-explore');
      const outcome = await explore.handler({
        agent: {
          id: 'sess-web',
          session: { header: { cwd: dir } },
          steer(message) {
            steered.push(message);
          },
        },
        rawInput: '',
        signal: new AbortController().signal,
      });

      assert.equal(outcome.kind, 'success');
      assert.match(outcome.text, /已经找到 specline\//);
      assert.match(outcome.text, /config\.yaml/);
      assert.equal(outcome.text.includes('已取消初始化'), false);
      assert.equal(steered.length, 1);
      const text = steered[0]?.content?.[0]?.text ?? '';
      assert.match(text, /已经找到 specline\//);
      assert.match(text, /直接向用户说明/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('injects baked skill instructions when the project is initialized', async () => {
    const injected = [];
    const steered = [];
    const registered = [];
    const dir = makeTempDir('dsh-index-skill-inject-');
    try {
      writeSpeclineProject(dir);
      const ctx = {
        commands: {
          register(definition) {
            registered.push(definition);
            return () => {};
          },
        },
      };
      apply(ctx);
      const explore = registered.find((item) => item.name === 'specline-explore');
      const outcome = await explore.handler({
        agent: {
          id: 'sess-web',
          session: { header: { cwd: dir } },
          inject(message) {
            injected.push(message);
          },
          steer(message) {
            steered.push(message);
          },
        },
        rawInput: '先摸清登录流程',
        signal: new AbortController().signal,
      });

      assert.equal(outcome.kind, 'success');
      assert.equal(injected.length, 1);
      assert.equal(injected[0].source.kind, 'skill-invocation');
      assert.equal(injected[0].source.name, 'specline-explore');
      assert.equal(injected[0].source.form, 'instructions');
      assert.match(injected[0].content[0].text, /<skill_instructions>/);
      assert.match(injected[0].content[0].text, /思考伙伴/);
      assert.equal(steered.length, 1);
      assert.equal(steered[0].content[0].text, '先摸清登录流程');
      assert.equal(String(steered[0].content[0].text).includes('<skill_instructions>'), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('named plugin(ctx) is the same boot wiring as apply(ctx)', () => {
    const ctx = createFakeCtx();
    plugin(ctx);
    assert.equal(ctx.slashes.size, 10);
    assert.equal(ctx.providers.length, 1);
    for (const toolName of ROLE_TOOL_NAMES) {
      assert.equal(ctx.tools.has(toolName), false);
    }
  });
});

describe('slash callback', () => {
  it('takes the init path and does not arm when config.yaml is missing', async () => {
    const armCalls = [];
    const initCalls = [];
    const ctx = createFakeCtx({
      arm(input) {
        armCalls.push(input);
        return arm(input);
      },
      async handleUninitializedProject(input) {
        initCalls.push(input);
        const { handleUninitializedProject } = await import('../lib/project-init.js');
        return handleUninitializedProject(input);
      },
    });
    apply(ctx);

    const dir = makeTempDir('dsh-index-no-cfg-');
    try {
      assert.equal(isSpeclineProject(dir), false);
      const { handler } = ctx.slashes.get('/specline-pipeline');
      const result = await handler({ projectDir: dir, kind: 'web' });

      assert.equal(shouldPromptInit('web'), true);
      assert.equal(result.path, 'init');
      assert.equal(result.armed, false);
      assert.equal(result.prompted, true);
      assert.equal(armCalls.length, 0);
      assert.equal(initCalls.length, 1);
      assert.equal(initCalls[0].cwd, dir);
      for (const name of ROLE_TOOL_NAMES) {
        assert.equal(ctx.tools.has(name), false);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('calls arm when specline/config.yaml exists', async () => {
    const armCalls = [];
    const ctx = createFakeCtx({
      arm(input) {
        armCalls.push(input);
        return arm(input);
      },
    });
    apply(ctx);

    const dir = makeTempDir('dsh-index-cfg-');
    try {
      writeSpeclineProject(dir);
      const { handler } = ctx.slashes.get('/specline-pipeline');
      const session = { projectDir: dir, sessionId: 'sess-current' };
      const result = await handler(session);

      assert.equal(isSpeclineProject(dir), true);
      assert.equal(result.path, 'arm');
      assert.equal(result.armed, true);
      assert.equal(result.sessionId, 'sess-current');
      assert.deepEqual(result.steps, [
        'inject',
        'mountRoleTools',
        'enableWriteGuard',
        'bind',
      ]);
      assert.equal(armCalls.length, 1);
      assert.equal(armCalls[0].projectDir, dir);
      assert.equal(armCalls[0].sessionId, 'sess-current');
      assert.deepEqual(session.roleTools, [...ROLE_TOOL_NAMES]);
      assert.equal(session.injected, true);
      assert.equal(session.writeGuard, true);
      assert.equal(session.bound, true);
      for (const name of ROLE_TOOL_NAMES) {
        assert.equal(ctx.tools.has(name), false);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('headless missing config only errors and never arms', async () => {
    const armCalls = [];
    const ctx = createFakeCtx({
      kind: 'headless',
      arm(input) {
        armCalls.push(input);
        return arm(input);
      },
    });
    apply(ctx);

    const dir = makeTempDir('dsh-index-headless-');
    try {
      const { handler } = ctx.slashes.get('/specline-quickfix');
      const result = await handler({ projectDir: dir });
      assert.equal(shouldPromptInit('headless'), false);
      assert.equal(result.path, 'init');
      assert.equal(result.armed, false);
      assert.equal(result.prompted, false);
      assert.ok(result.error);
      assert.equal(armCalls.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
