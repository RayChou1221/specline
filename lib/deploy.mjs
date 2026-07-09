import {
  existsSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from 'fs';
import { join, dirname } from 'path';
import {
  PACKAGE_ROOT,
  TEMPLATES_DIR,
  deployManifestPath,
  PLATFORMS,
  projectPlatformsPath,
} from './paths.mjs';
import { renderCursorAgent, renderClaudeAgent, renderCodexAgent } from './render-agents.mjs';
import { renderSkillForPlatform } from './render.mjs';
import { mergeOpencodeJson } from './merge.mjs';
import { computeFileHash, sha256 } from './hash.mjs';
import { readLockFile } from './lock.mjs';

/**
 * @param {string} dir
 * @param {string} [relBase]
 */
function walkDir(dir, relBase = '') {
  /** @type {{ rel: string, abs: string }[]} */
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...walkDir(abs, rel));
    } else {
      out.push({ rel, abs });
    }
  }
  return out;
}

/** @type {Record<string, string[]>} */
export const PLATFORM_PATH_PREFIXES = {
  cursor: ['.cursor/'],
  claude: ['.claude/'],
  codex: ['.codex/'],
  opencode: ['.opencode/', 'specline/opencode-plugin/', 'opencode.json'],
};

const SHARED_PATH_PREFIXES = ['specline/bin/', 'specline/config.yaml'];

/**
 * @param {string} relPath
 * @param {string} platform
 */
export function pathBelongsToPlatform(relPath, platform) {
  const prefixes = PLATFORM_PATH_PREFIXES[platform] || [];
  return prefixes.some((p) => {
    const bare = p.replace(/\/$/, '');
    return relPath === bare || relPath.startsWith(p);
  });
}

/**
 * @param {Map<string, unknown>} manifest
 * @param {string[]} platforms
 */
export function filterManifestByPlatforms(manifest, platforms) {
  const filtered = new Map();
  for (const [rel, entry] of manifest) {
    const isShared = SHARED_PATH_PREFIXES.some(
      (p) => rel === p || rel.startsWith(p),
    );
    if (isShared) {
      filtered.set(rel, entry);
      continue;
    }
    if (platforms.some((pl) => pathBelongsToPlatform(rel, pl))) {
      filtered.set(rel, entry);
    }
  }
  return filtered;
}

/**
 * @param {string} packageRoot
 * @param {boolean} withShellGuard
 */
export function buildCursorHooksJsonContent(packageRoot, withShellGuard = false) {
  const basePath = join(packageRoot, 'adapters', 'cursor', 'hooks.json');
  const base = JSON.parse(readFileSync(basePath, 'utf-8'));
  if (withShellGuard) {
    base.hooks = base.hooks || {};
    base.hooks.beforeShellExecution = [
      {
        command: '.cursor/hooks/specline-shell-guard.sh',
        matcher: 'rm -rf|curl.*\\|.*bash|wget.*\\|.*sh|^sudo ',
        failClosed: true,
      },
    ];
  }
  return JSON.stringify(base, null, 2) + '\n';
}

export function buildClaudeSettingsTemplate(packageRoot = PACKAGE_ROOT) {
  const hooksPath = join(packageRoot, 'adapters', 'claude', 'hooks', 'hooks.json');
  return readFileSync(hooksPath, 'utf-8');
}

/**
 * @param {string} [packageRoot]
 */
export function getSharedSpeclineManifest(packageRoot = PACKAGE_ROOT) {
  /** @type {Map<string, { source?: string, transform?: string, content?: string }>} */
  const manifest = new Map();

  manifest.set('specline/bin/gate.sh', {
    source: join(packageRoot, 'core', 'gates', 'pipeline-gate.sh'),
  });

  manifest.set('specline/bin/contract-check.mjs', {
    source: join(packageRoot, 'core', 'gates', 'contract-check.mjs'),
  });

  manifest.set('specline/templates/execution-contract.md', {
    source: join(packageRoot, 'core', 'templates', 'execution-contract.md'),
  });

  for (const { rel, abs } of walkDir(
    join(packageRoot, 'core', 'gates', 'pipeline-gate-checks'),
    'specline/bin/gate-checks',
  )) {
    manifest.set(rel, { source: abs });
  }

  manifest.set('specline/config.yaml', {
    source: join(packageRoot, 'core', 'templates', 'specline', 'config.yaml'),
  });

  return manifest;
}

