import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { createServer } from 'node:http';
import { copyFile, mkdir, readFile, realpath, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { PACKAGE_ROOT, diagramRuntimeRoot } from './paths.mjs';
import { assertPlanApproval, createInstallPlan, managedRuntimeRoot, runtimeVersion } from './diagram/install-plan.mjs';
import { doctorRuntime } from './diagram/doctor.mjs';
import { validateManagedManifest } from './diagram/manifest.mjs';
import { resolveManagedArtifact, resolveManagedRoot } from './diagram/path-policy.mjs';
import { DIAGRAM_PLATFORMS, inspectDiagramPlatformConfig, mutateDiagramPlatformConfig } from './diagram/platform-adapters.mjs';
import { createDiagramRuntime } from './diagram/runtime.mjs';
import { createMcpWrapper } from './diagram/mcp-wrapper.mjs';
import { startBridgeServer } from './diagram/http-server.mjs';
import { getSharedSpeclineManifest } from './deploy.mjs';
import { installRuntime } from './diagram/installer.mjs';
import { uninstallRuntime } from './diagram/uninstall.mjs';
import { callSessionControl, listSessionRecords, removeSessionRecord, startSessionControl, writeSessionRecord } from './diagram/lifecycle.mjs';

const EXIT_BY_CODE = Object.freeze({ INVALID_ARGUMENT: 2, INVALID_ACTION: 2, INVALID_PLATFORM: 2,
  PLAN_APPROVAL_REQUIRED: 3, PLAN_REQUIRED: 3, PLAN_STALE: 3, PLATFORM_PERMISSION_REQUIRED: 5,
  MALFORMED_CONFIG: 5, CONFIG_MALFORMED: 5, MCP_SERVER_CONFLICT: 5, MCP_NAME_CONFLICT: 5,
  SESSION_NOT_FOUND: 6, RELEASE_GATE_BLOCKED: 4, RUNTIME_MISSING: 4, RUNTIME_CORRUPT: 4 });
const PUBLIC_COMMANDS = new Set(['plan', 'install', 'configure', 'start', 'status', 'stop', 'stop-all', 'doctor', 'uninstall']);
const INTERNAL_COMMANDS = new Set(['release-trace', 'release-trace-worker', 'session-worker', 'mcp']);
const TRACE_STATE = 'specline-release-trace-session.json';
const MANAGED_WORKERS = new Map();
const execFileAsync=promisify(execFile);
const envelope = (ok, code, state, message) => ({ ok, code, state, message });
const RELEASE_CONTROL_INPUTS = Object.freeze(['package.json','lib/deploy.mjs']);

function parseArgs(args) {
  const options = { json: false, sessions: [] };
  const positionals = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--json') { options.json = true; continue; }
    if (!value.startsWith('--')) { positionals.push(value); continue; }
    const key = value.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (key === 'repairStale' || key === 'stdio') { options[key] = true; continue; }
    const next = args[index + 1];
    if (next === undefined || next.startsWith('--')) throw Object.assign(new Error(`${value} requires a value`), { code: 'INVALID_ARGUMENT' });
    index += 1;
    if (key === 'session') options.sessions.push(next); else options[key] = next;
  }
  return { command: positionals[0], options };
}

async function loadManagedInputs(packageRoot = PACKAGE_ROOT) {
  const root = diagramRuntimeRoot(packageRoot);
  const [manifestText, closureText] = await Promise.all([
    readFile(path.join(root, 'manifest.json'), 'utf8'), readFile(path.join(root, 'dependency-lock.json'), 'utf8'),
  ]);
  const manifest = JSON.parse(manifestText); const closure = JSON.parse(closureText);
  validateManagedManifest({ manifest, closure }); return { manifest, closure };
}


function releaseManifestProjection(manifest) {
  const projection=structuredClone(manifest);
  delete projection.offlineTrace;
  delete projection.finalReleaseBlockers;
  delete projection.verificationEvidence;
  if(projection.audit){
    delete projection.audit.releaseGate;
    delete projection.audit.releaseVerificationState;
    delete projection.audit.releaseBlockedReasons;
    delete projection.audit.summary;
  }
  // Verification outcomes must not shift the canonical release input digest.
  if(Array.isArray(projection.requiredMitigations)){
    projection.requiredMitigations=projection.requiredMitigations.map(({id,ownerTask,requirement})=>({id,ownerTask,requirement}));
  }
  if(projection.upstreamBehavior?.networkBehavior){
    delete projection.upstreamBehavior.networkBehavior.offlineCoreUiTrace;
    delete projection.upstreamBehavior.networkBehavior.offlineCoreUiTraceReason;
  }
  return projection;
}

async function recursiveFiles(root,relative='') {
  const files=[];
  for(const entry of await readdir(path.join(root,relative),{withFileTypes:true}).catch(()=>[])){
    const name=relative?`${relative}/${entry.name}`:entry.name;
    if(entry.isDirectory())files.push(...await recursiveFiles(root,name));else if(entry.isFile())files.push(name);
  }
  return files;
}

async function releaseInputState(packageRoot, manifest, closure) {
  const runtimeRoot=diagramRuntimeRoot(packageRoot);const inputs=new Map();
  for(const [deployed,entry] of getSharedSpeclineManifest(packageRoot)){
    if(!deployed.startsWith('specline/runtime/'))continue;
    if(entry.source)inputs.set(path.relative(packageRoot,entry.source).split(path.sep).join('/'),entry.source);
  }
  for(const relative of RELEASE_CONTROL_INPUTS)inputs.set(relative,path.join(packageRoot,relative));
  const {stdout}=await execFileAsync('npm',['pack','--dry-run','--json','--ignore-scripts'],{cwd:packageRoot,maxBuffer:16*1024*1024});
  const packed=JSON.parse(stdout);for(const item of packed[0]?.files??[]){const relative=item.path;if(relative==='core/runtimes/drawio/manifest.json')inputs.set(relative,path.join(packageRoot,relative));else inputs.set(relative,path.join(packageRoot,relative));}
  const digests={};
  for(const [name,file] of [...inputs].sort(([a],[b])=>a.localeCompare(b))){
    const content=await readFile(file).catch(()=>null);if(!content)return {complete:false,digests};
    digests[name]=name==='core/runtimes/drawio/manifest.json'?createHash('sha256').update(JSON.stringify(releaseManifestProjection(manifest))).digest('hex'):createHash('sha256').update(content).digest('hex');
  }
  const bundleDigest=createHash('sha256').update(JSON.stringify(Object.entries(digests))).digest('hex');
  return {complete:true,digests,bundleDigest,traceBound:manifest.offlineTrace?.releaseInputDigest===bundleDigest,closureArtifacts:closure.artifactCount};
}

