import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Parse a simple YAML list from platforms.yaml.
 * Handles both inline `[cursor, claude]` and block `- cursor` formats.
 * @param {string} content
 * @returns {string[]}
 */
export function parsePlatformsYaml(content) {
  const platforms = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    if (trimmed.startsWith('- ')) {
      platforms.push(trimmed.slice(2).trim().replace(/^["']|["']$/g, ''));
      continue;
    }

    const inlineMatch = trimmed.match(/^platforms:\s*\[(.+)\]/);
    if (inlineMatch) {
      return inlineMatch[1]
        .split(',')
        .map((p) => p.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    }

    if (trimmed.startsWith('platforms:')) continue;
  }

  return platforms;
}

/**
 * Read the platforms list from specline/platforms.yaml
 * @param {string} projectDir
 * @returns {string[]}
 */
export function readPlatforms(projectDir) {
  const platformsPath = join(projectDir, 'specline', 'platforms.yaml');
  if (!existsSync(platformsPath)) return [];
  const content = readFileSync(platformsPath, 'utf-8');
  return parsePlatformsYaml(content);
}

/**
 * CLI entry point for `specline platforms`
 * @param {string} [cwd]
 * @returns {number} exit code
 */
export function cliPlatforms(cwd) {
  const projectDir = cwd || process.cwd();
  const platformsPath = join(projectDir, 'specline', 'platforms.yaml');

  if (!existsSync(platformsPath)) {
    process.stderr.write('No specline/platforms.yaml found. Run `specline init` first.\n');
    return 1;
  }

  const platforms = readPlatforms(projectDir);
  if (platforms.length === 0) {
    process.stdout.write('No platforms configured.\n');
    return 0;
  }

  process.stdout.write('Deployed platforms:\n');
  for (const p of platforms) {
    process.stdout.write(`  - ${p}\n`);
  }
  return 0;
}
