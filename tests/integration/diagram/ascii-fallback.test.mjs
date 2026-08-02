import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repo = resolve(import.meta.dirname, "../../..");
const cli = join(repo, "cli.mjs");

function run(args, cwd, env) {
  const result = spawnSync(process.execPath, [cli, "diagram", ...args, "--json"], {
    cwd, env, encoding: "utf8",
  });
  let body;
  assert.doesNotThrow(() => { body = JSON.parse(result.stdout); }, result.stderr || result.stdout);
  return { ...result, body };
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

test("DGM-003-S1/S2 and DGM-014: missing runtime is recoverable with no install or config side effects", async () => {
  const root = await mkdtemp(join(tmpdir(), "specline-fallback-"));
  const home = join(root, "home");
  const project = join(root, "project");
  await mkdir(home);
  await mkdir(project);
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    HTTP_PROXY: "http://127.0.0.1:9",
    HTTPS_PROXY: "http://127.0.0.1:9",
    NO_PROXY: "127.0.0.1,localhost",
  };

  const result = run(["start", "--project", project, "--slug", "fallback-only"], project, env);
  assert.equal(result.status, 4);
  assert.equal(result.body.ok, false);
  assert.ok(["missing", "blocked", "corrupt", "version_mismatch"].includes(result.body.state.runtimeState));
  assert.match(JSON.stringify(result.body), /recover|ASCII|plan|doctor/i);
  assert.equal(await exists(join(home, ".specline", "runtimes", "drawio")), false);
  assert.equal(await exists(join(project, "specline", "diagrams")), false);
  assert.deepEqual(await readdir(home), []);
});

test("DGM-003-S3: unapproved or stale digest cannot mutate isolated state", async () => {
  const root = await mkdtemp(join(tmpdir(), "specline-stale-plan-"));
  const home = join(root, "home");
  const project = join(root, "project");
  await mkdir(home);
  await mkdir(project);
  const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, ".config") };
  const result = run(["install", "--approved-plan", "stale-local-fixture-digest"], project, env);
  assert.equal(result.status, 3);
  assert.equal(result.body.ok, false);
  assert.equal(await exists(join(home, ".specline", "runtimes", "drawio")), false);
});

test("DGM-014-S2: invalid local UI startup never advertises wildcard or remote fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "specline-no-remote-"));
  const home = join(root, "home");
  const project = join(root, "project");
  await mkdir(home);
  await mkdir(project);
  const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, ".config") };
  const result = run(["start", "--project", project, "--slug", "no-remote-fallback"], project, env);
  assert.equal(result.status, 4);
  const output = JSON.stringify(result.body);
  assert.doesNotMatch(output, /0\.0\.0\.0|app\.diagrams\.net|embed\.diagrams\.net/);
});
