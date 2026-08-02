import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const PLATFORM = 'cursor';
const SERVER_NAME = 'specline-diagram';
const MANAGED_MARKER = 'diagram-adapter-v1';
const DEFAULT_SERVER = Object.freeze({
  command: 'specline',
  args: ['diagram', 'mcp', '--stdio'],
  env: {
    SPECLINE_MANAGED: MANAGED_MARKER,
  },
});
const TOOL_MAPPINGS = Object.freeze({
  'diagram.create': 'specline_diagram_create',
  'diagram.load': 'specline_diagram_load',
  'diagram.edit': 'specline_diagram_edit',
  'diagram.readState': 'specline_diagram_read_state',
  'diagram.export': 'specline_diagram_export',
  'diagram.finish': 'specline_diagram_finish',
});

function failure(content, code, message) {
  return {
    ok: false,
    code,
    message,
    changed: false,
    reloadState: 'not_required',
    content,
  };
}

function permissionFailure(content, options) {
  if (options.approved !== true) {
    return failure(content, 'PLATFORM_PERMISSION_REQUIRED', 'Cursor configuration requires approval');
  }
  if (
    options.currentPlatform &&
    options.currentPlatform !== PLATFORM &&
    options.explicitPlatformApproval !== true
  ) {
    return failure(
      content,
      'PLATFORM_PERMISSION_REQUIRED',
      'Cursor requires independent approval when it is not the current platform',
    );
  }
  return null;
}

function parseConfig(content) {
  if (typeof content !== 'string') return null;
  try {
    const parsed = content.trim() ? JSON.parse(content) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (
      parsed.mcpServers !== undefined &&
      (!parsed.mcpServers || typeof parsed.mcpServers !== 'object' || Array.isArray(parsed.mcpServers))
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function serialize(config) {
  return `${JSON.stringify(config, null, 2)}\n`;
}

function managedServer(server = {}) {
  server = server && typeof server === 'object' ? server : {};
  const command = typeof server.command === 'string' && server.command ? server.command : DEFAULT_SERVER.command;
  const args = Array.isArray(server.args) ? [...server.args] : [...DEFAULT_SERVER.args];
  const env = server.env && typeof server.env === 'object' && !Array.isArray(server.env)
    ? { ...server.env }
    : {};
  return {
    command,
    args,
    env: {
      ...env,
      SPECLINE_MANAGED: MANAGED_MARKER,
    },
  };
}

function isManaged(server) {
  return Boolean(
    server &&
    typeof server === 'object' &&
    !Array.isArray(server) &&
    server.env &&
    server.env.SPECLINE_MANAGED === MANAGED_MARKER,
  );
}

export function cursorConfigPath({ projectRoot, homeDir, scope = 'project' } = {}) {
  if (scope === 'project' && typeof projectRoot === 'string' && projectRoot) {
    return join(projectRoot, '.cursor', 'mcp.json');
  }
  if (scope === 'user' && typeof homeDir === 'string' && homeDir) {
    return join(homeDir, '.cursor', 'mcp.json');
  }
  throw new TypeError('Cursor config path requires projectRoot or homeDir for the selected scope');
}

export function mergeCursorDiagramConfig(content = '', options = {}) {
  const denied = permissionFailure(content, options);
  if (denied) return denied;

  const config = parseConfig(content);
  if (!config) {
    return failure(content, 'MALFORMED_CONFIG', 'Cursor mcp.json must contain a JSON object');
  }

  const servers = config.mcpServers ?? {};
  const hasExisting = Object.hasOwn(servers, SERVER_NAME);
  const existing = servers[SERVER_NAME];
  const desired = managedServer(options.server);
  if (hasExisting && !isManaged(existing)) {
    return failure(
      content,
      'MCP_SERVER_CONFLICT',
      `Cursor already contains a non-Specline ${SERVER_NAME} server`,
    );
  }
  if (hasExisting && isDeepStrictEqual(existing, desired)) {
    return {
      ok: true,
      code: 'CONFIG_UNCHANGED',
      changed: false,
      reloadState: 'not_required',
      content,
    };
  }

  const next = {
    ...config,
    mcpServers: {
      ...servers,
      [SERVER_NAME]: desired,
    },
  };
  return {
    ok: true,
    code: hasExisting ? 'CONFIG_UPDATED' : 'CONFIG_ADDED',
    changed: true,
    reloadState: 'reload_required',
    content: serialize(next),
  };
}

export function removeCursorDiagramConfig(content = '', options = {}) {
  const denied = permissionFailure(content, options);
  if (denied) return denied;

  const config = parseConfig(content);
  if (!config) {
    return failure(content, 'MALFORMED_CONFIG', 'Cursor mcp.json must contain a JSON object');
  }
  const servers = config.mcpServers ?? {};
  const hasExisting = Object.hasOwn(servers, SERVER_NAME);
  const existing = servers[SERVER_NAME];
  if (!hasExisting) {
    return {
      ok: true,
      code: 'CONFIG_UNCHANGED',
      changed: false,
      reloadState: 'not_required',
      content,
    };
  }
  if (!isManaged(existing)) {
    return failure(
      content,
      'MCP_SERVER_CONFLICT',
      `Refusing to remove non-Specline ${SERVER_NAME} server`,
    );
  }

  const nextServers = { ...servers };
  delete nextServers[SERVER_NAME];
  return {
    ok: true,
    code: 'CONFIG_REMOVED',
    changed: true,
    reloadState: 'reload_required',
    content: serialize({
      ...config,
      mcpServers: nextServers,
    }),
  };
}

export function toolNameForCursor(operation) {
  const name = TOOL_MAPPINGS[operation];
  if (!name) throw new RangeError(`Unsupported diagram operation: ${operation}`);
  return name;
}

export const cursorDiagramAdapter = Object.freeze({
  platform: PLATFORM,
  serverName: SERVER_NAME,
  toolMappings: TOOL_MAPPINGS,
});
