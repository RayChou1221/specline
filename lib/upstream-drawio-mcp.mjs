/**
 * Extremely thin upstream Draw.io MCP config helper.
 *
 * Only upserts `drawio` (npx @next-ai-drawio/mcp-server@latest) and removes
 * legacy managed `specline-diagram` entries. No planDigest / runtime / session /
 * releaseGate, and no multi-platform fan-out — callers MUST pass an explicit
 * targetPath for any filesystem write.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

export const DRAWIO_SERVER_NAME = 'drawio';
export const LEGACY_SERVER_NAME = 'specline-diagram';
export const UPSTREAM_PACKAGE = '@next-ai-drawio/mcp-server@latest';
export const UPSTREAM_COMMAND = 'npx';
export const UPSTREAM_ARGS = Object.freeze([UPSTREAM_PACKAGE]);

/** @typedef {'mcpServers' | 'opencode' | 'codex'} McpConfigFormat */

/**
 * Build the upstream drawio MCP server entry for a given config shape.
 * @param {McpConfigFormat} [format='mcpServers']
 */
export function buildDrawioServerEntry(format = 'mcpServers') {
  if (format === 'opencode') {
    return {
      type: 'local',
      command: [UPSTREAM_COMMAND, ...UPSTREAM_ARGS],
      enabled: true,
    };
  }
  if (format === 'codex') {
    return {
      command: UPSTREAM_COMMAND,
      args: [...UPSTREAM_ARGS],
      enabled: true,
    };
  }
  if (format === 'mcpServers') {
    return {
      command: UPSTREAM_COMMAND,
      args: [...UPSTREAM_ARGS],
    };
  }
  throw new TypeError(`Unsupported MCP config format: ${format}`);
}

/** Known Codex MCP config basenames (not arbitrary *.toml). */
const CODEX_MCP_CONFIG_NAMES = new Set(['config.toml']);

/**
 * True when path sits under a `.codex/` directory segment.
 * @param {string} targetPath
 */
function isUnderCodexDir(targetPath) {
  return /(?:^|[\\/])\.codex(?:[\\/]|$)/.test(targetPath);
}

/**
 * Infer config format from an explicit target file path.
 * Arbitrary `*.toml` (e.g. Cargo.toml) is NOT treated as Codex — only known
 * MCP config basenames or paths under `.codex/`.
 * @param {string} targetPath
 * @returns {McpConfigFormat}
 */
export function detectMcpConfigFormat(targetPath) {
  if (typeof targetPath !== 'string' || !targetPath.trim()) {
    throw new TypeError('targetPath is required to detect MCP config format');
  }
  const name = basename(targetPath);
  if (name === 'opencode.json') return 'opencode';
  if (name === 'mcp.json' || name === '.mcp.json' || name.endsWith('mcp.json')) {
    return 'mcpServers';
  }
  if (
    CODEX_MCP_CONFIG_NAMES.has(name) ||
    (name.endsWith('.toml') && isUnderCodexDir(targetPath))
  ) {
    return 'codex';
  }
  throw new TypeError(
    `Unable to detect MCP config format from path: ${targetPath}`,
  );
}

/**
 * Pure transform: upsert drawio and remove legacy specline-diagram.
 * Does not touch the filesystem.
 *
 * @param {string} [content='']
 * @param {{ format: McpConfigFormat }} options
 * @returns {{ content: string, changed: boolean, format: McpConfigFormat }}
 */
export function upsertDrawioMcpContent(content = '', { format } = {}) {
  if (!format) {
    throw new TypeError('format is required');
  }
  if (format === 'codex') {
    return upsertCodexToml(typeof content === 'string' ? content : '', format);
  }
  if (format === 'mcpServers' || format === 'opencode') {
    return upsertJsonMcp(typeof content === 'string' ? content : '', format);
  }
  throw new TypeError(`Unsupported MCP config format: ${format}`);
}

/**
 * Write upstream drawio MCP into a single explicit target file.
 * Refuses to run without targetPath (no silent multi-platform writes).
 *
 * @param {{ targetPath: string, format?: McpConfigFormat }} options
 */
