/**
 * Uninitialized-project handling for DSH Web vs Headless.
 * Web may prompt then run `specline init --platform none` in the repo cwd.
 * Headless only errors: no prompt, no init, no arming.
 * This module never writes directories itself unless a runner is supplied.
 */

import { spawnSync } from 'node:child_process';

export type RuntimeKind = 'web' | 'headless';

export const INIT_COMMAND = 'specline';
export const INIT_ARGS = ['init', '--platform', 'none'] as const;
export const NOT_A_SPECLINE_PROJECT = 'current directory is not a Specline project';
export const INIT_QUESTION_ID = 'specline-init';
export const INIT_QUESTION_APPROVE = '初始化';
export const INIT_QUESTION_DECLINE = '取消';
export const INIT_CLI = 'specline init --platform none';

export function shouldPromptInit(kind: RuntimeKind): boolean {
  return kind === 'web';
}

export function buildInitInvocation(): { command: string; args: string[] } {
  return { command: INIT_COMMAND, args: [...INIT_ARGS] };
}

export type InitPolicy = {
  prompt: boolean;
  allowInit: boolean;
  autoInit: boolean;
};

export function describeInitPolicy(kind: RuntimeKind): InitPolicy {
  if (kind === 'web') {
    return { prompt: true, allowInit: true, autoInit: false };
  }
  return { prompt: false, allowInit: false, autoInit: false };
}

export type InitRunner = (invocation: {
  command: string;
  args: string[];
  cwd: string;
}) => { status: number } | Promise<{ status: number }>;

export type InitAsk = () => boolean | Promise<boolean>;

export type InitSpawnFn = (
  command: string,
  args: readonly string[],
  options: { cwd: string; encoding: 'utf8' },
) => { status: number | null };

export function createDefaultInitRunner(
  spawnFn: InitSpawnFn = (command, args, options) =>
    spawnSync(command, [...args], options),
): InitRunner {
  return (invocation) => {
    const result = spawnFn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      encoding: 'utf8',
    });
    return { status: result.status ?? 1 };
  };
}

export function formatUninitCommandText(input: {
  cwd?: string;
  declined?: boolean;
  failed?: boolean;
  hasSpeclineDir?: boolean;
}): string {
  const dirLine = input.cwd ? `目录：${input.cwd}` : undefined;
  if (input.failed) {
    return [
      'specline init 执行失败。',
      dirLine,
      `请确认本机已安装 Specline CLI，然后在该仓库手动执行：`,
      `  ${INIT_CLI}`,
    ].filter((line) => line !== undefined).join('\n');
  }
  if (input.hasSpeclineDir) {
    return [
      '已经找到 specline/ 目录，但还缺少 specline/config.yaml，所以还不能启动 Specline。',
      dirLine,
      '',
      '请在该仓库执行：',
      `  ${INIT_CLI}`,
      '生成 config.yaml 后再重新输入斜杠命令。',
    ].filter((line) => line !== undefined).join('\n');
  }
  if (input.declined) {
    return [
      '当前目录还不是 Specline 项目，已取消初始化。',
      dirLine,
      '',
      `若要使用 Specline，请先执行：`,
      `  ${INIT_CLI}`,
      '然后再输入斜杠命令。',
    ].filter((line) => line !== undefined).join('\n');
  }
  return [
    '当前目录还不是 Specline 项目。',
    dirLine,
    '',
    `请先在该仓库执行：`,
    `  ${INIT_CLI}`,
    '完成后再重新输入斜杠命令。',
  ].filter((line) => line !== undefined).join('\n');
}

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
export async function handleUninitializedProject(input: {
  kind: RuntimeKind;
  cwd: string;
  ask?: InitAsk;
  runner?: InitRunner;
}): Promise<UninitializedResult> {
  if (input.kind === 'headless') {
    return {
      prompted: false,
      ranInit: false,
      shouldArm: false,
      wroteDirectories: false,
      error: NOT_A_SPECLINE_PROJECT,
      cwd: input.cwd,
    };
  }

  const ask = input.ask;
  const consented = ask ? await ask() : false;
  if (!consented) {
    return {
      prompted: true,
      declined: Boolean(ask),
      ranInit: false,
      shouldArm: false,
      wroteDirectories: false,
      error: NOT_A_SPECLINE_PROJECT,
      cwd: input.cwd,
    };
  }

  const invocation = buildInitInvocation();
  if (!input.runner) {
    return {
      prompted: true,
      ranInit: false,
      shouldArm: false,
      wroteDirectories: false,
      error: 'web init requires a runner',
      command: invocation.command,
      args: invocation.args,
      cwd: input.cwd,
    };
  }

  const result = await input.runner({
    command: invocation.command,
    args: invocation.args,
    cwd: input.cwd,
  });

  if (result.status !== 0) {
    return {
      prompted: true,
      ranInit: true,
      shouldArm: false,
      wroteDirectories: false,
      error: 'specline init failed',
      command: invocation.command,
      args: invocation.args,
      cwd: input.cwd,
    };
  }

  return {
    prompted: true,
    ranInit: true,
    shouldArm: true,
    wroteDirectories: false,
    error: null,
    command: invocation.command,
    args: invocation.args,
    cwd: input.cwd,
  };
}
