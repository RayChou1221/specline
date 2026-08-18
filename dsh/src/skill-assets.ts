/**
 * Load baked Skill markdown from dsh/assets at runtime.
 * Build-time rendering lives in build-assets.ts; this module only reads the
 * published files so the slash path can inject Skill bodies without core/.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function resolveSkillsDir(): string {
  return join(PACKAGE_ROOT, 'assets', 'skills');
}

export type BakedSkill = {
  name: string;
  description: string;
  dir: string;
  body: string;
};

function splitFrontmatter(markdown: string): { data: Record<string, string>; body: string } {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { data: {}, body: markdown };
  const data: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key) data[key] = value;
  }
  return { data, body: markdown.slice(match[0].length) };
}

export function loadBakedSkill(skillDir: string): BakedSkill | null {
  if (!skillDir || skillDir.includes('..') || skillDir.includes('/') || skillDir.includes('\\')) {
    return null;
  }
  const dir = join(resolveSkillsDir(), skillDir);
  const file = join(dir, 'SKILL.md');
  if (!existsSync(file)) return null;
  const raw = readFileSync(file, 'utf8');
  const { data, body } = splitFrontmatter(raw);
  return {
    name: data.name || skillDir,
    description: data.description || skillDir,
    dir,
    body: body.trimStart(),
  };
}

/**
 * Match DSH's canonical <skill_content> wrapper so the model sees the same
 * shape as a native user-invocable skill invocation.
 */
export function renderSkillContent(name: string, content: string, resourceDir?: string): string {
  const resources = resourceDir
    ? [
      `Base directory for this skill: ${resourceDir}`,
      'Resolve relative paths mentioned by this skill against the base directory before using them. Load referenced resources only as needed.',
    ]
    : ['Load referenced resources only as needed.'];
  return [
    `<skill_content name="${name}">`,
    '<skill_resources>',
    ...resources,
    '</skill_resources>',
    '',
    '<skill_instructions>',
    content,
    '</skill_instructions>',
    '</skill_content>',
  ].join('\n');
}
