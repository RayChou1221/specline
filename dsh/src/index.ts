import {
  USER_SLASH_SKILLS,
  BOOT_POLICY,
  type SlashSkill,
} from './skills.js';
import { isSpeclineProject, arm, inspectSpeclineProject, resolveSpeclineProjectDir, type ArmActions, type ArmResult } from './arming.js';
import { ROLE_TOOL_NAMES, createRoleToolConfigs } from './role-tools.js';
import { parentWriteAllowed } from './write-guard.js';
import {
  shouldInjectOrchestrator,
  createSessionInjectTracker,
  SESSION_START_HOOK,
} from './session-inject.js';
import {
  shouldPromptInit,
  handleUninitializedProject,
  formatUninitCommandText,
  type InitAsk,
  type InitRunner,
  type RuntimeKind,
  type UninitializedResult,
} from './project-init.js';
import { resolveGateInvocation } from './gate-client.js';
import { resolveHumanGate } from './human-gate.js';
import { buildDrawioPatchEntry, bundleEnablesDrawio } from './diagram-mcp.js';
import { visualizeUsesMcp } from './visualize-contract.js';
import { resolvePluginConfig } from './plugin-config.js';
import { loadBakedSkill, renderSkillContent } from './skill-assets.js';

export {
  USER_SLASH_SKILLS,
  BOOT_POLICY,
  ROLE_TOOL_NAMES,
  isSpeclineProject,
  inspectSpeclineProject,
  resolveSpeclineProjectDir,
  arm,
  resolveGateInvocation,
  shouldPromptInit,
  resolveHumanGate,
  parentWriteAllowed,
  shouldInjectOrchestrator,
  buildDrawioPatchEntry,
  bundleEnablesDrawio,
  visualizeUsesMcp,
};

export const name = 'dsh-specline';

export type SlashSession = {
  id?: string;
  sessionId?: string;
  projectDir?: string;
  cwd?: string;
  kind?: RuntimeKind;
  parentSession?: string | null;
  ask?: InitAsk;
  runner?: InitRunner;
  injected?: boolean;
  roleTools?: readonly string[];
  writeGuard?: boolean;
  bound?: boolean;
  writeAllowed?: (relPath: string) => boolean;
};

export type SlashDispatchResult = {
  path: 'init' | 'arm';
  armed: boolean;
  prompted?: boolean;
  declined?: boolean;
  ranInit?: boolean;
  shouldArm?: boolean;
  wroteDirectories?: boolean;
  error?: string | null;
  cwd?: string;
  hasSpeclineDir?: boolean;
  sessionId?: string | null;
  steps?: ArmResult['steps'];
  reason?: string;
};

export type SlashHandler = (
  session?: SlashSession,
) => Promise<SlashDispatchResult>;

export type SpeclineSkillProvider = {
  'user-invocable': true;
  'disable-model-invocation': true;
  skills: readonly SlashSkill[];
  get: (name: string) => SlashSkill | undefined;
  skill: (request?: { name?: string }) => never;
};

export type DuckContext = {
  kind?: RuntimeKind;
  cwd?: string;
  config?: unknown;
  arm?: typeof arm;
  handleUninitializedProject?: typeof handleUninitializedProject;
  ask?: InitAsk;
  runner?: InitRunner;
  slash?: {
    register?: (
      name: string,
      handler: SlashHandler,
      meta?: Record<string, unknown>,
    ) => void;
  };
  command?: (name: string, handler: SlashHandler) => void;
  skills?: {
    provide?: (provider: SpeclineSkillProvider) => void;
    register?: (provider: SpeclineSkillProvider) => void;
  };
  tools?: {
    register?: (name: string, tool?: unknown) => void;
    define?: (name: string, tool?: unknown) => void;
    has?: (name: string) => boolean;
  };
  effect?: (callback: (() => unknown) | (() => Generator), label?: string) => unknown;
  get?: (name: string) => unknown;
  commands?: {
    register: (definition: {
      name: string;
      description: string;
      input?: { hint: string };
      handler: (invocation?: Record<string, unknown>) => unknown;
    }) => unknown;
  };
};

/** Cordis loader reads these named exports. Do not default-export a function — unwrapExports prefers default and drops inject. */
export const inject = ['commands'] as const;