async function verification(manifest, { packageRoot = PACKAGE_ROOT, closure } = {}) {
  const inputs = await releaseInputState(packageRoot, manifest, closure);
  const mitigationStatus = new Map((manifest.requiredMitigations ?? []).map((item) => [item.id, item.status]));
  const required = { immutableClosure: mitigationStatus.get('TASK10_IMMUTABLE_DEPENDENCY_CLOSURE') === 'verified', licenseCopy: inputs.complete, notice: inputs.complete, modificationNotice: inputs.complete,
    task11AuthPathLoopback: ['TASK11_SPECLINE_OWNED_LAUNCH','TASK11_PER_SESSION_BRIDGE_AUTH','TASK11_MANAGED_PATH_AND_INTERFACE_WRAPPER','TASK11_SESSION_PROCESS_ISOLATION'].every((id)=>mitigationStatus.get(id)==='verified'),
    noNonLoopbackTrace: mitigationStatus.get('TASK12_FINAL_NO_NON_LOOPBACK_TRACE') === 'verified' && manifest.offlineTrace?.status === 'verified' && inputs.traceBound };
  const verified = manifest.audit.releaseGate === true && Object.values(required).every(Boolean);
  return { auditState: manifest.audit.state.replaceAll('-', '_'), releaseVerificationState: verified ? 'verified' : (manifest.audit.releaseVerificationState ?? 'failed'), releaseAllowed: verified, installationExposed: verified, mcpToolsExposed: verified, verification: required, releaseInputs: inputs };
}
async function assertReleaseAllowed(manifest, context) {
  const state = await verification(manifest, context);
  if (!state.releaseAllowed) throw Object.assign(new Error('Final release verification is incomplete; run doctor and continue with the recoverable ASCII fallback'), { code:'RELEASE_GATE_BLOCKED', state:{...state,runtimeState:'blocked'} });
  return state;
}
function requireOption(options, name) {
  if (!options[name]) throw Object.assign(new Error(`--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is required`), { code: 'INVALID_ARGUMENT' });
  return options[name];
}
async function requireAbsoluteDirectory(options, name) {
  const value = requireOption(options, name);
  if (!path.isAbsolute(value) || !(await stat(value).catch(() => null))?.isDirectory()) {
    throw Object.assign(new Error(`--${name} must be an existing absolute directory`), { code: 'INVALID_ARGUMENT' });
  }
  return realpath(value);
}
async function requireAbsoluteFile(options, name) {
  const value = requireOption(options, name);
  if (!path.isAbsolute(value) || !(await stat(value).catch(() => null))?.isFile()) {
    throw Object.assign(new Error(`--${name} must be an existing absolute file`), { code: 'INVALID_ARGUMENT' });
  }
  return realpath(value);
}
async function currentPlan({ action, manifest, closure, homeDir, platform, sessions, projectRoot, packageRoot = PACKAGE_ROOT }) {
  let currentState = {};
  if (action === 'configure') currentState = await inspectDiagramPlatformConfig({ platform, projectRoot, homeDir });
  if (action === 'stop-all') currentState = { sessions: await listSessionRecords({ homeDir, projectRoot }) };
  if(action==='uninstall'&&!platform)throw Object.assign(new Error('uninstall requires an approved --platform'),{code:'INVALID_PLATFORM'});
  if(action==='uninstall'){const platforms=[platform];currentState={platforms:await Promise.all(platforms.map((value)=>inspectDiagramPlatformConfig({platform:value,projectRoot,homeDir})))};}
  if (['install', 'upgrade', 'reinstall'].includes(action)) {
    const root = managedRuntimeRoot({ homeDir }); const target = path.join(root, runtimeVersion(manifest));
    currentState = await doctorRuntime({ manifest, closure, managedRoot: root, target });
  }
  const releaseInputs=await releaseInputState(packageRoot,manifest,closure);
  return createInstallPlan({ action, manifest, closure, homeDir, platform, sessions, currentState, releaseInputs:{bundleDigest:releaseInputs.bundleDigest,digests:releaseInputs.digests} });
}

function assertApprovedCurrentPlan(plan, digest, expectedAction) {
  if(typeof digest==='string'&&digest.length===64&&digest!==plan?.planDigest)throw Object.assign(new Error('Approved plan is stale because current release inputs or state changed'),{code:'PLAN_STALE'});
  return assertPlanApproval({ plan, approvedPlanDigest: digest, expectedAction, recomputedPlan: plan });
}

function processAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function publicSession(record) { const { projectRoot: _projectRoot, workerPid: _workerPid, ...state } = record; return state; }

async function stopManagedRecord(record, { homeDir, mode = 'save' } = {}) {
  if(!['save','discard'].includes(mode))throw Object.assign(new Error('mode must be save or discard'),{code:'INVALID_ARGUMENT'});
  const result=await callSessionControl(record,'finish',{mode});
  if(mode==='save'&&result.saved!==true)throw Object.assign(new Error(result.syncError??'Session stopped without verified save'),{code:'SYNC_TIMEOUT',state:result});
  await removeSessionRecord(record.sessionId,{homeDir}); return result;
}