/**
 * @param {string} [packageRoot]
 * @param {{ withShellGuard?: boolean, legacyPhase0?: boolean }} [options]
 */
export function getCursorPlatformManifest(packageRoot = PACKAGE_ROOT, options = {}) {
  const { withShellGuard = false, legacyPhase0 = false } = options;
  if (legacyPhase0) return getCursorUpstreamManifestPhase0(packageRoot);

  /** @type {Map<string, { source?: string, transform?: string, content?: string, platform?: string }>} */
  const manifest = new Map();

  for (const { rel, abs } of walkDir(join(packageRoot, 'core', 'skills'), '.cursor/skills')) {
    if (rel.endsWith('.md')) {
      manifest.set(rel, { source: abs, transform: 'skill-render', platform: 'cursor' });
    } else {
      manifest.set(rel, { source: abs });
    }
  }

  const bootstrap = join(packageRoot, 'core', 'bootstrap', 'using-specline.md');
  if (existsSync(bootstrap)) {
    manifest.set('.cursor/skills/using-specline/SKILL.md', { source: bootstrap });
  }

  const agentsDir = join(packageRoot, 'core', 'agents');
  if (existsSync(agentsDir)) {
    for (const file of readdirSync(agentsDir).filter((f) => f.endsWith('.yaml'))) {
      const rel = `.cursor/agents/${file.replace('.yaml', '.md')}`;
      manifest.set(rel, { source: join(agentsDir, file), transform: 'cursor-agent-md' });
    }
  }

  manifest.set('.cursor/hooks/specline-session-start.sh', {
    source: join(packageRoot, 'core', 'hooks', 'session-start.sh'),
  });

  if (withShellGuard) {
    manifest.set('.cursor/hooks/specline-shell-guard.sh', {
      source: join(packageRoot, 'core', 'hooks', 'shell-guard.sh'),
    });
  }

  manifest.set('.cursor/hooks.json', {
    transform: 'cursor-hooks-json',
    content: buildCursorHooksJsonContent(packageRoot, withShellGuard),
  });

  const cursorReadme = join(TEMPLATES_DIR, '.cursor', 'README.md');
  if (existsSync(cursorReadme)) {
    manifest.set('.cursor/README.md', { source: cursorReadme });
  }

  return manifest;
}

/**
 * @param {string} [packageRoot]
 */
export function getClaudeUpstreamManifest(packageRoot = PACKAGE_ROOT) {
  /** @type {Map<string, { source?: string, transform?: string, content?: string, platform?: string }>} */
  const manifest = new Map();

  for (const { rel, abs } of walkDir(join(packageRoot, 'core', 'skills'), '.claude/skills')) {
    if (rel.endsWith('.md')) {
      manifest.set(rel, { source: abs, transform: 'skill-render', platform: 'claude' });
    } else {
      manifest.set(rel, { source: abs });
    }
  }

  const bootstrap = join(packageRoot, 'core', 'bootstrap', 'using-specline.md');
  if (existsSync(bootstrap)) {
    manifest.set('.claude/skills/using-specline/SKILL.md', { source: bootstrap });
  }

  const agentsDir = join(packageRoot, 'core', 'agents');
  if (existsSync(agentsDir)) {
    for (const file of readdirSync(agentsDir).filter((f) => f.endsWith('.yaml'))) {
      manifest.set(`.claude/agents/${file.replace('.yaml', '.md')}`, {
        source: join(agentsDir, file),
        transform: 'claude-md',
      });
    }
  }

  manifest.set('.claude/settings.json', {
    transform: 'claude-settings-json',
    content: buildClaudeSettingsTemplate(packageRoot),
  });

  return manifest;
}

/**
 * @param {string} [packageRoot]
 */
