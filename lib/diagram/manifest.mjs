import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';

const DEFAULT_DEPENDENCY_LOCK = new URL(
  '../../core/runtimes/drawio/dependency-lock.json',
  import.meta.url,
);

const FIXED_IDENTITY = Object.freeze({
  drawioWebapp: {
    version: '31.1.2',
    url: 'https://github.com/jgraph/drawio/releases/download/v31.1.2/draw.war',
    sha256: '05907c7d4f987673de5222350d32e64bf1a16defbf5259be3a28d156466f85c3',
  },
  nextAiDrawioMcp: {
    version: '0.2.3',
    url: 'https://registry.npmjs.org/@next-ai-drawio/mcp-server/-/mcp-server-0.2.3.tgz',
    sha256: '550587860131778e83944e0f8382d2cf954362e59f3b1a6bb5d455ca1ec566ac',
    npmIntegrity:
      'sha512-cocHvx0iUlk+T3g0wRw7to5R3OleHXjLyF4zjOU27yfM8QUFb9vZ56cIODmtMaxtwWjPhU6Ug4kzhBgGLcjyLQ==',
  },
});

export class ManifestError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ManifestError';
    this.code = code;
  }
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function readDependencyClosureSync(lockPath = DEFAULT_DEPENDENCY_LOCK) {
  let source;
  try {
    source = readFileSync(lockPath, 'utf8');
  } catch (error) {
    throw new ManifestError(
      'DEPENDENCY_LOCK_READ_FAILED',
      `Cannot read canonical dependency lock: ${error.message}`,
    );
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new ManifestError(
      'DEPENDENCY_LOCK_MALFORMED',
      `Canonical dependency lock is malformed: ${error.message}`,
    );
  }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function assertExactArtifact(actual, expected, id) {
  for (const [field, value] of Object.entries(expected)) {
    if (actual?.[field] !== value) {
      throw new ManifestError(
        'MANIFEST_IDENTITY_DRIFT',
        `${id}.${field} does not match the audited fixed identity`,
      );
    }
  }
}

function assertExactVersion(version, id) {
  if (
    typeof version !== 'string' ||
    !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(version)
  ) {
    throw new ManifestError('CLOSURE_RANGE_FORBIDDEN', `${id} must use an exact version`);
  }
}

function assertOfficialNpmSource(artifact) {
  let source;
  try {
    source = new URL(artifact.source);
  } catch {
    throw new ManifestError('UNOFFICIAL_CLOSURE_SOURCE', `${artifact.path} source is invalid`);
  }
  if (
    source.protocol !== 'https:' ||
    source.hostname !== 'registry.npmjs.org' ||
    source.search ||
    source.hash
  ) {
    throw new ManifestError(
      'UNOFFICIAL_CLOSURE_SOURCE',
      `${artifact.path} must use the official npm registry tarball`,
    );
  }
  const basename = artifact.name.startsWith('@') ? artifact.name.split('/')[1] : artifact.name;
  if (!source.pathname.endsWith(`/-/${basename}-${artifact.version}.tgz`)) {
    throw new ManifestError(
      'CLOSURE_SOURCE_DRIFT',
      `${artifact.path} source does not match its exact name and version`,
    );
  }
}

export function validateDependencyClosure(closure) {
  if (
    !closure ||
    closure.schemaVersion !== 1 ||
    !Array.isArray(closure.artifacts) ||
    closure.artifactCount !== closure.artifacts.length ||
    closure.artifacts.length === 0
  ) {
    throw new ManifestError('CLOSURE_INCOMPLETE', 'Dependency closure metadata is incomplete');
  }

  const byPath = new Map();
  for (const artifact of closure.artifacts) {
    if (
      !artifact ||
      typeof artifact.path !== 'string' ||
      !artifact.path.startsWith('node_modules/') ||
      byPath.has(artifact.path)
    ) {
      throw new ManifestError('CLOSURE_INVALID_PATH', 'Closure paths must be unique and managed');
    }
    assertExactVersion(artifact.version, artifact.path);
    assertOfficialNpmSource(artifact);
    if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(artifact.npmIntegrity ?? '')) {
      throw new ManifestError(
        'CLOSURE_INTEGRITY_MISSING',
        `${artifact.path} is missing npm sha512 integrity`,
      );
    }
    if (!/^[a-f0-9]{64}$/.test(artifact.sha256 ?? '')) {
      throw new ManifestError(
        'CLOSURE_CHECKSUM_MISSING',
        `${artifact.path} is missing an exact SHA-256`,
      );
    }
    if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0) {
      throw new ManifestError('CLOSURE_SIZE_MISSING', `${artifact.path} has no fixed byte size`);
    }
    if (
      !artifact.dependencies ||
      typeof artifact.dependencies !== 'object' ||
      !Array.isArray(artifact.optionalPeers)
    ) {
      throw new ManifestError(
        'CLOSURE_DEPENDENCIES_MISSING',
        `${artifact.path} has no exact dependency edge set`,
      );
    }
    byPath.set(artifact.path, artifact);
  }

  const root = byPath.get(closure.root);
  if (!root) {
    throw new ManifestError('CLOSURE_ROOT_MISSING', 'Dependency closure root is missing');
  }
  for (const artifact of closure.artifacts) {
    for (const [dependencyName, dependencyPath] of Object.entries(artifact.dependencies)) {
      const dependency = byPath.get(dependencyPath);
      if (!dependency || dependency.name !== dependencyName) {
        throw new ManifestError(
          'CLOSURE_DEPENDENCY_MISSING',
          `${artifact.path} dependency ${dependencyName} is missing or drifted`,
        );
      }
    }
  }

  const reachable = new Set();
  const visit = (artifactPath) => {
    if (reachable.has(artifactPath)) return;
    reachable.add(artifactPath);
    for (const child of Object.values(byPath.get(artifactPath).dependencies)) visit(child);
  };
  visit(closure.root);
  if (reachable.size !== closure.artifacts.length) {
    throw new ManifestError(
      'CLOSURE_UNREACHABLE_ARTIFACT',
      'Dependency closure contains artifacts outside the root transitive graph',
    );
  }
  return {
    closureDigest: digest(closure),
    artifactCount: closure.artifactCount,
    root,
  };
}

