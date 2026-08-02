import assert from "node:assert/strict";
import { mkdtemp, cp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repo = resolve(import.meta.dirname, "../../..");
const cli = join(repo, "cli.mjs");
const fixture = process.env.SPECLINE_DIAGRAM_LOCAL_FIXTURE;
const configFixtures = process.env.SPECLINE_DIAGRAM_CONFIG_FIXTURES;
const platforms = ["cursor", "claude", "codex", "opencode"];

async function isolated(platform) {
  const root = await mkdtemp(join(tmpdir(), `specline-${platform}-`));
  const home = join(root, "home");
  const project = join(root, "project");
  await cp(fixture, home, { recursive: true });
  await import("node:fs/promises").then(({ mkdir }) => mkdir(project, { recursive: true }));
  return {
    home,
    project,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      SPECLINE_DIAGRAM_TEST_PROJECT: project,
      NO_PROXY: "127.0.0.1,localhost",
    },
  };
}

function run(args, cwd, env) {
  const result = spawnSync(process.execPath, [cli, "diagram", ...args, "--json"], {
    cwd,
    env,
    encoding: "utf8",
  });
  let body;
  assert.doesNotThrow(() => { body = JSON.parse(result.stdout); }, result.stderr || result.stdout);
  assert.equal(result.stdout.trim().split("\n").length, 1, "JSON stdout must contain one object");
  return { ...result, body };
}

async function snapshot(root, prefix = "") {
  const result = {};
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const relative = join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(result, await snapshot(join(root, entry.name), relative));
    else result[relative] = await readFile(join(root, entry.name), "utf8");
  }
  return result;
}

for (const platform of platforms) {
  test(`DGM-006 ${platform}: isolated permission, idempotence, preservation, and reversible removal`, {
    skip: fixture ? false : "set SPECLINE_DIAGRAM_LOCAL_FIXTURE to a verified local runtime fixture",
  }, async () => {
    const ctx = await isolated(platform);
    const before = await snapshot(ctx.home);
    const plan = run(["plan", "--action", "configure", "--platform", platform], ctx.project, ctx.env);
    assert.equal(plan.status, 0);
    assert.equal(plan.body.ok, true);
    assert.match(plan.body.state.planDigest, /\S+/);

    const denied = run(["configure", "--platform", platform], ctx.project, ctx.env);
    assert.equal(denied.status, 3);
    assert.deepEqual(await snapshot(ctx.home), before, "missing consent must make zero writes");

    const configured = run([
      "configure", "--platform", platform, "--approved-plan", plan.body.state.planDigest,
    ], ctx.project, ctx.env);
    assert.equal(configured.status, 0);
    assert.equal(configured.body.state.reloadState, "reload_required");
    const once = await snapshot(ctx.home);

    const repeatPlan = run(["plan", "--action", "configure", "--platform", platform], ctx.project, ctx.env);
    const repeated = run([
      "configure", "--platform", platform, "--approved-plan", repeatPlan.body.state.planDigest,
    ], ctx.project, ctx.env);
    assert.equal(repeated.status, 0);
    assert.deepEqual(await snapshot(ctx.home), once, "configuration must be idempotent");

    const uninstallPlan = run(["plan", "--action", "uninstall", "--platform", platform], ctx.project, ctx.env);
    const removed = run(["uninstall", "--approved-plan", uninstallPlan.body.state.planDigest], ctx.project, ctx.env);
    assert.equal(removed.status, 0);
    const after = await snapshot(ctx.home);
    for (const [path, contents] of Object.entries(before)) {
      assert.equal(after[path], contents, `unrelated fixture content changed: ${path}`);
    }
  });

  for (const scenario of ["same-name-conflict", "malformed"]) {
    test(`DGM-006 ${platform}: ${scenario} fixture is rejected with zero writes`, {
      skip: configFixtures ? false : "set SPECLINE_DIAGRAM_CONFIG_FIXTURES to local matrix fixtures",
    }, async () => {
      const scenarioFixture = join(configFixtures, platform, scenario);
      const root = await mkdtemp(join(tmpdir(), `specline-${platform}-${scenario}-`));
      const home = join(root, "home");
      const project = join(root, "project");
      await cp(scenarioFixture, home, { recursive: true });
      await import("node:fs/promises").then(({ mkdir }) => mkdir(project, { recursive: true }));
      const env = {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: join(home, ".config"),
        NO_PROXY: "127.0.0.1,localhost",
      };
      const before = await snapshot(home);
      const plan = run(["plan", "--action", "configure", "--platform", platform], project, env);
      if (plan.status === 0) {
        const configured = run([
          "configure", "--platform", platform, "--approved-plan", plan.body.state.planDigest,
        ], project, env);
        assert.equal(configured.status, 5);
      } else {
        assert.equal(plan.status, 5);
      }
      assert.deepEqual(await snapshot(home), before);
    });
  }
}

test("DGM-007-S1: configuring one platform does not modify other platform homes", {
  skip: fixture ? false : "set SPECLINE_DIAGRAM_LOCAL_FIXTURE to a verified local runtime fixture",
}, async () => {
  const ctx = await isolated("cursor-only");
  const plan = run(["plan", "--action", "configure", "--platform", "cursor"], ctx.project, ctx.env);
  const result = run([
    "configure", "--platform", "cursor", "--approved-plan", plan.body.state.planDigest,
  ], ctx.project, ctx.env);
  assert.equal(result.status, 0);
  assert.ok(
    !result.body.state.configuredPlatforms ||
      result.body.state.configuredPlatforms.every((value) => value === "cursor"),
    "unapproved platforms must not be configured",
  );
});
