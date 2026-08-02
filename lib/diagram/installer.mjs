import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { assertPlanApproval, digestPlan } from './install-plan.mjs';
import { validateManagedManifest } from './manifest.mjs';

const RELEASE_INPUT_NAMES = ['patches/launcher.mjs', 'LICENSE.drawio', 'LICENSE.next-ai-drawio', 'NOTICE.md'];
const RELEASE_INPUT_PREFIX='core/runtimes/drawio/';
const releaseInputKey=(relative)=>`${RELEASE_INPUT_PREFIX}${relative}`;

const FORBIDDEN_REMOTE = [
  /https?:\/\/(?:app|embed)\.diagrams\.net/i,
  /https?:\/\/0\.0\.0\.0(?::|\/)/i,
  /https?:\/\/localhost(?::|\/)/i,
];

export class InstallerError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'InstallerError';
    this.code = code;
  }
}

function isInside(parent, child, pathImpl = path) {
  const relative = pathImpl.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !pathImpl.isAbsolute(relative));
}

async function exists(fsImpl, file) {
  try {
    await fsImpl.lstat(file);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function assertAllowedDownloadUrl(url, artifactId) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new InstallerError('DOWNLOAD_FAILED', `Invalid download URL for ${artifactId}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new InstallerError('DOWNLOAD_FAILED', `Download URL must use https: ${artifactId}`);
  }
  if (FORBIDDEN_REMOTE.some((pattern) => pattern.test(url))) {
    throw new InstallerError(
      'DOWNLOAD_FAILED',
      `Download URL is forbidden for offline-local runtime: ${artifactId}`,
    );
  }
}

async function defaultDownload(artifact, destination, { fsImpl = fs } = {}) {
  // GitHub Releases redirect github.com → objects/release-assets.githubusercontent.com.
  // Integrity is enforced by SHA-256 after download; rejecting redirects breaks install.
  await assertAllowedDownloadUrl(artifact.source, artifact.id);
  const response = await fetch(artifact.source, {
    redirect: 'follow',
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new InstallerError(
      'DOWNLOAD_FAILED',
      `Download failed with HTTP ${response.status}: ${artifact.id}`,
    );
  }
  if (response.url) await assertAllowedDownloadUrl(response.url, artifact.id);
  await fsImpl.writeFile(destination, Buffer.from(await response.arrayBuffer()), { flag: 'wx' });
}

function runFile(command, args, { processImpl = { spawn } } = {}) {
  return new Promise((resolve, reject) => {
    const child = processImpl.spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited ${code}: ${stderr.trim()}`));
    });
  });
}

function validateArchiveEntries(listing, artifactId) {
  const entries = listing.split('\n').filter(Boolean);
  if (entries.length === 0) {
    throw new InstallerError('INVALID_ARCHIVE', `Archive is empty: ${artifactId}`);
  }
  for (const entry of entries) {
    if (
      entry.includes('\0') ||
      entry.includes('\\') ||
      entry.startsWith('/') ||
      entry.split('/').includes('..')
    ) {
      throw new InstallerError(
        'UNSAFE_ARCHIVE',
        `Archive contains an unsafe path: ${artifactId}`,
      );
    }
  }
}

async function defaultMaterialize({
  artifact,
  archive,
  stage,
  fsImpl,
  pathImpl,
  processImpl,
}) {
  if (artifact.id === 'drawio-webapp') {
    const listing = await runFile('unzip', ['-Z1', archive], { processImpl });
    validateArchiveEntries(listing, artifact.id);
    const verbose = await runFile('unzip', ['-Z', '-l', archive], { processImpl });
    if (/^\s*[lh][rwx-]{9}\s/m.test(verbose)) {
      throw new InstallerError('UNSAFE_ARCHIVE', 'Draw.io archive contains a link');
    }
    const destination = pathImpl.join(stage, 'webapp');
    await fsImpl.mkdir(destination, { recursive: true });
    await runFile('unzip', ['-q', archive, '-d', destination], { processImpl });
    const bootstrap=pathImpl.join(destination,'js','bootstrap.js');let source=await fsImpl.readFile(bootstrap,'utf8');source=source.replace('App.main();','App.main(function(ui){window.speclineDrawioEditorUi=ui;});');await fsImpl.writeFile(bootstrap,source);
    return;
  }

  const listing = await runFile('tar', ['-tzf', archive], { processImpl });
  validateArchiveEntries(listing, artifact.id);
  const verbose = await runFile('tar', ['-tvzf', archive], { processImpl });
  if (/^[lh][rwx-]{9}\s/m.test(verbose)) {
    throw new InstallerError('UNSAFE_ARCHIVE', `npm archive contains a link: ${artifact.id}`);
  }
  const destination = pathImpl.join(stage, 'mcp', artifact.id);
  if (!isInside(pathImpl.join(stage, 'mcp'), destination, pathImpl)) {
    throw new InstallerError('INVALID_ARTIFACT_PATH', `Unsafe closure path: ${artifact.id}`);
  }
  await fsImpl.mkdir(destination, { recursive: true });
  await runFile(
    'tar',
    ['-xzf', archive, '-C', destination, '--strip-components=1'],
    { processImpl },
  );
  if (artifact.id === 'node_modules/@next-ai-drawio/mcp-server') {
    const serverFile=pathImpl.join(destination,'dist','http-server.js');let source=await fsImpl.readFile(serverFile,'utf8');
    source=source.replace('process.env.DRAWIO_BASE_URL || "https://embed.diagrams.net"','process.env.DRAWIO_BASE_URL || (() => { throw new Error("DRAWIO_BASE_URL_REQUIRED") })()').replaceAll('app.diagrams.net','127.0.0.1').replaceAll('http://localhost:','http://127.0.0.1:');
    await fsImpl.writeFile(serverFile,source);
    const entryFile=pathImpl.join(destination,'dist','index.js');let entry=await fsImpl.readFile(entryFile,'utf8');entry=entry.replaceAll('http://localhost:','http://127.0.0.1:').replaceAll('app.diagrams.net','127.0.0.1');await fsImpl.writeFile(entryFile,entry);
  }
}

