import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(ROOT, 'cli.mjs');

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    env: { ...process.env, CI: '1' },
    timeout: 15_000,
  });
}

describe('cli has no diagram subcommand', () => {
  it('rejects specline diagram', () => {
    const result = run(['diagram', 'doctor']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /未知命令:\s*diagram/);
  });

  it('help does not advertise diagram', () => {
    const result = run(['--help']);
    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stdout, /\bspecline diagram\b/);
  });

  it('lib/diagram product sources are gone', () => {
    assert.equal(existsSync(join(ROOT, 'lib', 'diagram.mjs')), false);
    assert.equal(existsSync(join(ROOT, 'lib', 'diagram')), false);
  });
});
