import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repo = resolve(import.meta.dirname, "../../..");
const cli = join(repo, "cli.mjs");
const fixture = process.env.SPECLINE_DIAGRAM_LOCAL_FIXTURE;
const uiDriver = process.env.SPECLINE_DIAGRAM_UI_DRIVER;

function run(args, cwd, env) {
  const result = spawnSync(process.execPath, [cli, "diagram", ...args, "--json"], {
    cwd, env, encoding: "utf8",
  });
  return { ...result, body: JSON.parse(result.stdout) };
}

test("DGM-009-S1/S2: local UI edit roundtrip wins revision race and exports SVG", {
  skip: fixture && uiDriver ? false : "set local runtime fixture and local UI driver",
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "specline-roundtrip-"));
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
  const started = run(["start", "--project", project, "--slug", "ui-roundtrip"], project, env);
  assert.equal(started.status, 0);
  const { sessionId, uiUrl, revision } = started.body.state;
  assert.match(uiUrl, /^http:\/\/127\.0\.0\.1:/);

  const driven = spawnSync(process.execPath, [
    uiDriver,
    "--ui-url", uiUrl,
    "--session", sessionId,
    "--base-revision", revision,
    "--edit-label", "edited-locally",
    "--export", "svg",
  ], { cwd: project, env, encoding: "utf8" });
  assert.equal(driven.status, 0, driven.stderr);
  const result = JSON.parse(driven.stdout);
  assert.equal(result.sessionId, sessionId);
  assert.notEqual(result.revision, revision);
  assert.equal(result.dirty, false);
  assert.match(result.exportRelativePath, /^specline\/diagrams\/ui-roundtrip\/ui-roundtrip\.svg$/);

  const status = run(["status", "--session", sessionId], project, env);
  assert.equal(status.body.state.revision, result.revision);
});

test("DGM-009-S3: stale UI revision fails closed instead of claiming saved", {
  skip: fixture && uiDriver ? false : "set local runtime fixture and local UI driver",
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "specline-conflict-"));
  const home = join(root, "home");
  const project = join(root, "project");
  await cp(fixture, home, { recursive: true });
  await mkdir(project);
  const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, ".config") };
  const started = run(["start", "--project", project, "--slug", "revision-conflict"], project, env);
  const driven = spawnSync(process.execPath, [
    uiDriver,
    "--ui-url", started.body.state.uiUrl,
    "--session", started.body.state.sessionId,
    "--base-revision", "stale-revision",
    "--expect-conflict",
  ], { cwd: project, env, encoding: "utf8" });
  assert.equal(driven.status, 0, driven.stderr);
  const result = JSON.parse(driven.stdout);
  assert.equal(result.httpStatus, 409);
  assert.equal(result.code, "REVISION_CONFLICT");
  assert.notEqual(result.saved, true);
});

test("DGM-011-S1: unauthenticated and cross-session bridge calls are rejected", {
  skip: fixture ? false : "set SPECLINE_DIAGRAM_LOCAL_FIXTURE to a verified local runtime fixture",
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "specline-ui-auth-"));
  const home = join(root, "home");
  const project = join(root, "project");
  await cp(fixture, home, { recursive: true });
  await mkdir(project);
  const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, ".config") };
  const started = run(["start", "--project", project, "--slug", "ui-auth"], project, env);
  const endpoint = new URL(`api/sessions/${started.body.state.sessionId}/state`, started.body.state.uiUrl);
  const unauthorized = await fetch(endpoint, {
    method: "PUT",
    headers: { "content-type": "application/json", origin: new URL(started.body.state.uiUrl).origin },
    body: JSON.stringify({ baseRevision: started.body.state.revision, xml: "<mxfile/>" }),
  });
  assert.ok([401, 403].includes(unauthorized.status));
  assert.doesNotMatch(JSON.stringify(started.body), /bearer|token/i);
});
