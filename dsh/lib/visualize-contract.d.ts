/**
 * Visualize stays a self-contained single-file HTML path.
 * It must not detect, upsert, or require drawio MCP. Diagram ASCII
 * fallback must not be rewritten into Visualize or break Explore.
 */
export declare const VISUALIZE_OUTPUT: "single-file-html";
export declare const DIAGRAM_ASCII_FALLBACK: "ascii";
export type VisualizePathContract = {
    usesMcp: false;
    callsDiagramUpsert: false;
    output: typeof VISUALIZE_OUTPUT;
    requiresMcpDrawio: false;
};
export type DiagramFailureFallback = {
    fallback: typeof DIAGRAM_ASCII_FALLBACK;
    invokeVisualize: false;
    mergeContracts: false;
    interruptExplore: false;
};
export declare function visualizeUsesMcp(): boolean;
/** Visualize must not invoke diagram profile upsert. */
export declare function visualizeCallsDiagramUpsert(): boolean;
/** ASCII fallback stays ASCII; it does not become a Visualize run. */
export declare function diagramAsciiFallbackInvokesVisualize(): boolean;
export declare function resolveVisualizePath(): VisualizePathContract;
export declare function resolveDiagramFailureFallback(): DiagramFailureFallback;
