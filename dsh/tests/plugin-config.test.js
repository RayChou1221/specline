import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_PLUGIN_CONFIG,
  PLUGIN_CONFIG_SCHEMA,
  canRunPipeline,
  readProjectCheckpointConfig,
  resolvePluginConfig,
} from '../lib/plugin-config.js';

const tempRoots = [];

function tempDir(prefix = 'dsh-plugin-config-') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function writeYaml(projectDir, body) {
  mkdirSync(join(projectDir, 'specline'), { recursive: true });
  writeFileSync(join(projectDir, 'specline', 'config.yaml'), body, 'utf8');
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    rmSync(root, { recursive: true, force: true });
  }
});

describe('plugin Config schema', () => {
  it('does not include human_gate_policy', () => {
    assert.equal('human_gate_policy' in PLUGIN_CONFIG_SCHEMA, false);
    assert.equal('humanGatePolicy' in PLUGIN_CONFIG_SCHEMA, false);
    assert.equal('human_gate_policy' in DEFAULT_PLUGIN_CONFIG, false);
    assert.deepEqual(
      Object.keys(PLUGIN_CONFIG_SCHEMA).sort(),
      ['gateViaCli', 'maxDepth', 'writeIntercept'],
    );
  });

  it('defaults write intercept on, maxDepth 1, and Gate via CLI', () => {
    assert.equal(PLUGIN_CONFIG_SCHEMA.writeIntercept.default, true);
    assert.equal(PLUGIN_CONFIG_SCHEMA.maxDepth.default, 1);
    assert.equal(PLUGIN_CONFIG_SCHEMA.gateViaCli.default, true);
    assert.deepEqual(DEFAULT_PLUGIN_CONFIG, {
      writeIntercept: true,
      maxDepth: 1,
      gateViaCli: true,
    });
    assert.deepEqual(resolvePluginConfig(), DEFAULT_PLUGIN_CONFIG);
    assert.deepEqual(resolvePluginConfig({}), DEFAULT_PLUGIN_CONFIG);
  });

  it('applies plugin overrides without copying project-strategy keys', () => {
    const resolved = resolvePluginConfig({
      writeIntercept: false,
      maxDepth: 2,
      gateViaCli: false,
      human_gate_policy: 'none',
      humanGatePolicy: 'full',
    });
    assert.deepEqual(resolved, {
      writeIntercept: false,
      maxDepth: 2,
      gateViaCli: false,
    });
    assert.equal('human_gate_policy' in resolved, false);
    assert.equal('humanGatePolicy' in resolved, false);
  });
});

describe('pipeline requires project specline/config.yaml', () => {
  it('rejects when specline/ is missing', () => {
    const projectDir = tempDir();
    assert.equal(canRunPipeline(projectDir), false);
    assert.throws(
      () => readProjectCheckpointConfig(projectDir),
      { name: 'MissingSpeclineProjectError' },
    );
  });

  it('rejects when specline/ exists but config.yaml does not', () => {
    const projectDir = tempDir();
    mkdirSync(join(projectDir, 'specline'));
    assert.equal(canRunPipeline(projectDir), false);
    assert.throws(
      () => readProjectCheckpointConfig(projectDir),
      { name: 'MissingSpeclineProjectError' },
    );
  });

  it('does not fill human_gate_policy from plugin Config when yaml is missing', () => {
    const projectDir = tempDir();
    assert.throws(
      () => readProjectCheckpointConfig(projectDir, {
        pluginConfig: { human_gate_policy: 'none', writeIntercept: true },
      }),
      { name: 'MissingSpeclineProjectError' },
    );
  });

  it('does not fill strategy from ~/.dsh/settings.yaml when yaml is missing', () => {
    const projectDir = tempDir();
    const dshHome = tempDir('dsh-home-');
    writeFileSync(
      join(dshHome, 'settings.yaml'),
      'pipeline:\n  human_gate_policy: none\n',
      'utf8',
    );
    assert.equal(canRunPipeline(projectDir), false);
    assert.throws(
      () => readProjectCheckpointConfig(projectDir, { dshHome }),
      { name: 'MissingSpeclineProjectError' },
    );
  });
});

describe('each checkpoint reads repo specline/config.yaml', () => {
  it('reads human_gate_policy and gate command/fallback from the project yaml', () => {
    const projectDir = tempDir();
    writeYaml(
      projectDir,
      [
        'pipeline:',
        '  human_gate_policy: minimal',
        'gate:',
        '  command: specline gate',
        '  fallback: specline/bin/gate.sh',
        '',
      ].join('\n'),
    );
    assert.equal(canRunPipeline(projectDir), true);
    assert.deepEqual(readProjectCheckpointConfig(projectDir), {
      pipeline: { human_gate_policy: 'minimal' },
      gate: {
        command: 'specline gate',
        fallback: 'specline/bin/gate.sh',
      },
    });
  });

  it('re-reads the file at each checkpoint instead of caching', () => {
    const projectDir = tempDir();
    writeYaml(projectDir, 'pipeline:\n  human_gate_policy: full\n');
    assert.equal(
      readProjectCheckpointConfig(projectDir).pipeline.human_gate_policy,
      'full',
    );
    writeYaml(projectDir, 'pipeline:\n  human_gate_policy: none\n');
    assert.equal(
      readProjectCheckpointConfig(projectDir).pipeline.human_gate_policy,
      'none',
    );
  });

  it('does not let plugin or profile config override project yaml', () => {
    const projectDir = tempDir();
    writeYaml(
      projectDir,
      [
        'pipeline:',
        '  human_gate_policy: full',
        'gate:',
        '  command: specline gate',
        '  fallback: specline/bin/gate.sh',
        '',
      ].join('\n'),
    );
    const dshHome = tempDir('dsh-home-');
    writeFileSync(
      join(dshHome, 'settings.yaml'),
      [
        'pipeline:',
        '  human_gate_policy: none',
        'gate:',
        '  command: echo hijacked',
        '',
      ].join('\n'),
      'utf8',
    );
    const checkpoint = readProjectCheckpointConfig(projectDir, {
      dshHome,
      pluginConfig: {
        human_gate_policy: 'none',
        gateViaCli: false,
      },
      profileConfig: {
        pipeline: { human_gate_policy: 'minimal' },
        gate: { command: 'profile-gate', fallback: 'profile-fallback' },
      },
    });
    assert.deepEqual(checkpoint, {
      pipeline: { human_gate_policy: 'full' },
      gate: {
        command: 'specline gate',
        fallback: 'specline/bin/gate.sh',
      },
    });
  });

  it('does not invent a plugin default when human_gate_policy is omitted from yaml', () => {
    const projectDir = tempDir();
    writeYaml(projectDir, 'gate:\n  command: specline gate\n');
    const checkpoint = readProjectCheckpointConfig(projectDir, {
      pluginConfig: { human_gate_policy: 'minimal' },
    });
    assert.equal(checkpoint.pipeline.human_gate_policy, undefined);
    assert.equal(checkpoint.gate.command, 'specline gate');
  });
});
