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
export declare const DEFAULT_GATE_COMMAND = "specline gate";
export declare const DEFAULT_GATE_FALLBACK = "specline/bin/gate.sh";
export type GateEnv = {
    PATH?: string;
};
export type GateConfig = {
    command: string;
    fallback: string;
};
export type GateInvocation = {
    command: string;
    args: string[];
    cwd: string;
};
export type GateSpawnFn = (command: string, args: readonly string[], options: {
    cwd: string;
    encoding: 'utf8';
}) => {
    status: number | null;
    stdout?: string | Buffer | null;
    stderr?: string | Buffer | null;
};
/**
 * Read gate.command / gate.fallback from a config.yaml body.
 * Missing keys fall back to the recommended defaults.
 */
export declare function parseGateConfig(yamlText: string): GateConfig;
export declare function readProjectGateConfig(projectDir: string): GateConfig;
/**
 * Choose { command, args } for a Gate subprocess.
 * cwd is the repository root (projectDir). Does not interpret Gate stdout.
 */
export declare function resolveGateInvocation(env: GateEnv, projectDir: string): GateInvocation;
/**
 * Spawn the resolved invocation and return the child status/streams unchanged.
 * Callers must not treat rewritten stdout as the Gate verdict; use status.
 */
export declare function runGateInvocation(invocation: GateInvocation, extraArgs?: readonly string[], spawnFn?: GateSpawnFn): {
    status: number;
    stdout: string;
    stderr: string;
};
