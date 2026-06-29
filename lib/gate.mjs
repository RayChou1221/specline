import { existsSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { PACKAGE_ROOT } from './paths.mjs';

const GATE_PHASES = new Set([
  'new', 'list', 'artifacts', 'spec', 'semantic', 'build', 'lint',
  'test-unit', 'test-integration', 'test-e2e', 'detect-modules', 'bind', 'archive', 'status',
]);

/**
 * @param {string} projectDir
 */
export function resolveGateScript(projectDir) {
  const projectGate = join(projectDir, 'specline', 'bin', 'gate.sh');
  if (existsSync(projectGate)) return projectGate;
  const packaged = join(PACKAGE_ROOT, 'core', 'gates', 'pipeline-gate.sh');
  const legacy = join(projectDir, '.cursor', 'hooks', 'specline-pipeline-gate.sh');
  if (projectDir === PACKAGE_ROOT && existsSync(packaged)) return packaged;
  if (existsSync(legacy)) return legacy;
  return packaged;
}

/**
 * @param {string} phase
 * @param {{ change?: string, projectDir?: string, execute?: boolean, json?: boolean, extraArgs?: string[] }} opts
 */
export function runGate(phase, opts = {}) {
  const projectDir = opts.projectDir || process.cwd();
  const script = resolveGateScript(projectDir);
  const args = [script, phase];
  if (opts.change) args.push('--change', opts.change);
  if (opts.execute) args.push('--execute');
  if (opts.extraArgs?.length) args.push(...opts.extraArgs);

  const result = spawnSync('bash', args, {
    cwd: projectDir,
    encoding: 'utf-8',
    env: { ...process.env, SPECLINE_PROJECT_ROOT: projectDir },
  });

  if (opts.json && phase === 'list') {
    try {
      result.jsonOutput = JSON.parse((result.stdout || '').trim());
    } catch {
      result.jsonOutput = (result.stdout || '').trim().split('\n').filter(Boolean);
    }
  }

  return result;
}

/**
 * CLI entry point for `specline gate <subcommand> [--change <name>] [--json]`
 * @param {string[]} argv - remaining args after "gate"
 * @param {string} [cwd]
 * @returns {number} exit code
 */
export function cliGate(argv, cwd) {
  const projectDir = cwd || process.cwd();
  const subcommand = argv[0];

  if (!subcommand || subcommand === '--help') {
    const phases = [...GATE_PHASES].join(', ');
    process.stdout.write(`Usage: specline gate <subcommand> [--change <name>] [--json]\n\nSubcommands: ${phases}\n`);
    return subcommand ? 0 : 1;
  }

  if (!isGatePhase(subcommand)) {
    process.stderr.write(`Unknown gate subcommand: ${subcommand}\nAvailable: ${[...GATE_PHASES].join(', ')}\n`);
    return 1;
  }

  let change = null;
  let json = false;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--change' && argv[i + 1]) {
      change = argv[++i];
    } else if (argv[i] === '--json') {
      json = true;
    }
  }

  const result = runGate(subcommand, { change, projectDir, json });

  if (json && subcommand === 'list') {
    const output = result.jsonOutput
      ? JSON.stringify(result.jsonOutput, null, 2)
      : (result.stdout || '');
    process.stdout.write(output + '\n');
  } else {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }

  return result.status ?? 1;
}

export function isGatePhase(phase) {
  return GATE_PHASES.has(phase);
}

export { GATE_PHASES };