export type BootSurface = {
  slashes: readonly SlashSkill[];
  skillProvider: SpeclineSkillProvider;
  roleToolsRegistered: false;
};

function resolveKind(ctx: DuckContext, session?: SlashSession): RuntimeKind {
  const value = session?.kind ?? ctx.kind;
  return value === 'headless' ? 'headless' : 'web';
}

function resolveProjectDir(ctx: DuckContext, session?: SlashSession): string {
  return session?.projectDir ?? session?.cwd ?? ctx.cwd ?? process.cwd();
}

function resolveSessionId(session?: SlashSession): string {
  return session?.sessionId ?? session?.id ?? 'current';
}

function createArmActions(session: SlashSession, writeIntercept: boolean): ArmActions {
  return {
    inject(sessionId) {
      if (!shouldInjectOrchestrator(session.parentSession)) return;
      const tracker = createSessionInjectTracker();
      tracker.handle({
        hook: SESSION_START_HOOK,
        sessionId,
        parentSession: session.parentSession ?? null,
      });
      session.injected = true;
    },
    mountRoleTools() {
      session.roleTools = createRoleToolConfigs().map((config) => config.toolName);
    },
    enableWriteGuard() {
      if (!writeIntercept) return;
      session.writeGuard = true;
      session.writeAllowed = (relPath) =>
        parentWriteAllowed(relPath, session.parentSession);
    },
    bind() {
      session.bound = true;
    },
  };
}

export function createSkillProvider(): SpeclineSkillProvider {
  return {
    'user-invocable': true,
    'disable-model-invocation': true,
    skills: USER_SLASH_SKILLS,
    get(name: string) {
      if (!name) return undefined;
      const noSlash = name.replace(/^\//, '');
      const withSlash = name.startsWith('/') ? name : `/${name}`;
      return USER_SLASH_SKILLS.find(
        (skill) =>
          skill.slash === name ||
          skill.slash === withSlash ||
          skill.skillDir === noSlash ||
          skill.skillDir === name ||
          skill.id === name ||
          skill.id === noSlash,
      );
    },
    skill() {
      throw new Error('model skill() invocation is disabled');
    },
  };
}

export async function handleSlashCommand(
  session: SlashSession = {},
  ctx: DuckContext = {},
): Promise<SlashDispatchResult> {
  const requestedDir = resolveProjectDir(ctx, session);
  const projectDir = resolveSpeclineProjectDir(requestedDir) ?? requestedDir;
  const kind = resolveKind(ctx, session);
  const armFn = ctx.arm ?? arm;
  const initFn = ctx.handleUninitializedProject ?? handleUninitializedProject;
  const pluginConfig = resolvePluginConfig(ctx.config);
  const inspection = inspectSpeclineProject(projectDir);

  if (!inspection.hasConfig) {
    const initResult: UninitializedResult = await initFn({
      kind,
      cwd: projectDir,
      ask: session.ask ?? ctx.ask,
      runner: session.runner ?? ctx.runner,
    });
    if (initResult.shouldArm && isSpeclineProject(projectDir)) {
      return armCurrentSession(session, ctx, projectDir, armFn, pluginConfig.writeIntercept, {
        prompted: initResult.prompted,
        ranInit: initResult.ranInit,
      });
    }
    return {
      path: 'init',
      armed: false,
      prompted: initResult.prompted,
      declined: initResult.declined,
      ranInit: initResult.ranInit,
      shouldArm: initResult.shouldArm,
      wroteDirectories: initResult.wroteDirectories,
      error: initResult.error,
      cwd: projectDir,
      hasSpeclineDir: inspection.hasSpeclineDir,
      sessionId: null,
      steps: [],
    };
  }

  return armCurrentSession(session, ctx, projectDir, armFn, pluginConfig.writeIntercept);
}

function armCurrentSession(
  session: SlashSession,
  _ctx: DuckContext,
  projectDir: string,
  armFn: typeof arm,
  writeIntercept: boolean,
  extra: { prompted?: boolean; ranInit?: boolean } = {},
): SlashDispatchResult {
  const sessionId = resolveSessionId(session);
  const result = armFn({
    projectDir,
    sessionId,
    actions: createArmActions(session, writeIntercept),
  });
  return {
    path: 'arm',
    armed: result.armed,
    sessionId: result.sessionId,
    steps: result.steps,
    reason: result.reason,
    prompted: extra.prompted,
    ranInit: extra.ranInit,
  };
}

function hasOwn(ctx: object, key: string): boolean {
  try {
    return Object.prototype.hasOwnProperty.call(ctx, key);
  } catch {
    return false;
  }
}

function ownGet<T>(ctx: object, key: string): T | undefined {
  if (!hasOwn(ctx, key)) return undefined;
  try {
    return (ctx as Record<string, T | undefined>)[key];
  } catch {
    return undefined;
  }
}

function getService<T>(ctx: DuckContext, key: 'commands' | 'effect'): T | undefined {
  try {
    return ctx[key] as T | undefined;
  } catch {
    return undefined;
  }
}

function commandName(skill: SlashSkill): string {
  return skill.skillDir;
}

function commandDescription(skill: SlashSkill): string {
  return `Start Specline ${skill.id} (user slash only)`;
}

function sessionFromInvocation(invocation: Record<string, unknown> = {}): SlashSession {
  if (invocation.projectDir || invocation.kind || invocation.sessionId || invocation.ask || invocation.runner) {
    return invocation as SlashSession;
  }
  const agent = invocation.agent && typeof invocation.agent === 'object'
    ? invocation.agent as Record<string, unknown>
    : undefined;
  const session = agent?.session && typeof agent.session === 'object'
    ? agent.session as Record<string, unknown>
    : undefined;
  const header = session?.header && typeof session.header === 'object'
    ? session.header as Record<string, unknown>
    : undefined;
  const headerCwd = typeof header?.cwd === 'string' ? header.cwd : undefined;
  return {
    kind: 'web',
    projectDir: typeof invocation.cwd === 'string'
      ? invocation.cwd
      : typeof agent?.cwd === 'string'
        ? agent.cwd
        : headerCwd ?? process.cwd(),
    sessionId: typeof invocation.sessionId === 'string'
      ? invocation.sessionId
      : typeof agent?.id === 'string'
        ? agent.id
        : 'current',
    parentSession: typeof header?.parentSession === 'string' ? header.parentSession : null,
  };
}

type HostAgent = {
  steer?: (message: unknown) => void;
  inject?: (message: unknown) => void;
};

function contextMessage(text: string, source: Record<string, unknown>): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source,
  };
}

