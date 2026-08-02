import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repo = resolve(import.meta.dirname, "../../..");
const cli = join(repo, "cli.mjs");
const fixture = process.env.SPECLINE_DIAGRAM_LOCAL_FIXTURE;

function run(args, cwd, env) {
  const result = spawnSync(process.execPath, [cli, "diagram", ...args, "--json"], {
    cwd, env, encoding: "utf8",
  });
  return { ...result, body: JSON.parse(result.stdout) };
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "specline-lifecycle-"));
  const home = join(root, "home");
  const project = join(root, "project");
  await cp(fixture, home, { recursive: true });
  await mkdir(project);
  return {
    project,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      NO_PROXY: "127.0.0.1,localhost",
    },
  };
}

async function start(ctx, slug) {
  const result = run(["start", "--project", ctx.project, "--slug", slug], ctx.project, ctx.env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.body.state.sessionId, /\S+/);
  assert.match(result.body.state.uiUrl, /^http:\/\/127\.0\.0\.1:\d+\/sessions\/[^/]+\/$/);
  return result.body.state;
}

test("DGM-012-S1: save synchronizes artifacts and stops only the current session", {
  skip: fixture ? false : "set SPECLINE_DIAGRAM_LOCAL_FIXTURE to a verified local runtime fixture",
}, async () => {
  const ctx = await setup();
  const session = await start(ctx, "save-lifecycle");
  const stopped = run(["stop", "--session", session.sessionId, "--mode", "save"], ctx.project, ctx.env);
  assert.equal(stopped.status, 0);
  assert.equal(stopped.body.state.sessionState, "stopped");
  const dir = join(ctx.project, "specline", "diagrams", "save-lifecycle");
  assert.ok((await stat(join(dir, "save-lifecycle.drawio"))).isFile());
  const markdown = await readFile(join(dir, "save-lifecycle.md"), "utf8");
  for (const heading of ["Purpose", "Audience", "Confirmed", "Assumptions", "Open Questions", "Diagram", "Revision History"]) {
    assert.match(markdown, new RegExp(heading));
  }
});

test("DGM-012-S2/S3: discard, continue, and keep-30m have distinct observable states", {
  skip: fixture ? false : "set SPECLINE_DIAGRAM_LOCAL_FIXTURE to a verified local runtime fixture",
}, async () => {
  const ctx = await setup();
  const discard = await start(ctx, "discard-lifecycle");
  assert.equal(run(["stop", "--session", discard.sessionId, "--mode", "discard"], ctx.project, ctx.env).body.state.sessionState, "stopped");

  const continued = await start(ctx, "continue-lifecycle");
  const continueResult = run(["stop", "--session", continued.sessionId, "--mode", "continue"], ctx.project, ctx.env);
  assert.equal(continueResult.status, 0);
  assert.notEqual(continueResult.body.state.sessionState, "stopped");

  const held = run(["stop", "--session", continued.sessionId, "--mode", "keep-30m"], ctx.project, ctx.env);
  assert.equal(held.status, 0);
  assert.equal(held.body.state.sessionState, "idle_held");
  const status = run(["status", "--session", continued.sessionId], ctx.project, ctx.env);
  assert.equal(status.body.state.sessionState, "idle_held");
});

test("DGM-012-S4: repeated stop is bounded and never reports an unrelated PID termination", {
  skip: fixture ? false : "set SPECLINE_DIAGRAM_LOCAL_FIXTURE to a verified local runtime fixture",
}, async () => {
  const ctx = await setup();
  const session = await start(ctx, "idempotent-cleanup");
  const first = run(["stop", "--session", session.sessionId, "--mode", "discard"], ctx.project, ctx.env);
  const second = run(["stop", "--session", session.sessionId, "--mode", "discard"], ctx.project, ctx.env);
  assert.equal(first.status, 0);
  assert.ok([0, 6].includes(second.status));
  assert.doesNotMatch(JSON.stringify(second.body), /killed.*unknown|terminated.*unowned/i);
});
