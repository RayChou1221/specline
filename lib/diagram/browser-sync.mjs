export class BrowserSyncError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BrowserSyncError';
    this.code = code;
  }
}

function assertRevision(actual, expected) {
  if (expected !== undefined && expected !== actual) {
    throw new BrowserSyncError(
      'REVISION_CONFLICT',
      `Expected revision ${expected}, current revision is ${actual}`,
    );
  }
}

export function createBrowserSync({
  sessionId,
  initialXml = '',
  initialRevision = 0,
  requestBrowserState,
  persist,
  now = () => Date.now(),
} = {}) {
  if (typeof sessionId !== 'string' || !sessionId) {
    throw new BrowserSyncError('INVALID_SESSION', 'sessionId is required');
  }
  if (!Number.isSafeInteger(initialRevision) || initialRevision < 0) {
    throw new BrowserSyncError('INVALID_REVISION', 'initialRevision must be non-negative');
  }

  let xml = initialXml;
  let revision = initialRevision;
  let dirty = false;
  let lastActivityAt = now();

  function snapshot() {
    return Object.freeze({ sessionId, revision, dirty, lastActivityAt });
  }

  function applyState({ baseRevision, xml: nextXml } = {}) {
    assertRevision(revision, baseRevision);
    if (typeof nextXml !== 'string') {
      throw new BrowserSyncError('INVALID_XML', 'xml must be a string');
    }
    xml = nextXml;
    revision += 1;
    dirty = true;
    lastActivityAt = now();
    return snapshot();
  }

  async function sync({ expectedRevision, timeoutMs = 5_000 } = {}) {
    assertRevision(revision, expectedRevision);
    if (typeof requestBrowserState !== 'function') {
      if (dirty && typeof persist === 'function') {
        await persist({ sessionId, revision, xml });
        dirty = false;
      }
      return snapshot();
    }

    let timer;
    try {
      const browserState = await Promise.race([
        requestBrowserState({ sessionId, revision }),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new BrowserSyncError('SYNC_TIMEOUT', 'Browser synchronization timed out')),
            timeoutMs,
          );
        }),
      ]);
      if (browserState && browserState.revision !== revision) {
        throw new BrowserSyncError(
          'REVISION_CONFLICT',
          'Browser returned a state for a different revision',
        );
      }
      if (browserState && typeof browserState.xml === 'string' && browserState.xml !== xml) {
        xml = browserState.xml;
        revision += 1;
        dirty = true;
      }
      if (dirty && typeof persist === 'function') {
        await persist({ sessionId, revision, xml });
        dirty = false;
      }
      lastActivityAt = now();
      return snapshot();
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    applyState,
    getState: snapshot,
    getXml: () => xml,
    markDirty() {
      dirty = true;
      lastActivityAt = now();
      return snapshot();
    },
    sync,
  });
}