async function copyReleaseInputs({ releaseInputsRoot, stage, fsImpl, pathImpl }) {
  if (!releaseInputsRoot) throw new InstallerError('RELEASE_INPUTS_MISSING', 'Managed release inputs root is required');
  const digests = {};
  for (const relative of RELEASE_INPUT_NAMES) {
    const source = pathImpl.join(releaseInputsRoot, relative);
    const destination = pathImpl.join(stage, relative);
    const content = await fsImpl.readFile(source).catch(() => null);
    if (!content) throw new InstallerError('RELEASE_INPUTS_MISSING', `Managed release input is missing: ${relative}`);
    await fsImpl.mkdir(pathImpl.dirname(destination), { recursive: true });
    await fsImpl.writeFile(destination, content, { flag: 'wx', mode: relative.endsWith('.mjs') ? 0o755 : 0o644 });
    digests[releaseInputKey(relative)] = createHash('sha256').update(content).digest('hex');
  }
  return digests;
}
function digestReleaseInputs(digests){return createHash('sha256').update(JSON.stringify(Object.entries(digests).sort())).digest('hex');}

async function verifyArchive(fsImpl, artifact, archive) {
  const content = await fsImpl.readFile(archive);
  const sha256 = createHash('sha256').update(content).digest('hex');
  if (sha256 !== artifact.sha256) {
    throw new InstallerError('CHECKSUM_MISMATCH', `SHA-256 mismatch: ${artifact.id}`);
  }
  if (artifact.npmIntegrity) {
    const separator = artifact.npmIntegrity.indexOf('-');
    const algorithm = artifact.npmIntegrity.slice(0, separator);
    const expected = artifact.npmIntegrity.slice(separator + 1);
    const actual = createHash(algorithm).update(content).digest('base64');
    if (actual !== expected) {
      throw new InstallerError('INTEGRITY_MISMATCH', `npm integrity mismatch: ${artifact.id}`);
    }
  }
}

async function walkFiles(fsImpl, pathImpl, root) {
  const output = [];
  for (const entry of await fsImpl.readdir(root, { withFileTypes: true })) {
    const file = pathImpl.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      throw new InstallerError('UNSAFE_LAYOUT', `Runtime contains a symlink: ${file}`);
    }
    if (entry.isDirectory()) output.push(...await walkFiles(fsImpl, pathImpl, file));
    else if (entry.isFile()) output.push(file);
  }
  return output;
}

async function containsForbiddenRemote(fsImpl, file) {
  const handle = await fsImpl.open(file, 'r');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let carry = '';
  try {
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) return false;
      const text = carry + buffer.subarray(0, bytesRead).toString('latin1');
      if (FORBIDDEN_REMOTE.some((pattern) => pattern.test(text))) return true;
      carry = text.slice(-256);
    }
  } finally {
    await handle.close();
  }
}

function closureParent(packagePath) {
  const nested = packagePath.lastIndexOf('/node_modules/');
  return nested < 0 ? '' : packagePath.slice(0, nested);
}

function resolveClosureDependency(packagePath, dependencyName, availablePaths) {
  let base = packagePath;
  while (true) {
    const candidate = base
      ? `${base}/node_modules/${dependencyName}`
      : `node_modules/${dependencyName}`;
    if (availablePaths.has(candidate)) return candidate;
    if (!base) return null;
    base = closureParent(base);
  }
}

