import { parseAgentYaml } from '../../lib/render-agents.mjs';
import { renderSkill, stripPlatformSections } from '../../lib/render.mjs';

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
export const DSH_VARS: DshRenderVars = {
  DISPATCH: '调用 specline_* 角色工具',
  CONFIRM: '直接向用户提问',
  LINT: '运行 bash lint 命令检查',
};

/**
 * stripPlatformSections target so DSH keeps the non-cursor block set
 * (claude,codex,opencode) and drops cursor-only sections.
 */
export const DSH_STRIP_PLATFORM = 'claude';

export const ROLE_YAML_NAMES = [
  'specline-spec-creator',
  'specline-spec-reviewer',
  'specline-frontend-dev',
  'specline-backend-dev',
  'specline-config-dev',
  'specline-config-reviewer',
  'specline-code-reviewer',
  'specline-test-writer',
  'specline-test-runner',
  'specline-explore-assistant',
] as const;

export type RoleYamlName = (typeof ROLE_YAML_NAMES)[number];

/** yaml `specline-spec-creator` → toolName `specline_spec_creator`. */
export function yamlNameToToolName(yamlName: string): string {
  return yamlName.replaceAll('-', '_');
}

export const ROLE_TOOL_NAMES = ROLE_YAML_NAMES.map(yamlNameToToolName);

/** Rewrite `role="specline-spec-creator"` to `toolName="specline_spec_creator"`. */
export function rewriteYamlRolesToToolNames(content: string): string {
  return content.replace(
    /role=["'](specline-[a-z0-9-]+)["']/g,
    (_match: string, yamlName: string) => `toolName="${yamlNameToToolName(yamlName)}"`,
  );
}

export function stripNonCursorPlatformSections(content: string): string {
  return stripPlatformSections(content, DSH_STRIP_PLATFORM);
}

/**
 * Render a core SKILL.md for DSH: substitute DSH_VARS, drop cursor-only
 * platform blocks, and map yaml role names onto specline_* toolNames.
 */
export function renderDshSkill(content: string): string {
  const withVars = renderSkill(content, DSH_VARS);
  const stripped = stripNonCursorPlatformSections(withVars);
  return rewriteYamlRolesToToolNames(stripped);
}

function stripMarkdownFrontmatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

/**
 * Build the specline_frontend_dev persona by inlining frontend-design
 * into the agent yaml instructions. Does not copy SKILL.md into dsh/.
 */
export function renderFrontendDevPersona(
  yamlContent: string,
  frontendDesignMarkdown: string,
): string {
  const { instructions } = parseAgentYaml(yamlContent);
  const designBody = stripMarkdownFrontmatter(frontendDesignMarkdown).trim();
  return `${instructions.trim()}\n\n## Canonical frontend-design\n\n${designBody}\n`;
}
