import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
} from 'fs';
import { join, dirname } from 'path';
import { computeFileHash, sha256 } from './hash.mjs';
import { readLockFile, writeLockFile, isV1Lock, migrateV1ToV2 } from './lock.mjs';
import {
  getCombinedUpstreamManifest,
  writeManifestToProject,
  readProjectPlatforms,
  writePlatformsYaml,
  filterManifestByPlatforms,
  hashManifestEntry,
  readUpstreamContent,
} from './deploy.mjs';
import { PACKAGE_ROOT } from './paths.mjs';
import { mergeHooksJson, mergeConfigYaml, backupBeforeOverwrite, mergeClaudeSettings } from './merge.mjs';

const PROTECTED_PREFIXES = [
  'specline/changes/',
  'specline/specs/',
  'specline/.pipeline-sessions.json',
];

const LEGACY_HOOK_SCRIPTS = [
  '.cursor/hooks/specline-phase-guard.sh',
  '.cursor/hooks/specline-agent-guard.sh',
  '.cursor/hooks/specline-reminder.sh',
  '.cursor/hooks/specline-auto-format.sh',
];

/** @param {string} relPath */
function isProtectedPath(relPath) {
  return PROTECTED_PREFIXES.some((prefix) => relPath === prefix || relPath.startsWith(prefix));
}

/**
 * Legacy Codex Skill copies under `.codex/skills` are non-authoritative after the
 * move to `.agents/skills`. Sync must not delete them (Agents/hooks are unaffected).
 * @param {string} relPath
 */
function isLegacyCodexSkillPath(relPath) {
  return relPath === '.codex/skills' || relPath.startsWith('.codex/skills/');
}

/** @param {string} relPath */
function isHooksJson(relPath) {
  return relPath === '.cursor/hooks.json' || relPath === '.codex/hooks.json';
}

/** @param {string} relPath */
function isClaudeSettings(relPath) {
  return relPath === '.claude/settings.json';
}

/** @param {string} relPath */
function isConfigYaml(relPath) {
  return relPath === 'specline/config.yaml';
}

/**
 * Three-way hash comparison to classify sync action.
 * @param {{ upstreamHash: string|null, lockHash: string|null, localHash: string|null, localExists: boolean }} info
 * @returns {'NEW'|'WILL_UPDATE'|'UNCHANGED'|'MODIFIED_ONLY'|'CONFLICT'|'UPSTREAM_REMOVED'}
 */
function classifyFile({ upstreamHash, lockHash, localHash, localExists }) {
  if (!upstreamHash && lockHash) return 'UPSTREAM_REMOVED';
  if (!upstreamHash) return 'UNCHANGED';
  if (!localExists) return 'NEW';

  if (!lockHash) {
    return localHash === upstreamHash ? 'UNCHANGED' : 'CONFLICT';
  }

  if (localHash === lockHash) {
    return upstreamHash === lockHash ? 'UNCHANGED' : 'WILL_UPDATE';
  }

  return upstreamHash === lockHash ? 'MODIFIED_ONLY' : 'CONFLICT';
}

/** Read package version from package.json */
function getPackageVersion(packageRoot) {
  try {
    return JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8')).version || '2.0.0';
  } catch {
    return '2.0.0';
  }
}

/**
 * @typedef {Object} SyncPlan
 * @property {string} path
 * @property {'NEW'|'WILL_UPDATE'|'UNCHANGED'|'MODIFIED_ONLY'|'CONFLICT'|'UPSTREAM_REMOVED'} type
 */

/**
 * @typedef {Object} SyncResult
 * @property {SyncPlan[]} plan
 * @property {{ newCount: number, updated: number, conflicted: number, skippedModified: number, unchanged: number, upstreamRemoved: number }} stats
 * @property {boolean} migrated
 */

/**
 * Main sync logic for multi-platform projects.
 *
 * @param {string} projectDir
 * @param {{ platforms?: string[], dryRun?: boolean, packageRoot?: string }} [options]
 * @returns {SyncResult}
 */
