import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { PACKAGE_ROOT } from './paths.mjs';
import { getCodexUpstreamManifest, writeManifestToProject } from './deploy.mjs';
import { mergeHooksJson } from './merge.mjs';

/**
 * Deploy Specline assets to a Codex project.
 *
 * Skills -> .agents/skills/  |  Agents -> .codex/agents/*.toml (YAML -> TOML)
 * Hook  -> .codex/hooks.json (copy or merge)
 *
 * @param {string} projectDir  Target project root
 * @param {{ packageRoot?: string, dryRun?: boolean }} [options]
 * @returns {{ filesWritten: string[], hooksAction: 'created'|'merged'|'unchanged' }}
 */
export function deployCodex(projectDir, options = {}) {
  const { packageRoot = PACKAGE_ROOT, dryRun = false } = options;

  const manifest = getCodexUpstreamManifest(packageRoot);

  const hooksRel = '.codex/hooks.json';
  manifest.delete(hooksRel);

  const filesWritten = [];

  if (!dryRun) {
    for (const dir of ['.agents/skills', '.codex/agents']) {
      const full = join(projectDir, dir);
      if (!existsSync(full)) mkdirSync(full, { recursive: true });
    }
    writeManifestToProject(projectDir, manifest);
  }
  for (const rel of manifest.keys()) filesWritten.push(rel);

  const hooksAction = mergeCodexHooksFile(projectDir, packageRoot, dryRun);

  filesWritten.push(hooksRel);
  return { filesWritten, hooksAction };
}

/**
 * Merge .codex/hooks.json with Specline hooks template.
 *
 * - Existing file: merge (preserve user-defined hooks, update specline hooks)
 * - No file: copy from adapters/codex/hooks.json
 *
 * @param {string} projectDir
 * @param {string} packageRoot
 * @param {boolean} dryRun
 * @returns {'created'|'merged'|'unchanged'}
 */
function mergeCodexHooksFile(projectDir, packageRoot, dryRun) {
  const hooksPath = join(projectDir, '.codex', 'hooks.json');
  const templatePath = join(packageRoot, 'adapters', 'codex', 'hooks.json');
  if (!existsSync(templatePath)) return 'unchanged';

  const templateContent = readFileSync(templatePath, 'utf-8');

  if (existsSync(hooksPath)) {
    const existingContent = readFileSync(hooksPath, 'utf-8');
    const merged = mergeHooksJson(existingContent, templateContent);
    if (merged === existingContent) return 'unchanged';

    if (!dryRun) {
      writeFileSync(hooksPath, merged, 'utf-8');
    }
    return 'merged';
  }

  if (!dryRun) {
    const dir = dirname(hooksPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    copyFileSync(templatePath, hooksPath);
  }
  return 'created';
}
