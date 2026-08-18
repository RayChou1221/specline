/**
 * Role-tool factory for slash-armed parent sessions.
 * Persona inlining for specline_frontend_dev is owned by render-from-core
 * (Task 5). This module only maps toolName + child isolation; it does not
 * duplicate frontend-design Skill copy or write agent markdown into projects.
 *
 * Import point (Task 19 / build wiring):
 *   import { inlineFrontendDesign } from './render-from-core.js';
 */
export const FRONTEND_DEV_PERSONA_MODULE = './render-from-core.js';
export const ROLE_TOOL_NAMES = [
    'specline_spec_creator',
    'specline_spec_reviewer',
    'specline_frontend_dev',
    'specline_backend_dev',
    'specline_config_dev',
    'specline_config_reviewer',
    'specline_code_reviewer',
    'specline_test_writer',
    'specline_test_runner',
    'specline_explore_assistant',
];
export const CHILD_SESSION_MAX_DEPTH = 1;
export const CHILD_SESSION_CAN_GATE_ARCHIVE = false;
export const ROLE_PERSONA_SOURCES = {
    specline_spec_creator: 'core/agents/specline-spec-creator.yaml',
    specline_spec_reviewer: 'core/agents/specline-spec-reviewer.yaml',
    specline_frontend_dev: 'core/agents/specline-frontend-dev.yaml',
    specline_backend_dev: 'core/agents/specline-backend-dev.yaml',
    specline_config_dev: 'core/agents/specline-config-dev.yaml',
    specline_config_reviewer: 'core/agents/specline-config-reviewer.yaml',
    specline_code_reviewer: 'core/agents/specline-code-reviewer.yaml',
    specline_test_writer: 'core/agents/specline-test-writer.yaml',
    specline_test_runner: 'core/agents/specline-test-runner.yaml',
    specline_explore_assistant: 'core/agents/specline-explore-assistant.yaml',
};
const ROLE_TOOL_NAME_SET = new Set(ROLE_TOOL_NAMES);
export function filterChildSessionTools(tools) {
    return tools.filter((name) => !ROLE_TOOL_NAME_SET.has(name));
}
export function createRoleToolConfig(toolName) {
    const inlineFrontendDesign = toolName === 'specline_frontend_dev';
    return {
        kind: 'dsh-tool-subagent',
        toolName,
        personaSource: ROLE_PERSONA_SOURCES[toolName],
        maxDepth: CHILD_SESSION_MAX_DEPTH,
        toolFilter: filterChildSessionTools,
        canGateArchive: CHILD_SESSION_CAN_GATE_ARCHIVE,
        inlineFrontendDesign,
        ...(inlineFrontendDesign ? { personaRendererModule: FRONTEND_DEV_PERSONA_MODULE } : {}),
    };
}
export function createRoleToolConfigs() {
    return ROLE_TOOL_NAMES.map((toolName) => createRoleToolConfig(toolName));
}
