import { USER_SLASH_SKILLS, BOOT_POLICY, } from './skills.js';
import { isSpeclineProject, arm, inspectSpeclineProject, resolveSpeclineProjectDir } from './arming.js';
import { ROLE_TOOL_NAMES, createRoleToolConfigs } from './role-tools.js';
import { parentWriteAllowed } from './write-guard.js';
import { shouldInjectOrchestrator, createSessionInjectTracker, SESSION_START_HOOK, } from './session-inject.js';
import { shouldPromptInit, handleUninitializedProject, formatUninitCommandText, } from './project-init.js';
import { resolveGateInvocation } from './gate-client.js';
import { resolveHumanGate } from './human-gate.js';
import { buildDrawioPatchEntry, bundleEnablesDrawio } from './diagram-mcp.js';
import { visualizeUsesMcp } from './visualize-contract.js';
import { resolvePluginConfig } from './plugin-config.js';
import { loadBakedSkill, renderSkillContent } from './skill-assets.js';
export { USER_SLASH_SKILLS, BOOT_POLICY, ROLE_TOOL_NAMES, isSpeclineProject, inspectSpeclineProject, resolveSpeclineProjectDir, arm, resolveGateInvocation, shouldPromptInit, resolveHumanGate, parentWriteAllowed, shouldInjectOrchestrator, buildDrawioPatchEntry, bundleEnablesDrawio, visualizeUsesMcp, };
export const name = 'dsh-specline';
/** Cordis loader reads these named exports. Do not default-export a function — unwrapExports prefers default and drops inject. */
export const inject = ['commands'];
function resolveKind(ctx, session) {
    const value = session?.kind ?? ctx.kind;
    return value === 'headless' ? 'headless' : 'web';
}
function resolveProjectDir(ctx, session) {
    return session?.projectDir ?? session?.cwd ?? ctx.cwd ?? process.cwd();
}
function resolveSessionId(session) {
    return session?.sessionId ?? session?.id ?? 'current';
}
function createArmActions(session, writeIntercept) {
    return {
        inject(sessionId) {
            if (!shouldInjectOrchestrator(session.parentSession))
                return;
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
            if (!writeIntercept)
                return;
            session.writeGuard = true;
            session.writeAllowed = (relPath) => parentWriteAllowed(relPath, session.parentSession);
        },
        bind() {
            session.bound = true;
        },
    };
}
export function createSkillProvider() {
    return {
        'user-invocable': true,
        'disable-model-invocation': true,
        skills: USER_SLASH_SKILLS,
        get(name) {
            if (!name)
                return undefined;
            const noSlash = name.replace(/^\//, '');
            const withSlash = name.startsWith('/') ? name : `/${name}`;
            return USER_SLASH_SKILLS.find((skill) => skill.slash === name ||
                skill.slash === withSlash ||
                skill.skillDir === noSlash ||
                skill.skillDir === name ||
                skill.id === name ||
                skill.id === noSlash);
        },
        skill() {
            throw new Error('model skill() invocation is disabled');
        },
    };
}
export async function handleSlashCommand(session = {}, ctx = {}) {
    const requestedDir = resolveProjectDir(ctx, session);
    const projectDir = resolveSpeclineProjectDir(requestedDir) ?? requestedDir;
    const kind = resolveKind(ctx, session);
    const armFn = ctx.arm ?? arm;
    const initFn = ctx.handleUninitializedProject ?? handleUninitializedProject;
    const pluginConfig = resolvePluginConfig(ctx.config);
    const inspection = inspectSpeclineProject(projectDir);
    if (!inspection.hasConfig) {
        const initResult = await initFn({
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
function armCurrentSession(session, _ctx, projectDir, armFn, writeIntercept, extra = {}) {
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
function hasOwn(ctx, key) {
    try {
        return Object.prototype.hasOwnProperty.call(ctx, key);
    }
    catch {
        return false;
    }
}
function ownGet(ctx, key) {
    if (!hasOwn(ctx, key))
        return undefined;
    try {
        return ctx[key];
    }
    catch {
        return undefined;
    }
}
function getService(ctx, key) {
    try {
        return ctx[key];
    }
    catch {
        return undefined;
    }
}
function commandName(skill) {
    return skill.skillDir;
}
function commandDescription(skill) {
    return `Start Specline ${skill.id} (user slash only)`;
}
function sessionFromInvocation(invocation = {}) {
    if (invocation.projectDir || invocation.kind || invocation.sessionId || invocation.ask || invocation.runner) {
        return invocation;
    }
    const agent = invocation.agent && typeof invocation.agent === 'object'
        ? invocation.agent
        : undefined;
    const session = agent?.session && typeof agent.session === 'object'
        ? agent.session
        : undefined;
    const header = session?.header && typeof session.header === 'object'
        ? session.header
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
function contextMessage(text, source) {
    return {
        id: crypto.randomUUID(),
        role: 'user',
        content: [{ type: 'text', text }],
        source,
    };
}
function buildSkillInjection(skill) {
    const loaded = loadBakedSkill(skill.skillDir);
    if (!loaded)
        return null;
    return {
        name: loaded.name,
        text: renderSkillContent(loaded.name, loaded.body, loaded.dir),
    };
}
function buildSlashFollowup(skill, result, rawInput) {
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
    if (extra)
        return extra;
    return `请按照 ${skill.skillDir} 的 <skill_instructions> 开始，直接在当前对话里推进。`;
}
function deliverSkillAndFollowup(agent, skill, result, rawInput) {
    if (typeof agent?.steer !== 'function')
        return;
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
                }
                catch {
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
function toCommandResult(result) {
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
function registerSlash(ctx, skill, handler) {
    const meta = {
        'user-invocable': skill['user-invocable'],
        'disable-model-invocation': skill['disable-model-invocation'],
        id: skill.id,
        skillDir: skill.skillDir,
    };
    ctx.slash?.register?.(skill.slash, handler, meta);
    ctx.command?.(skill.slash, handler);
}
function registerSkillProvider(ctx, provider) {
    ctx.skills?.provide?.(provider);
    ctx.skills?.register?.(provider);
}
function registerHostCommands(ctx, sessionHandler) {
    const commands = getService(ctx, 'commands');
    if (typeof commands?.register !== 'function')
        return;
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
                        ? invocation.agent
                        : undefined;
                    deliverSkillAndFollowup(agent, skill, result, typeof invocation?.rawInput === 'string' ? invocation.rawInput : '');
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
export function apply(ctx = {}, config) {
    const pluginConfig = resolvePluginConfig(config);
    const skillProvider = createSkillProvider();
    const duck = {
        kind: ownGet(ctx, 'kind'),
        cwd: ownGet(ctx, 'cwd'),
        arm: ownGet(ctx, 'arm'),
        handleUninitializedProject: ownGet(ctx, 'handleUninitializedProject'),
        ask: ownGet(ctx, 'ask'),
        runner: ownGet(ctx, 'runner'),
    };
    const handler = (session = {}) => handleSlashCommand(session, {
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
