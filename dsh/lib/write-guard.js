import { posix } from 'node:path';
const PIPELINE_STATE = '.pipeline-state.json';
const PIPELINE_SESSIONS = '.pipeline-sessions.json';
function normalizeRelPath(relPath) {
    if (!relPath)
        return '';
    let normalized = posix.normalize(relPath.replace(/\\/g, '/'));
    if (normalized.startsWith('./'))
        normalized = normalized.slice(2);
    if (normalized === '.')
        return '';
    return normalized;
}
function isParentOrchestrator(parentSession) {
    return parentSession == null || parentSession === '';
}
function isSpeclineRuntimeWritePath(relPath) {
    const path = normalizeRelPath(relPath);
    if (!path || path.startsWith('../'))
        return false;
    if (path === 'specline/changes' || path.startsWith('specline/changes/')) {
        return true;
    }
    const base = posix.basename(path);
    if (base === PIPELINE_STATE || base === PIPELINE_SESSIONS) {
        return true;
    }
    if (path === '.tmp' || path.startsWith('.tmp/')) {
        return true;
    }
    return false;
}
/**
 * Parent (empty parentSession) may only write Specline runtime artifacts.
 * Child sessions (has parent) may write application source.
 */
export function parentWriteAllowed(relPath, parentSession) {
    if (!isParentOrchestrator(parentSession)) {
        return true;
    }
    return isSpeclineRuntimeWritePath(relPath);
}
