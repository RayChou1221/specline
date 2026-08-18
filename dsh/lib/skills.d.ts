export type SlashSkillFlags = {
    'user-invocable': true;
    'disable-model-invocation': true;
};
export type SlashSkill = SlashSkillFlags & {
    id: string;
    slash: string;
    skillDir: string;
};
/**
 * Ten user-facing Specline skills registered as slash commands at boot.
 * frontend-design is not a slash; using-specline is not injected.
 */
export declare const USER_SLASH_SKILLS: SlashSkill[];
/**
 * Boot-time policy: register slashes + SkillProvider only.
 * No using-specline prompt, no Specline agent preset, no frontend-design slash.
 */
export declare const BOOT_POLICY: {
    readonly injectUsingSpecline: false;
    readonly registerPreset: false;
    readonly frontendDesignAsSlash: false;
};
export declare function isUserSlashSkill(name: string): boolean;