export const IMMUTABLE_DEPENDENCY_CLOSURE = (() => {
  const closure = readDependencyClosureSync();
  validateDependencyClosure(closure);
  return deepFreeze(closure);
})();

export async function loadDependencyClosure({
  lockPath = DEFAULT_DEPENDENCY_LOCK,
  fsImpl = fs,
} = {}) {
  let source;
  try {
    source = await fsImpl.readFile(lockPath, 'utf8');
  } catch (error) {
    throw new ManifestError(
      'DEPENDENCY_LOCK_READ_FAILED',
      `Cannot read canonical dependency lock: ${error.message}`,
    );
  }
  let closure;
  try {
    closure = JSON.parse(source);
  } catch (error) {
    throw new ManifestError(
      'DEPENDENCY_LOCK_MALFORMED',
      `Canonical dependency lock is malformed: ${error.message}`,
    );
  }
  validateDependencyClosure(closure);
  return deepFreeze(closure);
}

export function validateManagedManifest({
  manifest,
  closure = IMMUTABLE_DEPENDENCY_CLOSURE,
} = {}) {
  if (
    !manifest ||
    manifest.schemaVersion !== 1 ||
    manifest.runtime !== 'drawio' ||
    manifest.audit?.state !== 'verified-with-required-mitigations' ||
    manifest.audit?.implementationGate !== true ||
    typeof manifest.audit?.releaseGate !== 'boolean'
  ) {
    throw new ManifestError('AUDIT_GATE_BLOCKED', 'Manifest does not pass the Task 1 audit gate');
  }
  assertExactArtifact(
    manifest.artifacts?.drawioWebapp,
    FIXED_IDENTITY.drawioWebapp,
    'drawioWebapp',
  );
  assertExactArtifact(
    manifest.artifacts?.nextAiDrawioMcp,
    FIXED_IDENTITY.nextAiDrawioMcp,
    'nextAiDrawioMcp',
  );
  const closureResult = validateDependencyClosure(closure);
  assertExactArtifact(
    closureResult.root,
    {
      name: manifest.artifacts.nextAiDrawioMcp.package,
      version: manifest.artifacts.nextAiDrawioMcp.version,
      source: manifest.artifacts.nextAiDrawioMcp.url,
      sha256: manifest.artifacts.nextAiDrawioMcp.sha256,
      npmIntegrity: manifest.artifacts.nextAiDrawioMcp.npmIntegrity,
    },
    'dependencyClosure.root',
  );
  if (
    closure.generatedFrom?.package !== closureResult.root.name ||
    closure.generatedFrom?.version !== closureResult.root.version ||
    closure.generatedFrom?.source !== closureResult.root.source ||
    closure.generatedFrom?.npmIntegrity !== closureResult.root.npmIntegrity ||
    closure.generatedFrom?.sha256 !== closureResult.root.sha256
  ) {
    throw new ManifestError(
      'CLOSURE_PROVENANCE_DRIFT',
      'Closure provenance does not match its fixed root artifact',
    );
  }
  return {
    manifestDigest: digest(manifest),
    closureDigest: closureResult.closureDigest,
    artifactCount: closureResult.artifactCount,
    releaseAllowed: manifest.audit.releaseGate,
  };
}

export async function loadManagedManifest({
  manifestPath,
  dependencyLockPath = DEFAULT_DEPENDENCY_LOCK,
  fsImpl = fs,
  closure,
} = {}) {
  let manifest;
  try {
    manifest = JSON.parse(await fsImpl.readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new ManifestError('MANIFEST_READ_FAILED', `Cannot read runtime manifest: ${error.message}`);
  }
  const dependencyClosure = closure ?? await loadDependencyClosure({
    lockPath: dependencyLockPath,
    fsImpl,
  });
  validateManagedManifest({ manifest, closure: dependencyClosure });
  return deepFreeze(manifest);
}
