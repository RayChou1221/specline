/**
 * Load baked Skill markdown from dsh/assets at runtime.
 * Build-time rendering lives in build-assets.ts; this module only reads the
 * published files so the slash path can inject Skill bodies without core/.
 */
export declare function resolveSkillsDir(): string;
export type BakedSkill = {
    name: string;
    description: string;
    dir: string;
    body: string;
};
export declare function loadBakedSkill(skillDir: string): BakedSkill | null;
/**
 * Match DSH's canonical <skill_content> wrapper so the model sees the same
 * shape as a native user-invocable skill invocation.
 */
export declare function renderSkillContent(name: string, content: string, resourceDir?: string): string;