function buildSkillInjection(skill: SlashSkill): { text: string; name: string } | null {
  const loaded = loadBakedSkill(skill.skillDir);
  if (!loaded) return null;
  return {
    name: loaded.name,
    text: renderSkillContent(loaded.name, loaded.body, loaded.dir),
  };
}

function buildSlashFollowup(skill: SlashSkill, result: SlashDispatchResult, rawInput: string): string {
  const extra = rawInput.trim();
  if (result.path === 'init') {
    return [
      formatUninitCommandText({
        cwd: result.cwd,
        declined: false,
        failed: Boolean(result.ranInit) && !result.shouldArm,
        hasSpeclineDir: result.hasSpeclineDir,
      }),
      '',
      '请用中文直接向用户说明现状和下一步，不要调用工具做初始化，也不要说“已取消”。',
    ].join('\n');
  }
  if (extra) return extra;
  return `请按照 ${skill.skillDir} 的 <skill_instructions> 开始，直接在当前对话里推进。`;
}

function deliverSkillAndFollowup(
  agent: HostAgent | undefined,
  skill: SlashSkill,
  result: SlashDispatchResult,
  rawInput: string,
): void {
  if (typeof agent?.steer !== 'function') return;
  const followup = buildSlashFollowup(skill, result, rawInput);
  let injected = false;
  if (result.armed) {
    const skillInjection = buildSkillInjection(skill);
    if (skillInjection) {
      if (typeof agent.inject === 'function') {
        try {
          agent.inject(contextMessage(skillInjection.text, {
            kind: 'skill-invocation',
            name: skillInjection.name,
            form: 'instructions',
          }));
          injected = true;
        } catch {
          injected = false;
        }
      }
      if (!injected) {
        agent.steer(contextMessage(`${skillInjection.text}\n\n${followup}`, { kind: 'user' }));
        return;
      }
    }
  }
  agent.steer(contextMessage(followup, { kind: 'user' }));
}