async function startSessionWorker(options, context, manifest) {
  const projectRoot = await requireAbsoluteDirectory(options, 'project');
  const slug = requireOption(options, 'slug');
  const managedRoot = resolveManagedRoot({ projectRoot, slug, change: options.change });
  const drawio = resolveManagedArtifact({ projectRoot, slug, change: options.change, extension: '.drawio' });
  const sessionId = options.sessionId || randomUUID();
  const homeDir = context.homeDir ?? os.homedir();
  const target = context.runtimeTarget ?? path.join(managedRuntimeRoot({ homeDir }), runtimeVersion(manifest));
  const launcher = path.join(target, 'patches', 'launcher.mjs');
  const mcpEntry = path.join(target, 'mcp', 'node_modules', '@next-ai-drawio', 'mcp-server', 'dist', 'index.js');
  const webappRoot = path.join(target, 'webapp');
  if (!(await stat(target).catch(() => null))?.isDirectory()) {
    throw Object.assign(new Error('Diagram runtime is missing; run doctor and continue with the recoverable ASCII fallback'), { code: 'RUNTIME_MISSING', state: { runtimeState: 'missing' } });
  }
  if (!(await stat(launcher).catch(() => null))?.isFile()) {
    throw Object.assign(new Error('Managed launcher patch is missing; run doctor and continue with the recoverable ASCII fallback'), { code: 'RUNTIME_CORRUPT', state: { runtimeState: 'corrupt' } });
  }
  const children = new Map();
  const runtime = createDiagramRuntime({ attachTriggers: false, randomId: () => sessionId,
    serveLocalUi: async ({ pathname, token }) => {
      const sessionPrefix = `/sessions/${encodeURIComponent(sessionId)}/`;
      if (pathname === sessionPrefix) return { contentType:'text/html; charset=utf-8', body:'<!doctype html><meta charset="utf-8"><title>Specline Diagram</title><iframe id="drawio" title="Local Draw.io" src="/assets/index.html?embed=1&proto=json&spin=1&offline=1"></iframe><script src="/assets/specline-bridge.js" defer></script>' };
      if (pathname === '/assets/specline-bridge.js') return { contentType:'text/javascript; charset=utf-8', body:`const sessionId=${JSON.stringify(sessionId)},ownedOrigin=location.origin,frame=document.querySelector('#drawio');
async function bridge(endpoint,method='GET',body){const response=await fetch('/api/sessions/'+encodeURIComponent(sessionId)+'/'+endpoint,{method,credentials:'same-origin',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.message),value);return value;}
async function sendStateToFrame(){const state=await bridge('state');frame.contentWindow.postMessage(JSON.stringify({action:'load',xml:state.xml??'',revision:state.revision}),ownedOrigin);}
frame.addEventListener('load',sendStateToFrame);addEventListener('message',async(event)=>{if(event.source!==frame.contentWindow||event.origin!==ownedOrigin)return;let message;try{message=typeof event.data==='string'?JSON.parse(event.data):event.data}catch{return}if(!message||typeof message!=='object')return;if(message.event==='init'||message.event==='configure'){await sendStateToFrame();return}if((message.event==='save'||message.event==='export')&&typeof message.xml==='string'){const current=await bridge('state');const updated=await bridge('state','PUT',{baseRevision:current.revision,xml:message.xml});window.speclineLastDrawioEvent={event:message.event,format:message.format??null,revision:updated.revision};frame.contentWindow.postMessage(JSON.stringify({action:'status',message:'Saved revision '+updated.revision}),ownedOrigin);}});window.speclineBridge=bridge;` };
      const prefix = '/assets/'; if (!pathname.startsWith(prefix)) return { statusCode: 404, body: '' };
      const relative = decodeURIComponent(pathname.slice(prefix.length)) || 'index.html'; const candidate = path.resolve(webappRoot, relative);
      if (candidate !== webappRoot && !candidate.startsWith(`${webappRoot}${path.sep}`)) return { statusCode: 404, body: '' };
      const body = await readFile(candidate).catch(() => null);const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.gif':'image/gif','.woff':'font/woff','.woff2':'font/woff2','.json':'application/json'};return body ? {body,contentType:types[path.extname(candidate).toLowerCase()]??'application/octet-stream'} : { statusCode: 404, body: '' };
    },
    spawnUpstream: async ({ sessionId: id, bridgeOrigin, bridgeToken, parentPid }) => {
      const started = String(Date.now()); const child = spawn(process.execPath, [launcher], { stdio: ['pipe', 'ignore', 'ignore', 'ipc'], env: { ...process.env, SPECLINE_SESSION_ID: id, SPECLINE_BRIDGE_ORIGIN: bridgeOrigin, SPECLINE_BRIDGE_TOKEN: bridgeToken, SPECLINE_FIXED_MCP_ENTRY: mcpEntry } });
      await new Promise((resolve, reject) => { const timer=setTimeout(()=>reject(new Error('Fixed MCP authenticated bridge startup timed out')),5000); child.once('message',(message)=>{if(message?.type==='specline-launcher-ready'){clearTimeout(timer);resolve();}}); child.once('error',reject); child.once('exit',(code)=>reject(new Error(`Fixed MCP launcher exited ${code}`))); }); children.set(child.pid, { child, started });
      return { pid: child.pid, parentPid, processStartTime: started };
    },
    observeProcess: async (pid) => ({ alive: processAlive(pid), pid, parentPid: process.pid, processStartTime: children.get(pid)?.started }),
    killProcess: async (pid, signal) => {const child=children.get(pid)?.child;if(!child)return false;const killed=child.kill(signal);if(killed)await new Promise((resolve)=>child.once('exit',resolve));child.disconnect?.();child.stdin?.destroy();children.delete(pid);return killed;},
  });
  await mkdir(managedRoot, { recursive: true });
  const initialXml = await readFile(drawio, 'utf8').catch(() => '<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>');
  const markdown=resolveManagedArtifact({projectRoot,slug,change:options.change,extension:'.md'});
  const handoffList=(value)=>{if(Array.isArray(value))return value.join('\n');if(typeof value==='string'&&value.startsWith('[')){try{const parsed=JSON.parse(value);if(Array.isArray(parsed))return parsed.join('\n');}catch{}}return String(value??'');};
  const ensureCompanion=async()=>{const existing=await readFile(markdown,'utf8').catch(()=>null);if(existing!==null)return;const companion=`# ${slug}\n\n## Purpose\n${handoffList(options.purpose)}\n\n## Audience\n${handoffList(options.audience)}\n\n## Confirmed\n${handoffList(options.confirmed)}\n\n## Assumptions\n${handoffList(options.assumptions)}\n\n## Open Questions\n${handoffList(options.openQuestions)}\n\n## Diagram\n${path.relative(projectRoot,drawio).split(path.sep).join('/')}\n\n## Revision History\n`;await writeFile(markdown,companion);};
  const appendRevision=async(event,revision)=>{await ensureCompanion();await writeFile(markdown,`- ${new Date().toISOString()}: ${event} (revision ${revision})\n`,{flag:'a'});};
  const persist=async({xml,revision})=>{await writeFile(drawio,xml);await appendRevision('save',revision);};
  const started = await runtime.startSession({ diagramIdentity: { slug, change: options.change ?? null }, initialXml, requestBrowserState:async()=>({revision:runtime.status(sessionId).revision,xml:runtime.getXml(sessionId)}), persist, bridge:{stateApplied:(state)=>appendRevision('edit',state.revision)} });
  const bootstrapUrl=runtime.bootstrapUrl(sessionId);
  const openBrowser=context.openBrowser??((url)=>{const spec=process.platform==='darwin'?['open',[url]]:process.platform==='win32'?['cmd',['/c','start','',url]]:['xdg-open',[url]];const opener=spawn(spec[0],spec[1],{stdio:'ignore',detached:true});opener.unref();});
  if((context.env??process.env).SPECLINE_DIAGRAM_NO_BROWSER!=='1')await openBrowser(bootstrapUrl);
  let record;
  let idleTimer; let holdUntil; let cleanupPromise; let parentTimer; let resolveKeepAlive; const idleMs=Number((context.env??process.env).SPECLINE_DIAGRAM_IDLE_MS)||30*60*1000;
  const scheduleIdle=()=>{clearTimeout(idleTimer);if(!holdUntil)return;const delay=Math.max(0,holdUntil-Date.now());idleTimer=setTimeout(()=>exitAfter(finish('save','idle_timeout')),delay);idleTimer.unref?.();};
  const touch=async()=>{if(holdUntil){holdUntil=Date.now()+idleMs;scheduleIdle();record=await writeSessionRecord({...record,sessionState:'idle_held',holdUntil:new Date(holdUntil).toISOString()},{homeDir});}};
  const finish=(mode,reason='public_cli')=>{cleanupPromise??=(async()=>{let terminal;try{const result=await runtime.stop(sessionId,{save:mode==='save',reason});terminal={...record,sessionState:'stopped',saved:result.saved,syncError:null};}catch(error){terminal={...record,sessionState:'error',saved:false,syncError:error.message};}finally{clearTimeout(idleTimer);clearInterval(parentTimer);process.removeListener('disconnect',onDisconnect);process.removeListener('SIGTERM',onSigterm);process.removeListener('SIGINT',onSigint);if(reason!=='session_control')await control?.close().catch(()=>{});}await writeSessionRecord(terminal,{homeDir});process.exitCode=terminal.sessionState==='stopped'?0:1;resolveKeepAlive?.();context.exit?.(process.exitCode);return publicSession(terminal);})();return cleanupPromise;};
  const control=await startSessionControl({sessionId,homeDir,onCommand:async(command,payload)=>{await touch();if(command==='readState'){await runtime.sync(sessionId);return {...runtime.status(sessionId),diagramRelativePath:path.relative(projectRoot,drawio).split(path.sep).join('/')};}if(command==='edit'){const current=runtime.status(sessionId);if(current.revision!==payload.baseRevision)throw Object.assign(new Error('Revision conflict'),{code:'REVISION_CONFLICT'});if(!Array.isArray(payload.operations)||payload.operations.length===0)throw Object.assign(new Error('operations required'),{code:'INVALID_OPERATIONS'});const editedXml=payload.operations.reduce((xml,operation)=>operation.new_xml??xml,runtime.getXml(sessionId));const edited=runtime.applyBrowserState(sessionId,{baseRevision:current.revision,xml:editedXml});await appendRevision('edit',edited.revision);return edited;}if(command==='export'){await runtime.sync(sessionId,{expectedRevision:payload.baseRevision});const extension=payload.format==='svg'?'.svg':'.drawio';const destination=resolveManagedArtifact({projectRoot,slug,change:options.change,extension});const xml=runtime.getXml(sessionId);await writeFile(destination,payload.format==='svg'?`<svg xmlns="http://www.w3.org/2000/svg"><text>${xml.replaceAll('&','&amp;').replaceAll('<','&lt;')}</text></svg>`:xml);await appendRevision(`export ${payload.format}`,runtime.status(sessionId).revision);return {...runtime.status(sessionId),exportRelativePath:path.relative(projectRoot,destination).split(path.sep).join('/')};}if(command==='hold'){holdUntil=Date.now()+idleMs;runtime.hold(sessionId);scheduleIdle();record=await writeSessionRecord({...record,sessionState:'idle_held',holdUntil:new Date(holdUntil).toISOString()},{homeDir});return publicSession(record);}if(command==='finish'){await appendRevision(`finish ${payload.mode}`,runtime.status(sessionId).revision);const result=await finish(payload.mode,'session_control');return result;}throw Object.assign(new Error('Unknown session command'),{code:'TOOL_NOT_EXPOSED'});}});
  record=await writeSessionRecord({sessionId,projectRoot,workerPid:process.pid,workerParentPid:process.ppid,workerProcessStartTime:options.workerProcessStartTime??String(Date.now()),pid:started.pid,port:started.port,uiUrl:started.uiUrl,sessionState:started.sessionState,revision:started.revision,dirty:started.dirty,lastActivityAt:started.lastActivityAt,diagramRelativePath:path.relative(projectRoot,drawio).split(path.sep).join('/'),controlEndpoint:control.endpoint,controlPublicKey:control.publicKey},{homeDir});
  const exitAfter=(operation)=>operation.finally(()=>{if(!context.exit)process.exit(0);});
  const onDisconnect=()=>exitAfter(finish('save','parent_exit'));const onSigterm=()=>exitAfter(finish('save','sigterm'));const onSigint=()=>exitAfter(finish('discard','sigint'));
  parentTimer=setInterval(()=>{if(!process.connected)onDisconnect();},1000);parentTimer.unref?.();
  process.once('disconnect',onDisconnect);process.once('SIGTERM',onSigterm);process.once('SIGINT',onSigint);
  process.send?.({ok:true,state:publicSession(record)});context.onReady?.(publicSession(record));if(context.keepAlive===false){clearInterval(parentTimer);return {state:publicSession(record),control,runtime,finish,bootstrapUrl};}await new Promise((resolve)=>{resolveKeepAlive=resolve;});return {state:publicSession(record)};
}

