import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repo = resolve(import.meta.dirname, "../../..");
const cli = join(repo, "cli.mjs");
const fixture = process.env.SPECLINE_DIAGRAM_LOCAL_FIXTURE;

function command(args, cwd, env) {
  const result = spawnSync(process.execPath, [cli, "diagram", ...args, "--json"], {
    cwd, env, encoding: "utf8",
  });
  const json = JSON.parse(result.stdout);
  assert.equal(result.stdout.trim().split("\n").length, 1);
  return { ...result, json };
}

test("DGM-007-S2/DGM-014-S3: first configuration requires exactly one reload", {
  skip: fixture ? false : "set SPECLINE_DIAGRAM_LOCAL_FIXTURE to a verified local runtime fixture",
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "specline-reload-"));
  const home = join(root, "home");
  const project = join(root, "project");
  await cp(fixture, home, { recursive: true });
  await mkdir(project);
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    NO_PROXY: "127.0.0.1,localhost",
  };

  const plan = command(["plan", "--action", "configure", "--platform", "cursor"], project, env);
  const configured = command([
    "configure", "--platform", "cursor", "--approved-plan", plan.json.state.planDigest,
  ], project, env);
  assert.equal(configured.status, 0);
  assert.equal(configured.json.state.reloadState, "reload_required");

  const beforeReload = command(["doctor"], project, env);
  assert.equal(beforeReload.status, 0);
  assert.equal(beforeReload.json.state.reloadState, "reload_required");

  const reloaded = command(["doctor"], project, env);
  assert.equal(reloaded.status, 0);
  assert.ok(
    ["reloaded", "mcp_missing"].includes(reloaded.json.state.reloadState),
    "post-reload discovery must become reloaded or mcp_missing",
  );

  const stable = command(["doctor"], project, env);
  assert.notEqual(stable.json.state.reloadState, "reload_required");
  if (stable.json.state.reloadState === "mcp_missing") {
    assert.match(JSON.stringify(stable.json), /doctor|recover|revers|ASCII/i);
  }
});
