import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { assertPlanApproval } from './install-plan.mjs';

export class UninstallError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'UninstallError';
    this.code = code;
  }
}

function isInside(parent, child, pathImpl) {
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

export async function uninstallRuntime({
  plan,
  approvedPlanDigest,
  recomputedPlan,
  activeSessions = [],
  fsImpl = fs,
  pathImpl = path,
  idFactory = randomUUID,
  removeManagedConfiguration = async () => ({ removed: [] }),
} = {}) {
  assertPlanApproval({
    plan,
    approvedPlanDigest,
    expectedAction: 'uninstall',
    recomputedPlan,
  });
  if (activeSessions.length > 0) {
    throw new UninstallError(
      'ACTIVE_SESSIONS',
      'Uninstall is blocked while managed diagram sessions are active',
    );
  }
  if (
    !isInside(plan.managedRoot, plan.target, pathImpl) ||
    plan.target === plan.managedRoot ||
    plan.mutations?.preserveDiagrams !== true
  ) {
    throw new UninstallError(
      'UNSAFE_UNINSTALL_PLAN',
      'Uninstall plan is not limited to the managed runtime',
    );
  }

  const present = await exists(fsImpl, plan.target);
  const tombstone = pathImpl.join(plan.managedRoot, `.uninstall-${idFactory()}`);
  let moved = false;
  let configuration;
  try {
    if (present) {
      await fsImpl.rename(plan.target, tombstone);
      moved = true;
    }
    configuration = await removeManagedConfiguration(plan);
    if (moved) await fsImpl.rm(tombstone, { recursive: true, force: true });
    return {
      runtimeState: 'missing',
      removedRuntime: present,
      removedConfiguration: configuration.removed ?? [],
      diagramsPreserved: true,
    };
  } catch (error) {
    const recovery={ configurationRestored: configuration?.rollback ? false : null, runtimeRestored: moved ? false : null, tombstone: moved ? tombstone : null, target: plan.target };
    let configurationRecoveryError; let runtimeRecoveryError;
    if (typeof configuration?.rollback === 'function') {
      try { await configuration.rollback(); recovery.configurationRestored=true; }
      catch (rollbackError) { configurationRecoveryError=rollbackError; }
    }
    if (moved) {
      try { await fsImpl.rename(tombstone, plan.target); recovery.runtimeRestored=true; recovery.tombstone=null; }
      catch (rollbackError) { runtimeRecoveryError=rollbackError; }
    }
    if (configurationRecoveryError || runtimeRecoveryError) {
      const partial=new UninstallError('UNINSTALL_PARTIAL_FAILURE','Uninstall failed and automatic recovery was incomplete; manual recovery is required',error);
      partial.state={partialFailure:true,manualRecoveryRequired:true,recovery,configurationRecoveryError:configurationRecoveryError?.message??null,runtimeRecoveryError:runtimeRecoveryError?.message??null};
      throw partial;
    }
    if (error instanceof UninstallError) throw error;
    const restored=new UninstallError('UNINSTALL_FAILED','Uninstall failed; runtime and configuration were restored',error);
    restored.state={partialFailure:false,manualRecoveryRequired:false,recovery};
    throw restored;
  }
}
