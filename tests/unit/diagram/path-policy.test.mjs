import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  PathPolicyError,
  resolveManagedArtifact,
  resolveManagedRoot,
  validateManagedRelativePath,
} from '../../../lib/diagram/path-policy.mjs';

const tempDirs = new Set();

function makeProject() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'specline-path-policy-'));
  tempDirs.add(projectRoot);
  mkdirSync(join(projectRoot, 'specline', 'changes', 'known-change'), { recursive: true });
  return projectRoot;
}

afterEach(() => {
  for (const directory of tempDirs) {
    rmSync(directory, { recursive: true, force: true });
  }
  tempDirs.clear();
});

describe('managed diagram roots', () => {
  it('resolves default and explicitly linked existing change roots', () => {
    const projectRoot = makeProject();

    assert.equal(
      resolveManagedRoot({ projectRoot, slug: 'system-map' }),
      join(projectRoot, 'specline', 'diagrams', 'system-map'),
    );
    assert.equal(
      resolveManagedRoot({ projectRoot, slug: 'system-map', change: 'known-change' }),
      join(projectRoot, 'specline', 'changes', 'known-change', 'diagrams', 'system-map'),
    );
  });

  it('rejects invalid slugs and unknown changes', () => {
    const projectRoot = makeProject();

    for (const slug of ['Uppercase', '../escape', 'two words', 'a\\b', '']) {
      assert.throws(
        () => resolveManagedRoot({ projectRoot, slug }),
        (error) => error instanceof PathPolicyError && error.code === 'INVALID_SLUG',
      );
    }
    assert.throws(
      () => resolveManagedRoot({ projectRoot, slug: 'system-map', change: 'missing' }),
      (error) => error instanceof PathPolicyError && error.code === 'CHANGE_NOT_FOUND',
    );
  });
});

describe('path canonicalization', () => {
  it('accepts only same-name drawio, markdown, and svg artifacts', () => {
    const projectRoot = makeProject();

    for (const extension of ['.drawio', '.md', '.svg']) {
      const result = resolveManagedArtifact({ projectRoot, slug: 'system-map', extension });
      assert.equal(result, join(projectRoot, 'specline', 'diagrams', 'system-map', `system-map${extension}`));
    }
    assert.throws(
      () => resolveManagedArtifact({ projectRoot, slug: 'system-map', extension: '.png' }),
      (error) => error.code === 'EXTENSION_NOT_ALLOWED',
    );
  });

  it('rejects POSIX and Windows traversal and absolute paths', () => {
    const root = makeProject();
    for (const candidate of [
      '../outside.drawio',
      'nested/../../outside.drawio',
      '..\\outside.drawio',
      'nested\\..\\outside.drawio',
      '/tmp/outside.drawio',
      'C:\\temp\\outside.drawio',
      'C:outside.drawio',
      '\\\\server\\share\\outside.drawio',
      'system-map.drawio\0ignored',
    ]) {
      assert.throws(
        () => validateManagedRelativePath({ root, relativePath: candidate }),
        (error) => error instanceof PathPolicyError,
        candidate,
      );
    }
  });

  it('rejects symlink escape through an existing path segment', () => {
    const projectRoot = makeProject();
    const root = resolveManagedRoot({ projectRoot, slug: 'system-map' });
    const outside = mkdtempSync(join(tmpdir(), 'specline-path-outside-'));
    tempDirs.add(outside);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(outside, 'system-map.drawio'), '<mxfile/>');
    symlinkSync(outside, join(root, 'linked'));

    assert.throws(
      () => validateManagedRelativePath({
        root,
        relativePath: 'linked/system-map.drawio',
      }),
      (error) => error.code === 'SYMLINK_ESCAPE',
    );
  });

  it('fails closed for a dangling symlink path segment', () => {
    const projectRoot = makeProject();
    const root = resolveManagedRoot({ projectRoot, slug: 'system-map' });
    const outside = join(projectRoot, '..', 'not-created-outside');
    mkdirSync(root, { recursive: true });
    symlinkSync(outside, join(root, 'dangling'));

    assert.throws(
      () => validateManagedRelativePath({
        root,
        relativePath: 'dangling/system-map.drawio',
      }),
      (error) => error.code === 'SYMLINK_ESCAPE',
    );
  });

  it('canonicalizes an in-root existing artifact without escaping', () => {
    const projectRoot = makeProject();
    const root = resolveManagedRoot({ projectRoot, slug: 'system-map' });
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'system-map.drawio'), '<mxfile/>');

    assert.equal(
      validateManagedRelativePath({ root, relativePath: 'system-map.drawio' }),
      join(root, 'system-map.drawio'),
    );
  });
});
