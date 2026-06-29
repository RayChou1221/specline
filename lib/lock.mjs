import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { computeFileHash, sha256 } from './hash.mjs';

/**
 * @typedef {Object} LockData
 * @property {string} version
 * @property {string} synced_at
 * @property {number} [schema]
 * @property {string[]} [platforms]
 * @property {Map<string, string>} files
 */

/** @param {string} projectDir */
export function lockFilePath(projectDir) {
  return join(projectDir, 'specline', '.specline-lock.yaml');
}

/** @param {string} projectDir @returns {LockData|null} */
export function readLockFile(projectDir) {
  const lockPath = lockFilePath(projectDir);
  if (!existsSync(lockPath)) return null;

  const lines = readFileSync(lockPath, 'utf-8').split('\n');
  /** @type {LockData} */
  const result = { version: '', synced_at: '', files: new Map() };
  let inFiles = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    if (trimmed.startsWith('version:')) {
      result.version = trimmed.slice('version:'.length).trim().replace(/^"(.*)"$/, '$1');
    } else if (trimmed.startsWith('synced_at:')) {
      result.synced_at = trimmed.slice('synced_at:'.length).trim().replace(/^"(.*)"$/, '$1');
    } else if (trimmed.startsWith('schema:')) {
      result.schema = Number(trimmed.slice('schema:'.length).trim());
    } else if (trimmed.startsWith('platforms:')) {
      const raw = trimmed.slice('platforms:'.length).trim();
      if (raw.startsWith('[')) {
        result.platforms = raw
          .slice(1, -1)
          .split(',')
          .map((p) => p.trim().replace(/^"(.*)"$/, '$1'))
          .filter(Boolean);
      }
    } else if (trimmed === 'files:') {
      inFiles = true;
    } else if (inFiles && trimmed.includes(':')) {
      const colonIdx = trimmed.indexOf(':');
      const key = trimmed.slice(0, colonIdx).trim();
      const value = trimmed.slice(colonIdx + 1).trim();
      result.files.set(key, value);
    }
  }

  return result;
}

/** @param {string} projectDir @param {LockData} lockData */
export function writeLockFile(projectDir, lockData) {
  const lockDir = join(projectDir, 'specline');
  if (!existsSync(lockDir)) {
    mkdirSync(lockDir, { recursive: true });
  }
  const lockPath = lockFilePath(projectDir);
  const lines = [
    '# Specline Lock File — 自动生成，请勿手动编辑',
    `version: "${lockData.version}"`,
    `synced_at: "${lockData.synced_at}"`,
  ];
  if (lockData.schema != null) {
    lines.push(`schema: ${lockData.schema}`);
  }
  if (lockData.platforms?.length) {
    lines.push(`platforms: [${lockData.platforms.map((p) => `"${p}"`).join(', ')}]`);
  }
  lines.push('files:');
  for (const [key, value] of lockData.files) {
    lines.push(`  ${key}: ${value}`);
  }
  writeFileSync(lockPath, lines.join('\n') + '\n', 'utf-8');
}

/** @returns {boolean} */
export function isV1Lock(lockData) {
  return lockData != null && lockData.schema == null && !lockData.platforms?.length;
}

/** @param {LockData} lockData @param {string} packageVersion @param {string[]} [platforms] */
export function migrateV1ToV2(lockData, packageVersion, platforms = ['cursor']) {
  lockData.schema = 2;
  lockData.version = packageVersion;
  lockData.platforms = [...platforms];
  return lockData;
}

export { computeFileHash, sha256 };
