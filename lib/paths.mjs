import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** npm 包根目录 */
export const PACKAGE_ROOT = join(__dirname, '..');

export const CORE_DIR = join(PACKAGE_ROOT, 'core');
export const ADAPTERS_DIR = join(PACKAGE_ROOT, 'adapters');
export const TEMPLATES_DIR = join(PACKAGE_ROOT, 'templates');

export const CORE_SKILLS = join(CORE_DIR, 'skills');
export const CORE_AGENTS = join(CORE_DIR, 'agents');
export const CORE_GATES = join(CORE_DIR, 'gates');
export const CORE_HOOKS = join(CORE_DIR, 'hooks');
export const CORE_BOOTSTRAP = join(CORE_DIR, 'bootstrap');
export const CORE_TEMPLATES = join(CORE_DIR, 'templates');
export const CORE_RUNTIMES = join(CORE_DIR, 'runtimes');

/** @param {string} [packageRoot] */
export function diagramRuntimeRoot(packageRoot = PACKAGE_ROOT) {
  return join(packageRoot, 'core', 'runtimes', 'drawio');
}

/** @param {string} platform */
export function adapterDir(platform) {
  return join(ADAPTERS_DIR, platform);
}

/** @param {string} platform */
export function deployManifestPath(platform) {
  return join(adapterDir(platform), 'deploy.json');
}

/** @param {string} projectDir */
export function projectSpeclineDir(projectDir) {
  return join(projectDir, 'specline');
}

/** @param {string} projectDir */
export function projectPlatformsPath(projectDir) {
  return join(projectSpeclineDir(projectDir), 'platforms.yaml');
}

export const PLATFORMS = ['cursor', 'claude', 'codex', 'opencode'];
