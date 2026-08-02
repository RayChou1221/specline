import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  cursorConfigPath,
  mergeCursorDiagramConfig,
  removeCursorDiagramConfig,
  toolNameForCursor,
} from '../../adapters/cursor/diagram-mcp.mjs';
import {
  claudeConfigPath,
  mergeClaudeDiagramConfig,
  removeClaudeDiagramConfig,
  toolNameForClaude,
} from '../../adapters/claude/diagram-mcp.mjs';
import {
  getConfigPath as codexConfigPath,
  mergeConfig as mergeCodexConfig,
  removeConfig as removeCodexConfig,
  CODEX_TOOL_MAP,
} from '../../adapters/codex/diagram-mcp.mjs';
import {
  getConfigPath as openCodeConfigPath,
  mergeConfig as mergeOpenCodeConfig,
  removeConfig as removeOpenCodeConfig,
  OPENCODE_TOOL_MAP,
} from '../../adapters/opencode/diagram-mcp.mjs';
import { PLATFORMS } from '../paths.mjs';

export class DiagramPlatformError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DiagramPlatformError';
    this.code = code;
  }
}

const reverse = (mapping) => Object.freeze(Object.fromEntries(
  Object.entries(mapping).map(([visible, operation]) => [operation, visible]),
));

const ADAPTERS = Object.freeze({
  cursor: {
    configPath: ({ projectRoot, homeDir, scope }) => cursorConfigPath({ projectRoot, homeDir, scope }),
    merge: (source, options) => mergeCursorDiagramConfig(source, options),
    remove: (source, options) => removeCursorDiagramConfig(source, options),
    toolName: toolNameForCursor,
  },
  claude: {
    configPath: ({ projectRoot, homeDir, scope }) => claudeConfigPath({ projectRoot, homeDir, scope }),
    merge: (source, options) => mergeClaudeDiagramConfig(source, options),
    remove: (source, options) => removeClaudeDiagramConfig(source, options),
    toolName: toolNameForClaude,
  },
  codex: {
    configPath: ({ projectRoot }) => codexConfigPath(projectRoot),
    merge: (source, options) => mergeCodexConfig(source, options),
    remove: (source, options) => removeCodexConfig(source, options),
    toolName: (operation) => reverse(CODEX_TOOL_MAP)[operation],
  },
  opencode: {
    configPath: ({ projectRoot }) => openCodeConfigPath(projectRoot),
    merge: (source, options) => mergeOpenCodeConfig(source, options),
    remove: (source, options) => removeOpenCodeConfig(source, options),
    toolName: (operation) => reverse(OPENCODE_TOOL_MAP)[operation],
  },
});

export function getDiagramPlatformAdapter(platform) {
  if (!PLATFORMS.includes(platform)) {
    throw new DiagramPlatformError('INVALID_PLATFORM', `Unsupported diagram platform: ${platform}`);
  }
  return ADAPTERS[platform];
}

export function diagramToolName(platform, operation) {
  const name = getDiagramPlatformAdapter(platform).toolName(operation);
  if (!name) throw new DiagramPlatformError('INVALID_OPERATION', `Unsupported diagram operation: ${operation}`);
  return name;
}

function metadataMode(metadata) { return metadata ? metadata.mode : 0o600; }

async function readConfig(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}


function hashSource(source) { return createHash('sha256').update(source).digest('hex'); }