export function getCodexUpstreamManifest(packageRoot = PACKAGE_ROOT) {
  /** @type {Map<string, { source?: string, transform?: string, content?: string, tomlTemplate?: string, platform?: string }>} */
  const manifest = new Map();

  for (const { rel, abs } of walkDir(join(packageRoot, 'core', 'skills'), '.codex/skills')) {
    if (rel.endsWith('.md')) {
      manifest.set(rel, { source: abs, transform: 'skill-render', platform: 'codex' });
    } else {
      manifest.set(rel, { source: abs });
    }
  }

  const bootstrap = join(packageRoot, 'core', 'bootstrap', 'using-specline.md');
  if (existsSync(bootstrap)) {
    manifest.set('.codex/skills/using-specline/SKILL.md', { source: bootstrap });
  }

  const tomlTemplate = readFileSync(
    join(packageRoot, 'adapters', 'codex', 'agent.toml.hbs'),
    'utf-8',
  );

  const agentsDir = join(packageRoot, 'core', 'agents');
  if (existsSync(agentsDir)) {
    for (const file of readdirSync(agentsDir).filter((f) => f.endsWith('.yaml'))) {
      manifest.set(`.codex/agents/${file.replace('.yaml', '.toml')}`, {
        source: join(agentsDir, file),
        transform: 'codex-toml',
        tomlTemplate,
      });
    }
  }

  manifest.set('.codex/hooks.json', {
    source: join(packageRoot, 'adapters', 'codex', 'hooks.json'),
  });

  return manifest;
}

/**
 * @param {string} [packageRoot]
 */
export function getOpencodeUpstreamManifest(packageRoot = PACKAGE_ROOT) {
  /** @type {Map<string, { source?: string, transform?: string, content?: string, platform?: string }>} */
  const manifest = new Map();

  for (const { rel, abs } of walkDir(join(packageRoot, 'core', 'skills'), '.opencode/skills')) {
    if (rel.endsWith('.md')) {
      manifest.set(rel, { source: abs, transform: 'skill-render', platform: 'opencode' });
    } else {
      manifest.set(rel, { source: abs });
    }
  }

  const bootstrap = join(packageRoot, 'core', 'bootstrap', 'using-specline.md');
  if (existsSync(bootstrap)) {
    manifest.set('.opencode/skills/using-specline/SKILL.md', { source: bootstrap });
  }

  manifest.set('specline/opencode-plugin/plugin.js', {
    source: join(packageRoot, 'adapters', 'opencode', 'plugin.js'),
  });

  manifest.set('opencode.json', {
    transform: 'opencode-json',
    content: mergeOpencodeJson(''),
  });

  return manifest;
}

/**
 * @param {string[]} platforms
 * @param {string} [packageRoot]
 * @param {{ withShellGuard?: boolean, legacyPhase0?: boolean }} [options]
 */
export function getCombinedUpstreamManifest(platforms, packageRoot = PACKAGE_ROOT, options = {}) {
  /** @type {Map<string, { source?: string, transform?: string, content?: string, tomlTemplate?: string }>} */
  const combined = new Map();

  for (const [rel, entry] of getSharedSpeclineManifest(packageRoot)) {
    combined.set(rel, entry);
  }

  if (platforms.includes('cursor')) {
    for (const [rel, entry] of getCursorPlatformManifest(packageRoot, options)) {
      combined.set(rel, entry);
    }
  }
  if (platforms.includes('claude')) {
    for (const [rel, entry] of getClaudeUpstreamManifest(packageRoot)) {
      combined.set(rel, entry);
    }
  }
  if (platforms.includes('codex')) {
    for (const [rel, entry] of getCodexUpstreamManifest(packageRoot)) {
      combined.set(rel, entry);
    }
  }
  if (platforms.includes('opencode')) {
    for (const [rel, entry] of getOpencodeUpstreamManifest(packageRoot)) {
      combined.set(rel, entry);
    }
  }

  return combined;
}

/** Backward-compatible alias: cursor-only full manifest including shared paths */
export function getCursorUpstreamManifest(packageRoot = PACKAGE_ROOT, options = {}) {
  const manifest = getCursorPlatformManifest(packageRoot, options);
  for (const [rel, entry] of getSharedSpeclineManifest(packageRoot)) {
    if (!manifest.has(rel)) manifest.set(rel, entry);
  }
  return manifest;
}

