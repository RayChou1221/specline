import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
export const ARM_STEPS = ['inject', 'mountRoleTools', 'enableWriteGuard', 'bind'];
export function isSpeclineProject(dir) {
    if (!dir)
        return false;
    const configPath = join(dir, 'specline', 'config.yaml');
    try {
        return existsSync(configPath) && statSync(configPath).isFile();
    }
    catch {
        return false;
    }
}
/** Distinguish “no specline folder” from “folder exists but config.yaml is missing”. */
export function inspectSpeclineProject(dir) {
    if (!dir) {
        return { dir, hasSpeclineDir: false, hasConfig: false };
    }
    let hasSpeclineDir = false;
    try {
        const speclineDir = join(dir, 'specline');
        hasSpeclineDir = existsSync(speclineDir) && statSync(speclineDir).isDirectory();
    }
    catch {
        hasSpeclineDir = false;
    }
    return {
        dir,
        hasSpeclineDir,
        hasConfig: isSpeclineProject(dir),
    };
}
/** Walk up from cwd so a session opened inside a subfolder still finds the repo. */
export function resolveSpeclineProjectDir(startDir, maxDepth = 8) {
    let current = startDir;
    for (let i = 0; i < maxDepth; i += 1) {
        if (!current)
            return null;
        if (isSpeclineProject(current))
            return current;
        const parent = dirname(current);
        if (parent === current)
            break;
        current = parent;
    }
    return null;
}
/**
 * Arm only the current session: inject Skill, mount role tools, enable write
 * guard, then bind. Does not write ~/.dsh progress or create .dsh/skills.
 * Refuses when the cwd is not a Specline project.
 */
export function arm(input) {
    const sessionId = input.sessionId;
    if (!isSpeclineProject(input.projectDir)) {
        return {
            armed: false,
            sessionId: null,
            steps: [],
            reason: 'not-specline-project',
        };
    }
    const actions = input.actions ?? {};
    actions.inject?.(sessionId);
    actions.mountRoleTools?.(sessionId);
    actions.enableWriteGuard?.(sessionId);
    actions.bind?.(sessionId);
    return {
        armed: true,
        sessionId,
        steps: [...ARM_STEPS],
    };
}
