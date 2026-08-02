import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runDiagramCommand } from '../../../lib/diagram.mjs';

const packageRoot = path.resolve(import.meta.dirname, '../../..');

async function blockedPackageRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'specline-diagram-blocked-'));
  for (const name of ['cli.mjs', 'package.json', 'README.md', 'LICENSE', 'lib', 'core', 'adapters', 'templates']) {
    await cp(path.join(packageRoot, name), path.join(root, name), { recursive: true });
  }
  await mkdir(path.join(root, 'docs/knowledge/howtos'), { recursive: true });
  await cp(path.join(packageRoot, 'docs/diagram-runtime.md'), path.join(root, 'docs/diagram-runtime.md'));
  await cp(
    path.join(packageRoot, 'docs/knowledge/howtos/local-drawio-diagrams.md'),
    path.join(root, 'docs/knowledge/howtos/local-drawio-diagrams.md'),
  );
  const manifestPath = path.join(root, 'core/runtimes/drawio/manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.audit.releaseGate = false;
  manifest.audit.releaseVerificationState = 'pending';
  delete manifest.offlineTrace;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return root;
}

test('release gate fails closed across public mutation paths when verification is incomplete', async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'specline-diagram-home-'));
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'specline-diagram-project-'));
  const blockedRoot = await blockedPackageRoot();
  for (const args of [
    ['plan','--action','install','--json'], ['install','--approved-plan','a'.repeat(64),'--json'],
    ['configure','--platform','cursor','--approved-plan','a'.repeat(64),'--json'], ['start','--project',projectRoot,'--slug','sample','--json'],
    ['stop-all','--approved-plan','a'.repeat(64),'--json'], ['uninstall','--approved-plan','a'.repeat(64),'--json'], ['mcp','--stdio'],
  ]) {
    const result = await runDiagramCommand(args, { packageRoot: blockedRoot, homeDir, projectRoot });
    assert.equal(result.exitCode, 4, args.join(' ')); assert.equal(result.body.code, 'RELEASE_GATE_BLOCKED');
  }
});

test('verified release allows read-only install planning', async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'specline-diagram-home-'));
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'specline-diagram-project-'));
  const result = await runDiagramCommand(['plan','--action','install','--json'], { packageRoot, homeDir, projectRoot });
  assert.equal(result.exitCode, 0);
  assert.equal(result.body.code, 'PLAN_READY');
  assert.equal(result.body.state.releaseAllowed, true);
  assert.match(result.body.state.planDigest, /^[a-f0-9]{64}$/);
});

test('status filters persisted registry by project', async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'specline-diagram-home-'));
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'specline-diagram-project-'));
  const root = path.join(homeDir,'.specline','runtimes','drawio','sessions'); await mkdir(root,{recursive:true});
  await writeFile(path.join(root,'11111111-1111-1111-1111-111111111111.json'), JSON.stringify({sessionId:'11111111-1111-1111-1111-111111111111',projectRoot,sessionState:'active'}));
  await writeFile(path.join(root,'22222222-2222-2222-2222-222222222222.json'), JSON.stringify({sessionId:'22222222-2222-2222-2222-222222222222',projectRoot:'/other',sessionState:'active'}));
  const result=await runDiagramCommand(['status','--json'],{packageRoot,homeDir,projectRoot}); assert.equal(result.exitCode,0); assert.deepEqual(result.body.state.sessions.map(s=>s.sessionId),['11111111-1111-1111-1111-111111111111']);
});
