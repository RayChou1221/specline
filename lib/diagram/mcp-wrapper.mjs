import { relative, sep } from 'node:path';
import {
  resolveManagedArtifact,
  resolveManagedRoot,
} from './path-policy.mjs';

export const DIAGRAM_TOOLS = Object.freeze([
  'diagram.create',
  'diagram.load',
  'diagram.edit',
  'diagram.readState',
  'diagram.export',
  'diagram.finish',
]);

export class DiagramWrapperError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DiagramWrapperError';
    this.code = code;
  }
}

function assertSecurityBoundary(boundary) {
  if (
    boundary?.launch !== true ||
    boundary?.bridgeAuth !== true ||
    boundary?.managedPaths !== true
  ) {
    throw new DiagramWrapperError(
      'SECURITY_BOUNDARY_UNVERIFIED',
      'Diagram tools remain sealed until launch, bridge auth, and path boundaries are verified',
    );
  }
}

function relativeArtifact(projectRoot, pathname) {
  return relative(projectRoot, pathname).split(sep).join('/');
}

function assertBaseRevision(state, baseRevision) {
  if (state.revision !== baseRevision) {
    throw new DiagramWrapperError(
      'REVISION_CONFLICT',
      `Expected revision ${baseRevision}, current revision is ${state.revision}`,
    );
  }
}

function validateOperations(operations) {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new DiagramWrapperError('INVALID_OPERATIONS', 'operations must be a non-empty array');
  }
  for (const operation of operations) {
    if (
      !operation ||
      !['update', 'add', 'delete'].includes(operation.operation) ||
      typeof operation.cell_id !== 'string' ||
      !operation.cell_id
    ) {
      throw new DiagramWrapperError('INVALID_OPERATIONS', 'Diagram operation is invalid');
    }
  }
}

export function createMcpWrapper({
  projectRoot,
  runtime,
  upstream,
  securityBoundary,
} = {}) {
  assertSecurityBoundary(securityBoundary);
  if (!runtime || !upstream || typeof projectRoot !== 'string') {
    throw new DiagramWrapperError('INVALID_WRAPPER_CONFIG', 'Wrapper dependencies are required');
  }
  const sessions = new Map();

  async function open({ slug, change, create }) {
    const root = resolveManagedRoot({ projectRoot, slug, change });
    const drawioPath = resolveManagedArtifact({
      projectRoot,
      slug,
      change,
      extension: '.drawio',
    });
    const xml = create ?
      await upstream.create({ managedPath: drawioPath, slug }) :
      await upstream.load({ managedPath: drawioPath });
    const started = await runtime.startSession({
      diagramIdentity: { slug, change: change ?? null },
      initialXml: xml,
      persist: ({ xml: latestXml }) => upstream.persist({
        managedPath: drawioPath,
        xml: latestXml,
      }),
    });
    sessions.set(started.sessionId, {
      slug,
      change,
      root,
      drawioPath,
    });
    return result(started.sessionId, { includeUrl: true });
  }

  function requireContext(sessionId) {
    const context = sessions.get(sessionId);
    if (!context) {
      throw new DiagramWrapperError('SESSION_NOT_FOUND', 'Wrapper session does not exist');
    }
    return context;
  }

  function result(sessionId, extras = {}) {
    const context = requireContext(sessionId);
    const state = runtime.status(sessionId);
    return Object.freeze({
      sessionId,
      sessionState: state.sessionState,
      revision: state.revision,
      diagramRelativePath: relativeArtifact(projectRoot, context.drawioPath),
      dirty: state.dirty,
      ...(extras.includeUrl ? { uiUrl: state.uiUrl } : {}),
      ...(extras.exportPath ? {
        exportRelativePath: relativeArtifact(projectRoot, extras.exportPath),
      } : {}),
    });
  }

  const operations = Object.freeze({
    'diagram.create': (input) => open({ ...input, create: true }),
    'diagram.load': (input) => open({ ...input, create: false }),
    async 'diagram.edit'({ sessionId, baseRevision, operations: edits } = {}) {
      requireContext(sessionId);
      await runtime.sync(sessionId, { expectedRevision: baseRevision });
      const state = runtime.status(sessionId);
      assertBaseRevision(state, baseRevision);
      validateOperations(edits);
      const xml = await upstream.edit({
        sessionId,
        xml: runtime.getXml(sessionId),
        operations: edits,
      });
      runtime.applyBrowserState(sessionId, { baseRevision, xml });
      return result(sessionId);
    },
    async 'diagram.readState'({ sessionId } = {}) {
      requireContext(sessionId);
      await runtime.sync(sessionId);
      return result(sessionId);
    },
    async 'diagram.export'({ sessionId, baseRevision, format } = {}) {
      const context = requireContext(sessionId);
      if (!['drawio', 'svg'].includes(format)) {
        throw new DiagramWrapperError('FORMAT_NOT_ALLOWED', 'format must be drawio or svg');
      }
      assertBaseRevision(runtime.status(sessionId), baseRevision);
      await runtime.sync(sessionId, { expectedRevision: baseRevision });
      const exportPath = format === 'drawio' ? context.drawioPath : resolveManagedArtifact({
        projectRoot,
        slug: context.slug,
        change: context.change,
        extension: '.svg',
      });
      await upstream.export({
        managedPath: exportPath,
        format,
        xml: runtime.getXml(sessionId),
      });
      return result(sessionId, { exportPath });
    },
    async 'diagram.finish'({ sessionId, mode } = {}) {
      const context = requireContext(sessionId);
      if (mode === 'continue') {
        return result(sessionId);
      }
      if (mode === 'keep-30m') {
        runtime.hold(sessionId);
        return result(sessionId);
      }
      if (!['save', 'discard'].includes(mode)) {
        throw new DiagramWrapperError('INVALID_FINISH_MODE', 'Unknown finish mode');
      }
      const state = runtime.status(sessionId);
      const stopped = await runtime.stop(sessionId, {
        save: mode === 'save',
        reason: 'explicit',
      });
      sessions.delete(sessionId);
      return Object.freeze({
        sessionId,
        sessionState: 'stopped',
        revision: state.revision,
        diagramRelativePath: relativeArtifact(projectRoot, context.drawioPath),
        dirty: false,
        saved: stopped.saved,
      });
    },
  });

  return Object.freeze({
    listTools: () => [...DIAGRAM_TOOLS],
    call(tool, input) {
      const operation = operations[tool];
      if (!operation) {
        throw new DiagramWrapperError('TOOL_NOT_EXPOSED', `Tool is not exposed: ${tool}`);
      }
      return operation(input ?? {});
    },
  });
}
