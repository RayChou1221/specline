import { PLATFORMS } from './deploy.mjs';

const VALID_PLATFORM_TEXT = PLATFORMS.join(', ');

/**
 * Parse the sync-only platform scope. Unlike init parsing, sync does not
 * accept `none` and never silently drops invalid entries.
 *
 * @param {unknown} raw
 * @returns {string[]}
 */
export function parseSyncPlatformList(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new TypeError(
      `--platform 需要值；有效平台: ${VALID_PLATFORM_TEXT}，或 all`,
    );
  }

  const tokens = raw.split(',').map((token) => token.trim().toLowerCase());
  if (tokens.some((token) => token === '')) {
    throw new TypeError(
      `--platform 包含空值；有效平台: ${VALID_PLATFORM_TEXT}，或 all`,
    );
  }
  if (tokens.includes('none')) {
    throw new TypeError('--platform none 不支持 specline sync；none 仅适用于 init');
  }
  if (tokens.includes('all')) {
    if (tokens.length !== 1) {
      throw new TypeError('--platform all 必须单独使用');
    }
    return [...PLATFORMS];
  }

  const invalid = [...new Set(tokens.filter((token) => !PLATFORMS.includes(token)))];
  if (invalid.length > 0) {
    throw new TypeError(
      `${invalid.join(', ')} 是无效的 sync 平台；有效平台: ${VALID_PLATFORM_TEXT}，或 all`,
    );
  }

  return PLATFORMS.filter((platform) => tokens.includes(platform));
}

/**
 * Decide how CLI sync should handle lock/legacy state without mutating it.
 *
 * @param {{ hasLock: boolean, hasLegacyMarker: boolean, dryRun: boolean }} state
 * @returns {'locked'|'legacy-real'|'legacy-dry-run'|'uninitialized'}
 */
export function decideLegacySyncMode({ hasLock, hasLegacyMarker, dryRun }) {
  if (hasLock) return 'locked';
  if (!hasLegacyMarker) return 'uninitialized';
  return dryRun ? 'legacy-dry-run' : 'legacy-real';
}
