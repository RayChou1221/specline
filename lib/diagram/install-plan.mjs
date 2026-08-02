import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

import { validateManagedManifest } from './manifest.mjs';

const ACTIONS = new Set([
  'install',
  'upgrade',
  'reinstall',
  'configure',
  'uninstall',
  'stop-all',
]);

export class InstallPlanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'InstallPlanError';
    this.code = code;
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function digestPlan(planWithoutDigest) {
  return createHash('sha256').update(canonicalJson(planWithoutDigest)).digest('hex');
}

export function runtimeVersion(manifest) {
  const drawio = manifest?.artifacts?.drawioWebapp?.version;
  const mcp = manifest?.artifacts?.nextAiDrawioMcp?.version;
  if (!drawio || !mcp) {
    throw new InstallPlanError('INVALID_MANIFEST', 'Manifest artifact versions are required');
  }
  return `${drawio}-mcp.${mcp}`;
}

export function managedRuntimeRoot({ homeDir = os.homedir(), pathImpl = path } = {}) {
  if (typeof homeDir !== 'string' || !pathImpl.isAbsolute(homeDir)) {
    throw new InstallPlanError('INVALID_HOME', 'An absolute home directory is required');
  }
  return pathImpl.join(homeDir, '.specline', 'runtimes', 'drawio');
}

export function createInstallPlan({
  action,
  manifest,
  closure,
  homeDir,
  platform,
  sessions = [],
  currentState = {},
  releaseInputs = {},
  now,
  pathImpl = path,
} = {}) {
  if (!ACTIONS.has(action)) {
    throw new InstallPlanError('INVALID_ACTION', `Unsupported plan action: ${action}`);
  }
  validateManagedManifest({ manifest, closure });

  const root = managedRuntimeRoot({ homeDir, pathImpl });
  const version = runtimeVersion(manifest);
  const target = pathImpl.join(root, version);
  const closureBytes = closure.artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0);
  const closureDigest = digestPlan(closure);
  const artifacts = [
    {
      id: 'drawio-webapp',
      version: manifest.artifacts.drawioWebapp.version,
      source: manifest.artifacts.drawioWebapp.url,
      sha256: manifest.artifacts.drawioWebapp.sha256,
      downloadBytes: manifest.artifacts.drawioWebapp.downloadBytes,
      unpackedBytes: manifest.artifacts.drawioWebapp.unpackedBytes,
    },
    ...closure.artifacts.map((artifact) => ({
      id: artifact.path,
      version: artifact.version,
      source: artifact.source,
      npmIntegrity: artifact.npmIntegrity,
      sha256: artifact.sha256,
      downloadBytes: artifact.bytes,
    })),
  ];

  const plan = {
    schemaVersion: 1,
    action,
    runtime: 'drawio',
    runtimeVersion: version,
    target,
    managedRoot: root,
    platform: platform ?? null,
    sessions: [...sessions].sort(),
    generatedAt: now ?? null,
    currentState: canonicalize(currentState),
    releaseInputs: canonicalize(releaseInputs),
    artifacts,
    closure: {
      digest: closureDigest,
      artifactCount: closure.artifactCount,
      root: closure.root,
    },
    space: {
      downloadBytes: manifest.artifacts.drawioWebapp.downloadBytes + closureBytes,
      unpackedBytes:
        manifest.artifacts.drawioWebapp.unpackedBytes +
        manifest.artifacts.nextAiDrawioMcp.unpackedBytes,
    },
    policies: {
      userLevelOnly: true,
      atomicPublish: true,
      offlineOnly: true,
      automaticUpgrade: false,
      bindAddress: '127.0.0.1',
      releaseGate: manifest.audit.releaseGate,
    },
    mutations: action === 'uninstall'
      ? { removeRuntime: target, preserveDiagrams: true }
      : action === 'install' || action === 'upgrade' || action === 'reinstall'
        ? { publishRuntime: target, configurePlatforms: [] }
        : { configurePlatforms: platform ? [platform] : [] },
    reloadRequired: action === 'configure',
    approvalFreshness: { mode: 'state-bound-digest', warning: 'Approval remains valid only while the action, platform, affected sessions, and observed current state are unchanged.' },
    uninstallCommand: 'specline diagram plan --action uninstall --json',
  };

  return Object.freeze({
    ...plan,
    planDigest: digestPlan(plan),
  });
}

export function assertPlanApproval({
  plan,
  approvedPlanDigest,
  expectedAction,
  recomputedPlan,
} = {}) {
  if (!plan || typeof plan !== 'object') {
    throw new InstallPlanError('PLAN_REQUIRED', 'A current plan is required');
  }
  const { planDigest, ...unsigned } = plan;
  const actualDigest = digestPlan(unsigned);
  if (
    typeof approvedPlanDigest !== 'string' ||
    approvedPlanDigest.length !== 64 ||
    approvedPlanDigest !== planDigest ||
    actualDigest !== planDigest
  ) {
    throw new InstallPlanError(
      'PLAN_APPROVAL_REQUIRED',
      'Approval must match the exact current plan digest',
    );
  }
  if (expectedAction && plan.action !== expectedAction) {
    throw new InstallPlanError('PLAN_ACTION_MISMATCH', `Expected ${expectedAction} plan`);
  }
  if (recomputedPlan && recomputedPlan.planDigest !== planDigest) {
    throw new InstallPlanError(
      'PLAN_STALE',
      'The approved plan no longer matches current managed inputs',
    );
  }
  if (!recomputedPlan) {
    throw new InstallPlanError(
      'PLAN_CURRENT_STATE_REQUIRED',
      'The approved plan must be recomputed from current managed inputs',
    );
  }
  return plan;
}
