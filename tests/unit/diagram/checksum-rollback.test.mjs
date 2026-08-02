import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { IMMUTABLE_DEPENDENCY_CLOSURE } from '../../../lib/diagram/manifest.mjs';
import { createInstallPlan } from '../../../lib/diagram/install-plan.mjs';
import { createHash } from 'node:crypto';
import { installRuntime } from '../../../lib/diagram/installer.mjs';

const MANIFEST_PATH = new URL('../../../core/runtimes/drawio/manifest.json', import.meta.url);

const releaseRoot=new URL('../../../core/runtimes/drawio/',import.meta.url);
async function releaseInputs(){const names=['patches/launcher.mjs','LICENSE.drawio','LICENSE.next-ai-drawio','NOTICE.md'];const digests={};for(const name of names)digests[`core/runtimes/drawio/${name}`]=createHash('sha256').update(await fs.readFile(new URL(name,releaseRoot))).digest('hex');return {digests};}
async function setup(action = 'install') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'specline-installer-'));
  const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'));
  const plan = createInstallPlan({
    action,
    manifest,
    closure: IMMUTABLE_DEPENDENCY_CLOSURE,
    homeDir: root,
    releaseInputs: await releaseInputs(),
  });
  return { root, manifest, plan };
}

test('checksum failure removes staging and never publishes a runtime', async (t) => {
  const { root, manifest, plan } = await setup();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await assert.rejects(
    installRuntime({
      manifest,
      closure: IMMUTABLE_DEPENDENCY_CLOSURE,
      plan,
      approvedPlanDigest: plan.planDigest,
      recomputedPlan: plan,
      safetyStage: 'implementation-fixture',
      implementationFixtureRoot: root,
      download: async (_artifact, destination) => {
        await fs.writeFile(destination, 'wrong bytes');
      },
    }),
    { code: 'CHECKSUM_MISMATCH' },
  );

  assert.equal(await fs.stat(plan.target).then(() => true, () => false), false);
  const leftovers = await fs.readdir(plan.managedRoot);
  assert.deepEqual(leftovers.filter((entry) => entry.startsWith('.stage-')), []);
});

test('implementation fixture publishes only after complete layout verification', async (t) => {
  const { root, manifest, plan } = await setup();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await installRuntime({
    manifest,
    closure: IMMUTABLE_DEPENDENCY_CLOSURE,
    plan,
    approvedPlanDigest: plan.planDigest,
    recomputedPlan: plan,
    safetyStage: 'implementation-fixture',
    implementationFixtureRoot: root,
    releaseInputsRoot: new URL('../../../core/runtimes/drawio/', import.meta.url).pathname,
    idFactory: () => 'fixed',
    download: async (_artifact, destination) => {
      await fs.writeFile(destination, 'fixture');
    },
    verifyArtifact: async () => {},
    materialize: async ({ artifact, stage, pathImpl }) => {
      if (artifact.id === 'drawio-webapp') {
        const webapp = pathImpl.join(stage, 'webapp');
        await fs.mkdir(webapp, { recursive: true });
        await fs.writeFile(pathImpl.join(webapp, 'index.html'), '<!doctype html>');
        return;
      }
      const packageRoot = pathImpl.join(stage, 'mcp', artifact.id);
      await fs.mkdir(packageRoot, { recursive: true });
      const closureArtifact = IMMUTABLE_DEPENDENCY_CLOSURE.artifacts.find(
        (candidate) => candidate.path === artifact.id,
      );
      await fs.writeFile(
        pathImpl.join(packageRoot, 'package.json'),
        JSON.stringify({
          name: closureArtifact.name,
          version: closureArtifact.version,
          dependencies: Object.fromEntries(
            Object.keys(closureArtifact.dependencies).map((name) => [name, 'fixture']),
          ),
          peerDependenciesMeta: Object.fromEntries(
            closureArtifact.optionalPeers.map((name) => [name, { optional: true }]),
          ),
        }),
      );
      if (artifact.id === IMMUTABLE_DEPENDENCY_CLOSURE.root) {
        await fs.mkdir(pathImpl.join(packageRoot, 'dist'), { recursive: true });
        await fs.writeFile(pathImpl.join(packageRoot, 'dist', 'index.js'), 'export {};');
      }
    },
  });

  assert.equal(result.runtimeState, 'ready');
  assert.equal(result.automaticUpgrade, false);
  assert.equal(await fs.stat(path.join(plan.target, 'installation.json')).then(() => true), true);
  assert.deepEqual(
    (await fs.readdir(plan.target)).sort(),
    ['LICENSE.drawio', 'LICENSE.next-ai-drawio', 'NOTICE.md', 'installation.json', 'mcp', 'patches', 'webapp'],
  );
});
