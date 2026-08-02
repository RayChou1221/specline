import { randomBytes, randomUUID } from 'node:crypto';
import { createBrowserSync } from './browser-sync.mjs';
import { startBridgeServer } from './http-server.mjs';
import {
  attachLifecycleTriggers,
  createLifecycleController,
} from './lifecycle.mjs';

export class DiagramRuntimeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DiagramRuntimeError';
    this.code = code;
  }
}

export function assertLocalSessionUrl(value, sessionId) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new DiagramRuntimeError('REMOTE_ACCESS_BLOCKED', 'Session URL must be valid');
  }
  if (
    parsed.protocol !== 'http:' ||
    parsed.hostname !== '127.0.0.1' ||
    !parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== `/sessions/${encodeURIComponent(sessionId)}/`
  ) {
    throw new DiagramRuntimeError(
      'REMOTE_ACCESS_BLOCKED',
      'Session URL must be an exact 127.0.0.1 loopback URL',
    );
  }
  return value;
}

function publicState(session) {
  const state = session.browserSync.getState();
  return Object.freeze({
    ...state,
    sessionState: session.lifecycle.stopping ? 'stopping' :
      session.idleHeld ? 'idle_held' :
        (state.dirty ? 'dirty' : 'active'),
    uiUrl: session.uiUrl,
    pid: session.process.pid,
    port: session.http.port,
    diagramIdentity: session.diagramIdentity,
  });
}

export function createDiagramRuntime({
  startHttp = startBridgeServer,
  spawnUpstream,
  observeProcess,
  killProcess,
  parentPid = process.pid,
  randomId = randomUUID,
  randomToken = () => randomBytes(32).toString('base64url'),
  now = () => Date.now(),
  sleep,
  input = process.stdin,
  processObject = process,
  ownerParentPid = process.ppid,
  serveLocalUi,
  parentAlive = () => {
    try {
      process.kill(ownerParentPid, 0);
      return true;
    } catch {
      return false;
    }
  },
  attachTriggers = true,
} = {}) {
  const sessions = new Map();

  async function startSession({
    sessionId = randomId(),
    diagramIdentity,
    initialXml = '',
    initialRevision = 0,
    requestBrowserState,
    persist,
    bridge = {},
  } = {}) {
    if (sessions.has(sessionId)) {
      throw new DiagramRuntimeError('SESSION_CONFLICT', 'Session already exists');
    }
    if (typeof spawnUpstream !== 'function') {
      throw new DiagramRuntimeError(
        'RUNTIME_UNAVAILABLE',
        'Patched per-session upstream launcher is unavailable',
      );
    }

    const token = randomToken();
    const browserSync = createBrowserSync({
      sessionId,
      initialXml,
      initialRevision,
      requestBrowserState,
      persist,
      now,
    });
    const handlers = {
      state: async ({ body, method }) => {
        if (method === 'GET') return { ...browserSync.getState(), xml: browserSync.getXml() };
        const applied = browserSync.applyState(body);
        await bridge.stateApplied?.(applied);
        return applied;
      },
      sync: async ({ body }) => browserSync.sync(body),
      history: async ({ body }) => bridge.history?.(body) ?? browserSync.getState(),
      restore: async ({ body }) => {
        if (typeof bridge.restore !== 'function') {
          throw new DiagramRuntimeError('BRIDGE_ROUTE_NOT_FOUND', 'Restore is unavailable');
        }
        return bridge.restore(body);
      },
      preview: async ({ body }) => bridge.preview?.(body) ?? browserSync.getState(),
      export: async ({ body }) => {
        if (typeof bridge.export !== 'function') {
          throw new DiagramRuntimeError('BRIDGE_ROUTE_NOT_FOUND', 'Export is unavailable');
        }
        return bridge.export(body);
      },
    };

    const http = await startHttp({
      sessionId,
      token,
      handlers,
      uiHandler: typeof serveLocalUi==='function' ? (input)=>serveLocalUi({...input,token}) : undefined,
    });
    let uiUrl;
    try {
      uiUrl = assertLocalSessionUrl(http.uiUrl, sessionId);
      if (http.origin !== new URL(uiUrl).origin) {
        throw new DiagramRuntimeError(
          'REMOTE_ACCESS_BLOCKED',
          'Bridge origin must match the owned loopback UI origin',
        );
      }
      if (http.uiReady === false) {
        throw new DiagramRuntimeError(
          'RUNTIME_UNAVAILABLE',
          'Verified local Draw.io assets are unavailable',
        );
      }
    } catch (error) {
      await http.close();
      throw error;
    }
    let processRecord;
    try {
      processRecord = await spawnUpstream({
        sessionId,
        bridgeOrigin: http.origin,
        bridgeToken: token,
        drawioBaseUrl: http.origin,
        parentPid,
      });
      if (
        !processRecord ||
        !Number.isSafeInteger(processRecord.pid) ||
        processRecord.parentPid !== parentPid ||
        typeof processRecord.processStartTime !== 'string'
      ) {
        throw new DiagramRuntimeError(
          'UNVERIFIED_PROCESS_OWNERSHIP',
          'Upstream process ownership could not be established',
        );
      }
    } catch (error) {
      await http.close();
      throw error;
    }

    const session = {
      sessionId,
      diagramIdentity,
      browserSync,
      http,
      process: { ...processRecord, sessionId },
      uiUrl,
      bootstrapUrl: http.bootstrapUrl,
      idleHeld: false,
    };
    let detachTriggers;
    session.lifecycle = createLifecycleController({
      sessionId,
      children: [session.process],
      sync: () => browserSync.sync(),
      closeHttp: http.close,
      observeProcess,
      killProcess,
      sleep,
      removeState: () => {
        detachTriggers?.();
        sessions.delete(sessionId);
      },
    });
    sessions.set(sessionId, session);
    if (attachTriggers) {
      detachTriggers = attachLifecycleTriggers({
        controller: session.lifecycle,
        input,
        processObject,
        parentAlive,
        idle: { lastActivityAt: () => browserSync.getState().lastActivityAt },
        now,
      });
    }
    return publicState(session);
  }

  function requireSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) {
      throw new DiagramRuntimeError('SESSION_NOT_FOUND', 'Session does not exist');
    }
    return session;
  }

  return Object.freeze({
    startSession,
    status: (sessionId) => publicState(requireSession(sessionId)),
    list: () => [...sessions.values()].map(publicState),
    applyBrowserState: (sessionId, state) => {
      const session = requireSession(sessionId);
      session.idleHeld = false;
      return session.browserSync.applyState(state);
    },
    sync: (sessionId, options) => requireSession(sessionId).browserSync.sync(options),
    getXml: (sessionId) => requireSession(sessionId).browserSync.getXml(),
    markDirty: (sessionId) => requireSession(sessionId).browserSync.markDirty(),
    hold: (sessionId) => {
      const session = requireSession(sessionId);
      session.idleHeld = true;
      return publicState(session);
    },
    stop: (sessionId, options) => requireSession(sessionId).lifecycle.stop(options),
    lifecycle: (sessionId) => requireSession(sessionId).lifecycle,
    bootstrapUrl: (sessionId) => requireSession(sessionId).bootstrapUrl,
  });
}
