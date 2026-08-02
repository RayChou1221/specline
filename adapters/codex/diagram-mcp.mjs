import { join } from 'node:path';

export const SERVER_NAME = 'specline-diagram';
export const CONFIG_RELATIVE_PATH = '.codex/config.toml';
export const SKILLS_RELATIVE_PATH = '.agents/skills';
export const MANAGED_ENV_KEY = 'SPECLINE_MANAGED_MCP';

export const CODEX_TOOL_MAP = Object.freeze({
  'mcp__specline-diagram__diagram_create': 'diagram.create',
  'mcp__specline-diagram__diagram_load': 'diagram.load',
  'mcp__specline-diagram__diagram_edit': 'diagram.edit',
  'mcp__specline-diagram__diagram_read_state': 'diagram.readState',
  'mcp__specline-diagram__diagram_export': 'diagram.export',
  'mcp__specline-diagram__diagram_finish': 'diagram.finish',
});

export class CodexAdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CodexAdapterError';
    this.code = code;
  }
}

export function getConfigPath(projectRoot) {
  return join(projectRoot, '.codex', 'config.toml');
}

function requirePermission(approved) {
  if (!approved) {
    throw new CodexAdapterError(
      'PLATFORM_PERMISSION_REQUIRED',
      'Codex configuration requires separate platform permission',
    );
  }
}

function stripComment(line) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = quote === char ? null : quote ?? char;
      continue;
    }
    if (char === '#' && quote === null) return line.slice(0, index);
  }
  if (quote !== null) {
    throw new CodexAdapterError('CONFIG_MALFORMED', 'Unterminated TOML string');
  }
  return line;
}

function normalizeHeader(rawHeader) {
  const parts = [];
  let current = '';
  let quote = null;
  for (const char of rawHeader) {
    if (char === '"' || char === "'") {
      quote = quote === char ? null : quote ?? char;
      continue;
    }
    if (char === '.' && quote === null) {
      if (!current.trim()) {
        throw new CodexAdapterError('CONFIG_MALFORMED', 'Invalid TOML table header');
      }
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (quote !== null || !current.trim()) {
    throw new CodexAdapterError('CONFIG_MALFORMED', 'Invalid TOML table header');
  }
  parts.push(current.trim());
  return parts.join('.');
}

function nestingDelta(content) {
  let delta = 0;
  let quote = null;
  let escaped = false;
  for (const char of content) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = quote === char ? null : quote ?? char;
      continue;
    }
    if (quote === null && (char === '[' || char === '{')) delta += 1;
    if (quote === null && (char === ']' || char === '}')) delta -= 1;
  }
  return delta;
}

function parseSections(source) {
  if (typeof source !== 'string') {
    throw new CodexAdapterError('CONFIG_MALFORMED', 'Codex configuration must be TOML text');
  }

  const lines = source.split('\n');
  const sections = [];
  const seen = new Set();
  let current = { name: null, start: 0, end: lines.length };
  let continuationDepth = 0;
  let multilineQuote = null;
  sections.push(current);

  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index];
    if (multilineQuote !== null) {
      const closing = line.indexOf(multilineQuote);
      if (closing < 0) continue;
      line = line.slice(closing + multilineQuote.length);
      multilineQuote = null;
    } else {
      const doubleIndex = line.indexOf('"""');
      const singleIndex = line.indexOf("'''");
      const candidates = [
        ['"""', doubleIndex],
        ["'''", singleIndex],
      ].filter(([, position]) => position >= 0).sort((left, right) => left[1] - right[1]);
      if (candidates.length > 0) {
        const [delimiter, opening] = candidates[0];
        const closing = line.indexOf(delimiter, opening + delimiter.length);
        if (closing < 0) {
          multilineQuote = delimiter;
          line = `${line.slice(0, opening)}""`;
        }
      }
    }

    const content = stripComment(line).trim();
    if (!content) continue;
    if (continuationDepth > 0) {
      continuationDepth += nestingDelta(content);
      if (continuationDepth < 0) {
        throw new CodexAdapterError('CONFIG_MALFORMED', `Unbalanced TOML value at line ${index + 1}`);
      }
      continue;
    }
    if (content.startsWith('[')) {
      const match = content.match(/^\[([^\[\]]+)\]$/);
      if (!match) {
        throw new CodexAdapterError('CONFIG_MALFORMED', `Invalid TOML table at line ${index + 1}`);
      }
      const name = normalizeHeader(match[1]);
      if (seen.has(name)) {
        throw new CodexAdapterError('CONFIG_MALFORMED', `Duplicate TOML table: ${name}`);
      }
      seen.add(name);
      current.end = index;
      current = { name, start: index, end: lines.length };
      sections.push(current);
      continue;
    }
    if (!content.includes('=')) {
      throw new CodexAdapterError('CONFIG_MALFORMED', `Invalid TOML entry at line ${index + 1}`);
    }
    continuationDepth = nestingDelta(content.slice(content.indexOf('=') + 1));
    if (continuationDepth < 0) {
      throw new CodexAdapterError('CONFIG_MALFORMED', `Unbalanced TOML value at line ${index + 1}`);
    }
  }
  if (continuationDepth !== 0) {
    throw new CodexAdapterError('CONFIG_MALFORMED', 'Unterminated TOML array or inline table');
  }
  if (multilineQuote !== null) {
    throw new CodexAdapterError('CONFIG_MALFORMED', 'Unterminated TOML multiline string');
  }

  return { lines, sections };
}