/** Phase 0 完整 hooks（向后兼容测试） */
function getCursorUpstreamManifestPhase0(packageRoot) {
  const manifest = new Map();
  const phase0Hooks = join(TEMPLATES_DIR, '.cursor', 'hooks.json');

  for (const { rel, abs } of walkDir(join(packageRoot, 'core', 'skills'), '.cursor/skills')) {
    manifest.set(rel, { source: abs });
  }
  const agentsDir = join(packageRoot, 'core', 'agents');
  if (existsSync(agentsDir)) {
    for (const file of readdirSync(agentsDir).filter((f) => f.endsWith('.yaml'))) {
      manifest.set(`.cursor/agents/${file.replace('.yaml', '.md')}`, {
        source: join(agentsDir, file),
        transform: 'cursor-agent-md',
      });
    }
  }
  for (const [src, dest] of [
    ['core/hooks/session-start.sh', '.cursor/hooks/specline-session-start.sh'],
    ['core/gates/pipeline-gate.sh', '.cursor/hooks/specline-pipeline-gate.sh'],
  ]) {
    manifest.set(dest, { source: join(packageRoot, src) });
  }
  for (const { rel, abs } of walkDir(
    join(packageRoot, 'core', 'gates', 'pipeline-gate-checks'),
    '.cursor/hooks/specline-pipeline-gate-checks',
  )) {
    manifest.set(rel, { source: abs });
  }
  for (const name of [
    'specline-phase-guard.sh',
    'specline-agent-guard.sh',
    'specline-reminder.sh',
    'specline-shell-guard.sh',
    'specline-auto-format.sh',
  ]) {
    const src = join(TEMPLATES_DIR, '.cursor', 'hooks', name);
    if (existsSync(src)) manifest.set(`.cursor/hooks/${name}`, { source: src });
  }
  manifest.set('.cursor/hooks.json', { source: phase0Hooks });
  for (const [rel, entry] of getSharedSpeclineManifest(packageRoot)) {
    manifest.set(rel, entry);
  }
  const readme = join(TEMPLATES_DIR, '.cursor', 'README.md');
  if (existsSync(readme)) manifest.set('.cursor/README.md', { source: readme });
  return manifest;
}

function renderManifestEntry(entry) {
  if (entry.transform === 'skill-render' && entry.platform) {
    return renderSkillForPlatform(readFileSync(entry.source, 'utf-8'), entry.platform);
  }
  if (entry.transform === 'cursor-agent-md' || entry.transform === 'claude-md') {
    const render = entry.transform === 'claude-md' ? renderClaudeAgent : renderCursorAgent;
    return render(readFileSync(entry.source, 'utf-8'));
  }
  if (entry.transform === 'codex-toml') {
    return renderCodexAgent(readFileSync(entry.source, 'utf-8'), entry.tomlTemplate);
  }
  if (entry.content) return entry.content;
  if (entry.source && existsSync(entry.source)) {
    return readFileSync(entry.source, 'utf-8');
  }
  return null;
}

export function hashManifestEntry(entry) {
  if (entry.transform === 'skill-render' && entry.platform) {
    return sha256(renderSkillForPlatform(readFileSync(entry.source, 'utf-8'), entry.platform));
  }
  if (entry.transform === 'cursor-agent-md') {
    return sha256(renderCursorAgent(readFileSync(entry.source, 'utf-8')));
  }
  if (entry.transform === 'claude-md') {
    return sha256(renderClaudeAgent(readFileSync(entry.source, 'utf-8')));
  }
  if (entry.transform === 'codex-toml') {
    return sha256(renderCodexAgent(readFileSync(entry.source, 'utf-8'), entry.tomlTemplate));
  }
  if (entry.content) return sha256(entry.content);
  if (entry.source && existsSync(entry.source)) return computeFileHash(entry.source);
  return null;
}

export function buildLockDataFromManifest(manifest, version, platforms = ['cursor']) {
  const files = new Map();
  for (const [rel, entry] of manifest) {
    const h = hashManifestEntry(entry);
    if (h) files.set(rel, h);
  }
  return {
    version,
    synced_at: new Date().toISOString(),
    schema: 2,
    platforms: [...platforms],
    files,
  };
}

const PLATFORM_DIRS = {
  cursor: [
    '.cursor/agents',
    '.cursor/skills',
    '.cursor/hooks',
  ],
  claude: ['.claude/agents', '.claude/skills'],
  codex: ['.codex/agents', '.codex/skills'],
  opencode: ['.opencode/skills', 'specline/opencode-plugin'],
};

const SHARED_DIRS = [
  'specline/changes/archive',
  'specline/specs',
  'specline/bin',
  'specline/bin/gate-checks',
];