export async function writeDrawioMcpConfig(options = {}) {
  const { targetPath, format } = options;
  if (typeof targetPath !== 'string' || !targetPath.trim()) {
    throw new TypeError(
      'targetPath is required; refusing silent multi-platform MCP writes',
    );
  }

  const resolvedFormat = format ?? detectMcpConfigFormat(targetPath);
  let existing = '';
  try {
    existing = await readFile(targetPath, 'utf8');
  } catch (err) {
    if (err && err.code !== 'ENOENT') throw err;
  }

  const result = upsertDrawioMcpContent(existing, { format: resolvedFormat });
  if (result.changed || existing === '') {
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, result.content, 'utf8');
  }

  return {
    targetPath,
    format: resolvedFormat,
    changed: result.changed || existing === '',
    content: result.content,
  };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function serializeJson(config) {
  return `${JSON.stringify(config, null, 2)}\n`;
}

function upsertJsonMcp(source, format) {
  const rootKey = format === 'opencode' ? 'mcp' : 'mcpServers';
  let config;
  if (!source.trim()) {
    config = format === 'opencode'
      ? { $schema: 'https://opencode.ai/config.json' }
      : {};
  } else {
    try {
      config = JSON.parse(source);
    } catch {
      throw new Error(`Malformed JSON MCP config (${format})`);
    }
    if (!isRecord(config)) {
      throw new Error(`MCP config must be a JSON object (${format})`);
    }
  }

  if (config[rootKey] !== undefined && !isRecord(config[rootKey])) {
    throw new Error(`MCP config "${rootKey}" must be an object (${format})`);
  }

  const next = { ...config };
  const servers = { ...(next[rootKey] ?? {}) };
  delete servers[LEGACY_SERVER_NAME];
  servers[DRAWIO_SERVER_NAME] = buildDrawioServerEntry(format);
  next[rootKey] = servers;

  const content = serializeJson(next);
  return {
    content,
    changed: content !== (source.endsWith('\n') ? source : source ? `${source}\n` : source),
    format,
  };
}

/**
 * Minimal Codex TOML upsert: strip [mcp_servers.specline-diagram*] tables,
 * then ensure [mcp_servers.drawio] with npx upstream entry.
 */
function upsertCodexToml(source, format) {
  const withoutLegacy = removeTomlMcpServerSection(source, LEGACY_SERVER_NAME);
  const withoutDrawio = removeTomlMcpServerSection(withoutLegacy, DRAWIO_SERVER_NAME);
  const entry = buildDrawioServerEntry('codex');
  const block = [
    `[mcp_servers.${DRAWIO_SERVER_NAME}]`,
    `command = ${tomlString(entry.command)}`,
    `args = ${tomlStringArray(entry.args)}`,
    `enabled = true`,
    '',
  ].join('\n');

  const trimmed = withoutDrawio.replace(/\s*$/, '');
  const content = trimmed ? `${trimmed}\n\n${block}` : block;
  return {
    content,
    changed: content !== source,
    format,
  };
}

function tomlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function tomlStringArray(values) {
  return `[${values.map((v) => tomlString(v)).join(', ')}]`;
}

/**
 * Remove `[mcp_servers.<name>]` and nested `[mcp_servers.<name>.*]` sections.
 */
function removeTomlMcpServerSection(source, serverName) {
  if (!source) return '';
  const lines = source.split('\n');
  const prefix = `mcp_servers.${serverName}`;
  const out = [];
  let skipping = false;

  for (const line of lines) {
    const header = matchTomlTableHeader(line);
    if (header !== null) {
      skipping = header === prefix || header.startsWith(`${prefix}.`);
      if (skipping) continue;
    }
    if (skipping) continue;
    out.push(line);
  }

  // Collapse excessive blank lines left by removals
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

function matchTomlTableHeader(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  if (trimmed.startsWith('[[')) return null; // array-of-tables — ignore
  return trimmed.slice(1, -1).trim();
}