function pidExists(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function acquireConfigLock(file, { staleLockMs = 30_000, retryMs = 20, timeoutMs = 5_000 } = {}) {
  const lock=`${file}.specline.lock`; const deadline=Date.now()+timeoutMs; const ownerToken=randomUUID();
  while(true){try{await writeFile(lock,`${JSON.stringify({pid:process.pid,ownerToken,createdAt:Date.now()})}\n`,{flag:'wx',mode:0o600});break;}catch(error){if(error?.code!=='EEXIST')throw error;let owner;try{owner=JSON.parse(await readFile(lock,'utf8'))}catch{owner=null}const metadata=await stat(lock).catch(()=>null);if(metadata&&Date.now()-metadata.mtimeMs>staleLockMs&&Number.isSafeInteger(owner?.pid)&&!pidExists(owner.pid)){const quarantine=`${lock}.stale-${randomUUID()}`;try{await rename(lock,quarantine);await rm(quarantine,{force:true});continue;}catch{continue;}}if(Date.now()>=deadline)throw new DiagramPlatformError('CONFIG_LOCKED','Platform configuration is locked by another live writer');await new Promise((resolve)=>setTimeout(resolve,retryMs));}}
  return async()=>{let owner;try{owner=JSON.parse(await readFile(lock,'utf8'))}catch{return}if(owner.ownerToken!==ownerToken)throw new DiagramPlatformError('CONFIG_LOCK_OWNERSHIP_LOST','Refusing to unlock a successor lock');const quarantine=`${lock}.release-${ownerToken}`;await rename(lock,quarantine);await rm(quarantine,{force:true});};
}

export async function inspectDiagramPlatformConfig({ platform, projectRoot, homeDir, scope = 'project' } = {}) {
  const adapter = getDiagramPlatformAdapter(platform);
  const file = adapter.configPath({ projectRoot, homeDir, scope });
  const source = await readConfig(file);
  const metadata = await stat(file).catch(() => null);
  return Object.freeze({ platform, configPath: file, exists: Boolean(metadata), bytes: Buffer.byteLength(source), sha256: hashSource(source) });
}

export async function mutateDiagramPlatformConfig({
  platform,
  projectRoot,
  homeDir,
  scope = 'project',
  operation = 'merge',
  approved = false,
  currentPlatform,
  explicitPlatformApproval = false,
  server,
} = {}) {
  const adapter = getDiagramPlatformAdapter(platform);
  if (!approved || (currentPlatform && currentPlatform !== platform && !explicitPlatformApproval)) {
    throw new DiagramPlatformError(
      'PLATFORM_PERMISSION_REQUIRED',
      `${platform} requires independent current-plan approval`,
    );
  }
  const file = adapter.configPath({ projectRoot, homeDir, scope });
  await mkdir(dirname(file), { recursive: true });
  const releaseLock = await acquireConfigLock(file);
  try {
  const source = await readConfig(file);
  const awaitableMetadata = Boolean(await stat(file).catch(() => null));
  let result;
  try {
    const options = {
      approved: true,
      currentPlatform,
      explicitPlatformApproval,
      ...(server ? { server } : {}),
    };
    result = operation === 'remove' ? adapter.remove(source, options) : adapter.merge(source, options);
  } catch (error) {
    throw new DiagramPlatformError(error.code ?? 'PLATFORM_CONFIG_FAILED', error.message);
  }
  if (result.ok === false) {
    throw new DiagramPlatformError(result.code, result.message);
  }
  if (result.changed) {
    await mkdir(dirname(file), { recursive: true });
    const beforeWrite = await readConfig(file);
    if (beforeWrite !== source) throw new DiagramPlatformError('PLAN_STALE', 'Platform configuration changed after approval; no write was performed');
    const temporary = join(dirname(file), `.${file.split(/[\\/]/).pop()}.specline-${process.pid}-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, result.content, { encoding: 'utf8', flag: 'wx', mode: metadataMode(await stat(file).catch(() => null)) });
      const finalCheck = await readConfig(file);
      if (finalCheck !== source) throw new DiagramPlatformError('PLAN_STALE', 'Platform configuration changed during atomic update; no replacement was performed');
      await rename(temporary, file);
    } finally { await rm(temporary, { force: true }).catch(() => {}); }
  }
  const replacementHash = result.changed ? hashSource(result.content) : hashSource(source);
  return {
    platform,
    configPath: file,
    changed: result.changed,
    reloadState: result.reloadState,
    rollback: result.changed ? () => restoreDiagramPlatformConfig({
      platform, projectRoot, homeDir, scope,
      expectedCurrentSha256: replacementHash,
      content: source,
      removeIfEmpty: !awaitableMetadata,
    }) : async () => {},
  };
  } finally { await releaseLock(); }
}

export async function restoreDiagramPlatformConfig({ platform, projectRoot, homeDir, scope='project', expectedCurrentSha256, content, removeIfEmpty=false }={}) {
  const adapter=getDiagramPlatformAdapter(platform);const file=adapter.configPath({projectRoot,homeDir,scope});await mkdir(dirname(file),{recursive:true});const releaseLock=await acquireConfigLock(file);try{const current=await readConfig(file);if(hashSource(current)!==expectedCurrentSha256)throw new DiagramPlatformError('PLAN_STALE','Configuration changed before rollback');if(removeIfEmpty&&content===''){await rm(file,{force:true});return;}const temporary=join(dirname(file),`.rollback-${randomUUID()}.tmp`);try{await writeFile(temporary,content,{encoding:'utf8',flag:'wx',mode:metadataMode(await stat(file).catch(()=>null))});await rename(temporary,file);}finally{await rm(temporary,{force:true}).catch(()=>{})}}finally{await releaseLock();}}

export const DIAGRAM_PLATFORMS = Object.freeze([...PLATFORMS]);
