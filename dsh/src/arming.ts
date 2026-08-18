import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const ARM_STEPS = ['inject', 'mountRoleTools', 'enableWriteGuard', 'bind'] as const;

export type ArmStep = (typeof ARM_STEPS)[number];

export type ArmActions = {
  inject: (sessionId: string) => void;
  mountRoleTools: (sessionId: string) => void;
  enableWriteGuard: (sessionId: string) => void;
  bind: (sessionId: string) => void;
};

export type ArmInput = {
  projectDir: string;
  sessionId: string;
  actions?: Partial<ArmActions>;
};

export type ArmResult = {
  armed: boolean;
  sessionId: string | null;
  steps: ArmStep[];
  reason?: string;
};

export function isSpeclineProject(dir: string): boolean {
  if (!dir) return false;
  const configPath = join(dir, 'specline', 'config.yaml');
  try {
    return existsSync(configPath) && statSync(configPath).isFile();
  } catch {
    return false;
  }
}

export type SpeclineProjectInspection = {
  dir: string;
  hasSpeclineDir: boolean;
  hasConfig: boolean;
};

/** Distinguish “no specline folder” from “folder exists but config.yaml is missing”. */
export function inspectSpeclineProject(dir: string): SpeclineProjectInspection {
  if (!dir) {
    return { dir, hasSpeclineDir: false, hasConfig: false };
  }
  let hasSpeclineDir = false;
  try {
    const speclineDir = join(dir, 'specline');
    hasSpeclineDir = existsSync(speclineDir) && statSync(speclineDir).isDirectory();
  } catch {
    hasSpeclineDir = false;
  }
  return {
    dir,
    hasSpeclineDir,
    hasConfig: isSpeclineProject(dir),
  };
}

/** Walk up from cwd so a session opened inside a subfolder still finds the repo. */
export function resolveSpeclineProjectDir(startDir: string, maxDepth = 8): string | null {
  let current = startDir;
  for (let i = 0; i < maxDepth; i += 1) {
    if (!current) return null;
    if (isSpeclineProject(current)) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/**
 * Arm only the current session: inject Skill, mount role tools, enable write
 * guard, then bind. Does not write ~/.dsh progress or create .dsh/skills.
 * Refuses when the cwd is not a Specline project.
 */
export function arm(input: ArmInput): ArmResult {
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