/**
 * @param {string} targetProjectDir
 * @param {string[]} platforms
 */
function ensurePlatformDirs(targetProjectDir, platforms) {
  const dirs = new Set(SHARED_DIRS);
  for (const pl of platforms) {
    for (const d of PLATFORM_DIRS[pl] || []) dirs.add(d);
  }
  for (const dir of dirs) {
    const full = join(targetProjectDir, dir);
    if (!existsSync(full)) mkdirSync(full, { recursive: true });
  }
}

/**
 * @param {string} targetProjectDir
 * @param {Map<string, object>} manifest
 */
export function writeManifestToProject(targetProjectDir, manifest) {
  for (const [rel, entry] of manifest) {
    const dest = join(targetProjectDir, rel);
    const destDir = dirname(dest);
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

    if (entry.transform === 'skill-render' && entry.platform) {
      const rendered = renderSkillForPlatform(readFileSync(entry.source, 'utf-8'), entry.platform);
      writeFileSync(dest, rendered, 'utf-8');
    } else if (entry.transform === 'cursor-agent-md' || entry.transform === 'claude-md') {
      const render = entry.transform === 'claude-md' ? renderClaudeAgent : renderCursorAgent;
      writeFileSync(dest, render(readFileSync(entry.source, 'utf-8')), 'utf-8');
    } else if (entry.transform === 'codex-toml') {
      writeFileSync(
        dest,
        renderCodexAgent(readFileSync(entry.source, 'utf-8'), entry.tomlTemplate),
        'utf-8',
      );
    } else if (entry.content) {
      writeFileSync(dest, entry.content, 'utf-8');
    } else if (entry.source) {
      copyFileSync(entry.source, dest);
      if (rel.endsWith('.sh')) {
        try {
          chmodSync(dest, 0o755);
        } catch {
          /* Windows */
        }
      }
    }
  }
}

/**
 * @param {string} targetProjectDir
 * @param {string} [packageRoot]
 * @param {{ withShellGuard?: boolean, platforms?: string[], legacyPhase0?: boolean }} [options]
 */
export function deployCursor(targetProjectDir, packageRoot = PACKAGE_ROOT, options = {}) {
  const platforms = options.platforms || ['cursor'];
  ensurePlatformDirs(targetProjectDir, platforms.includes('cursor') ? ['cursor'] : []);
  const manifest = getCursorUpstreamManifest(packageRoot, options);
  writeManifestToProject(targetProjectDir, manifest);
  return manifest;
}

/**
 * @param {string} targetProjectDir
 * @param {string[]} platforms
 * @param {string} [packageRoot]
 * @param {{ withShellGuard?: boolean }} [options]
 */
export function deployPlatforms(targetProjectDir, platforms, packageRoot = PACKAGE_ROOT, options = {}) {
  ensurePlatformDirs(targetProjectDir, platforms);
  const manifest = getCombinedUpstreamManifest(platforms, packageRoot, options);
  writeManifestToProject(targetProjectDir, manifest);
  return manifest;
}

/** @deprecated use deployCursor */
export const deployCursorPhase0 = deployCursor;

