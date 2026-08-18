export type DshRenderVars = {
    DISPATCH: string;
    CONFIRM: string;
    LINT: string;
};
/**
 * DSH build-time template vars. DISPATCH names the specline_* role tools;
 * CONFIRM is a user question (Human Gate still uses ctx.approval);
 * LINT is a bash lint command.
 */
export declare const DSH_VARS: DshRenderVars;
/**
 * stripPlatformSections target so DSH keeps the non-cursor block set
 * (claude,codex,opencode) and drops cursor-only sections.
 */
export declare const DSH_STRIP_PLATFORM = "claude";
export declare const ROLE_YAML_NAMES: readonly ["specline-spec-creator", "specline-spec-reviewer", "specline-frontend-dev", "specline-backend-dev", "specline-config-dev", "specline-config-reviewer", "specline-code-reviewer", "specline-test-writer", "specline-test-runner", "specline-explore-assistant"];
export type RoleYamlName = (typeof ROLE_YAML_NAMES)[number];
/** yaml `specline-spec-creator` → toolName `specline_spec_creator`. */
export declare function yamlNameToToolName(yamlName: string): string;
export declare const ROLE_TOOL_NAMES: string[];
/** Rewrite `role="specline-spec-creator"` to `toolName="specline_spec_creator"`. */
export declare function rewriteYamlRolesToToolNames(content: string): string;
export declare function stripNonCursorPlatformSections(content: string): string;
/**
 * Render a core SKILL.md for DSH: substitute DSH_VARS, drop cursor-only
 * platform blocks, and map yaml role names onto specline_* toolNames.
 */
export declare function renderDshSkill(content: string): string;
/**
 * Build the specline_frontend_dev persona by inlining frontend-design
 * into the agent yaml instructions. Does not copy SKILL.md into dsh/.
 */
export declare function renderFrontendDevPersona(yamlContent: string, frontendDesignMarkdown: string): string;
