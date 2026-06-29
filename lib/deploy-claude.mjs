import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { PACKAGE_ROOT } from './paths.mjs';
import { getClaudeUpstreamManifest, writeManifestToProject } from './deploy.mjs';
import { mergeClaudeSettings, backupBeforeOverwrite } from './merge.mjs';

/**
 * Deploy Specline assets to a Claude Code project.
 *
 * Skills  -> .claude/skills/  |  Agents -> .claude/agents/*.md
 * Hook   -> merge .claude/settings.json (SessionStart)
 *
 * @param {string} projectDir  Target project root
 * @param {{ packageRoot?: string, dryRun?: boolean }} [options]
 * @returns {{ filesWritten: string[], settingsAction: 'created'|'merged'|'unchanged' }}
 */
export function deployClaude(projectDir, options = {}) {
  const { packageRoot = PACKAGE_ROOT, dryRun = false } = options;

  const manifest = getClaudeUpstreamManifest(packageRoot);

  const settingsRel = '.claude/settings.json';
  manifest.delete(settingsRel);

  const filesWritten = [];

  if (!dryRun) {
    for (const dir of ['.claude/skills', '.claude/agents']) {
      const full = join(projectDir, dir);
      if (!existsSync(full)) mkdirSync(full, { recursive: true });
    }
    writeManifestToProject(projectDir, manifest);
  }
  for (const rel of manifest.keys()) filesWritten.push(rel);

  const settingsAction = mergeClaudeSettingsFile(projectDir, packageRoot, dryRun);

  filesWritten.push(settingsRel);
  return { filesWritten, settingsAction };
}

/**
 * Merge .claude/settings.json with Specline hooks template.
 *
 * - Existing file: backup → merge hooks.SessionStart → preserve user config
 * - No file: create with hooks section only
 *
 * @param {string} projectDir
 * @param {string} packageRoot
 * @param {boolean} dryRun
 * @returns {'created'|'merged'|'unchanged'}
 */
function mergeClaudeSettingsFile(projectDir, packageRoot, dryRun) {
  const settingsPath = join(projectDir, '.claude', 'settings.json');
  const templatePath = join(packageRoot, 'adapters', 'claude', 'hooks', 'hooks.json');
  if (!existsSync(templatePath)) return 'unchanged';

  const templateContent = readFileSync(templatePath, 'utf-8');

  if (existsSync(settingsPath)) {
    const existingContent = readFileSync(settingsPath, 'utf-8');
    const merged = mergeClaudeSettings(existingContent, templateContent);
    if (merged === existingContent) return 'unchanged';

    if (!dryRun) {
      backupBeforeOverwrite(settingsPath);
      writeFileSync(settingsPath, merged, 'utf-8');
    }
    return 'merged';
  }

  if (!dryRun) {
    const dir = dirname(settingsPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const freshSettings = mergeClaudeSettings('', templateContent);
    writeFileSync(settingsPath, freshSettings, 'utf-8');
  }
  return 'created';
}