function sectionText(parsed, section) {
  return parsed.lines.slice(section.start, section.end).join('\n');
}

function managedSections(parsed) {
  return parsed.sections.filter(
    ({ name }) => name === `mcp_servers.${SERVER_NAME}` || name?.startsWith(`mcp_servers.${SERVER_NAME}.`),
  );
}

function isOwned(parsed, sections) {
  const envSection = sections.find(({ name }) => name === `mcp_servers.${SERVER_NAME}.env`);
  if (!envSection) return false;
  const marker = new RegExp(`^\\s*${MANAGED_ENV_KEY}\\s*=\\s*["']${SERVER_NAME}["']\\s*(?:#.*)?$`, 'm');
  return marker.test(sectionText(parsed, envSection));
}

function quoteToml(value) {
  return JSON.stringify(value);
}

function buildServer({ command, args, enabledTools }) {
  if (typeof command !== 'string' || !command) {
    throw new CodexAdapterError('CONFIG_MALFORMED', 'Managed MCP command must be a non-empty string');
  }
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string')) {
    throw new CodexAdapterError('CONFIG_MALFORMED', 'Managed MCP args must be strings');
  }
  if (!Array.isArray(enabledTools) || !enabledTools.every((tool) => typeof tool === 'string')) {
    throw new CodexAdapterError('CONFIG_MALFORMED', 'Managed MCP enabled tools must be strings');
  }

  return [
    `[mcp_servers.${SERVER_NAME}]`,
    `command = ${quoteToml(command)}`,
    `args = [${args.map(quoteToml).join(', ')}]`,
    'enabled = true',
    `enabled_tools = [${enabledTools.map(quoteToml).join(', ')}]`,
    '',
    `[mcp_servers.${SERVER_NAME}.env]`,
    `${MANAGED_ENV_KEY} = ${quoteToml(SERVER_NAME)}`,
  ].join('\n');
}

function replaceSections(source, parsed, sections, replacement) {
  if (sections.length === 0) {
    const prefix = source.length === 0 ? '' : source.endsWith('\n') ? source : `${source}\n`;
    return `${prefix}${prefix ? '\n' : ''}${replacement}`;
  }

  const indexes = new Set();
  for (const section of sections) {
    for (let index = section.start; index < section.end; index += 1) indexes.add(index);
  }
  const first = Math.min(...indexes);
  const output = [];
  for (let index = 0; index < parsed.lines.length; index += 1) {
    if (index === first && replacement) output.push(replacement);
    if (!indexes.has(index)) output.push(parsed.lines[index]);
  }
  return output.join('\n').replace(/\n{3,}/g, '\n\n');
}

export function mergeConfig(
  source,
  {
    approved = false,
    command = 'specline',
    args = ['diagram', 'mcp', '--stdio'],
    enabledTools = Object.values(CODEX_TOOL_MAP),
  } = {},
) {
  requirePermission(approved);
  const parsed = parseSections(source);
  const existing = managedSections(parsed);
  if (existing.length > 0 && !isOwned(parsed, existing)) {
    throw new CodexAdapterError(
      'MCP_NAME_CONFLICT',
      `Codex MCP server "${SERVER_NAME}" is not managed by Specline`,
    );
  }

  const content = replaceSections(source, parsed, existing, buildServer({ command, args, enabledTools }));
  return {
    content,
    changed: content !== source,
    reloadState: content === source ? 'not_required' : 'reload_required',
    configRelativePath: CONFIG_RELATIVE_PATH,
    skillsRelativePath: SKILLS_RELATIVE_PATH,
  };
}

export function removeConfig(source, { approved = false } = {}) {
  requirePermission(approved);
  const parsed = parseSections(source);
  const existing = managedSections(parsed);
  if (existing.length === 0) {
    return { content: source, changed: false, reloadState: 'not_required' };
  }
  if (!isOwned(parsed, existing)) {
    throw new CodexAdapterError(
      'MCP_NAME_CONFLICT',
      `Codex MCP server "${SERVER_NAME}" is not managed by Specline`,
    );
  }
  return {
    content: replaceSections(source, parsed, existing, ''),
    changed: true,
    reloadState: 'reload_required',
  };
}
