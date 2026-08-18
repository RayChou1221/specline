export declare const ASSET_SKILLS_DIR = "skills";
export declare const ASSET_PERSONAS_DIR = "personas";
export declare const FRONTEND_DESIGN_SKILL = "frontend-design";
export declare const FRONTEND_DEV_YAML = "specline-frontend-dev.yaml";
export declare const SKIP_SKILL_DIRS: Set<string>;
export type BuildAssetsOptions = {
    coreDir?: string;
    outDir?: string;
    cwd?: string;
    fromDir?: string;
};
export type BuildAssetsResult = {
    coreDir: string;
    outDir: string;
    skills: string[];
    personas: string[];
};
/**
 * Locate repo `core/` from dsh/src (../../core), cwd = dsh/, or cwd = repo root.
 */
export declare function resolveCoreDir(options?: {
    cwd?: string;
    fromDir?: string;
}): string;
export declare function resolveAssetsDir(): string;
/**
 * Read core/skills and core/agents, bake DSH Skill/persona assets.
 * Published output does not require the source tree core/ at runtime.
 */
export declare function buildAssets(options?: BuildAssetsOptions): BuildAssetsResult;
export declare function main(argv?: string[]): BuildAssetsResult;
