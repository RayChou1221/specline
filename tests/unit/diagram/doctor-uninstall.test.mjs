import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { doctorRuntime } from '../../../lib/diagram/doctor.mjs';
import {
  IMMUTABLE_DEPENDENCY_CLOSURE,
  validateManagedManifest,
} from '../../../lib/diagram/manifest.mjs';
import {
  createInstallPlan,
  digestPlan,
} from '../../../lib/diagram/install-plan.mjs';
import { uninstallRuntime } from '../../../lib/diagram/uninstall.mjs';

const MANIFEST_PATH = new URL('../../../core/runtimes/drawio/manifest.json', import.meta.url);

async function installedFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'specline-doctor-'));
  const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'));
  const installPlan = createInstallPlan({
    action: 'install',
    manifest,
    closure: IMMUTABLE_DEPENDENCY_CLOSURE,
    homeDir: root,
  });
  const validation = validateManagedManifest({ manifest });
  await fs.mkdir(path.join(installPlan.target, 'webapp'), { recursive: true });
  await fs.mkdir(
    path.join(
      installPlan.target,
      'mcp',
      'node_modules',
      '@next-ai-drawio',
      'mcp-server',
      'dist',
    ),
    { recursive: true },
  );
  await fs.writeFile(path.join(installPlan.target, 'webapp', 'index.html'), '<!doctype html>');
  await fs.writeFile(
    path.join(
      installPlan.target,
      'mcp',
      'node_modules',
      '@next-ai-drawio',
      'mcp-server',
      'dist',
      'index.js',
    ),
    'export {};',
  );
  await fs.writeFile(
    path.join(installPlan.target, 'installation.json'),
    JSON.stringify({
      schemaVersion: 1,
      runtimeVersion: installPlan.runtimeVersion,
      manifestDigest: validation.manifestDigest,
      closureDigest: digestPlan(IMMUTABLE_DEPENDENCY_CLOSURE),
      artifactCount: IMMUTABLE_DEPENDENCY_CLOSURE.artifactCount,
      offlineVerified: true,
    releaseInputDigests: {},
    }),
  );
  return { root, manifest, installPlan };
}

test('doctor reports verified release, cleans only stale owned metadata, and never kills unknown PID', async (t) => {
  const { root, manifest, installPlan } = await installedFixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const staleStage = path.join(installPlan.managedRoot, '.stage-old');
  await fs.mkdir(staleStage);
  const old = new Date('2026-07-29T00:00:00.000Z');
  await fs.utimes(staleStage, old, old);
  const removedSessions = [];

  const result = await doctorRuntime({
    manifest,
    closure: IMMUTABLE_DEPENDENCY_CLOSURE,
    managedRoot: installPlan.managedRoot,
    repairStale: true,
    nowMs: Date.parse('2026-07-30T00:00:00.000Z'),
    sessionRecords: [
      {
        sessionId: 'dead',
        pid: 101,
        parentPid: 100,
        processStartTime: 'one',
      },
      {
        sessionId: 'unknown',
        pid: 201,
        parentPid: 200,
        processStartTime: 'two',
      },
    ],
    observeProcess: async (pid) => pid === 101 ? { alive: false } : null,
    removeSessionRecord: async (record) => removedSessions.push(record.sessionId),
  });

  assert.equal(result.runtimeState, 'ready');
  assert.equal(result.releaseVerificationState, 'verified');
  assert.deepEqual(removedSessions, ['dead']);
  assert.equal(result.sessions.find((item) => item.sessionId === 'unknown').removed, false);
  assert.equal(await fs.stat(staleStage).then(() => true, () => false), false);
});

test('approved uninstall removes only managed runtime and preserves diagrams', async (t) => {
  const { root, manifest } = await installedFixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const diagram = path.join(root, 'project', 'specline', 'diagrams', 'kept', 'kept.drawio');
  await fs.mkdir(path.dirname(diagram), { recursive: true });
  await fs.writeFile(diagram, '<mxfile/>');
  const plan = createInstallPlan({
    action: 'uninstall',
    manifest,
    closure: IMMUTABLE_DEPENDENCY_CLOSURE,
    homeDir: root,
  });

  const result = await uninstallRuntime({
    plan,
    approvedPlanDigest: plan.planDigest,
    recomputedPlan: plan,
    idFactory: () => 'fixed',
  });
  assert.equal(result.runtimeState, 'missing');
  assert.equal(result.diagramsPreserved, true);
  assert.equal(await fs.readFile(diagram, 'utf8'), '<mxfile/>');
  assert.equal(await fs.stat(plan.target).then(() => true, () => false), false);
});

test('uninstall rolls runtime back when managed configuration removal fails', async (t) => {
  const { root, manifest } = await installedFixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const plan = createInstallPlan({
    action: 'uninstall',
    manifest,
    closure: IMMUTABLE_DEPENDENCY_CLOSURE,
    homeDir: root,
  });

  await assert.rejects(
    uninstallRuntime({
      plan,
      approvedPlanDigest: plan.planDigest,
      recomputedPlan: plan,
      idFactory: () => 'rollback',
      removeManagedConfiguration: async () => {
        throw new Error('fixture failure');
      },
    }),
    { code: 'UNINSTALL_FAILED' },
  );
  assert.equal(await fs.stat(plan.target).then(() => true, () => false), true);
});


test('uninstall exposes partial failure and preserves tombstone when rollback fails', async (t) => {
  const { root, manifest } = await installedFixture();t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const plan=createInstallPlan({action:'uninstall',manifest,closure:IMMUTABLE_DEPENDENCY_CLOSURE,homeDir:root});
  const realFs={...fs,rm:async(file,options)=>{if(String(file).includes('.uninstall-'))throw new Error('tombstone delete failed');return fs.rm(file,options);},rename:async(from,to)=>{if(String(from).includes('.uninstall-'))throw new Error('runtime rollback failed');return fs.rename(from,to);}};
  let error;try{await uninstallRuntime({plan,approvedPlanDigest:plan.planDigest,recomputedPlan:plan,idFactory:()=> 'partial',fsImpl:realFs,removeManagedConfiguration:async()=>({removed:['cursor'],rollback:async()=>{throw new Error('config rollback failed')}})});}catch(value){error=value;}
  assert.equal(error?.code,'UNINSTALL_PARTIAL_FAILURE');assert.equal(error.state.manualRecoveryRequired,true);assert.equal(error.state.recovery.runtimeRestored,false);assert.equal(error.state.recovery.configurationRestored,false);assert.match(error.state.recovery.tombstone,/\.uninstall-partial$/);assert.equal(await fs.stat(error.state.recovery.tombstone).then(()=>true,()=>false),true);
});
