import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  IMMUTABLE_DEPENDENCY_CLOSURE,
  loadDependencyClosure,
  loadManagedManifest,
  validateManagedManifest,
} from '../../../lib/diagram/manifest.mjs';

const MANIFEST_PATH = new URL('../../../core/runtimes/drawio/manifest.json', import.meta.url);
const DEPENDENCY_LOCK_PATH = new URL(
  '../../../core/runtimes/drawio/dependency-lock.json',
  import.meta.url,
);

test('loads the fixed audited manifest and deployed canonical closure', async () => {
  const reads = [];
  const fsImpl = {
    readFile: async (file, encoding) => {
      reads.push(String(file));
      return fs.readFile(file, encoding);
    },
  };
  const manifest = await loadManagedManifest({
    manifestPath: MANIFEST_PATH,
    dependencyLockPath: DEPENDENCY_LOCK_PATH,
    fsImpl,
  });
  const result = validateManagedManifest({ manifest });

  assert.deepEqual(reads, [String(MANIFEST_PATH), String(DEPENDENCY_LOCK_PATH)]);
  assert.equal(manifest.audit.state, 'verified-with-required-mitigations');
  assert.equal(manifest.audit.releaseGate, true);
  assert.equal(manifest.audit.releaseVerificationState, 'verified');
  assert.equal(result.releaseAllowed, true);
  assert.equal(result.artifactCount, 126);
  assert.match(result.closureDigest, /^[a-f0-9]{64}$/);
});

test('rejects manifest identity and closure provenance drift', async () => {
  const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'));
  const changedManifest = structuredClone(manifest);
  changedManifest.artifacts.nextAiDrawioMcp.version = '0.2.4';

  assert.throws(
    () => validateManagedManifest({ manifest: changedManifest }),
    { code: 'MANIFEST_IDENTITY_DRIFT' },
  );

  const changedClosure = structuredClone(IMMUTABLE_DEPENDENCY_CLOSURE);
  changedClosure.artifacts[0].source = 'https://mirror.invalid/package.tgz';
  assert.throws(
    () => validateManagedManifest({ manifest, closure: changedClosure }),
    { code: 'UNOFFICIAL_CLOSURE_SOURCE' },
  );
});

test('missing or malformed deployed lock fails closed', async () => {
  await assert.rejects(
    loadDependencyClosure({
      lockPath: '/missing/dependency-lock.json',
      fsImpl: {
        readFile: async () => {
          const error = new Error('missing');
          error.code = 'ENOENT';
          throw error;
        },
      },
    }),
    { code: 'DEPENDENCY_LOCK_READ_FAILED' },
  );

  await assert.rejects(
    loadDependencyClosure({
      lockPath: '/malformed/dependency-lock.json',
      fsImpl: { readFile: async () => '{"artifacts":' },
    }),
    { code: 'DEPENDENCY_LOCK_MALFORMED' },
  );
});
