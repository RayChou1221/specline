import { join } from 'node:path';

export const SERVER_NAME = 'specline-diagram';
export const CONFIG_RELATIVE_PATH = 'opencode.json';
export const MANAGED_ENV_KEY = 'SPECLINE_MANAGED_MCP';

export const OPENCODE_TOOL_MAP = Object.freeze({
  'specline-diagram_diagram_create': 'diagram.create',
  'specline-diagram_diagram_load': 'diagram.load',
  'specline-diagram_diagram_edit': 'diagram.edit',
  'specline-diagram_diagram_read_state': 'diagram.readState',
  'specline-diagram_diagram_export': 'diagram.export',
  'specline-diagram_diagram_finish': 'diagram.finish',
});

export class OpenCodeAdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OpenCodeAdapterError';
    this.code = code;
  }
}

export function getConfigPath(projectRoot) {
  return join(projectRoot, CONFIG_RELATIVE_PATH);
}

function requirePermission(approved) {
  if (!approved) {
    throw new OpenCodeAdapterError(
      'PLATFORM_PERMISSION_REQUIRED',
      'OpenCode configuration requires separate platform permission',
    );
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseConfig(source) {
  if (typeof source !== 'string') {
    throw new OpenCodeAdapterError('CONFIG_MALFORMED', 'OpenCode configuration must be JSON text');
  }
  if (source.trim() === '') return { $schema: 'https://opencode.ai/config.json' };

  let config;
  try {
    config = JSON.parse(source);
  } catch {
    throw new OpenCodeAdapterError('CONFIG_MALFORMED', 'OpenCode configuration is malformed JSON');
  }
  if (!isRecord(config)) {
    throw new OpenCodeAdapterError('CONFIG_MALFORMED', 'OpenCode configuration must be an object');
  }
  if (config.mcp !== undefined && !isRecord(config.mcp)) {
    throw new OpenCodeAdapterError('CONFIG_MALFORMED', 'OpenCode "mcp" must be an object');
  }
  return config;
}

function isOwned(server) {
  return (
    isRecord(server) &&
    isRecord(server.environment) &&
    server.environment[MANAGED_ENV_KEY] === SERVER_NAME
  );
}

function buildServer({ command, environment, timeout }) {
  if (!Array.isArray(command) || command.length === 0 || !command.every((item) => typeof item === 'string')) {
    throw new OpenCodeAdapterError(
      'CONFIG_MALFORMED',
      'Managed OpenCode MCP command must be a non-empty string array',
    );
  }
  if (!isRecord(environment) || !Object.values(environment).every((value) => typeof value === 'string')) {
    throw new OpenCodeAdapterError(
      'CONFIG_MALFORMED',
      'Managed OpenCode MCP environment must contain string values',
    );
  }
  if (!Number.isInteger(timeout) || timeout <= 0) {
    throw new OpenCodeAdapterError('CONFIG_MALFORMED', 'Managed OpenCode MCP timeout must be positive');
  }

  return {
    type: 'local',
    command: [...command],
    enabled: true,
    environment: {
      ...environment,
      [MANAGED_ENV_KEY]: SERVER_NAME,
    },
    timeout,
  };
}

function serialize(config) {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function mergeConfig(
  source,
  {
    approved = false,
    command = ['specline', 'diagram', 'mcp', '--stdio'],
    environment = {},
    timeout = 10_000,
  } = {},
) {
  requirePermission(approved);
  const config = parseConfig(source);
  const existing = config.mcp?.[SERVER_NAME];
  if (existing !== undefined && !isOwned(existing)) {
    throw new OpenCodeAdapterError(
      'MCP_NAME_CONFLICT',
      `OpenCode MCP server "${SERVER_NAME}" is not managed by Specline`,
    );
  }

  const next = structuredClone(config);
  next.mcp = {
    ...(next.mcp ?? {}),
    [SERVER_NAME]: buildServer({ command, environment, timeout }),
  };
  const content = serialize(next);
  return {
    content,
    changed: content !== source,
    reloadState: content === source ? 'not_required' : 'reload_required',
    configRelativePath: CONFIG_RELATIVE_PATH,
  };
}

export function removeConfig(source, { approved = false } = {}) {
  requirePermission(approved);
  const config = parseConfig(source);
  const existing = config.mcp?.[SERVER_NAME];
  if (existing === undefined) {
    return { content: source, changed: false, reloadState: 'not_required' };
  }
  if (!isOwned(existing)) {
    throw new OpenCodeAdapterError(
      'MCP_NAME_CONFLICT',
      `OpenCode MCP server "${SERVER_NAME}" is not managed by Specline`,
    );
  }

  const next = structuredClone(config);
  delete next.mcp[SERVER_NAME];
  if (Object.keys(next.mcp).length === 0) delete next.mcp;
  return {
    content: serialize(next),
    changed: true,
    reloadState: 'reload_required',
  };
}
