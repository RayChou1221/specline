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
function posix(p) {
    return p.replace(/\\/g, '/');
}
function samePath(a, b) {
    return normalize(a) === normalize(b);
}
/** Bundle patch must stay drawio-free; never an upsert target. */
export function isPluginBundlePatch(targetPath) {
    const n = posix(targetPath);
    const isPluginFile = n === PLUGIN_BUNDLE_PATCH || n.endsWith(`/${PLUGIN_BUNDLE_PATCH}`);
    if (!isPluginFile)
        return false;
    return !n.includes('/profiles/');
}
/** DSH has no first-class project MCP; these paths are always refused. */
export function isProjectLevelMcp(targetPath) {
    const n = posix(targetPath);
    const file = n.split('/').pop() ?? '';
    if (file === 'mcp.json')
        return true;
    if (n.includes('/.cursor/mcp'))
        return true;
    return false;
}
export function isCurrentProfilePatch(targetPath, currentProfilePatchPath) {
    return (Boolean(targetPath) &&
        Boolean(currentProfilePatchPath) &&
        basename(currentProfilePatchPath) === PROFILE_PATCH_BASENAME &&
        samePath(targetPath, currentProfilePatchPath));
}
export function bundleEnablesDrawio() {
    return false;
}
export function buildDrawioPatchEntry() {
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
export function shouldUpsertDrawio(input) {
    return resolveDiagramFlow(input).shouldUpsert;
}
export function resolveDiagramFlow(input) {
    const denied = {
        writePluginPatch: false,
        writeProjectMcp: false,
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
    const allowed = isCurrentProfilePatch(target, input.currentProfilePatchPath) &&
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
