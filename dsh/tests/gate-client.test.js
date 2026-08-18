import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_GATE_COMMAND,
  DEFAULT_GATE_FALLBACK,
  parseGateConfig,
  readProjectGateConfig,
  resolveGateInvocation,
  runGateInvocation,
} from '../lib/gate-client.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'gate-client.ts');

function makeTempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeFakeBin(dir, name) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, '');
  chmodSync(file, 0o755);
  return file;
}

function writeProjectYaml(projectDir, yaml) {
  mkdirSync(join(projectDir, 'specline'), { recursive: true });
  writeFileSync(join(projectDir, 'specline', 'config.yaml'), yaml);
}

const YAML_WITH_GATE = `pipeline:
  human_gate_policy: minimal
gate:
  command: specline gate
  fallback: specline/bin/gate.sh
schema: spec-driven
`;

describe('project yaml gate.command / gate.fallback', () => {
  it('reads this repo config.yaml and confirms gate.sh exists', () => {
    const yamlPath = join(REPO_ROOT, 'specline', 'config.yaml');
    const scriptPath = join(REPO_ROOT, 'specline', 'bin', 'gate.sh');
    assert.equal(existsSync(yamlPath), true);
    assert.equal(existsSync(scriptPath), true);
    const parsed = parseGateConfig(readFileSync(yamlPath, 'utf8'));
    assert.equal(parsed.command, 'specline gate');
    assert.equal(parsed.fallback, 'specline/bin/gate.sh');
    assert.equal(parsed.command, DEFAULT_GATE_COMMAND);
    assert.equal(parsed.fallback, DEFAULT_GATE_FALLBACK);
  });
});

describe('resolveGateInvocation', () => {
  it('uses PATH specline when yaml command is specline gate (same chain, not exclusive)', () => {
    const projectDir = makeTempDir('dsh-gate-path-');
    const bin = makeTempDir('dsh-gate-bin-specline-');
    try {
      writeProjectYaml(projectDir, YAML_WITH_GATE);
      writeFakeBin(bin, 'specline');
      writeFakeBin(bin, 'npx');
      const invocation = resolveGateInvocation({ PATH: bin }, projectDir);
      assert.equal(invocation.command, 'specline');
      assert.deepEqual(invocation.args, ['gate']);
      assert.equal(invocation.cwd, projectDir);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(bin, { recursive: true, force: true });
    }
  });

  it('uses npx as an extra fallback when specline is missing from PATH', () => {
    const projectDir = makeTempDir('dsh-gate-npx-');
    const bin = makeTempDir('dsh-gate-bin-npx-');
    try {
      writeProjectYaml(projectDir, YAML_WITH_GATE);
      writeFakeBin(bin, 'npx');
      const invocation = resolveGateInvocation({ PATH: bin }, projectDir);
      assert.equal(invocation.command, 'npx');
      assert.deepEqual(invocation.args, ['specline', 'gate']);
      assert.equal(invocation.cwd, projectDir);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(bin, { recursive: true, force: true });
    }
  });

  it('uses yaml fallback gate.sh as the last step of the same chain', () => {
    const projectDir = makeTempDir('dsh-gate-sh-');
    try {
      writeProjectYaml(projectDir, YAML_WITH_GATE);
      mkdirSync(join(projectDir, 'specline', 'bin'), { recursive: true });
      writeFileSync(join(projectDir, 'specline', 'bin', 'gate.sh'), '#!/usr/bin/env bash\n');
      const invocation = resolveGateInvocation({ PATH: '' }, projectDir);
      assert.equal(invocation.command, 'bash');
      assert.deepEqual(invocation.args, ['specline/bin/gate.sh']);
      assert.equal(invocation.cwd, projectDir);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('defaults match yaml when config.yaml is absent', () => {
    const projectDir = makeTempDir('dsh-gate-defaults-');
    const bin = makeTempDir('dsh-gate-bin-default-');
    try {
      writeFakeBin(bin, 'specline');
      const withCli = resolveGateInvocation({ PATH: bin }, projectDir);
      assert.deepEqual(withCli, {
        command: 'specline',
        args: ['gate'],
        cwd: projectDir,
      });
      const cfg = readProjectGateConfig(projectDir);
      assert.equal(cfg.command, DEFAULT_GATE_COMMAND);
      assert.equal(cfg.fallback, DEFAULT_GATE_FALLBACK);
      const withScript = resolveGateInvocation({ PATH: '' }, projectDir);
      assert.deepEqual(withScript, {
        command: 'bash',
        args: ['specline/bin/gate.sh'],
        cwd: projectDir,
      });
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(bin, { recursive: true, force: true });
    }
  });

  it('honors a custom yaml fallback on the last step without skipping npx', () => {
    const projectDir = makeTempDir('dsh-gate-custom-');
    const npxBin = makeTempDir('dsh-gate-bin-custom-npx-');
    try {
      writeProjectYaml(
        projectDir,
        'gate:\n  command: specline gate\n  fallback: custom/gate.sh\n',
      );
      writeFakeBin(npxBin, 'npx');
      const viaNpx = resolveGateInvocation({ PATH: npxBin }, projectDir);
      assert.equal(viaNpx.command, 'npx');
      assert.deepEqual(viaNpx.args, ['specline', 'gate']);
      const viaScript = resolveGateInvocation({ PATH: '' }, projectDir);
      assert.equal(viaScript.command, 'bash');
      assert.deepEqual(viaScript.args, ['custom/gate.sh']);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(npxBin, { recursive: true, force: true });
    }
  });

  it('resolves this repo using PATH specline without treating yaml as a second chain', () => {
    const bin = makeTempDir('dsh-gate-repo-bin-');
    try {
      writeFakeBin(bin, 'specline');
      const invocation = resolveGateInvocation({ PATH: bin }, REPO_ROOT);
      assert.equal(invocation.command, 'specline');
      assert.deepEqual(invocation.args, ['gate']);
      assert.equal(invocation.cwd, REPO_ROOT);
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });
});

describe('runGateInvocation', () => {
  it('propagates exit code and does not rewrite stdout', () => {
    const calls = [];
    const result = runGateInvocation(
      { command: 'specline', args: ['gate'], cwd: '/tmp/repo' },
      ['spec', '--change', 'demo'],
      (command, args, options) => {
        calls.push({ command, args: [...args], options });
        return { status: 1, stdout: 'GATE_STDOUT_UNCHANGED\n', stderr: 'nope\n' };
      },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, 'GATE_STDOUT_UNCHANGED\n');
    assert.equal(result.stderr, 'nope\n');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, 'specline');
    assert.deepEqual(calls[0].args, ['gate', 'spec', '--change', 'demo']);
    assert.equal(calls[0].options.cwd, '/tmp/repo');
  });
});

describe('does not copy Gate decision logic', () => {
  it('does not embed phase verdicts or rewrite pass/fail semantics', () => {
    const src = readFileSync(SRC, 'utf8');
    assert.equal(/GATE_PHASES/.test(src), false);
    assert.equal(/function pass\(/.test(src), false);
    assert.equal(/function fail\(/.test(src), false);
    assert.equal(/stdout.*(PASS|FAIL|通过|失败)/.test(src), false);
  });
});
