import { createHash } from 'crypto';
import { readFileSync } from 'fs';

/** @param {string|Buffer} content */
export function sha256(content) {
  const hash = createHash('sha256').update(content).digest('hex');
  return `sha256:${hash}`;
}

/** @param {string} filePath */
export function computeFileHash(filePath) {
  return sha256(readFileSync(filePath));
}
