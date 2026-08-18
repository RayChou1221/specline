/**
 * Visualize stays a self-contained single-file HTML path.
 * It must not detect, upsert, or require drawio MCP. Diagram ASCII
 * fallback must not be rewritten into Visualize or break Explore.
 */
export const VISUALIZE_OUTPUT = 'single-file-html';
export const DIAGRAM_ASCII_FALLBACK = 'ascii';
export function visualizeUsesMcp() {
    return false;
}
/** Visualize must not invoke diagram profile upsert. */
export function visualizeCallsDiagramUpsert() {
    return false;
}
/** ASCII fallback stays ASCII; it does not become a Visualize run. */
export function diagramAsciiFallbackInvokesVisualize() {
    return false;
}
export function resolveVisualizePath() {
    return {
        usesMcp: false,
        callsDiagramUpsert: false,
        output: VISUALIZE_OUTPUT,
        requiresMcpDrawio: false,
    };
}
export function resolveDiagramFailureFallback() {
    return {
        fallback: DIAGRAM_ASCII_FALLBACK,
        invokeVisualize: false,
        mergeContracts: false,
        interruptExplore: false,
    };
}
