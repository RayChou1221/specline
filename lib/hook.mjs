import { existsSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { PACKAGE_ROOT } from './paths.mjs';

/**
 * @param {string} projectDir
 */
export function resolveSessionStartScript(projectDir) {
  const deployed = join(projectDir, '.cursor', 'hooks', 'specline-session-start.sh');
  if (existsSync(deployed)) return deployed;
  return join(PACKAGE_ROOT, 'core', 'hooks', 'session-start.sh');
}

/**
 * @param {object} cursorJson parsed stdout from session-start.sh
 * @param {string} platform
 */
export function formatHookOutput(cursorJson, platform) {
  const ctx = cursorJson.additional_context;
  if (platform === 'cursor' || platform === 'opencode') {
    if (ctx) return JSON.stringify({ additional_context: ctx });
    return JSON.stringify(cursorJson);
  }
  if (platform === 'claude' || platform === 'codex') {
    const additionalContext = ctx || '';
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext,
      },
    });
  }
  return JSON.stringify(cursorJson);
}

/**
 * @param {{ platform?: string, projectDir?: string, input?: string }} opts
 */
export function runSessionStartHook(opts = {}) {
  const platform = opts.platform || 'cursor';
  const projectDir = opts.projectDir || process.cwd();
  const script = resolveSessionStartScript(projectDir);
  const input = opts.input ?? JSON.stringify({ session_id: 'cli', is_background_agent: false });

  const result = spawnSync('bash', [script], {
    cwd: projectDir,
    input,
    encoding: 'utf-8',
    env: { ...process.env, SPECLINE_PROJECT_ROOT: projectDir },
  });

  let parsed = {};
  try {
    parsed = JSON.parse((result.stdout || '').trim() || '{}');
  } catch {
    parsed = {};
  }

  const formatted = formatHookOutput(parsed, platform);
  return { ...result, formatted, parsed };
}

/**
 * CLI entry point for `specline hook session-start [--platform <p>]`
 * @param {string[]} argv - remaining args after "hook session-start"
 * @param {string} [cwd]
 * @returns {number} exit code
 */
export function cliHookSessionStart(argv, cwd) {
  const projectDir = cwd || process.cwd();
  let platform = 'cursor';

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--platform' && argv[i + 1]) {
      platform = argv[++i];
    }
  }

  const { formatted, status } = runSessionStartHook({ platform, projectDir });
  process.stdout.write(formatted + '\n');
  return status ?? 0;
}

/**
 * CLI entry point for `specline hook <subcommand> [opts]`
 * @param {string[]} argv - remaining args after "hook"
 * @param {string} [cwd]
 * @returns {number} exit code
 */
export function cliHook(argv, cwd) {
  const subcommand = argv[0];

  if (!subcommand || subcommand === '--help') {
    process.stdout.write('Usage: specline hook <subcommand> [options]\n\nSubcommands: session-start\n');
    return subcommand ? 0 : 1;
  }

  if (subcommand === 'session-start') {
    return cliHookSessionStart(argv.slice(1), cwd);
  }

  process.stderr.write(`Unknown hook subcommand: ${subcommand}\nAvailable: session-start\n`);
  return 1;
}