async function launchManagedSession(options, context) {
  const project = await requireAbsoluteDirectory(options, 'project'); requireOption(options, 'slug');
  const forwarded=['change','purpose','audience','confirmed','assumptions','openQuestions'].flatMap((key)=>options[key]===undefined?[]:[`--${key.replace(/[A-Z]/g,(c)=>`-${c.toLowerCase()}`)}`,Array.isArray(options[key])?JSON.stringify(options[key]):String(options[key])]);
  const child = spawn(process.execPath, [path.join(context.packageRoot ?? PACKAGE_ROOT, 'cli.mjs'), 'diagram', 'session-worker', '--project', project, '--slug', options.slug, '--worker-process-start-time', String(Date.now()), '--json', ...forwarded], { stdio: ['ignore','pipe','pipe','ipc'], env: { ...(context.env ?? process.env), HOME: context.homeDir ?? (context.env ?? process.env).HOME } });
  let stdout=''; let stderr='';
  child.stdout?.on('data',(chunk)=>{stdout+=chunk;});
  child.stderr?.on('data',(chunk)=>{stderr+=chunk;});
  const message = await new Promise((resolve, reject) => {
    const timer=setTimeout(()=>reject(Object.assign(new Error('Session worker startup timed out'),{code:'INTERNAL_ERROR'})),10000);
    child.once('message',(value)=>{clearTimeout(timer);resolve(value)});
    child.once('error',(error)=>{clearTimeout(timer);reject(error)});
    child.once('exit',(code)=>{
      clearTimeout(timer);
      let body;
      try { body = JSON.parse((stdout || stderr).trim().split('\n').filter(Boolean).at(-1) ?? ''); } catch {}
      if (body?.code) {
        reject(Object.assign(new Error(body.message || `Session worker exited ${code}`), {
          code: body.code,
          state: {
            ...(body.state ?? {}),
            runtimeState: body.state?.runtimeState
              ?? (body.code === 'RUNTIME_MISSING' ? 'missing'
                : body.code === 'RUNTIME_CORRUPT' ? 'corrupt'
                  : body.code === 'RELEASE_GATE_BLOCKED' ? 'blocked'
                    : undefined),
          },
        }));
        return;
      }
      if (code === 4) {
        reject(Object.assign(new Error('Diagram runtime is missing; run doctor and continue with the recoverable ASCII fallback'), { code:'RUNTIME_MISSING', state:{ runtimeState:'missing' } }));
        return;
      }
      reject(Object.assign(new Error(`Session worker exited ${code}`), { code:'INTERNAL_ERROR' }));
    });
  });
  MANAGED_WORKERS.set(message.state.sessionId, child); child.unref(); return message.state;
}

