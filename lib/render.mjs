import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { PACKAGE_ROOT, adapterDir } from './paths.mjs';
import { parseAgentYaml } from './render-agents.mjs';

const DEFAULT_VARS = {
  cursor: {
    DISPATCH: '使用 Task 工具，subagent_type="{{ROLE}}"',
    CONFIRM: '使用 AskUserQuestion 工具',
    LINT: '使用 ReadLints 工具',
  },
  claude: {
    DISPATCH: '使用 dispatch_agent 工具，agent_name="{{ROLE}}"',
    CONFIRM: '直接向用户提问',
    LINT: '运行 bash lint 命令检查',
  },
  codex: {
    DISPATCH: '使用 dispatch_agent 工具，agent_name="{{ROLE}}"',
    CONFIRM: '直接向用户提问',
    LINT: '运行 bash lint 命令检查',
  },
  opencode: {
    DISPATCH: '使用 subagent 工具调度子 Agent',
    CONFIRM: '直接向用户提问',
    LINT: '运行 bash lint 命令检查',
  },
};

/**
 * Load vars from adapter deploy.json, fallback to DEFAULT_VARS.
 * @param {string} platform
 * @returns {{ DISPATCH: string, CONFIRM: string, LINT: string }}
 */
export function loadPlatformVars(platform) {
  const deployPath = join(adapterDir(platform), 'deploy.json');
  if (existsSync(deployPath)) {
    try {
      const manifest = JSON.parse(readFileSync(deployPath, 'utf-8'));
      if (manifest.vars) return manifest.vars;
    } catch { /* fallback */ }
  }
  return DEFAULT_VARS[platform] || DEFAULT_VARS.cursor;
}

/**
 * Replace {{DISPATCH}}, {{CONFIRM}}, {{LINT}} template variables.
 * Unknown {{...}} (including {{ROLE}}) are preserved as-is.
 * @param {string} content - skill source content
 * @param {{ DISPATCH?: string, CONFIRM?: string, LINT?: string }} vars
 * @returns {string}
 */
export function renderSkill(content, vars) {
  let result = content;
  if (vars.DISPATCH != null) result = result.replace(/\{\{DISPATCH\}\}/g, vars.DISPATCH);
  if (vars.CONFIRM != null) result = result.replace(/\{\{CONFIRM\}\}/g, vars.CONFIRM);
  if (vars.LINT != null) result = result.replace(/\{\{LINT\}\}/g, vars.LINT);
  return result;
}

/**
 * Strip platform-conditional sections.
 * Keeps sections matching targetPlatform, removes others.
 *
 * Format:
 *   <!-- platform:cursor -->
 *   ... cursor-specific content ...
 *   <!-- /platform:cursor -->
 *
 *   <!-- platform:claude,codex,opencode -->
 *   ... non-cursor content ...
 *   <!-- /platform:claude,codex,opencode -->
 *
 * @param {string} content
 * @param {string} targetPlatform
 * @returns {string}
 */
export function stripPlatformSections(content, targetPlatform) {
  return content.replace(
    /<!-- platform:([\w,]+) -->\n([\s\S]*?)<!-- \/platform:\1 -->\n?/g,
    (match, platforms, body) => {
      const platformList = platforms.split(',').map((p) => p.trim());
      if (platformList.includes(targetPlatform)) {
        return body;
      }
      return '';
    }
  );
}

/**
 * Full skill rendering pipeline: variable replacement + platform section stripping.
 * @param {string} content
 * @param {string} platform
 * @returns {string}
 */
export function renderSkillForPlatform(content, platform) {
  const vars = loadPlatformVars(platform);
  let result = renderSkill(content, vars);
  result = stripPlatformSections(result, platform);
  return result;
}

/**
 * Render agent YAML canonical to platform-specific format.
 * @param {string} yamlContent - raw YAML from core/agents/*.yaml
 * @param {string} platform
 * @returns {string|null} rendered content, or null if platform doesn't render agents
 */
export function renderAgent(yamlContent, platform) {
  if (platform === 'opencode') return null;

  const { name, description, instructions } = parseAgentYaml(yamlContent);

  if (platform === 'cursor' || platform === 'claude') {
    return `---\nname: ${name}\ndescription: ${description}\n---\n\n${instructions}\n`;
  }

  if (platform === 'codex') {
    const escapedName = (name || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const escapedDesc = (description || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const escapedInstructions = instructions.replace(/\\/g, '\\\\').replace(/"""/g, '\\"""');
    return `name = "${escapedName}"\ndescription = "${escapedDesc}"\n\n[instructions]\ndeveloper_instructions = """\n${escapedInstructions}\n"""\n`;
  }

  return null;
}
