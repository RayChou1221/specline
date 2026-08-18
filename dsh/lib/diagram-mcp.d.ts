/**
 * On-demand Draw.io MCP for `/specline-diagram`.
 *
 * Bundle never enables drawio by default. Upsert is only the current DSH
 * profile `cordis.patch.yml`. Never write the plugin package patch, never
 * create project-level MCP. Decline or illegal target → ASCII fallback.
 */
export declare const DRAWIO_PATCH_ID = "mcp-drawio";
export declare const DRAWIO_MCP_PACKAGE = "@deepseek-ai/dsh-mcp-client";
export declare const DRAWIO_SERVER_PACKAGE = "@next-ai-drawio/mcp-server@latest";
export declare const PROFILE_PATCH_BASENAME = "cordis.patch.yml";
export declare const PLUGIN_BUNDLE_PATCH = "dsh/cordis.patch.yml";
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
/** Bundle patch must stay drawio-free; never an upsert target. */
export declare function isPluginBundlePatch(targetPath: string): boolean;
/** DSH has no first-class project MCP; these paths are always refused. */
export declare function isProjectLevelMcp(targetPath: string): boolean;
export declare function isCurrentProfilePatch(targetPath: string, currentProfilePatchPath: string): boolean;
export declare function bundleEnablesDrawio(): boolean;
export declare function buildDrawioPatchEntry(): DrawioPatchEntry;
/**
 * True only when tools are missing, the user consented, and the write target
 * is the current profile patch. Existing drawio tools → false (draw directly).
 */
export declare function shouldUpsertDrawio(input: {
    hasDrawioTool: boolean;
    userConsent?: boolean | null;
    targetPath?: string | null;
    currentProfilePatchPath: string;
}): boolean;
export declare function resolveDiagramFlow(input: DiagramFlowInput): DiagramFlowResult;