export function loadDeployJson(platform, packageRoot = PACKAGE_ROOT) {
  const path = deployManifestPath(platform);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function countDeployedFiles(targetProjectDir) {
  const counts = { skills: 0, agents: 0, hooks: 0 };
  const tally = (sub, key) => {
    const dir = join(targetProjectDir, sub);
    if (existsSync(dir)) counts[key] += walkDir(dir).length;
  };
  for (const prefix of ['.cursor', '.claude', '.opencode']) {
    tally(`${prefix}/skills`, 'skills');
    tally(`${prefix}/agents`, 'agents');
  }
  tally('.codex/skills', 'skills');
  tally('.codex/agents', 'agents');
  tally('.cursor/hooks', 'hooks');
  if (existsSync(join(targetProjectDir, '.codex', 'hooks.json'))) counts.hooks += 1;
  if (existsSync(join(targetProjectDir, '.claude', 'settings.json'))) counts.hooks += 1;
  return counts;
}

export function readUpstreamContent(relPath, manifest) {
  const entry = manifest.get(relPath);
  if (!entry) return null;
  return renderManifestEntry(entry);
}

export function getUpstreamFileHash(relPath, packageRoot = PACKAGE_ROOT, options = {}) {
  const platforms = options.platforms || ['cursor'];
  const manifest = getCombinedUpstreamManifest(platforms, packageRoot, options);
  const entry = manifest.get(relPath);
  if (!entry) {
    const legacy = join(TEMPLATES_DIR, relPath);
    if (existsSync(legacy)) return computeFileHash(legacy);
    return null;
  }
  return hashManifestEntry(entry);
}

export function buildUpstreamLockData(version, packageRoot = PACKAGE_ROOT, options = {}) {
  const platforms = options.platforms || ['cursor'];
  const manifest = getCombinedUpstreamManifest(platforms, packageRoot, options);
  return buildLockDataFromManifest(manifest, version, platforms);
}

export function writePlatformsYaml(projectDir, platforms) {
  const valid = platforms.filter((p) => PLATFORMS.includes(p));
  const body = `platforms:\n${valid.map((p) => `  - ${p}`).join('\n')}\n`;
  writeFileSync(join(projectDir, 'specline', 'platforms.yaml'), body, 'utf-8');
}

/**
 * @param {string} projectDir
 * @returns {string[]|null}
 */
export function readPlatformsYaml(projectDir) {
  const path = projectPlatformsPath(projectDir);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf-8');
  const platforms = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*-\s*(\w+)/);
    if (m && PLATFORMS.includes(m[1])) platforms.push(m[1]);
  }
  return platforms.length ? platforms : null;
}

/** @param {string} projectDir @returns {string[]} */
export function detectProjectPlatforms(projectDir) {
  const detected = [];
  if (existsSync(join(projectDir, '.cursor'))) detected.push('cursor');
  if (existsSync(join(projectDir, '.claude'))) detected.push('claude');
  if (existsSync(join(projectDir, '.codex'))) detected.push('codex');
  if (
    existsSync(join(projectDir, '.opencode'))
    || existsSync(join(projectDir, 'specline', 'opencode-plugin'))
    || existsSync(join(projectDir, 'opencode.json'))
  ) {
    detected.push('opencode');
  }
  return detected;
}

/**
 * @param {string} projectDir
 * @returns {string[]}
 */
export function readProjectPlatforms(projectDir) {
  const platforms = new Set();
  const lock = readLockFile(projectDir);
  for (const platform of lock?.platforms || []) platforms.add(platform);
  for (const platform of readPlatformsYaml(projectDir) || []) platforms.add(platform);
  for (const platform of detectProjectPlatforms(projectDir)) platforms.add(platform);

  const resolved = PLATFORMS.filter((platform) => platforms.has(platform));
  return resolved.length ? resolved : ['cursor'];
}

/**
 * @param {string} projectDir
 * @param {string} [packageRoot]
 */
export function mergeAgentsMd(projectDir, packageRoot = PACKAGE_ROOT) {
  const bootstrapPath = join(packageRoot, 'core', 'bootstrap', 'using-specline.md');
  const templatePath = join(packageRoot, 'core', 'templates', 'AGENTS.md.hbs');
  if (!existsSync(bootstrapPath) || !existsSync(templatePath)) return;

  const bootstrap = readFileSync(bootstrapPath, 'utf-8').trim();
  const template = readFileSync(templatePath, 'utf-8').replace('{{bootstrap}}', bootstrap);
  const agentsPath = join(projectDir, 'AGENTS.md');
  const marker = '# Specline bootstrap';

  if (!existsSync(agentsPath)) {
    writeFileSync(agentsPath, template, 'utf-8');
    return;
  }

  const existing = readFileSync(agentsPath, 'utf-8');
  if (existing.includes(marker)) {
    const sep = '\n---\n\n';
    const idx = existing.indexOf(sep);
    const userTail = idx >= 0 ? existing.slice(idx + sep.length) : '';
    const merged = template + (userTail.trim() ? sep + userTail.trim() + '\n' : '\n');
    writeFileSync(agentsPath, merged, 'utf-8');
    return;
  }

  if (existing.includes('specline-pipeline') || existing.includes('Using Specline')) {
    return;
  }

  writeFileSync(agentsPath, template + '\n\n---\n\n' + existing.trim() + '\n', 'utf-8');
}

export { PLATFORMS };
