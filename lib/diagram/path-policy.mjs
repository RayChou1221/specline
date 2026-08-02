import {
  existsSync,
  lstatSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';

export const ALLOWED_DIAGRAM_EXTENSIONS = Object.freeze([
  '.drawio',
  '.md',
  '.svg',
]);

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class PathPolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PathPolicyError';
    this.code = code;
  }
}

function assertNonEmptyString(value, code, label) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new PathPolicyError(code, `${label} must be a non-empty string without NUL bytes`);
  }
}

function isWithin(root, candidate) {
  const difference = relative(root, candidate);
  return difference === '' ||
    (!difference.startsWith(`..${sep}`) && difference !== '..' && !isAbsolute(difference));
}

function lexicallyExists(pathname) {
  try {
    lstatSync(pathname);
    return true;
  } catch {
    return false;
  }
}

function canonicalizePotentialPath(pathname) {
  const absolute = resolve(pathname);
  const missingSegments = [];
  let cursor = absolute;

  while (!lexicallyExists(cursor)) {
    const parent = resolve(cursor, '..');
    if (parent === cursor) {
      throw new PathPolicyError('CANONICALIZATION_FAILED', `No existing ancestor for ${pathname}`);
    }
    missingSegments.unshift(cursor.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
    cursor = parent;
  }

  let canonical;
  try {
    canonical = realpathSync.native(cursor);
  } catch {
    throw new PathPolicyError(
      'SYMLINK_ESCAPE',
      'Path contains an unresolved symbolic link',
    );
  }
  for (const segment of missingSegments) {
    canonical = join(canonical, segment);
  }
  return canonical;
}

function assertCanonicalBoundary(root, candidate) {
  const canonicalRoot = canonicalizePotentialPath(root);
  const canonicalCandidate = canonicalizePotentialPath(candidate);
  if (!isWithin(canonicalRoot, canonicalCandidate)) {
    throw new PathPolicyError(
      'SYMLINK_ESCAPE',
      'Resolved path escapes the managed diagram root',
    );
  }
  return canonicalCandidate;
}

export function validateDiagramSlug(slug) {
  assertNonEmptyString(slug, 'INVALID_SLUG', 'Diagram slug');
  if (!SLUG_PATTERN.test(slug) || slug.length > 80) {
    throw new PathPolicyError(
      'INVALID_SLUG',
      'Diagram slug must be lowercase kebab-case and at most 80 characters',
    );
  }
  return slug;
}

export function validateChangeName(change) {
  assertNonEmptyString(change, 'INVALID_CHANGE', 'Change name');
  if (!SLUG_PATTERN.test(change) || change.length > 120) {
    throw new PathPolicyError(
      'INVALID_CHANGE',
      'Change name must be lowercase kebab-case and at most 120 characters',
    );
  }
  return change;
}

export function resolveManagedRoot({ projectRoot, slug, change } = {}) {
  assertNonEmptyString(projectRoot, 'INVALID_PROJECT_ROOT', 'Project root');
  if (!isAbsolute(projectRoot)) {
    throw new PathPolicyError('INVALID_PROJECT_ROOT', 'Project root must be an absolute native path');
  }
  validateDiagramSlug(slug);

  const absoluteProjectRoot = resolve(projectRoot);
  if (!existsSync(absoluteProjectRoot) || !lstatSync(absoluteProjectRoot).isDirectory()) {
    throw new PathPolicyError('PROJECT_NOT_FOUND', 'Project root must be an existing directory');
  }

  let root;
  if (change === undefined || change === null) {
    root = join(absoluteProjectRoot, 'specline', 'diagrams', slug);
  } else {
    validateChangeName(change);
    const changeRoot = join(absoluteProjectRoot, 'specline', 'changes', change);
    if (!existsSync(changeRoot) || !lstatSync(changeRoot).isDirectory()) {
      throw new PathPolicyError(
        'CHANGE_NOT_FOUND',
        `Linked change does not exist: ${change}`,
      );
    }
    root = join(changeRoot, 'diagrams', slug);
  }

  const canonicalProject = realpathSync.native(absoluteProjectRoot);
  const canonicalRoot = canonicalizePotentialPath(root);
  if (!isWithin(canonicalProject, canonicalRoot)) {
    throw new PathPolicyError(
      'SYMLINK_ESCAPE',
      'Managed diagram root escapes the project through a symbolic link',
    );
  }
  return root;
}

export function validateManagedRelativePath({ root, relativePath, allowedExtensions } = {}) {
  assertNonEmptyString(root, 'INVALID_MANAGED_ROOT', 'Managed root');
  assertNonEmptyString(relativePath, 'INVALID_RELATIVE_PATH', 'Relative path');

  if (
    isAbsolute(relativePath) ||
    win32.isAbsolute(relativePath) ||
    win32.parse(relativePath).root !== '' ||
    relativePath.startsWith('\\\\')
  ) {
    throw new PathPolicyError('ABSOLUTE_PATH_REJECTED', 'Absolute paths are not allowed');
  }

  const segments = relativePath.split(/[\\/]/);
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new PathPolicyError('PATH_TRAVERSAL', 'Empty, dot, and parent path segments are not allowed');
  }

  const extensions = allowedExtensions ?? ALLOWED_DIAGRAM_EXTENSIONS;
  const matchedExtension = extensions.find((extension) => relativePath.endsWith(extension));
  if (!matchedExtension) {
    throw new PathPolicyError(
      'EXTENSION_NOT_ALLOWED',
      `Allowed diagram extensions: ${extensions.join(', ')}`,
    );
  }

  const absoluteRoot = resolve(root);
  const lexicalCandidate = resolve(absoluteRoot, ...segments);
  if (!isWithin(absoluteRoot, lexicalCandidate)) {
    throw new PathPolicyError('PATH_TRAVERSAL', 'Path escapes the managed diagram root');
  }

  assertCanonicalBoundary(absoluteRoot, lexicalCandidate);
  return lexicalCandidate;
}

export function resolveManagedArtifact({
  projectRoot,
  slug,
  change,
  extension,
} = {}) {
  if (!ALLOWED_DIAGRAM_EXTENSIONS.includes(extension)) {
    throw new PathPolicyError(
      'EXTENSION_NOT_ALLOWED',
      `Allowed diagram extensions: ${ALLOWED_DIAGRAM_EXTENSIONS.join(', ')}`,
    );
  }
  const root = resolveManagedRoot({ projectRoot, slug, change });
  return validateManagedRelativePath({
    root,
    relativePath: `${slug}${extension}`,
  });
}
