import { generateKeyPairSync, randomBytes, randomUUID, sign, verify } from 'node:crypto';
import { createConnection, createServer } from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { classifyProcessOwnership } from './session-state.mjs';

export class LifecycleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LifecycleError';
    this.code = code;
  }
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function createLifecycleController({
  sessionId,
  children = [],
  sync,
  closeHttp,
  observeProcess,
  killProcess,
  removeState,
  sleep = delay,
  graceMs = 2_000,
  operationTimeoutMs = 5_000,
} = {}) {
  let stopping;

  async function bounded(operation, label) {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new LifecycleError('CLEANUP_TIMEOUT', `${label} timed out`)),
            operationTimeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function terminateOwned(record) {
    let observed;
    try {
      observed = await bounded(() => observeProcess(record.pid), 'Process ownership check');
    } catch {
      return { pid: record.pid, terminated: false, classification: 'unverified' };
    }
    const ownership = classifyProcessOwnership(record, observed);
    if (!ownership.mayTerminate) {
      return { pid: record.pid, terminated: false, classification: ownership.classification };
    }
    try {
      await bounded(() => killProcess(record.pid, 'SIGTERM'), 'SIGTERM delivery');
      await bounded(() => sleep(graceMs), 'Process grace period');
    } catch {
      return { pid: record.pid, terminated: false, classification: 'owned_signal_failed' };
    }
    let afterGrace;
    try {
      afterGrace = await bounded(
        () => observeProcess(record.pid),
        'Post-SIGTERM ownership check',
      );
    } catch {
      return { pid: record.pid, terminated: true, classification: 'owned_unconfirmed' };
    }
    if (afterGrace?.alive) {
      const rechecked = classifyProcessOwnership(record, afterGrace);
      if (rechecked.mayTerminate) {
        try {
          await bounded(() => killProcess(record.pid, 'SIGKILL'), 'SIGKILL delivery');
        } catch {
          return { pid: record.pid, terminated: false, classification: 'owned_force_failed' };
        }
      }
    }
    return { pid: record.pid, terminated: true, classification: 'owned' };
  }

  async function performStop({ save = true, reason = 'explicit' } = {}) {
    let synchronized = false;
    let syncError;
    if (save && typeof sync === 'function') {
      try {
        await bounded(() => sync(), 'Browser synchronization');
        synchronized = true;
      } catch (error) {
        syncError = error;
      }
    }

    if (typeof closeHttp === 'function') {
      try {
        await bounded(() => closeHttp(), 'HTTP shutdown');
      } catch {
        // Continue to owned-process cleanup even when graceful HTTP shutdown times out.
      }
    }
    const processes = [];
    for (const child of children) {
      processes.push(await terminateOwned(child));
    }
    if (typeof removeState === 'function') {
      await bounded(() => removeState(sessionId), 'Session state removal');
    }
    if (syncError) {
      throw new LifecycleError(
        'SYNC_TIMEOUT',
        `Session stopped without claiming a save (${reason}): ${syncError.message}`,
      );
    }
    return Object.freeze({
      sessionId,
      stopped: true,
      saved: save ? synchronized : false,
      reason,
      processes,
    });
  }

  return Object.freeze({
    stop(options) {
      stopping ??= performStop(options);
      return stopping;
    },
    get stopping() {
      return Boolean(stopping);
    },
  });
}