export function runSync(projectDir, options = {}) {
  const { dryRun = false, packageRoot = PACKAGE_ROOT } = options;

  const lockData = readLockFile(projectDir);
  if (!lockData) {
    throw new Error('No lock file found. Run `specline init` first.');
  }

  const migrated = isV1Lock(lockData);
  if (migrated) {
    const inferredPlatforms = readProjectPlatforms(projectDir);
    migrateV1ToV2(lockData, lockData.version || '2.0.0', inferredPlatforms);
  }

  const syncPlatforms = options.platforms?.length
    ? options.platforms
    : readProjectPlatforms(projectDir);

  const manifest = getCombinedUpstreamManifest(syncPlatforms, packageRoot);

  const allPaths = new Set();
  for (const p of manifest.keys()) allPaths.add(p);
  for (const p of lockData.files.keys()) {
    if (!isProtectedPath(p)) allPaths.add(p);
  }
  for (const legacy of LEGACY_HOOK_SCRIPTS) {
    if (lockData.files.has(legacy) || existsSync(join(projectDir, legacy))) {
      allPaths.add(legacy);
    }
  }

  /** @type {SyncPlan[]} */
  const plan = [];

  for (const relPath of allPaths) {
    if (isProtectedPath(relPath)) continue;

    const entry = manifest.get(relPath);
    const upstreamHash = entry ? hashManifestEntry(entry) : null;
    const lockHash = lockData.files.get(relPath) || null;
    const localPath = join(projectDir, relPath);
    const localExists = existsSync(localPath);
    const localHash = localExists ? computeFileHash(localPath) : null;

    const type = classifyFile({ upstreamHash, lockHash, localHash, localExists });
    // Drop legacy Codex Skills from lock tracking without deleting user content.
    if (type === 'UPSTREAM_REMOVED' && isLegacyCodexSkillPath(relPath)) continue;
    plan.push({ path: relPath, type });
  }

  const stats = { newCount: 0, updated: 0, conflicted: 0, skippedModified: 0, unchanged: 0, upstreamRemoved: 0 };
  for (const item of plan) {
    switch (item.type) {
      case 'NEW': stats.newCount++; break;
      case 'WILL_UPDATE': stats.updated++; break;
      case 'CONFLICT': stats.conflicted++; break;
      case 'MODIFIED_ONLY': stats.skippedModified++; break;
      case 'UNCHANGED': stats.unchanged++; break;
      case 'UPSTREAM_REMOVED': stats.upstreamRemoved++; break;
    }
  }

  if (dryRun) {
    return { plan, stats, migrated };
  }

  const newFiles = new Map();

  for (const item of plan) {
    const destPath = join(projectDir, item.path);

    switch (item.type) {
      case 'UNCHANGED':
      case 'MODIFIED_ONLY': {
        if (existsSync(destPath)) {
          newFiles.set(item.path, computeFileHash(destPath));
        }
        break;
      }

      case 'UPSTREAM_REMOVED': {
        if (existsSync(destPath)) {
          try { unlinkSync(destPath); } catch { /* ignore */ }
        }
        break;
      }

      case 'NEW':
      case 'WILL_UPDATE':
      case 'CONFLICT': {
        const entry = manifest.get(item.path);
        if (!entry) break;

        const destDir = dirname(destPath);
        if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

        if (isClaudeSettings(item.path)) {
          const existingContent = existsSync(destPath) ? readFileSync(destPath, 'utf-8') : '{}';
          const upstreamContent = readUpstreamContent(item.path, manifest);
          if (upstreamContent) {
            const merged = mergeClaudeSettings(existingContent, upstreamContent);
            writeFileSync(destPath, merged, 'utf-8');
            newFiles.set(item.path, sha256(merged));
          }
        } else if (isHooksJson(item.path)) {
          const existingContent = existsSync(destPath) ? readFileSync(destPath, 'utf-8') : '{}';
          const upstreamContent = readUpstreamContent(item.path, manifest);
          if (upstreamContent) {
            const merged = mergeHooksJson(existingContent, upstreamContent);
            writeFileSync(destPath, merged, 'utf-8');
            newFiles.set(item.path, sha256(merged));
          }
        } else if (isConfigYaml(item.path)) {
          const existingContent = existsSync(destPath) ? readFileSync(destPath, 'utf-8') : '';
          const upstreamContent = readUpstreamContent(item.path, manifest);
          if (upstreamContent) {
            const merged = mergeConfigYaml(existingContent, upstreamContent);
            writeFileSync(destPath, merged, 'utf-8');
            newFiles.set(item.path, sha256(merged));
          }
        } else {
          if (item.type === 'CONFLICT' && existsSync(destPath)) {
            backupBeforeOverwrite(destPath);
          }
          const subManifest = new Map([[item.path, entry]]);
          writeManifestToProject(projectDir, subManifest);
          newFiles.set(item.path, computeFileHash(destPath));
        }
        break;
      }
    }
  }

  const version = getPackageVersion(packageRoot);
  writeLockFile(projectDir, {
    version,
    synced_at: new Date().toISOString(),
    schema: 2,
    platforms: [...syncPlatforms],
    files: newFiles,
  });
  writePlatformsYaml(projectDir, syncPlatforms);

  return { plan, stats, migrated };
}