export async function validateRuntimeLayout({
  stage,
  manifest,
  closure,
  fsImpl = fs,
  pathImpl = path,
} = {}) {
  const required = [
    pathImpl.join(stage, 'webapp', manifest.artifacts.drawioWebapp.entry),
    pathImpl.join(
      stage,
      'mcp',
      'node_modules',
      '@next-ai-drawio',
      'mcp-server',
      'dist',
      'index.js',
    ),
    ...RELEASE_INPUT_NAMES.map((relative) => pathImpl.join(stage, relative)),
  ];
  for (const file of required) {
    const stat = await fsImpl.lstat(file).catch(() => null);
    if (!stat?.isFile()) {
      throw new InstallerError('INVALID_LAYOUT', `Required runtime entry is missing: ${file}`);
    }
  }
  const closurePaths = new Set(closure.artifacts.map((artifact) => artifact.path));
  for (const artifact of closure.artifacts) {
    const packageJson = pathImpl.join(stage, 'mcp', artifact.path, 'package.json');
    let metadata;
    try {
      metadata = JSON.parse(await fsImpl.readFile(packageJson, 'utf8'));
    } catch {
      throw new InstallerError(
        'INVALID_LAYOUT',
        `Closure package metadata is missing or malformed: ${artifact.path}`,
      );
    }
    if (metadata.name !== artifact.name || metadata.version !== artifact.version) {
      throw new InstallerError(
        'LAYOUT_IDENTITY_DRIFT',
        `Extracted package identity drifted: ${artifact.path}`,
      );
    }
    const declaredDependencies = Object.keys(metadata.dependencies ?? {}).sort();
    const lockedDependencies = Object.keys(artifact.dependencies).sort();
    if (JSON.stringify(declaredDependencies) !== JSON.stringify(lockedDependencies)) {
      throw new InstallerError(
        'CLOSURE_DECLARATION_DRIFT',
        `Extracted dependency declarations drifted: ${artifact.path}`,
      );
    }
    for (const dependencyName of declaredDependencies) {
      const resolved = resolveClosureDependency(
        artifact.path,
        dependencyName,
        closurePaths,
      );
      if (resolved !== artifact.dependencies[dependencyName]) {
        throw new InstallerError(
          'CLOSURE_RESOLUTION_DRIFT',
          `Exact dependency target drifted: ${artifact.path} -> ${dependencyName}`,
        );
      }
    }
    const optionalPeers = Object.entries(metadata.peerDependenciesMeta ?? {})
      .filter(([, peer]) => peer?.optional === true)
      .map(([name]) => name)
      .sort();
    if (JSON.stringify(optionalPeers) !== JSON.stringify([...artifact.optionalPeers].sort())) {
      throw new InstallerError(
        'CLOSURE_OPTIONAL_PEER_DRIFT',
        `Optional peer exclusions drifted: ${artifact.path}`,
      );
    }
    for (const peerName of Object.keys(metadata.peerDependencies ?? {})) {
      if (optionalPeers.includes(peerName)) continue;
      if (!resolveClosureDependency(artifact.path, peerName, closurePaths)) {
        throw new InstallerError(
          'CLOSURE_REQUIRED_PEER_MISSING',
          `Required peer is absent from closure: ${artifact.path} -> ${peerName}`,
        );
      }
    }
  }

  const files = await walkFiles(fsImpl, pathImpl, stage);
  for (const file of files) {
    if (!/\.(?:html?|js|mjs|json|css)$/i.test(file)) continue;
    const relative=pathImpl.relative(stage,file).split(pathImpl.sep).join('/');
    if (/\/(?:examples?|tests?|docs?)\//i.test(relative)) continue;
    const executableControl=relative.startsWith('patches/')||relative.startsWith('mcp/node_modules/@next-ai-drawio/mcp-server/dist/');
    if(!executableControl)continue;
    if (await containsForbiddenRemote(fsImpl, file)) {
      throw new InstallerError(
        'OFFLINE_POLICY_VIOLATION',
        `Runtime contains a forbidden remote or hostname fallback: ${file}`,
      );
    }
  }
  return { valid: true, filesChecked: files.length };
}

function assertImplementationStage({ manifest, plan, safetyStage, implementationFixtureRoot, pathImpl }) {
  if (manifest.audit.releaseGate === true) return;
  if (
    safetyStage !== 'implementation-fixture' ||
    !implementationFixtureRoot ||
    !pathImpl.isAbsolute(implementationFixtureRoot) ||
    !isInside(implementationFixtureRoot, plan.target, pathImpl)
  ) {
    throw new InstallerError(
      'RELEASE_GATE_BLOCKED',
      'releaseGate=false prohibits installation outside an explicit implementation fixture',
    );
  }
}

export async function installRuntime({
  manifest,
  closure,
  plan,
  approvedPlanDigest,
  recomputedPlan,
  safetyStage = 'release',
  implementationFixtureRoot,
  releaseInputsRoot,
  fsImpl = fs,
  pathImpl = path,
  processImpl = { spawn },
  download = defaultDownload,
  verifyArtifact = verifyArchive,
  materialize = defaultMaterialize,
  validateLayout = validateRuntimeLayout,
  idFactory = randomUUID,
} = {}) {
  assertPlanApproval({
    plan,
    approvedPlanDigest,
    expectedAction: plan?.action,
    recomputedPlan,
  });
  if (!['install', 'upgrade', 'reinstall'].includes(plan.action)) {
    throw new InstallerError('PLAN_ACTION_MISMATCH', 'Install requires an install plan');
  }
  const validated = validateManagedManifest({ manifest, closure });
  if (plan.closure.digest !== digestPlan(closure)) {
    throw new InstallerError('CLOSURE_DRIFT', 'Plan closure digest does not match managed data');
  }
  assertImplementationStage({
    manifest,
    plan,
    safetyStage,
    implementationFixtureRoot,
    pathImpl,
  });
  if (!isInside(plan.managedRoot, plan.target, pathImpl) || plan.target === plan.managedRoot) {
    throw new InstallerError('INVALID_TARGET', 'Install target must be inside the managed root');
  }

  const targetExists = await exists(fsImpl, plan.target);
  if (targetExists && plan.action !== 'reinstall') {
    throw new InstallerError(
      'ALREADY_INSTALLED',
      'The exact runtime target already exists; no automatic upgrade is performed',
    );
  }

  await fsImpl.mkdir(plan.managedRoot, { recursive: true });
  const operationId = idFactory();
  const stage = pathImpl.join(plan.managedRoot, `.stage-${operationId}`);
  const backup = pathImpl.join(plan.managedRoot, `.rollback-${operationId}`);
  let movedExisting = false;

  try {
    await fsImpl.mkdir(pathImpl.join(stage, 'downloads'), { recursive: true });
    for (let index = 0; index < plan.artifacts.length; index += 1) {
      const artifact = plan.artifacts[index];
      const archive = pathImpl.join(stage, 'downloads', `${String(index).padStart(4, '0')}.bin`);
      await download(artifact, archive, { fsImpl, pathImpl });
      await verifyArtifact(fsImpl, artifact, archive);
      await materialize({
        artifact,
        archive,
        stage,
        fsImpl,
        pathImpl,
        processImpl,
      });
    }

    const releaseInputDigests = await copyReleaseInputs({ releaseInputsRoot, stage, fsImpl, pathImpl });
    const releaseInputBundleDigest=digestReleaseInputs(releaseInputDigests);
    const plannedSubset=Object.fromEntries(Object.entries(plan.releaseInputs?.digests??{}).filter(([name])=>RELEASE_INPUT_NAMES.some(relative=>releaseInputKey(relative)===name)));
    if(releaseInputBundleDigest!==digestReleaseInputs(plannedSubset))throw new InstallerError('PLAN_STALE','Managed release inputs changed after plan approval');
    await validateLayout({ stage, manifest, closure, fsImpl, pathImpl });
    await fsImpl.rm(pathImpl.join(stage, 'downloads'), { recursive: true, force: true });
    await fsImpl.writeFile(
      pathImpl.join(stage, 'installation.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        runtimeVersion: plan.runtimeVersion,
        manifestDigest: validated.manifestDigest,
        closureDigest: plan.closure.digest,
        artifactCount: closure.artifactCount,
        offlineVerified: true,
        releaseInputDigests,
        releaseInputBundleDigest,
      }, null, 2)}\n`,
      { flag: 'wx' },
    );

    if (targetExists) {
      await fsImpl.rename(plan.target, backup);
      movedExisting = true;
    }
    await fsImpl.rename(stage, plan.target);
    if (movedExisting) await fsImpl.rm(backup, { recursive: true, force: true });
    return {
      runtimeState: 'ready',
      runtimeVersion: plan.runtimeVersion,
      target: plan.target,
      automaticUpgrade: false,
    };
  } catch (error) {
    await fsImpl.rm(stage, { recursive: true, force: true }).catch(() => {});
    if (movedExisting) {
      if (await exists(fsImpl, plan.target)) {
        await fsImpl.rm(plan.target, { recursive: true, force: true }).catch(() => {});
      }
      await fsImpl.rename(backup, plan.target).catch(() => {});
    }
    if (error instanceof InstallerError) throw error;
    throw new InstallerError('INSTALL_FAILED', 'Runtime installation failed and was rolled back', error);
  }
}