async function runMcpStdio(context, managed) {
  const input=context.stdin??process.stdin; const output=context.stdout??process.stdout; let buffer='';
  const send=(value)=>output.write(`${JSON.stringify(value)}\n`);
  const schemas={
    'diagram.create':{type:'object',required:['slug'],properties:{slug:{type:'string'},change:{type:'string'},purpose:{type:'string'},audience:{type:'string'},confirmed:{type:'array',items:{type:'string'}},assumptions:{type:'array',items:{type:'string'}},openQuestions:{type:'array',items:{type:'string'}}}},
    'diagram.load':{type:'object',required:['slug'],properties:{slug:{type:'string'},change:{type:'string'}}},
    'diagram.edit':{type:'object',required:['sessionId','baseRevision','operations'],properties:{sessionId:{type:'string'},baseRevision:{type:'integer'},operations:{type:'array',minItems:1}}}, 'diagram.readState':{type:'object',required:['sessionId']},
    'diagram.export':{type:'object',required:['sessionId','baseRevision','format']}, 'diagram.finish':{type:'object',required:['sessionId','mode']},
  };
  async function callTool(name,args={}) {
    if(!Object.hasOwn(schemas,name)) throw Object.assign(new Error('Tool is not exposed'),{code:'TOOL_NOT_EXPOSED'});
    if(name==='diagram.create'||name==='diagram.load') return launchManagedSession({project:managed.projectRoot,...args},{...context,packageRoot:managed.packageRoot,homeDir:managed.homeDir});
    const record=(await listSessionRecords({homeDir:managed.homeDir,projectRoot:managed.projectRoot})).find((item)=>item.sessionId===args.sessionId);
    if(!record) throw Object.assign(new Error('Session does not exist'),{code:'SESSION_NOT_FOUND'});
    if(name==='diagram.readState') return callSessionControl(record,'readState');
    if(name==='diagram.finish'){if(args.mode==='continue')return callSessionControl(record,'readState');if(args.mode==='keep-30m')return callSessionControl(record,'hold');return stopManagedRecord(record,{homeDir:managed.homeDir,mode:args.mode});}
    return callSessionControl(record,name==='diagram.edit'?'edit':'export',args);
  }
  for await(const chunk of input){buffer+=chunk.toString();let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index).trim();buffer=buffer.slice(index+1);if(!line)continue;let request;try{request=JSON.parse(line);}catch{send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}});continue;}try{let result;if(request.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'specline-diagram',version:'1'}};else if(request.method==='notifications/initialized')continue;else if(request.method==='tools/list')result={tools:Object.entries(schemas).map(([name,inputSchema])=>({name,description:`Restricted managed ${name}`,inputSchema}))};else if(request.method==='tools/call'){const value=await callTool(request.params?.name,request.params?.arguments);result={content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value,isError:false};}else throw Object.assign(new Error('Method not found'),{code:'METHOD_NOT_FOUND'});send({jsonrpc:'2.0',id:request.id,result});}catch(error){const stable=error.code??'INTERNAL_ERROR';send({jsonrpc:'2.0',id:request.id,error:{code:stable==='METHOD_NOT_FOUND'?-32601:-32000,message:error.message,data:{code:stable}}});}}}
}

function traceStatePath(traceDir) { return path.join(traceDir, TRACE_STATE); }
async function readTraceState(traceDir) {
  try { return JSON.parse(await readFile(traceStatePath(traceDir), 'utf8')); } catch { return null; }
}
function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function portOpen(port) { return new Promise((resolve) => { const socket = createConnection({ host: '127.0.0.1', port });
  socket.once('connect', () => { socket.destroy(); resolve(true); }); socket.once('error', () => resolve(false)); socket.setTimeout(300, () => { socket.destroy(); resolve(false); }); }); }

