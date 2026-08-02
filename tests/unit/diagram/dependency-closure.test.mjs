import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  IMMUTABLE_DEPENDENCY_CLOSURE,
  validateDependencyClosure,
} from '../../../lib/diagram/manifest.mjs';

const DEPENDENCY_LOCK_PATH = new URL(
  '../../../core/runtimes/drawio/dependency-lock.json',
  import.meta.url,
);

test('deployed lock is the canonical 126-entry immutable closure', async () => {
  const deployed = JSON.parse(await fs.readFile(DEPENDENCY_LOCK_PATH, 'utf8'));
  assert.deepEqual(deployed, IMMUTABLE_DEPENDENCY_CLOSURE);

  const closure = IMMUTABLE_DEPENDENCY_CLOSURE;
  const result = validateDependencyClosure(closure);

  assert.equal(closure.artifactCount, 126);
  assert.equal(result.artifactCount, closure.artifacts.length);
  assert.equal(result.root.name, '@next-ai-drawio/mcp-server');
  for (const artifact of closure.artifacts) {
    assert.match(artifact.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    assert.doesNotMatch(artifact.version, /[~^*<>=| ]/);
    assert.match(artifact.source, /^https:\/\/registry\.npmjs\.org\//);
    assert.match(artifact.npmIntegrity, /^sha512-/);
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
    assert.ok(artifact.bytes > 0);
    for (const dependencyPath of Object.values(artifact.dependencies)) {
      assert.match(dependencyPath, /^node_modules\//);
      assert.doesNotMatch(dependencyPath, /[~^*<>=| ]/);
    }
  }
});

test('closure rejects missing edges, ranges, checksum gaps, and extra nodes', () => {
  const missing = structuredClone(IMMUTABLE_DEPENDENCY_CLOSURE);
  delete missing.artifacts.find(
    (artifact) => Object.keys(artifact.dependencies).length > 0,
  ).dependencies[Object.keys(missing.artifacts.find(
    (artifact) => Object.keys(artifact.dependencies).length > 0,
  ).dependencies)[0]];
  assert.throws(
    () => validateDependencyClosure(missing),
    { code: 'CLOSURE_UNREACHABLE_ARTIFACT' },
  );

  const range = structuredClone(IMMUTABLE_DEPENDENCY_CLOSURE);
  range.artifacts[0].version = '^2.0.12';
  assert.throws(
    () => validateDependencyClosure(range),
    { code: 'CLOSURE_RANGE_FORBIDDEN' },
  );

  const checksum = structuredClone(IMMUTABLE_DEPENDENCY_CLOSURE);
  checksum.artifacts[0].sha256 = '';
  assert.throws(
    () => validateDependencyClosure(checksum),
    { code: 'CLOSURE_CHECKSUM_MISSING' },
  );

  const extra = structuredClone(IMMUTABLE_DEPENDENCY_CLOSURE);
  extra.artifacts.push({ ...structuredClone(extra.artifacts[0]), path: 'node_modules/unreachable' });
  extra.artifactCount += 1;
  assert.throws(
    () => validateDependencyClosure(extra),
    { code: 'CLOSURE_UNREACHABLE_ARTIFACT' },
  );
});
