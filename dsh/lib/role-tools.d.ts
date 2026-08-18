/**
 * Role-tool factory for slash-armed parent sessions.
 * Persona inlining for specline_frontend_dev is owned by render-from-core
 * (Task 5). This module only maps toolName + child isolation; it does not
 * duplicate frontend-design Skill copy or write agent markdown into projects.
 *
 * Import point (Task 19 / build wiring):
 *   import { inlineFrontendDesign } from './render-from-core.js';
 */
export declare const FRONTEND_DEV_PERSONA_MODULE = "./render-from-core.js";
export declare const ROLE_TOOL_NAMES: readonly ["specline_spec_creator", "specline_spec_reviewer", "specline_frontend_dev", "specline_backend_dev", "specline_config_dev", "specline_config_reviewer", "specline_code_reviewer", "specline_test_writer", "specline_test_runner", "specline_explore_assistant"];
export type RoleToolName = (typeof ROLE_TOOL_NAMES)[number];
export declare const CHILD_SESSION_MAX_DEPTH = 1;
export declare const CHILD_SESSION_CAN_GATE_ARCHIVE = false;
export declare const ROLE_PERSONA_SOURCES: Record<RoleToolName, string>;
export type RoleToolConfig = {
    kind: 'dsh-tool-subagent';
    toolName: RoleToolName;
    personaSource: string;
    maxDepth: typeof CHILD_SESSION_MAX_DEPTH;
    toolFilter: (tools: readonly string[]) => string[];
    canGateArchive: typeof CHILD_SESSION_CAN_GATE_ARCHIVE;
    inlineFrontendDesign: boolean;
    personaRendererModule?: string;
};
export declare function filterChildSessionTools(tools: readonly string[]): string[];
export declare function createRoleToolConfig(toolName: RoleToolName): RoleToolConfig;
export declare function createRoleToolConfigs(): RoleToolConfig[];
