/**
 * Resolve how to invoke Specline Gate without copying its pass/fail logic.
 *
 * Recommended default chain (not a user-confirmed pin):
 *   PATH specline → npx specline → bash specline/bin/gate.sh
 *
 * Project yaml `gate.command` / `gate.fallback` are the CLI and script ends
 * of that same chain (npx is an extra fallback between them), not a second
 * exclusive resolver.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
export const DEFAULT_GATE_COMMAND = 'specline gate';
export const DEFAULT_GATE_FALLBACK = 'specline/bin/gate.sh';
function stripQuotes(value) {
    const trimmed = value.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}
function stripInlineComment(value) {
    const hash = value.indexOf(' #');
    if (hash === -1)
        return value.trim();
    return value.slice(0, hash).trim();
}
/**
 * Read gate.command / gate.fallback from a config.yaml body.
 * Missing keys fall back to the recommended defaults.
 */
export function parseGateConfig(yamlText) {
    const result = {
        command: DEFAULT_GATE_COMMAND,
        fallback: DEFAULT_GATE_FALLBACK,
    };
    let inGate = false;
    for (const line of yamlText.split(/\r?\n/)) {
        if (/^gate:\s*(#.*)?$/.test(line)) {
            inGate = true;
            continue;
        }
        if (!inGate)
            continue;
        if (/^[A-Za-z0-9_-]+:/.test(line) && !/^\s/.test(line)) {
            inGate = false;
            continue;
        }
        const commandMatch = line.match(/^\s+command:\s*(.+)\s*$/);
        if (commandMatch) {
            const value = stripQuotes(stripInlineComment(commandMatch[1]));
            if (value)
                result.command = value;
            continue;
        }
        const fallbackMatch = line.match(/^\s+fallback:\s*(.+)\s*$/);
        if (fallbackMatch) {
            const value = stripQuotes(stripInlineComment(fallbackMatch[1]));
            if (value)
                result.fallback = value;
        }
    }
    return result;
}
export function readProjectGateConfig(projectDir) {
    const yamlPath = join(projectDir, 'specline', 'config.yaml');
    if (!existsSync(yamlPath)) {
        return {
            command: DEFAULT_GATE_COMMAND,
            fallback: DEFAULT_GATE_FALLBACK,
        };
    }
    return parseGateConfig(readFileSync(yamlPath, 'utf8'));
}
function commandOnPath(name, env) {
    const pathEnv = env.PATH ?? '';
    if (!pathEnv || !name)
        return false;
    const delim = pathEnv.includes(';') && /\\|[A-Za-z]:/.test(pathEnv) ? ';' : ':';
    for (const dir of pathEnv.split(delim)) {
        if (!dir)
            continue;
        if (existsSync(join(dir, name)))
            return true;
    }
    return false;
}
function tokenize(command) {
    return command.trim().split(/\s+/).filter(Boolean);
}
/**
 * Choose { command, args } for a Gate subprocess.
 * cwd is the repository root (projectDir). Does not interpret Gate stdout.
 */
export function resolveGateInvocation(env, projectDir) {
    const { command, fallback } = readProjectGateConfig(projectDir);
    const tokens = tokenize(command);
    const cli = tokens[0] ?? 'specline';
    const cliArgs = tokens.slice(1);
    if (commandOnPath(cli, env)) {
        return { command: cli, args: cliArgs, cwd: projectDir };
    }
    if (cli === 'specline' && commandOnPath('npx', env)) {
        return { command: 'npx', args: ['specline', ...cliArgs], cwd: projectDir };
    }
    return { command: 'bash', args: [fallback], cwd: projectDir };
}
/**
 * Spawn the resolved invocation and return the child status/streams unchanged.
 * Callers must not treat rewritten stdout as the Gate verdict; use status.
 */
export function runGateInvocation(invocation, extraArgs = [], spawnFn = (command, args, options) => spawnSync(command, [...args], options)) {
    const result = spawnFn(invocation.command, [...invocation.args, ...extraArgs], {
        cwd: invocation.cwd,
        encoding: 'utf8',
    });
    return {
        status: result.status ?? 1,
        stdout: String(result.stdout ?? ''),
        stderr: String(result.stderr ?? ''),
    };
}
