import { USER_SLASH_SKILLS, BOOT_POLICY, type SlashSkill } from './skills.js';
import { isSpeclineProject, arm, inspectSpeclineProject, resolveSpeclineProjectDir, type ArmResult } from './arming.js';
import { ROLE_TOOL_NAMES } from './role-tools.js';
import { parentWriteAllowed } from './write-guard.js';
import { shouldInjectOrchestrator } from './session-inject.js';
import { shouldPromptInit, handleUninitializedProject, type InitAsk, type InitRunner, type RuntimeKind } from './project-init.js';
import { resolveGateInvocation } from './gate-client.js';
import { resolveHumanGate } from './human-gate.js';
import { buildDrawioPatchEntry, bundleEnablesDrawio } from './diagram-mcp.js';
import { visualizeUsesMcp } from './visualize-contract.js';
export { USER_SLASH_SKILLS, BOOT_POLICY, ROLE_TOOL_NAMES, isSpeclineProject, inspectSpeclineProject, resolveSpeclineProjectDir, arm, resolveGateInvocation, shouldPromptInit, resolveHumanGate, parentWriteAllowed, shouldInjectOrchestrator, buildDrawioPatchEntry, bundleEnablesDrawio, visualizeUsesMcp, };
export declare const name = "dsh-specline";
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
export type SlashHandler = (session?: SlashSession) => Promise<SlashDispatchResult>;
export type SpeclineSkillProvider = {
    'user-invocable': true;
    'disable-model-invocation': true;
    skills: readonly SlashSkill[];
    get: (name: string) => SlashSkill | undefined;
    skill: (request?: {
        name?: string;
    }) => never;
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
        register?: (name: string, handler: SlashHandler, meta?: Record<string, unknown>) => void;
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
            input?: {
                hint: string;
            };
            handler: (invocation?: Record<string, unknown>) => unknown;
        }) => unknown;
    };
};
/** Cordis loader reads these named exports. Do not default-export a function — unwrapExports prefers default and drops inject. */
export declare const inject: readonly ["commands"];
export type BootSurface = {
    slashes: readonly SlashSkill[];
    skillProvider: SpeclineSkillProvider;
    roleToolsRegistered: false;
};
export declare function createSkillProvider(): SpeclineSkillProvider;
export declare function handleSlashCommand(session?: SlashSession, ctx?: DuckContext): Promise<SlashDispatchResult>;
/**
 * Profile boot: register ten user-only slashes via ctx.commands.
 * Does not register role tools, using-specline, or an agent preset.
 * Never read ctx.config — Cordis throws without inject; plugin config is the second argument.
 */
export declare function apply(ctx?: DuckContext, config?: unknown): BootSurface;
export { apply as plugin };
