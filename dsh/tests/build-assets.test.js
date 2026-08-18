import { after, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ASSET_PERSONAS_DIR,
  ASSET_SKILLS_DIR,
  SKIP_SKILL_DIRS,
  buildAssets,
  resolveAssetsDir,
  resolveCoreDir,
} from '../lib/build-assets.js';

const DSH_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(DSH_ROOT, '..');
const CLI_FILE = join(DSH_ROOT, 'lib', 'build-assets.js');
const PKG_JSON = join(DSH_ROOT, 'package.json');
const REAL_CORE = join(REPO_ROOT, 'core');

const tempRoots = [];

after(() => {
  for (const dir of tempRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function makeFixtureCore() {
  const coreDir = join(makeTempDir('dsh-core-fixture-'), 'core');
  writeFile(
    join(coreDir, 'skills', 'specline-pipeline', 'SKILL.md'),
    [
      '{{DISPATCH}}，role="specline-spec-creator"',
      '{{CONFIRM}}',
      '{{LINT}}',
      '',
    ].join('\n'),
  );
  writeFile(
    join(coreDir, 'skills', 'specline-pipeline', 'extra.txt'),
    'SIDECAR_OK\n',
  );
  writeFile(
    join(coreDir, 'skills', 'frontend-design', 'SKILL.md'),
    [
      '---',
      'name: frontend-design',
      '---',
      '',
      '# Frontend Design',
      'FIXTURE_DESIGN_BODY',
      '',
    ].join('\n'),
  );
  writeFile(
    join(coreDir, 'agents', 'specline-spec-creator.yaml'),
    [
      'name: specline-spec-creator',
      'description: spec',
      'instructions: |',
      '  PERSONA_SPEC_CREATOR',
      '',
    ].join('\n'),
  );
  writeFile(
    join(coreDir, 'agents', 'specline-frontend-dev.yaml'),
    [
      'name: specline-frontend-dev',
      'description: frontend',
      'instructions: |',
      '  PERSONA_FRONTEND',
      '',
    ].join('\n'),
  );
  return coreDir;
}

function assertNoDshPlaceholders(content, label) {
  assert.doesNotMatch(content, /\{\{DISPATCH\}\}/, `${label} still has {{DISPATCH}}`);
  assert.doesNotMatch(content, /\{\{CONFIRM\}\}/, `${label} still has {{CONFIRM}}`);
  assert.doesNotMatch(content, /\{\{LINT\}\}/, `${label} still has {{LINT}}`);
}

describe('package build hooks', () => {
  it('runs tsc then the compiled build-assets CLI in build and prepublishOnly', () => {
    const pkg = JSON.parse(readFileSync(PKG_JSON, 'utf8'));
    for (const name of ['build', 'prepublishOnly']) {
      assert.match(pkg.scripts[name], /tsc/);
      assert.match(pkg.scripts[name], /lib\/build-assets\.js/);
      const tscIndex = pkg.scripts[name].indexOf('tsc');
      const bakeIndex = pkg.scripts[name].indexOf('lib/build-assets.js');
      assert.equal(tscIndex >= 0 && bakeIndex > tscIndex, true, `${name} must compile before bake`);
    }
  });
});

describe('resolveCoreDir', () => {
  it('finds repo core from dsh/src, dsh/, and repo root', () => {
    assert.equal(existsSync(join(REAL_CORE, 'skills')), true);
    assert.equal(existsSync(join(REAL_CORE, 'agents')), true);
    const fromSrc = resolveCoreDir({ fromDir: join(DSH_ROOT, 'src'), cwd: DSH_ROOT });
    const fromDshCwd = resolveCoreDir({ cwd: DSH_ROOT });
    const fromRepoCwd = resolveCoreDir({ cwd: REPO_ROOT });
    assert.equal(resolve(fromSrc), REAL_CORE);
    assert.equal(resolve(fromDshCwd), REAL_CORE);
    assert.equal(resolve(fromRepoCwd), REAL_CORE);
  });
});

describe('buildAssets with a temp core fixture', () => {
  it('writes baked skills and personas without DISPATCH placeholders', () => {
    const coreDir = makeFixtureCore();
    const outDir = join(makeTempDir('dsh-assets-out-'), 'assets');
    const result = buildAssets({ coreDir, outDir });

    const skillPath = join(outDir, ASSET_SKILLS_DIR, 'specline-pipeline', 'SKILL.md');
    const sidecarPath = join(outDir, ASSET_SKILLS_DIR, 'specline-pipeline', 'extra.txt');
    const specPersona = join(outDir, ASSET_PERSONAS_DIR, 'specline_spec_creator.md');
    const fePersona = join(outDir, ASSET_PERSONAS_DIR, 'specline_frontend_dev.md');

    assert.equal(existsSync(skillPath), true);
    assert.equal(existsSync(sidecarPath), true);
    assert.equal(existsSync(specPersona), true);
    assert.equal(existsSync(fePersona), true);
    assert.equal(
      existsSync(join(outDir, ASSET_SKILLS_DIR, 'frontend-design', 'SKILL.md')),
      false,
    );
    assert.equal(SKIP_SKILL_DIRS.has('frontend-design'), true);

    const skill = readFileSync(skillPath, 'utf8');
    assert.match(skill, /specline_spec_creator/);
    assert.doesNotMatch(skill, /role="specline-spec-creator"/);
    assertNoDshPlaceholders(skill, 'fixture skill');
    assert.match(readFileSync(sidecarPath, 'utf8'), /SIDECAR_OK/);
    assert.match(readFileSync(specPersona, 'utf8'), /PERSONA_SPEC_CREATOR/);

    const persona = readFileSync(fePersona, 'utf8');
    assert.match(persona, /PERSONA_FRONTEND/);
    assert.match(persona, /FIXTURE_DESIGN_BODY/);
    assert.doesNotMatch(persona, /^---$/m);

    assert.equal(result.outDir, resolve(outDir));
    assert.equal(result.coreDir, resolve(coreDir));
    assert.equal(result.skills.includes('specline-pipeline/SKILL.md'), true);
    assert.equal(result.personas.includes('specline_spec_creator.md'), true);
    assert.equal(result.personas.includes('specline_frontend_dev.md'), true);
  });
});

describe('buildAssets against repo core', () => {
  it('bakes slash skills and specline_* personas into a tmp assets dir', () => {
    const outDir = join(makeTempDir('dsh-assets-real-'), 'assets');
    const result = buildAssets({ coreDir: REAL_CORE, outDir });

    const pipeline = join(outDir, ASSET_SKILLS_DIR, 'specline-pipeline', 'SKILL.md');
    assert.equal(existsSync(pipeline), true);
    const pipelineBody = readFileSync(pipeline, 'utf8');
    assert.match(pipelineBody, /specline_spec_creator/);
    assertNoDshPlaceholders(pipelineBody, 'repo pipeline skill');
    assert.doesNotMatch(pipelineBody, /role="specline-spec-creator"/);

    for (const id of [
      'pipeline',
      'quickfix',
      'explore',
      'knowledge',
      'propose',
      'apply-change',
      'archive-change',
      'visualize',
      'diagram',
      'init-web',
    ]) {
      assert.equal(
        existsSync(join(outDir, ASSET_SKILLS_DIR, `specline-${id}`, 'SKILL.md')),
        true,
        `missing baked skill specline-${id}`,
      );
    }
    assert.equal(
      existsSync(join(outDir, ASSET_SKILLS_DIR, 'frontend-design', 'SKILL.md')),
      false,
    );

    const fePersona = readFileSync(
      join(outDir, ASSET_PERSONAS_DIR, 'specline_frontend_dev.md'),
      'utf8',
    );
    assert.match(fePersona, /Canonical frontend-design/);
    assert.equal(result.personas.includes('specline_spec_creator.md'), true);
    assert.equal(result.skills.length >= 10, true);
    assert.equal(result.personas.length, 10);
  });
});

describe('build-assets CLI', () => {
  it('runs from dsh/ or repo root and locates core', () => {
    const coreDir = makeFixtureCore();
    const outFromDsh = join(makeTempDir('dsh-cli-dsh-'), 'assets');
    const outFromRepo = join(makeTempDir('dsh-cli-repo-'), 'assets');

    const fromDsh = spawnSync(
      process.execPath,
      [CLI_FILE, '--core', coreDir, '--out', outFromDsh],
      { cwd: DSH_ROOT, encoding: 'utf8' },
    );
    assert.equal(fromDsh.status, 0, fromDsh.stderr || fromDsh.stdout);
    assert.equal(existsSync(join(outFromDsh, ASSET_SKILLS_DIR, 'specline-pipeline', 'SKILL.md')), true);

    const fromRepo = spawnSync(
      process.execPath,
      [CLI_FILE, '--core', coreDir, '--out', outFromRepo],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    assert.equal(fromRepo.status, 0, fromRepo.stderr || fromRepo.stdout);
    const baked = readFileSync(
      join(outFromRepo, ASSET_SKILLS_DIR, 'specline-pipeline', 'SKILL.md'),
      'utf8',
    );
    assert.match(baked, /specline_spec_creator/);
    assertNoDshPlaceholders(baked, 'CLI-baked skill');
  });

  it('default assets dir is dsh/assets', () => {
    assert.equal(resolveAssetsDir(), join(DSH_ROOT, 'assets'));
  });
});
