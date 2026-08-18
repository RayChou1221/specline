export declare const ARM_STEPS: readonly ["inject", "mountRoleTools", "enableWriteGuard", "bind"];
export type ArmStep = (typeof ARM_STEPS)[number];
export type ArmActions = {
    inject: (sessionId: string) => void;
    mountRoleTools: (sessionId: string) => void;
    enableWriteGuard: (sessionId: string) => void;
    bind: (sessionId: string) => void;
};
export type ArmInput = {
    projectDir: string;
    sessionId: string;
    actions?: Partial<ArmActions>;
};
export type ArmResult = {
    armed: boolean;
    sessionId: string | null;
    steps: ArmStep[];
    reason?: string;
};
export declare function isSpeclineProject(dir: string): boolean;
export type SpeclineProjectInspection = {
    dir: string;
    hasSpeclineDir: boolean;
    hasConfig: boolean;
};
/** Distinguish “no specline folder” from “folder exists but config.yaml is missing”. */
export declare function inspectSpeclineProject(dir: string): SpeclineProjectInspection;
/** Walk up from cwd so a session opened inside a subfolder still finds the repo. */
export declare function resolveSpeclineProjectDir(startDir: string, maxDepth?: number): string | null;
/**
 * Arm only the current session: inject Skill, mount role tools, enable write
 * guard, then bind. Does not write ~/.dsh progress or create .dsh/skills.
 * Refuses when the cwd is not a Specline project.
 */
export declare function arm(input: ArmInput): ArmResult;
