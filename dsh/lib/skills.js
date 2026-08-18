const USER_ONLY_FLAGS = {
    'user-invocable': true,
    'disable-model-invocation': true,
};
function slashSkill(id) {
    return {
        id,
        slash: `/specline-${id}`,
        skillDir: `specline-${id}`,
        ...USER_ONLY_FLAGS,
    };
}
/**
 * Ten user-facing Specline skills registered as slash commands at boot.
 * frontend-design is not a slash; using-specline is not injected.
 */
export const USER_SLASH_SKILLS = [
    slashSkill('pipeline'),
    slashSkill('quickfix'),
    slashSkill('explore'),
    slashSkill('knowledge'),
    slashSkill('propose'),
    slashSkill('apply-change'),
    slashSkill('archive-change'),
    slashSkill('visualize'),
    slashSkill('diagram'),
    slashSkill('init-web'),
];
/**
 * Boot-time policy: register slashes + SkillProvider only.
 * No using-specline prompt, no Specline agent preset, no frontend-design slash.
 */
export const BOOT_POLICY = {
    injectUsingSpecline: false,
    registerPreset: false,
    frontendDesignAsSlash: false,
};
export function isUserSlashSkill(name) {
    return USER_SLASH_SKILLS.some((skill) => skill.skillDir === name || skill.slash === name || skill.id === name);
}
