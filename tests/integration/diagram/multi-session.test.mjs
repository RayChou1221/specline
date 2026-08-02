import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp } from "node:fs/promises";
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

test("DGM-011-S1/S2: sessions are isolated and stop-all requires exact consent", {
  skip: fixture ? false : "set SPECLINE_DIAGRAM_LOCAL_FIXTURE to a verified local runtime fixture",
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "specline-multi-"));
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

  const one = run(["start", "--project", project, "--slug", "session-one"], project, env);
  const two = run(["start", "--project", project, "--slug", "session-two"], project, env);
  assert.equal(one.status, 0);
  assert.equal(two.status, 0);
  assert.notEqual(one.body.state.sessionId, two.body.state.sessionId);
  assert.notEqual(new URL(one.body.state.uiUrl).port, new URL(two.body.state.uiUrl).port);

  const stopOne = run(["stop", "--session", one.body.state.sessionId, "--mode", "discard"], project, env);
  assert.equal(stopOne.status, 0);
  const twoStillActive = run(["status", "--session", two.body.state.sessionId], project, env);
  assert.equal(twoStillActive.status, 0);
  assert.notEqual(twoStillActive.body.state.sessionState, "stopped");

  const three = run(["start", "--project", project, "--slug", "session-three"], project, env);
  assert.equal(three.status, 0);
  const denied = run(["stop-all"], project, env);
  assert.equal(denied.status, 3);
  for (const id of [two.body.state.sessionId, three.body.state.sessionId]) {
    assert.notEqual(run(["status", "--session", id], project, env).body.state.sessionState, "stopped");
  }

  const plan = run(["plan", "--action", "stop-all"], project, env);
  assert.equal(plan.status, 0);
  const plannedIds = plan.body.state.sessions.map((session) => session.sessionId).sort();
  assert.deepEqual(plannedIds, [two.body.state.sessionId, three.body.state.sessionId].sort());
  const stopped = run(["stop-all", "--approved-plan", plan.body.state.planDigest], project, env);
  assert.equal(stopped.status, 0);
});

test("DGM-005-S1: status never leaks sessions from another isolated project", {
  skip: fixture ? false : "set SPECLINE_DIAGRAM_LOCAL_FIXTURE to a verified local runtime fixture",
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "specline-project-isolation-"));
  const home = join(root, "home");
  const projectA = join(root, "a");
  const projectB = join(root, "b");
  await cp(fixture, home, { recursive: true });
  await mkdir(projectA);
  await mkdir(projectB);
  const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, ".config") };
  const started = run(["start", "--project", projectA, "--slug", "private-a"], projectA, env);
  assert.equal(started.status, 0);
  const listed = run(["status"], projectB, env);
  assert.doesNotMatch(JSON.stringify(listed.body), new RegExp(started.body.state.sessionId));
});
