import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  deployPlatforms,
  buildUpstreamLockData,
  readPlatformsYaml,
  writePlatformsYaml,
  countDeployedFiles,
  PLATFORMS,
} from './deploy.mjs';
import { writeLockFile } from './lock.mjs';
import { PACKAGE_ROOT } from './paths.mjs';
import { selectPlatforms } from './tty-select.mjs';

/**
 * @param {string} raw
 * @returns {string[]}
 */
export function parsePlatformList(raw) {
  if (!raw || raw === 'none') return [];
  if (raw === 'all') return [...PLATFORMS];
  return raw
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter((p) => PLATFORMS.includes(p));
}

/**
 * @param {boolean} isTTY
 * @param {string|undefined} platformArg
 */
export async function resolvePlatforms(isTTY, platformArg) {
  if (platformArg !== undefined) {
    return parsePlatformList(platformArg);
  }
  return selectPlatforms();
}

/**
 * @param {object} opts
 * @param {string} opts.target
 * @param {string[]} opts.platforms
 * @param {boolean} opts.withShellGuard
 * @param {string} opts.version
 * @param {boolean} [opts.force]
 */
export function runInit(opts) {
  const { target, platforms, withShellGuard, version, force } = opts;

  const speclineDir = join(target, 'specline');
  const alreadyInitialized = existsSync(join(speclineDir, '.specline-lock.yaml'));

  if (alreadyInitialized && !force && platforms.length > 0) {
    return runAppendPlatforms({ target, platforms, withShellGuard, version });
  }

  if (platforms.length === 0) {
    for (const dir of ['specline/changes/archive', 'specline/specs', 'specline/bin']) {
      const full = join(target, dir);
      if (!existsSync(full)) mkdirSync(full, { recursive: true });
    }
    writePlatformsYaml(target, []);

    const lockData = buildUpstreamLockData(version, PACKAGE_ROOT, { platforms: [] });
    writeLockFile(target, lockData);

    return { skills: 0, agents: 0, hooks: 0, platforms: [], appended: [] };
  }

  deployPlatforms(target, platforms, PACKAGE_ROOT, { withShellGuard, platforms });
  writePlatformsYaml(target, platforms);

  const lockData = buildUpstreamLockData(version, PACKAGE_ROOT, {
    withShellGuard,
    platforms,
  });
  writeLockFile(target, lockData);

  return { ...countDeployedFiles(target), platforms, appended: [] };
}

/**
 * Append new platforms without resetting existing configuration.
 * @param {object} opts
 * @param {string} opts.target
 * @param {string[]} opts.platforms - requested platforms
 * @param {boolean} opts.withShellGuard
 * @param {string} opts.version
 */
function runAppendPlatforms(opts) {
  const { target, platforms: requested, withShellGuard, version } = opts;

  const existingPlatforms = readPlatformsYaml(target) || [];
  const newPlatforms = requested.filter((p) => !existingPlatforms.includes(p));

  if (newPlatforms.length === 0) {
    return {
      skills: 0,
      agents: 0,
      hooks: 0,
      platforms: existingPlatforms,
      appended: [],
    };
  }

  deployPlatforms(target, newPlatforms, PACKAGE_ROOT, { withShellGuard, platforms: newPlatforms });

  const allPlatforms = [...existingPlatforms, ...newPlatforms];
  writePlatformsYaml(target, allPlatforms);

  const lockData = buildUpstreamLockData(version, PACKAGE_ROOT, {
    withShellGuard,
    platforms: allPlatforms,
  });
  writeLockFile(target, lockData);

  return {
    ...countDeployedFiles(target),
    platforms: allPlatforms,
    appended: newPlatforms,
  };
}
