export type SlashSkillFlags = {
  'user-invocable': true;
  'disable-model-invocation': true;
};

export type SlashSkill = SlashSkillFlags & {
  id: string;
  slash: string;
  skillDir: string;
};

const USER_ONLY_FLAGS: SlashSkillFlags = {
  'user-invocable': true,
  'disable-model-invocation': true,
};

function slashSkill(id: string): SlashSkill {
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
export const USER_SLASH_SKILLS: SlashSkill[] = [
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
} as const;

export function isUserSlashSkill(name: string): boolean {
  return USER_SLASH_SKILLS.some(
    (skill) => skill.skillDir === name || skill.slash === name || skill.id === name,
  );
}
