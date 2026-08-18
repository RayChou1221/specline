/**
 * On-demand Draw.io MCP for `/specline-diagram`.
 *
 * Bundle never enables drawio by default. Upsert is only the current DSH
 * profile `cordis.patch.yml`. Never write the plugin package patch, never
 * create project-level MCP. Decline or illegal target → ASCII fallback.
 */

import { basename, normalize } from 'node:path';

export const DRAWIO_PATCH_ID = 'mcp-drawio';
export const DRAWIO_MCP_PACKAGE = '@deepseek-ai/dsh-mcp-client';
export const DRAWIO_SERVER_PACKAGE = '@next-ai-drawio/mcp-server@latest';
export const PROFILE_PATCH_BASENAME = 'cordis.patch.yml';
export const PLUGIN_BUNDLE_PATCH = 'dsh/cordis.patch.yml';

export type DrawioPatchEntry = {
  id: typeof DRAWIO_PATCH_ID;
  name: typeof DRAWIO_MCP_PACKAGE;
  config: {
    serverName: 'drawio';
    transport: 'stdio';
    command: 'npx';
    args: ['-y', typeof DRAWIO_SERVER_PACKAGE];
  };
};

export type DiagramFlowInput = {
  hasDrawioTool: boolean;
  userConsent?: boolean | null;
  targetPath?: string | null;
  currentProfilePatchPath: string;
};

export type DiagramFlowResult = {
  shouldUpsert: boolean;
  drawDirect: boolean;
  askUser: boolean;
  fallbackAscii: boolean;
  writePluginPatch: false;
  writeProjectMcp: false;
  target: 'current-profile' | null;
};

function posix(p: string): string {
  return p.replace(/\\/g, '/');
}

function samePath(a: string, b: string): boolean {
  return normalize(a) === normalize(b);
}

/** Bundle patch must stay drawio-free; never an upsert target. */
export function isPluginBundlePatch(targetPath: string): boolean {
  const n = posix(targetPath);
  const isPluginFile =
    n === PLUGIN_BUNDLE_PATCH || n.endsWith(`/${PLUGIN_BUNDLE_PATCH}`);
  if (!isPluginFile) return false;
  return !n.includes('/profiles/');
}

/** DSH has no first-class project MCP; these paths are always refused. */
export function isProjectLevelMcp(targetPath: string): boolean {
  const n = posix(targetPath);
  const file = n.split('/').pop() ?? '';
  if (file === 'mcp.json') return true;
  if (n.includes('/.cursor/mcp')) return true;
  return false;
}

export function isCurrentProfilePatch(
  targetPath: string,
  currentProfilePatchPath: string,
): boolean {
  return (
    Boolean(targetPath) &&
    Boolean(currentProfilePatchPath) &&
    basename(currentProfilePatchPath) === PROFILE_PATCH_BASENAME &&
    samePath(targetPath, currentProfilePatchPath)
  );
}

export function bundleEnablesDrawio(): boolean {
  return false;
}

export function buildDrawioPatchEntry(): DrawioPatchEntry {
  return {
    id: DRAWIO_PATCH_ID,
    name: DRAWIO_MCP_PACKAGE,
    config: {
      serverName: 'drawio',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', DRAWIO_SERVER_PACKAGE],
    },
  };
}

/**
 * True only when tools are missing, the user consented, and the write target
 * is the current profile patch. Existing drawio tools → false (draw directly).
 */
export function shouldUpsertDrawio(input: {
  hasDrawioTool: boolean;
  userConsent?: boolean | null;
  targetPath?: string | null;
  currentProfilePatchPath: string;
}): boolean {
  return resolveDiagramFlow(input).shouldUpsert;
}

export function resolveDiagramFlow(input: DiagramFlowInput): DiagramFlowResult {
  const denied = {
    writePluginPatch: false as const,
    writeProjectMcp: false as const,
  };

  if (input.hasDrawioTool) {
    return {
      shouldUpsert: false,
      drawDirect: true,
      askUser: false,
      fallbackAscii: false,
      target: null,
      ...denied,
    };
  }

  if (input.userConsent !== true) {
    const declined = input.userConsent === false;
    return {
      shouldUpsert: false,
      drawDirect: false,
      askUser: !declined,
      fallbackAscii: declined,
      target: null,
      ...denied,
    };
  }

  const target = input.targetPath ?? input.currentProfilePatchPath;
  const allowed =
    isCurrentProfilePatch(target, input.currentProfilePatchPath) &&
    !isPluginBundlePatch(target) &&
    !isProjectLevelMcp(target);

  if (!allowed) {
    return {
      shouldUpsert: false,
      drawDirect: false,
      askUser: false,
      fallbackAscii: true,
      target: null,
      ...denied,
    };
  }

  return {
    shouldUpsert: true,
    drawDirect: false,
    askUser: false,
    fallbackAscii: false,
    target: 'current-profile',
    ...denied,
  };
}
