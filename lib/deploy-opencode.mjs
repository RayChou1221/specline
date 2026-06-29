import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { PACKAGE_ROOT } from './paths.mjs';
import { getOpencodeUpstreamManifest, writeManifestToProject } from './deploy.mjs';
import { mergeOpencodeJson } from './merge.mjs';

const PLUGIN_REL = 'specline/opencode-plugin/plugin.js';
const OPENCODE_JSON_REL = 'opencode.json';
const PLUGIN_ENTRY = './specline/opencode-plugin';

/**
 * Deploy Specline assets to an OpenCode project.
 *
 * Skills  -> .opencode/skills/  |  Plugin -> specline/opencode-plugin/plugin.js
 * Merge opencode.json plugin entry. No agent files generated.
 *
 * @param {string} projectDir  Target project root
 * @param {{ packageRoot?: string, dryRun?: boolean }} [options]
 * @returns {{ filesWritten: string[], opencodeJsonAction: 'created'|'merged'|'unchanged' }}
 */
export function deployOpencode(projectDir, options = {}) {
  const { packageRoot = PACKAGE_ROOT, dryRun = false } = options;

  const manifest = getOpencodeUpstreamManifest(packageRoot);

  manifest.delete(PLUGIN_REL);
  manifest.delete(OPENCODE_JSON_REL);

  const filesWritten = [];

  if (!dryRun) {
    for (const dir of ['.opencode/skills', 'specline/opencode-plugin']) {
      const full = join(projectDir, dir);
      if (!existsSync(full)) mkdirSync(full, { recursive: true });
    }
    writeManifestToProject(projectDir, manifest);
  }
  for (const rel of manifest.keys()) filesWritten.push(rel);

  deployPluginJs(projectDir, packageRoot, dryRun);
  filesWritten.push(PLUGIN_REL);

  const opencodeJsonAction = mergeOpencodeJsonFile(projectDir, dryRun);
  filesWritten.push(OPENCODE_JSON_REL);

  return { filesWritten, opencodeJsonAction };
}

/**
 * Copy plugin.js from adapters/opencode/ to specline/opencode-plugin/.
 */
function deployPluginJs(projectDir, packageRoot, dryRun) {
  const src = join(packageRoot, 'adapters', 'opencode', 'plugin.js');
  const dest = join(projectDir, PLUGIN_REL);
  if (!existsSync(src)) return;

  if (!dryRun) {
    const dir = dirname(dest);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    copyFileSync(src, dest);
  }
}

/**
 * Merge opencode.json in project root.
 *
 * - Existing file: ensure "plugin" array includes specline entry, preserve rest
 * - No file: create minimal { "plugin": ["./specline/opencode-plugin"] }
 *
 * @param {string} projectDir
 * @param {boolean} dryRun
 * @returns {'created'|'merged'|'unchanged'}
 */
function mergeOpencodeJsonFile(projectDir, dryRun) {
  const jsonPath = join(projectDir, OPENCODE_JSON_REL);

  if (existsSync(jsonPath)) {
    const existingContent = readFileSync(jsonPath, 'utf-8');
    const merged = mergeOpencodeJson(existingContent, PLUGIN_ENTRY);
    if (merged === existingContent) return 'unchanged';

    if (!dryRun) {
      writeFileSync(jsonPath, merged, 'utf-8');
    }
    return 'merged';
  }

  if (!dryRun) {
    const fresh = mergeOpencodeJson('', PLUGIN_ENTRY);
    writeFileSync(jsonPath, fresh, 'utf-8');
  }
  return 'created';
}
