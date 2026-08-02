import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  statSync,
} from 'fs';
import { join, dirname } from 'path';
import { computeFileHash, sha256 } from './hash.mjs';
import { readLockFile, writeLockFile, isV1Lock, migrateV1ToV2 } from './lock.mjs';
import {
  getCombinedUpstreamManifest,
  writeManifestToProject,
  readPlatformsYaml,
  detectProjectPlatforms,
  writePlatformsYaml,
  pathIsInSyncScope,
  validateManagedRelativePath,
  hashManifestEntry,
  readUpstreamContent,
  PLATFORMS,
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
  if (!upstreamHash && lockHash) {
    if (!localExists || localHash === lockHash) return 'UPSTREAM_REMOVED';
    return 'CONFLICT';
  }
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

/** @param {unknown} lockData */
function cloneLockData(lockData) {
  if (!lockData || typeof lockData !== 'object' || !(lockData.files instanceof Map)) {
    throw new TypeError('Invalid lock data: expected an object with a files Map.');
  }
  if (typeof lockData.version !== 'string' || !lockData.version) {
    throw new TypeError('Invalid lock data: version is required.');
  }
  if (lockData.schema != null && lockData.schema !== 2) {
    throw new TypeError(`Unsupported lock schema: ${lockData.schema}.`);
  }

  const cloned = {
    ...lockData,
    files: new Map(lockData.files),
  };
  if (Object.prototype.hasOwnProperty.call(lockData, 'platforms')) {
    if (!Array.isArray(lockData.platforms)) {
      throw new TypeError('Invalid lock data: platforms must be an array.');
    }
    for (const platform of lockData.platforms) {
      if (typeof platform !== 'string' || !PLATFORMS.includes(platform)) {
        throw new TypeError(`Invalid lock data: unsupported platform ${JSON.stringify(platform)}.`);
      }
    }
    cloned.platforms = [...lockData.platforms];
  }
  return cloned;
}

/**
 * Resolve configured platforms without re-reading the disk lock. This is
 * important for ephemeral planning, where the supplied lock is authoritative.
 * @param {string} projectDir
 * @param {object} lockData
 */
function validateDiskLockSyntax(projectDir) {
  const lockPath = join(projectDir, 'specline', '.specline-lock.yaml');
  const lines = readFileSync(lockPath, 'utf-8').split('\n');
  const platformLines = lines.filter((line) => line.trim().startsWith('platforms:'));
  if (platformLines.length > 1) {
    throw new TypeError('Invalid lock data: duplicate platforms metadata.');
  }
  if (platformLines.length === 0) return;

  const raw = platformLines[0].trim().slice('platforms:'.length).trim();
  if (!raw.startsWith('[') || !raw.endsWith(']')) {
    throw new TypeError('Invalid lock data: malformed platforms metadata.');
  }
  const body = raw.slice(1, -1).trim();
  if (!body) return;
  const entries = body.split(',');
  if (entries.some((entry) => entry.trim() === '')) {
    throw new TypeError('Invalid lock data: malformed platforms metadata.');
  }
  for (const entry of entries) {
    const value = entry.trim();
    const quoted = (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"));
    const platform = quoted ? value.slice(1, -1) : value;
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(platform) || !PLATFORMS.includes(platform)) {
      throw new TypeError(`Invalid lock data: unsupported platform ${JSON.stringify(platform)}.`);
    }
  }
}

/** Validate a managed path immediately before accessing the project filesystem. */
function managedLocalPath(projectDir, relPath) {
  if (validateManagedRelativePath(projectDir, relPath) === null) {
    throw new TypeError(`Unsafe managed path ${JSON.stringify(relPath)}.`);
  }
  return join(projectDir, relPath);
}

/** Validate all untrusted lock keys before scope checks or filesystem access. */
function validateLockFileEntries(projectDir, lockData) {
  for (const [relPath, hash] of lockData.files) {
    if (validateManagedRelativePath(projectDir, relPath) === null) {
      throw new TypeError(`Invalid lock data: unsafe managed path ${JSON.stringify(relPath)}.`);
    }
    if (typeof hash !== 'string' || hash.length === 0) {
      throw new TypeError(`Invalid lock data: malformed hash for ${JSON.stringify(relPath)}.`);
    }
  }
}

function resolveConfiguredPlatforms(projectDir, lockData) {
  const yamlPlatforms = readPlatformsYaml(projectDir);
  if (yamlPlatforms !== null) {
    return PLATFORMS.filter((platform) => yamlPlatforms.includes(platform));
  }
  if (
    lockData.schema === 2
    && Object.prototype.hasOwnProperty.call(lockData, 'platforms')
  ) {
    return PLATFORMS.filter((platform) => lockData.platforms.includes(platform));
  }
  const detected = detectProjectPlatforms(projectDir);
  return detected.length ? detected : ['cursor'];
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
 * Build a plan using only the supplied lock as the baseline.
 * @param {string} projectDir
 * @param {object} inputLockData
 * @param {{ platforms?: string[], packageRoot?: string }} [options]
 */
function buildSyncPlan(projectDir, inputLockData, options = {}) {
  if (
    typeof projectDir !== 'string'
    || !projectDir
    || !existsSync(projectDir)
    || !statSync(projectDir).isDirectory()
  ) {
    throw new TypeError('Invalid project directory.');
  }
  const allowedOptions = new Set(['platforms', 'packageRoot']);
  for (const key of Object.keys(options)) {
    if (!allowedOptions.has(key)) {
      throw new TypeError(`Unsupported sync planning option: ${key}.`);
    }
  }
  if (
    options.platforms !== undefined
    && (
      !Array.isArray(options.platforms)
      || options.platforms.some((platform) => !PLATFORMS.includes(platform))
    )
  ) {
    throw new TypeError('Invalid target platforms.');
  }
  if (options.packageRoot !== undefined && typeof options.packageRoot !== 'string') {
    throw new TypeError('Invalid package root.');
  }

  const packageRoot = options.packageRoot || PACKAGE_ROOT;
  const lockData = cloneLockData(inputLockData);
  validateLockFileEntries(projectDir, lockData);
  const configuredPlatforms = resolveConfiguredPlatforms(projectDir, lockData);
  const migrated = isV1Lock(lockData);
  if (migrated) {
    migrateV1ToV2(
      lockData,
      getPackageVersion(packageRoot),
      configuredPlatforms,
    );
  }

  const targetPlatforms = options.platforms === undefined
    ? configuredPlatforms
    : [...options.platforms];
  const manifest = getCombinedUpstreamManifest(targetPlatforms, packageRoot);
  for (const relPath of manifest.keys()) {
    managedLocalPath(projectDir, relPath);
  }
  const allPaths = new Set(manifest.keys());

  for (const relPath of lockData.files.keys()) {
    if (!isProtectedPath(relPath) && pathIsInSyncScope(relPath, targetPlatforms, projectDir)) {
      allPaths.add(relPath);
    }
  }
  for (const legacy of LEGACY_HOOK_SCRIPTS) {
    if (
      pathIsInSyncScope(legacy, targetPlatforms, projectDir)
      && (lockData.files.has(legacy) || existsSync(managedLocalPath(projectDir, legacy)))
    ) {
      allPaths.add(legacy);
    }
  }

  /** @type {SyncPlan[]} */
  const plan = [];
  for (const relPath of allPaths) {
    if (isProtectedPath(relPath) || !pathIsInSyncScope(relPath, targetPlatforms, projectDir)) {
      continue;
    }

    const entry = manifest.get(relPath);
    const upstreamHash = entry ? hashManifestEntry(entry) : null;
    const lockHash = lockData.files.get(relPath) || null;
    const localExists = existsSync(managedLocalPath(projectDir, relPath));
    const localHash = localExists
      ? computeFileHash(managedLocalPath(projectDir, relPath))
      : null;
    const type = classifyFile({ upstreamHash, lockHash, localHash, localExists });

    // Stop tracking legacy Codex Skill copies without deleting user content.
    if (type === 'UPSTREAM_REMOVED' && isLegacyCodexSkillPath(relPath)) continue;
    plan.push({
      path: relPath,
      type,
      removalConflict: !upstreamHash && Boolean(lockHash) && localExists && localHash !== lockHash,
    });
  }

  const stats = {
    newCount: 0,
    updated: 0,
    conflicted: 0,
    skippedModified: 0,
    unchanged: 0,
    upstreamRemoved: 0,
  };
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

  return {
    result: { plan, stats, migrated },
    lockData,
    configuredPlatforms,
    targetPlatforms,
    manifest,
  };
}

/**
 * Plan sync against an in-memory lock without reading or writing the disk lock.
 *
 * @param {string} projectDir
 * @param {object} lockData
 * @param {{ platforms?: string[], packageRoot?: string }} [options]
 * @returns {SyncResult}
 */
export function planSyncWithEphemeralLock(projectDir, lockData, options = {}) {
  return buildSyncPlan(projectDir, lockData, options).result;
}

/**
 * Backward-compatible migration helper used by migration-focused unit tests.
 * Migration is performed in memory; runSync owns persistence.
 *
 * @param {string} projectDir
 * @param {string} packageVersion
 * @param {(message: string) => void} [log]
 */
export function migrateLockIfNeeded(projectDir, packageVersion, log = () => {}) {
  const diskLock = readLockFile(projectDir);
  if (!diskLock) return { migrated: false, lockData: null };

  const lockData = cloneLockData(diskLock);
  const migrated = isV1Lock(lockData);
  if (migrated) {
    const configuredPlatforms = resolveConfiguredPlatforms(projectDir, lockData);
    migrateV1ToV2(lockData, packageVersion, configuredPlatforms);
    log('Lock file migrated v1→v2.');
  }
  return { migrated, lockData };
}

/**
 * Main sync logic for multi-platform projects.
 *
 * @param {string} projectDir
 * @param {{ platforms?: string[], dryRun?: boolean, packageRoot?: string }} [options]
 * @returns {SyncResult}
 */
export function runSync(projectDir, options = {}) {
  const { dryRun = false, packageRoot = PACKAGE_ROOT } = options;

  const diskLock = readLockFile(projectDir);
  if (!diskLock) {
    throw new Error('No lock file found. Run `specline init` first.');
  }
  validateDiskLockSyntax(projectDir);

  const {
    result,
    lockData,
    configuredPlatforms,
    targetPlatforms,
    manifest,
  } = buildSyncPlan(projectDir, diskLock, { platforms: options.platforms, packageRoot });
  const { plan, stats, migrated } = result;

  if (dryRun) {
    return result;
  }

  // Copy all old entries, then replace only baselines in the active scope.
  // Removal baselines stay present until unlink succeeds or absence is confirmed.
  const nextFiles = new Map(lockData.files);
  const preservedBaselines = new Set(
    plan
      .filter((item) => item.type === 'UPSTREAM_REMOVED' || item.removalConflict)
      .map((item) => item.path),
  );
  for (const relPath of lockData.files.keys()) {
    if (
      !isProtectedPath(relPath)
      && pathIsInSyncScope(relPath, targetPlatforms, projectDir)
      && !preservedBaselines.has(relPath)
    ) {
      nextFiles.delete(relPath);
    }
  }

  for (const item of plan) {
    switch (item.type) {
      case 'UNCHANGED':
      case 'MODIFIED_ONLY': {
        if (existsSync(managedLocalPath(projectDir, item.path))) {
          nextFiles.set(
            item.path,
            computeFileHash(managedLocalPath(projectDir, item.path)),
          );
        }
        break;
      }

      case 'UPSTREAM_REMOVED': {
        const localPath = managedLocalPath(projectDir, item.path);
        const baselineHash = lockData.files.get(item.path);

        // Revalidate immediately before deletion. A local edit made after plan
        // construction converts removal into a conflict and remains tracked
        // against the original baseline for a future explicit resolution.
        if (existsSync(localPath)) {
          const currentHash = computeFileHash(localPath);
          if (!baselineHash || currentHash !== baselineHash) {
            item.type = 'CONFLICT';
            item.removalConflict = true;
            stats.upstreamRemoved--;
            stats.conflicted++;
            break;
          }
        }

        try {
          unlinkSync(localPath);
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
        nextFiles.delete(item.path);
        break;
      }

      case 'NEW':
      case 'WILL_UPDATE':
      case 'CONFLICT': {
        const entry = manifest.get(item.path);
        if (!entry) break;

        const destDir = dirname(managedLocalPath(projectDir, item.path));
        if (!existsSync(destDir)) {
          mkdirSync(dirname(managedLocalPath(projectDir, item.path)), { recursive: true });
        }

        if (isClaudeSettings(item.path)) {
          const existingContent = existsSync(managedLocalPath(projectDir, item.path))
            ? readFileSync(managedLocalPath(projectDir, item.path), 'utf-8')
            : '{}';
          const upstreamContent = readUpstreamContent(item.path, manifest);
          if (upstreamContent) {
            const merged = mergeClaudeSettings(existingContent, upstreamContent);
            writeFileSync(managedLocalPath(projectDir, item.path), merged, 'utf-8');
            nextFiles.set(item.path, sha256(merged));
          }
        } else if (isHooksJson(item.path)) {
          const existingContent = existsSync(managedLocalPath(projectDir, item.path))
            ? readFileSync(managedLocalPath(projectDir, item.path), 'utf-8')
            : '{}';
          const upstreamContent = readUpstreamContent(item.path, manifest);
          if (upstreamContent) {
            const merged = mergeHooksJson(existingContent, upstreamContent);
            writeFileSync(managedLocalPath(projectDir, item.path), merged, 'utf-8');
            nextFiles.set(item.path, sha256(merged));
          }
        } else if (isConfigYaml(item.path)) {
          const existingContent = existsSync(managedLocalPath(projectDir, item.path))
            ? readFileSync(managedLocalPath(projectDir, item.path), 'utf-8')
            : '';
          const upstreamContent = readUpstreamContent(item.path, manifest);
          if (upstreamContent) {
            const merged = mergeConfigYaml(existingContent, upstreamContent);
            writeFileSync(managedLocalPath(projectDir, item.path), merged, 'utf-8');
            nextFiles.set(item.path, sha256(merged));
          }
        } else {
          if (
            item.type === 'CONFLICT'
            && existsSync(managedLocalPath(projectDir, item.path))
          ) {
            backupBeforeOverwrite(managedLocalPath(projectDir, item.path));
          }
          const subManifest = new Map([[item.path, entry]]);
          managedLocalPath(projectDir, item.path);
          writeManifestToProject(projectDir, subManifest);
          nextFiles.set(
            item.path,
            computeFileHash(managedLocalPath(projectDir, item.path)),
          );
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
    platforms: [...configuredPlatforms],
    files: nextFiles,
  });
  if (migrated && readPlatformsYaml(projectDir) === null) {
    writePlatformsYaml(projectDir, configuredPlatforms);
  }

  return result;
}