function toCommandResult(result: SlashDispatchResult): { kind: 'success' | 'error'; text: string } {
  if (result.path === 'init') {
    if (result.prompted === false) {
      return { kind: 'error', text: String(result.error ?? 'current directory is not a Specline project') };
    }
    return {
      kind: 'success',
      text: formatUninitCommandText({
        cwd: result.cwd,
        declined: false,
        failed: Boolean(result.ranInit) && !result.shouldArm,
        hasSpeclineDir: result.hasSpeclineDir,
      }),
    };
  }
  if (!result.armed && result.error) {
    return { kind: 'error', text: String(result.error) };
  }
  if (result.armed) {
    return { kind: 'success', text: `Specline ${result.sessionId ?? 'current'} 已在当前会话启动` };
  }
  return { kind: 'success', text: 'Specline slash handled.' };
}

function registerSlash(ctx: DuckContext, skill: SlashSkill, handler: SlashHandler): void {
  const meta = {
    'user-invocable': skill['user-invocable'],
    'disable-model-invocation': skill['disable-model-invocation'],
    id: skill.id,
    skillDir: skill.skillDir,
  };
  ctx.slash?.register?.(skill.slash, handler, meta);
  ctx.command?.(skill.slash, handler);
}

function registerSkillProvider(ctx: DuckContext, provider: SpeclineSkillProvider): void {
  ctx.skills?.provide?.(provider);
  ctx.skills?.register?.(provider);
}

function registerHostCommands(
  ctx: DuckContext,
  sessionHandler: SlashHandler,
): void {
  const commands = getService<DuckContext['commands']>(ctx, 'commands');
  if (typeof commands?.register !== 'function') return;

  const install = function* () {
    for (const skill of USER_SLASH_SKILLS) {
      // Call through the service object. Extracting `.register` drops `this`,
      // and dsh-commands then reads `undefined.layers`.
      yield commands.register({
        name: commandName(skill),
        description: commandDescription(skill),
        input: { hint: 'requirement, flags, or --change name' },
        handler: async (invocation) => {
          const session = sessionFromInvocation(invocation);
          const result = await sessionHandler(session);
          const agent = invocation?.agent && typeof invocation.agent === 'object'
            ? invocation.agent as HostAgent
            : undefined;
          deliverSkillAndFollowup(
            agent,
            skill,
            result,
            typeof invocation?.rawInput === 'string' ? invocation.rawInput : '',
          );
          return toCommandResult(result);
        },
      });
    }
  };

  if (typeof ctx.effect === 'function') {
    ctx.effect(install, 'dsh-specline commands');
    return;
  }
  for (const _ of install()) {
    /* register for tests that omit ctx.effect */
  }
}

/**
 * Profile boot: register ten user-only slashes via ctx.commands.
 * Does not register role tools, using-specline, or an agent preset.
 * Never read ctx.config — Cordis throws without inject; plugin config is the second argument.
 */
export function apply(ctx: DuckContext = {}, config?: unknown): BootSurface {
  const pluginConfig = resolvePluginConfig(config);
  const skillProvider = createSkillProvider();
  const duck: DuckContext = {
    kind: ownGet(ctx, 'kind'),
    cwd: ownGet(ctx, 'cwd'),
    arm: ownGet(ctx, 'arm'),
    handleUninitializedProject: ownGet(ctx, 'handleUninitializedProject'),
    ask: ownGet(ctx, 'ask'),
    runner: ownGet(ctx, 'runner'),
  };
  const handler: SlashHandler = (session = {}) => handleSlashCommand(session, {
    kind: session.kind ?? duck.kind,
    cwd: session.projectDir ?? session.cwd ?? duck.cwd,
    config: pluginConfig,
    arm: duck.arm,
    handleUninitializedProject: duck.handleUninitializedProject,
    ask: session.ask ?? duck.ask,
    runner: session.runner ?? duck.runner,
  });

  registerHostCommands(ctx, handler);

  if (hasOwn(ctx, 'slash') || hasOwn(ctx, 'command') || hasOwn(ctx, 'skills')) {
    for (const skill of USER_SLASH_SKILLS) {
      registerSlash(ctx, skill, handler);
    }
    registerSkillProvider(ctx, skillProvider);
  }

  return {
    slashes: USER_SLASH_SKILLS,
    skillProvider,
    roleToolsRegistered: false,
  };
}

export { apply as plugin };