export function attachLifecycleTriggers({
  controller,
  input = process.stdin,
  processObject = process,
  parentAlive,
  idle = {},
  pollMs = 1_000,
  idleMs = 30 * 60 * 1_000,
  now = () => Date.now(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  let disposed = false;
  const stop = (reason) => controller.stop({ save: true, reason }).catch(() => {});
  const onEnd = () => stop('stdin_eof');
  const onSigterm = () => stop('sigterm');
  input?.once?.('end', onEnd);
  processObject?.once?.('SIGTERM', onSigterm);

  const timer = setIntervalFn(() => {
    if (disposed || controller.stopping) {
      return;
    }
    if (typeof parentAlive === 'function' && !parentAlive()) {
      stop('parent_exit');
      return;
    }
    if (now() - (idle.lastActivityAt?.() ?? now()) >= idleMs) {
      stop('idle_timeout');
    }
  }, pollMs);
  timer?.unref?.();

  return () => {
    disposed = true;
    clearIntervalFn(timer);
    input?.removeListener?.('end', onEnd);
    processObject?.removeListener?.('SIGTERM', onSigterm);
  };
}

export async function stopAllSessions(sessions, {
  approved = false,
  approvedSessionIds = [],
} = {}) {
  const ids = sessions.map((session) => session.sessionId).sort();
  const approvedIds = [...approvedSessionIds].sort();
  if (!approved || JSON.stringify(ids) !== JSON.stringify(approvedIds)) {
    throw new LifecycleError(
      'CONSENT_REQUIRED',
      'stop-all requires confirmation for the exact affected session list',
    );
  }
  return Promise.all(sessions.map((session) => session.controller.stop({
    save: true,
    reason: 'stop_all',
  })));
}


export function sessionRegistryRoot({ homeDir = os.homedir() } = {}) {
  return path.join(homeDir, '.specline', 'runtimes', 'drawio', 'sessions');
}

function registryFile(root, sessionId) { return path.join(root, `${sessionId}.json`); }

export async function writeSessionRecord(record, { homeDir, fsImpl = fs } = {}) {
  const root = sessionRegistryRoot({ homeDir });
  await fsImpl.mkdir(root, { recursive: true, mode: 0o700 });
  const file = registryFile(root, record.sessionId);
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const publicRecord = { ...record };
  delete publicRecord.token;
  await fsImpl.writeFile(temporary, `${JSON.stringify(publicRecord, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await fsImpl.rename(temporary, file);
  return publicRecord;
}

export async function listSessionRecords({ homeDir, projectRoot, fsImpl = fs } = {}) {
  const root = sessionRegistryRoot({ homeDir });
  const names = await fsImpl.readdir(root).catch((error) => error?.code === 'ENOENT' ? [] : Promise.reject(error));
  const records = [];
  for (const name of names) {
    if (!/^[0-9a-f-]+\.json$/i.test(name)) continue;
    try {
      const record = JSON.parse(await fsImpl.readFile(path.join(root, name), 'utf8'));
      if (!projectRoot || record.projectRoot === projectRoot) records.push(record);
    } catch { /* malformed records are handled by doctor */ }
  }
  return records.sort((a, b) => String(a.sessionId).localeCompare(String(b.sessionId)));
}

export async function removeSessionRecord(sessionId, { homeDir, fsImpl = fs } = {}) {
  await fsImpl.rm(registryFile(sessionRegistryRoot({ homeDir }), sessionId), { force: true });
}


function controlEndpoint(root, sessionId, platform = process.platform) {
  return platform === 'win32' ? `\\\\.\\pipe\\specline-diagram-${sessionId}` : path.join(os.tmpdir(), `specline-dgm-${sessionId.slice(0,12)}-${process.pid}.sock`);
}

export async function startSessionControl({ sessionId, homeDir, onCommand, platform = process.platform } = {}) {
  const root = sessionRegistryRoot({ homeDir }); await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const endpoint = controlEndpoint(root, sessionId, platform); if (platform !== 'win32') await fs.rm(endpoint, { force: true });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const server = createServer((socket) => { let source=''; socket.setEncoding('utf8'); socket.on('data',async(chunk)=>{source+=chunk;if(!source.includes('\n'))return;try{const request=JSON.parse(source.trim());if(typeof request.challenge!=='string'||typeof request.command!=='string')throw new Error('INVALID_CONTROL_REQUEST');const result=await onCommand(request.command,request.payload??{});const payload={challenge:request.challenge,ok:true,result};const signature=sign(null,Buffer.from(JSON.stringify(payload)),privateKey).toString('base64');socket.end(`${JSON.stringify({...payload,signature})}\n`,()=>{if(request.command==='finish')setImmediate(()=>server.close(()=>{if(platform!=='win32')fs.rm(endpoint,{force:true}).catch(()=>{});}));});}catch(error){const payload={challenge:'',ok:false,error:{code:error.code??'SESSION_CONTROL_ERROR',message:error.message}};const signature=sign(null,Buffer.from(JSON.stringify(payload)),privateKey).toString('base64');socket.end(`${JSON.stringify({...payload,signature})}\n`);}}); });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(endpoint,resolve)});
  return Object.freeze({ endpoint, publicKey: publicKeyDer, close: async()=>{await new Promise((resolve)=>server.close(resolve));if(platform!=='win32')await fs.rm(endpoint,{force:true});} });
}

export async function callSessionControl(record, command, payload = {}, { timeoutMs = 15_000 } = {}) {
  if (!record?.controlEndpoint || !record?.controlPublicKey) throw new LifecycleError('UNVERIFIED_PROCESS_OWNERSHIP','Session has no verifiable control endpoint');
  const challenge=randomBytes(24).toString('base64url');
  const response=await new Promise((resolve,reject)=>{const socket=createConnection(record.controlEndpoint);let source='';const timer=setTimeout(()=>{socket.destroy();reject(new LifecycleError('SESSION_CONTROL_TIMEOUT','Session control timed out'));},timeoutMs);socket.setEncoding('utf8');socket.once('connect',()=>socket.write(`${JSON.stringify({challenge,command,payload})}\n`));socket.on('data',(chunk)=>{source+=chunk});socket.once('end',()=>{clearTimeout(timer);try{resolve(JSON.parse(source))}catch{reject(new LifecycleError('UNVERIFIED_PROCESS_OWNERSHIP','Malformed session control response'))}});socket.once('error',(error)=>{clearTimeout(timer);reject(new LifecycleError('UNVERIFIED_PROCESS_OWNERSHIP',error.message))});});
  const { signature, ...signed }=response; const publicKey={key:Buffer.from(record.controlPublicKey,'base64'),type:'spki',format:'der'};
  if(response.challenge!==challenge||!signature||!verify(null,Buffer.from(JSON.stringify(signed)),publicKey,Buffer.from(signature,'base64'))) throw new LifecycleError('UNVERIFIED_PROCESS_OWNERSHIP','Session control ownership proof failed');
  if(!response.ok) throw Object.assign(new LifecycleError(response.error?.code??'SESSION_CONTROL_ERROR',response.error?.message??'Session control failed'),{state:response.error?.state});
  return response.result;
}
