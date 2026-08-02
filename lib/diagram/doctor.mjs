import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { digestPlan, runtimeVersion } from './install-plan.mjs';
import { validateManagedManifest } from './manifest.mjs';
import { classifyProcessOwnership } from './session-state.mjs';

async function readJson(fsImpl, file) {
  try {
    return JSON.parse(await fsImpl.readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    return { malformed: true };
  }
}

async function isFile(fsImpl, file) {
  try {
    return (await fsImpl.lstat(file)).isFile();
  } catch {
    return false;
  }
}

async function verifyReleaseInputs(fsImpl,pathImpl,target,metadata){
  const expected=metadata?.releaseInputDigests;if(!expected||typeof expected!=='object')return false;
  for(const [relative,digest] of Object.entries(expected)){const content=await fsImpl.readFile(pathImpl.join(target,relative)).catch(()=>null);if(!content||createHash('sha256').update(content).digest('hex')!==digest)return false;}
  return true;
}

async function inspectStaging({
  fsImpl,
  pathImpl,
  managedRoot,
  target,
  repairStale,
  nowMs,
  staleAfterMs,
}) {
  const stale = [];
  let entries = [];
  try {
    entries = await fsImpl.readdir(managedRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\.(?:stage|rollback|uninstall)-/.test(entry.name)) continue;
    const candidate = pathImpl.join(managedRoot, entry.name);
    const stat = await fsImpl.stat(candidate);
    if (nowMs - stat.mtimeMs < staleAfterMs) continue;
    const isRecoveryCopy = /^\.(?:rollback|uninstall)-/.test(entry.name);
    const targetPresent = await fsImpl.lstat(target).then(() => true, () => false);
    const recoverable = isRecoveryCopy && !targetPresent;
    const result = {
      path: candidate,
      classification: recoverable ? 'recovery_required' : 'stale_installer_temp',
      removed: false,
    };
    if (repairStale && !recoverable) {
      await fsImpl.rm(candidate, { recursive: true, force: true });
      result.removed = true;
    }
    stale.push(result);
  }
  return stale;
}

async function inspectSessions({
  sessionRecords,
  observeProcess,
  removeSessionRecord,
  repairStale,
}) {
  const sessions = [];
  for (const record of sessionRecords) {
    let observed = null;
    try {
      observed = await observeProcess(record.pid);
    } catch {
      observed = null;
    }
    const ownership = classifyProcessOwnership(record, observed);
    const item = { sessionId: record.sessionId, ...ownership, removed: false };
    if (repairStale && ownership.classification === 'stale_dead') {
      await removeSessionRecord(record);
      item.removed = true;
    }
    sessions.push(item);
  }
  return sessions;
}

export async function doctorRuntime({
  manifest,
  closure,
  managedRoot,
  target = path.join(managedRoot, runtimeVersion(manifest)),
  repairStale = false,
  fsImpl = fs,
  pathImpl = path,
  nowMs = Date.now(),
  staleAfterMs = 60 * 60 * 1000,
  sessionRecords = [],
  observeProcess = async () => null,
  removeSessionRecord = async () => {},
} = {}) {
  let manifestValidation;
  try {
    manifestValidation = validateManagedManifest({ manifest, closure });
  } catch (error) {
    return {
      auditState: manifest?.audit?.state?.replaceAll('-', '_') ?? 'blocked',
      releaseVerificationState: 'pending',
      runtimeState: 'blocked',
      code: error.code ?? 'INVALID_MANIFEST',
      stale: [],
      sessions: [],
    };
  }

  const stale = await inspectStaging({
    fsImpl,
    pathImpl,
    managedRoot,
    target,
    repairStale,
    nowMs,
    staleAfterMs,
  });
  const sessions = await inspectSessions({
    sessionRecords,
    observeProcess,
    removeSessionRecord,
    repairStale,
  });
  const metadata = await readJson(fsImpl, pathImpl.join(target, 'installation.json'));
  let runtimeState = 'ready';
  let code = 'RUNTIME_READY';

  if (!metadata) {
    runtimeState = 'missing';
    code = 'RUNTIME_MISSING';
  } else if (
    metadata.malformed ||
    metadata.runtimeVersion !== runtimeVersion(manifest) ||
    metadata.manifestDigest !== manifestValidation.manifestDigest ||
    metadata.closureDigest !== digestPlan(closure) ||
    metadata.artifactCount !== closure.artifactCount ||
    metadata.offlineVerified !== true ||
    !await verifyReleaseInputs(fsImpl,pathImpl,target,metadata) ||
    !await isFile(fsImpl, pathImpl.join(target, 'webapp', manifest.artifacts.drawioWebapp.entry)) ||
    !await isFile(
      fsImpl,
      pathImpl.join(
        target,
        'mcp',
        'node_modules',
        '@next-ai-drawio',
        'mcp-server',
        'dist',
        'index.js',
      ),
    )
  ) {
    runtimeState = 'corrupt';
    code = 'RUNTIME_CORRUPT';
  }

  return {
    auditState: manifest.audit.state.replaceAll('-', '_'),
    releaseVerificationState: manifest.audit.releaseVerificationState ?? (manifest.audit.releaseGate ? 'pending' : 'failed'),
    runtimeState,
    code,
    target,
    automaticUpgrade: false,
    stale,
    sessions,
  };
}
