/**
 * Uninitialized-project handling for DSH Web vs Headless.
 * Web may prompt then run `specline init --platform none` in the repo cwd.
 * Headless only errors: no prompt, no init, no arming.
 * This module never writes directories itself unless a runner is supplied.
 */
export type RuntimeKind = 'web' | 'headless';
export declare const INIT_COMMAND = "specline";
export declare const INIT_ARGS: readonly ["init", "--platform", "none"];
export declare const NOT_A_SPECLINE_PROJECT = "current directory is not a Specline project";
export declare const INIT_QUESTION_ID = "specline-init";
export declare const INIT_QUESTION_APPROVE = "\u521D\u59CB\u5316";
export declare const INIT_QUESTION_DECLINE = "\u53D6\u6D88";
export declare const INIT_CLI = "specline init --platform none";
export declare function shouldPromptInit(kind: RuntimeKind): boolean;
export declare function buildInitInvocation(): {
    command: string;
    args: string[];
};
export type InitPolicy = {
    prompt: boolean;
    allowInit: boolean;
    autoInit: boolean;
};
export declare function describeInitPolicy(kind: RuntimeKind): InitPolicy;
export type InitRunner = (invocation: {
    command: string;
    args: string[];
    cwd: string;
}) => {
    status: number;
} | Promise<{
    status: number;
}>;
export type InitAsk = () => boolean | Promise<boolean>;
export type InitSpawnFn = (command: string, args: readonly string[], options: {
    cwd: string;
    encoding: 'utf8';
}) => {
    status: number | null;
};
export declare function createDefaultInitRunner(spawnFn?: InitSpawnFn): InitRunner;
export declare function formatUninitCommandText(input: {
    cwd?: string;
    declined?: boolean;
    failed?: boolean;
    hasSpeclineDir?: boolean;
}): string;
export type UninitializedResult = {
    prompted: boolean;
    declined?: boolean;
    ranInit: boolean;
    shouldArm: boolean;
    wroteDirectories: boolean;
    error: string | null;
    command?: string;
    args?: string[];
    cwd?: string;
};
/**
 * Handle a Specline slash when cwd has no specline/config.yaml.
 * Does not mkdir, does not arm, does not spawn unless a runner is provided.
 */
export declare function handleUninitializedProject(input: {
    kind: RuntimeKind;
    cwd: string;
    ask?: InitAsk;
    runner?: InitRunner;
}): Promise<UninitializedResult>;