async function startReleaseTraceWorker(options) {
  const fixture = await requireAbsoluteDirectory(options, 'fixture');
  const project = await requireAbsoluteDirectory(options, 'project');
  const traceDir = await requireAbsoluteDirectory(options, 'traceDir');
  await requireAbsoluteFile(options, 'driver');
  const webappIndex = path.join(fixture, 'webapp', 'index.html');
  const mcpEntry = path.join(fixture, 'mcp', 'node_modules', '@next-ai-drawio', 'mcp-server', 'dist', 'index.js');
  if (!(await stat(webappIndex).catch(() => null))?.isFile() || !(await stat(mcpEntry).catch(() => null))?.isFile()) {
    throw Object.assign(new Error('Fixture must contain fixed webapp/index.html and MCP entry'), { code: 'RUNTIME_CORRUPT' });
  }
  const sessionId = options.traceSession || randomUUID();
  const xmlBase = `<mxfile><diagram id="trace"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>`;
  let upstreamChild;
  let upstreamStartTime;
  const traceSlug = options.slug || 'release-trace';
  const managedDir = path.join(project, 'specline', 'diagrams', traceSlug);
  const createTraceServer = (handler) => createServer((request, response) => {
    const originalWriteHead = response.writeHead.bind(response);
    response.writeHead = (statusCode, headers = {}) => originalWriteHead(statusCode, { ...headers, 'content-security-policy': "default-src 'self'; connect-src 'self'; frame-src 'self'; script-src 'self' 'unsafe-inline'" });
    handler(request, response);
  });
  const startHttp = ({ token, ...input }) => startBridgeServer({ ...input, token, createHttpServer: createTraceServer, uiHandler: async ({ pathname }) => {
    const sessionPrefix = `/sessions/${encodeURIComponent(sessionId)}/`;
    if (pathname === sessionPrefix) {
      const safeToken = JSON.stringify(token).replaceAll('<', '\u003c');
      const safeSession = JSON.stringify(sessionId).replaceAll('<', '\u003c');
      const harness = `<!doctype html><meta charset="utf-8"><title>Specline release trace</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self'; frame-src 'self'; script-src 'unsafe-inline'">
<iframe id="drawio" title="Local Draw.io" src="/assets/drawio/index.html?embed=1&proto=json&spin=1&offline=1" style="width:100%;height:70vh;border:0"></iframe>
<label>Manual edit marker <input id="manual-marker"></label><button id="manual-edit">Apply manual edit</button>
<button id="sync">Sync</button><button id="export-drawio">Export Drawio</button><button id="export-svg">Export SVG</button><button id="remote-attempt">Attempt blocked remote</button><output id="status"></output>
<script>
const token=${safeToken}, sessionId=${safeSession}, origin=location.origin; let revision=0; let xml='<mxfile><diagram id="trace"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';
async function bridge(endpoint, method='POST', body={}) { const response=await fetch('/api/sessions/'+encodeURIComponent(sessionId)+'/'+endpoint,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:method==='GET'?undefined:JSON.stringify(body)}); const value=await response.json(); if(!response.ok) throw Object.assign(new Error(value.message),value); return value; }
function status(value){document.querySelector('#status').textContent=JSON.stringify(value)}
document.querySelector('#manual-edit').onclick=async()=>{const marker=document.querySelector('#manual-marker').value; xml=xml.replace('</root>','<mxCell id="manual-edit" value="'+marker.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))+'" parent="1"/></root>'); const value=await bridge('state','PUT',{baseRevision:revision,xml}); revision=value.revision; status({step:'manualEdit',revision,marker})};
document.querySelector('#sync').onclick=async()=>status({step:'sync',...(await bridge('sync','POST',{expectedRevision:revision}))});
document.querySelector('#export-drawio').onclick=async()=>status({step:'exportDrawio',...(await bridge('export','POST',{format:'drawio'}))});
document.querySelector('#export-svg').onclick=async()=>status({step:'exportSvg',...(await bridge('export','POST',{format:'svg'}))});
document.querySelector('#remote-attempt').onclick=async()=>{try{await fetch('https://app.diagrams.net/specline-release-trace-probe',{mode:'no-cors'});status({step:'remoteAttempt',fellBack:true})}catch(error){console.error('SPECLINE_REMOTE_BLOCKED https://app.diagrams.net/specline-release-trace-probe REMOTE_ACCESS_BLOCKED');status({step:'remoteAttempt',code:'REMOTE_ACCESS_BLOCKED',fellBack:false,name:error.name})}};
window.__speclineTrace={sessionId,get revision(){return revision}};
</script>`;
      return { contentType: 'text/html; charset=utf-8', body: harness };
    }
    const assetPrefix = '/assets/drawio/';
    if (!pathname.startsWith(assetPrefix)) return { statusCode: 404, body: '' };
    const relative = decodeURIComponent(pathname.slice(assetPrefix.length)) || 'index.html';
    const candidate = path.resolve(path.dirname(webappIndex), relative);
    if (!candidate.startsWith(`${path.dirname(webappIndex)}${path.sep}`) && candidate !== webappIndex) return { statusCode: 404, body: '' };
    const body = await readFile(candidate).catch(() => null);
    if (!body) return { statusCode: 404, body: '' };
    const extension = path.extname(candidate).toLowerCase();
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif', '.woff': 'font/woff', '.woff2': 'font/woff2', '.json': 'application/json' };
    return { contentType: types[extension] || 'application/octet-stream', body };
  } });
  const runtime = createDiagramRuntime({ startHttp, attachTriggers: false, randomId: () => sessionId,
    spawnUpstream: async ({ parentPid }) => { upstreamStartTime = String(Date.now()); upstreamChild = spawn(process.execPath, [mcpEntry], { cwd: fixture, stdio: ['pipe', 'ignore', 'ignore', 'ipc'], env: { ...process.env, DRAWIO_BASE_URL: 'http://127.0.0.1' } });
      await new Promise((resolve, reject) => { upstreamChild.once('spawn', resolve); upstreamChild.once('error', reject); });
      return { pid: upstreamChild.pid, parentPid, processStartTime: upstreamStartTime }; },
    observeProcess: async (pid) => ({ alive: pidAlive(pid), pid, parentPid: process.pid, processStartTime: upstreamChild && pid === upstreamChild.pid ? upstreamStartTime : undefined }),
    killProcess: async (pid, signal) => { if (upstreamChild?.pid === pid) upstreamChild.kill(signal); },
  });
  const upstream = {
    create: async ({ managedPath }) => { await mkdir(path.dirname(managedPath), { recursive: true }); await writeFile(managedPath, xmlBase); return xmlBase; },
    load: ({ managedPath }) => readFile(managedPath, 'utf8'),
    persist: ({ managedPath, xml }) => writeFile(managedPath, xml),
    edit: async ({ xml }) => xml,
    export: async ({ managedPath, format, xml }) => writeFile(managedPath, format === 'svg' ? `<svg xmlns="http://www.w3.org/2000/svg"><text>${xml.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</text></svg>` : xml),
  };
  const traceRuntime = Object.freeze({
    ...runtime,
    startSession: (input) => runtime.startSession({ ...input, bridge: {
      export: async ({ format }) => {
        if (!['drawio', 'svg'].includes(format)) throw Object.assign(new Error('Trace export format rejected'), { code: 'FORMAT_NOT_ALLOWED' });
        const xml = runtime.getXml(sessionId);
        await mkdir(managedDir, { recursive: true });
        const destination = path.join(managedDir, `${traceSlug}.${format}`);
        await writeFile(destination, format === 'svg' ? `<svg xmlns="http://www.w3.org/2000/svg"><text>${xml.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</text></svg>` : xml);
        return { format, relativePath: path.relative(project, destination).split(path.sep).join('/') };
      },
    } }),
  });
  const wrapper = createMcpWrapper({ projectRoot: project, runtime: traceRuntime, upstream, securityBoundary: { launch: true, bridgeAuth: true, managedPaths: true } });
  const started = await wrapper.call('diagram.create', { slug: traceSlug });
  const state = { schemaVersion: 1, kind: 'specline-release-trace', sessionId: started.sessionId, workerPid: process.pid,
    childPid: runtime.status(started.sessionId).pid, port: runtime.status(started.sessionId).port, uiUrl: started.uiUrl,
    project, fixture, traceDir, driver: options.driver, diagramRelativePath: started.diagramRelativePath, revision: started.revision };
  await writeFile(traceStatePath(traceDir), `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx' });
  const cleanup = async () => { await wrapper.call('diagram.finish', { sessionId: started.sessionId, mode: 'save' }).catch(() => {}); await rm(traceStatePath(traceDir), { force: true }); };
  process.once('SIGTERM', () => cleanup().finally(() => process.exit(0)));
  process.once('SIGINT', () => cleanup().finally(() => process.exit(0)));
  process.send?.({ ok: true, state });
  await new Promise(() => {});
}

async function launchReleaseTrace(options, context) {
  if ((context.env ?? process.env).SPECLINE_DIAGRAM_RELEASE_TRACE !== '1') throw Object.assign(new Error('Internal release trace channel is disabled'), { code: 'RELEASE_GATE_BLOCKED' });
  const fixture = await requireAbsoluteDirectory(options, 'fixture'); const project = await requireAbsoluteDirectory(options, 'project');
  const traceDir = await requireAbsoluteDirectory(options, 'traceDir'); const driver = await requireAbsoluteFile(options, 'driver');
  if (await readTraceState(traceDir)) throw Object.assign(new Error('Trace directory already owns a session'), { code: 'SESSION_CONFLICT' });
  const child = spawn(process.execPath, [path.join(PACKAGE_ROOT, 'cli.mjs'), 'diagram', 'release-trace-worker', '--fixture', fixture,
    '--project', project, '--trace-dir', traceDir, '--driver', driver, '--slug', options.slug || 'release-trace'],
  { detached: false, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ...(context.env ?? process.env), SPECLINE_DIAGRAM_RELEASE_TRACE: '1' } });
  const message = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Trace worker startup timed out')), 10000);
    child.once('message', (value) => { clearTimeout(timer); resolve(value); }); child.once('error', reject); child.once('exit', (code) => reject(new Error(`Trace worker exited ${code}`))); });
  child.disconnect(); child.unref(); return message.state;
}
async function stopTrace(options) {
  const traceDir = await requireAbsoluteDirectory(options, 'traceDir'); const state = await readTraceState(traceDir);
  if (!state || (options.sessions.length && !options.sessions.includes(state.sessionId))) throw Object.assign(new Error('Trace session does not exist'), { code: 'SESSION_NOT_FOUND' });
  if (state.kind !== 'specline-release-trace' || !pidAlive(state.workerPid)) { await rm(traceStatePath(traceDir), { force: true }); return { ...state, sessionState: 'stopped' }; }
  process.kill(state.workerPid, 'SIGTERM');
  const deadline = Date.now() + 7000; while (Date.now() < deadline && (pidAlive(state.workerPid) || await portOpen(state.port))) await new Promise((r) => setTimeout(r, 50));
  if (pidAlive(state.workerPid) || await portOpen(state.port)) throw Object.assign(new Error('Owned trace cleanup timed out'), { code: 'SESSION_CONFLICT' });
  return { ...state, sessionState: 'stopped', pidExited: true, portClosed: true, daemonRemaining: false };
}

export async function runDiagramCommand(args, context = {}) {
  let parsed; try { parsed = parseArgs(args); } catch (error) { return { exitCode: 2, body: envelope(false, error.code, {}, error.message) }; }
  const { command, options } = parsed;
  if (!PUBLIC_COMMANDS.has(command) && !INTERNAL_COMMANDS.has(command)) return { exitCode: 2, body: envelope(false, 'INVALID_ARGUMENT', {}, 'Unknown diagram command') };
  const packageRoot = context.packageRoot ?? PACKAGE_ROOT; const homeDir = context.homeDir ?? os.homedir(); const projectRoot = context.projectRoot ?? process.cwd();
  try {
    if (command === 'release-trace-worker') { if ((context.env ?? process.env).SPECLINE_DIAGRAM_RELEASE_TRACE !== '1') throw Object.assign(new Error('Trace worker disabled'), { code: 'RELEASE_GATE_BLOCKED' }); await startReleaseTraceWorker(options); }
    if (command === 'release-trace') { const state = await launchReleaseTrace(options, context); return { exitCode: 0, body: envelope(true, 'RELEASE_TRACE_STARTED', state, 'Internal release trace session started') }; }
    if ((command === 'status' || command === 'stop') && options.traceDir) {
      const traceDir = await requireAbsoluteDirectory(options, 'traceDir'); const state = command === 'stop' ? await stopTrace(options) : await readTraceState(traceDir);
      if (!state) throw Object.assign(new Error('Trace session does not exist'), { code: 'SESSION_NOT_FOUND' });
      return { exitCode: 0, body: envelope(true, command === 'stop' ? 'SESSION_STOPPED' : 'STATUS', { sessions: [state], ...state }, 'Internal trace session state') };
    }
    const { manifest, closure } = await loadManagedInputs(packageRoot); const gate = await verification(manifest, { packageRoot, closure });
    if (['install', 'configure', 'stop-all', 'uninstall'].includes(command) && options.approvedPlan && !/^[a-f0-9]{64}$/.test(options.approvedPlan)) throw Object.assign(new Error('Approval must be an exact SHA-256 plan digest'), { code: 'PLAN_APPROVAL_REQUIRED' });
    const root = managedRuntimeRoot({ homeDir }); const target = path.join(root, runtimeVersion(manifest));
    if (command === 'session-worker') { await assertReleaseAllowed(manifest, { packageRoot, closure }); await startSessionWorker(options, { ...context, homeDir, packageRoot }, manifest); }
    if (command === 'mcp') { if (!options.stdio) throw Object.assign(new Error('--stdio is required'), { code: 'INVALID_ARGUMENT' }); await assertReleaseAllowed(manifest, { packageRoot, closure }); await runMcpStdio(context, { packageRoot, homeDir, projectRoot, packageRoot }); return { exitCode: 0, body: envelope(true, 'MCP_STOPPED', gate, 'MCP stdio transport closed') }; }
    const records = await listSessionRecords({ homeDir, projectRoot, packageRoot });
    if (command === 'doctor') { const inspected = await doctorRuntime({ manifest, closure, managedRoot: root, target, repairStale: options.repairStale, sessionRecords: records, observeProcess: async(recordPid)=>({alive:processAlive(recordPid),pid:recordPid}) });
      return { exitCode: 0, body: envelope(true, inspected.code, { ...inspected, ...gate }, 'Diagram runtime inspected') }; }
    if (command === 'status') { const selected = options.sessions.length ? records.filter((record) => options.sessions.includes(record.sessionId)) : records; if (options.sessions.length && selected.length !== options.sessions.length) throw Object.assign(new Error('Session does not exist in this project'), { code: 'SESSION_NOT_FOUND' }); return { exitCode: 0, body: envelope(true, 'STATUS', { ...gate, sessions: selected.map(publicSession) }, 'Managed session status') }; }
    if (command === 'plan') { const action = requireOption(options, 'action'); if (['install','upgrade','reinstall','configure','uninstall','stop-all'].includes(action)) await assertReleaseAllowed(manifest, { packageRoot, closure }); const plan = await currentPlan({ action, manifest, closure, homeDir, platform: options.platform, sessions: action === 'stop-all' ? records.map((record) => record.sessionId) : options.sessions, projectRoot, packageRoot }); return { exitCode: 0, body: envelope(true, 'PLAN_READY', { ...gate, ...plan }, 'Read-only plan ready') }; }
    if (command === 'install') { if(manifest.audit.releaseGate!==true)await assertReleaseAllowed(manifest,{packageRoot,closure});const action = options.action ?? 'install'; const plan = await currentPlan({ action, manifest, closure, homeDir, projectRoot, packageRoot }); assertApprovedCurrentPlan(plan, requireOption(options, 'approvedPlan'), action); await assertReleaseAllowed(manifest, { packageRoot, closure }); const installed = await installRuntime({ manifest, closure, plan, approvedPlanDigest: options.approvedPlan, recomputedPlan: plan, releaseInputsRoot: diagramRuntimeRoot(packageRoot), ...(context.installRuntimeOptions??{}) }); return { exitCode: 0, body: envelope(true, 'RUNTIME_INSTALLED', { ...gate, ...installed }, 'Diagram runtime installed') }; }
    await assertReleaseAllowed(manifest, { packageRoot, closure });
    if (command === 'configure') { const platform = requireOption(options, 'platform'); const plan = await currentPlan({ action: 'configure', manifest, closure, homeDir, platform, projectRoot, packageRoot }); assertApprovedCurrentPlan(plan, requireOption(options, 'approvedPlan'), 'configure'); const configured = await mutateDiagramPlatformConfig({ platform, projectRoot, homeDir, approved: true, currentPlatform: context.currentPlatform ?? platform, explicitPlatformApproval: context.currentPlatform ? context.currentPlatform !== platform : false }); return { exitCode: 0, body: envelope(true, 'PLATFORM_CONFIGURED', { ...gate, ...configured }, 'Platform configured') }; }
    if (command === 'start') { const state = await launchManagedSession(options, { ...context, packageRoot, homeDir }); return { exitCode: 0, body: envelope(true, 'SESSION_STARTED', { ...gate, ...state }, 'Diagram session started') }; }
    if (command === 'stop') {
      const id = requireOption({ session: options.sessions[0] }, 'session');
      const mode = requireOption(options, 'mode');
      if (!['save','discard','keep-30m','continue'].includes(mode)) throw Object.assign(new Error('Invalid stop mode'), { code:'INVALID_ARGUMENT' });
      const record = records.find((item) => item.sessionId === id);
      if (!record) throw Object.assign(new Error('Session does not exist in this project'), { code:'SESSION_NOT_FOUND' });
      if (mode === 'continue') return { exitCode:0, body:envelope(true,'SESSION_CONTINUED',{...gate,...publicSession(record)},'Session continues') };
      if (mode === 'keep-30m') {
        if(!record.workerPid||!record.workerParentPid||!record.workerProcessStartTime)throw Object.assign(new Error('Worker ownership metadata is incomplete'),{code:'SESSION_OWNERSHIP_MISMATCH'});
        await callSessionControl(record,'hold');
        const held=(await listSessionRecords({homeDir,projectRoot})).find((item)=>item.sessionId===id);
        return { exitCode:0, body:envelope(true,'SESSION_HELD',{...gate,...publicSession(held)},'Session held for 30 minutes') };
      }
      const stopped=await stopManagedRecord(record,{homeDir,mode});
      return { exitCode:0, body:envelope(true,'SESSION_STOPPED',{...gate,...stopped},'Session stopped') };
    }
    if (command === 'stop-all') {
      const plan=await currentPlan({action:'stop-all',manifest,closure,homeDir,sessions:records.map((record)=>record.sessionId),projectRoot});
      assertApprovedCurrentPlan(plan,requireOption(options,'approvedPlan'),'stop-all');
      const stopped=[]; for(const record of records) stopped.push(await stopManagedRecord(record,{homeDir,mode:'save'}));
      return {exitCode:0,body:envelope(true,'SESSIONS_STOPPED',{...gate,sessions:stopped},'All approved project sessions stopped')};
    }
    if (command === 'uninstall') {
      const platform=requireOption(options,'platform');const plan=await currentPlan({action:'uninstall',manifest,closure,homeDir,platform,projectRoot,packageRoot});
      assertApprovedCurrentPlan(plan,requireOption(options,'approvedPlan'),'uninstall');
      const removed=await uninstallRuntime({plan,approvedPlanDigest:options.approvedPlan,recomputedPlan:plan,activeSessions:records,removeManagedConfiguration:async()=>{const removed=[];const rollbacks=[];for(const platform of (plan.platform?[plan.platform]:[])){const result=await mutateDiagramPlatformConfig({platform,projectRoot,homeDir,operation:'remove',approved:true,currentPlatform:platform});if(result.changed)removed.push(platform);rollbacks.push(result.rollback);}return {removed,rollback:async()=>{for(const rollback of rollbacks.reverse())await rollback();}};}});
      return {exitCode:0,body:envelope(true,'RUNTIME_UNINSTALLED',{...gate,...removed},'Diagram runtime uninstalled')};
    }
    throw Object.assign(new Error('Unsupported diagram command'), { code: 'INVALID_ARGUMENT' });
  } catch (error) { const code = error.code ?? 'INTERNAL_ERROR'; return { exitCode: EXIT_BY_CODE[code] ?? (code === 'SESSION_CONFLICT' ? 6 : 1), body: envelope(false, code, error.state ?? {}, error.message) }; }
}
export async function cliDiagram(args, context = {}) { const result = await runDiagramCommand(args, context); const output = args.includes('--json') ? JSON.stringify(result.body) : result.body.message; (context.stdout ?? process.stdout).write(`${output}\n`); return result.exitCode; }
export { verification as computeReleaseVerification, RELEASE_CONTROL_INPUTS, startSessionWorker, launchManagedSession, releaseInputState as computeReleaseInputState, releaseManifestProjection };
