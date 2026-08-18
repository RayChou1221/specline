/**
 * Visualize stays a self-contained single-file HTML path.
 * It must not detect, upsert, or require drawio MCP. Diagram ASCII
 * fallback must not be rewritten into Visualize or break Explore.
 */

export const VISUALIZE_OUTPUT = 'single-file-html' as const;
export const DIAGRAM_ASCII_FALLBACK = 'ascii' as const;

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

export function visualizeUsesMcp(): boolean {
  return false;
}

/** Visualize must not invoke diagram profile upsert. */
export function visualizeCallsDiagramUpsert(): boolean {
  return false;
}

/** ASCII fallback stays ASCII; it does not become a Visualize run. */
export function diagramAsciiFallbackInvokesVisualize(): boolean {
  return false;
}

export function resolveVisualizePath(): VisualizePathContract {
  return {
    usesMcp: false,
    callsDiagramUpsert: false,
    output: VISUALIZE_OUTPUT,
    requiresMcpDrawio: false,
  };
}

export function resolveDiagramFailureFallback(): DiagramFailureFallback {
  return {
    fallback: DIAGRAM_ASCII_FALLBACK,
    invokeVisualize: false,
    mergeContracts: false,
    interruptExplore: false,
  };
}
