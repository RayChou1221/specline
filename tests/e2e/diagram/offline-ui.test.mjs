import assert from 'node:assert/strict';
import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repo = resolve(import.meta.dirname, '../../..');
const cli = resolve(repo, 'cli.mjs');
const fixture = process.env.SPECLINE_DIAGRAM_LOCAL_FIXTURE;
const uiDriver = process.env.SPECLINE_DIAGRAM_UI_DRIVER;
const project = process.env.SPECLINE_DIAGRAM_TRACE_PROJECT;
const traceDir = process.env.SPECLINE_DIAGRAM_TRACE_DIR;
const enabled = process.env.SPECLINE_DIAGRAM_RELEASE_TRACE === '1';
const runnable = enabled && [fixture, uiDriver, project, traceDir].every((value) => value && value.startsWith('/'));
const marker = `specline-manual-edit-${process.pid}-${Date.now()}`;

function run(args, env = process.env) {
  const result = spawnSync(process.execPath, [cli, 'diagram', ...args, '--json'], { cwd: project || repo, env, encoding: 'utf8' });
  return { ...result, body: JSON.parse(result.stdout) };
}
async function exists(file) { try { await access(file, constants.F_OK); return true; } catch { return false; } }
async function portOpen(port) { return new Promise((done) => { const socket = createConnection({ host: '127.0.0.1', port });
  socket.once('connect', () => { socket.destroy(); done(true); }); socket.once('error', () => done(false)); }); }

function validateIndependentEvidence(evidence, osEvidence) {
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.collector, 'independent-release-trace');
  assert.deepEqual(evidence.steps, ['create', 'manualEdit', 'sync', 'exportDrawio', 'exportSvg']);
  assert.ok(Array.isArray(evidence.cdp?.http));
  assert.ok(Array.isArray(evidence.cdp?.websocket));
  assert.ok(Array.isArray(evidence.cdp?.blocked));
  assert.equal(osEvidence.schemaVersion, 1);
  assert.equal(osEvidence.collector, 'independent-os-packet-capture');
  assert.ok(Array.isArray(osEvidence.dns));
  assert.ok(Array.isArray(osEvidence.packets));
  assert.equal(osEvidence.captureIndependentOfDriver, true);
  assert.equal(typeof osEvidence.command, 'string');
  assert.match(osEvidence.command, /tcpdump/);
  assert.match(osEvidence.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(osEvidence.endedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(Date.parse(osEvidence.endedAt) >= Date.parse(osEvidence.startedAt));
  assert.ok(Number.isSafeInteger(osEvidence.packetCount) && osEvidence.packetCount > 0);
  assert.equal(typeof osEvidence.rawEvidenceSha256, 'string');
  assert.match(osEvidence.rawEvidenceSha256, /^[a-f0-9]{64}$/);
  assert.ok(osEvidence.packets.length > 0, 'capture must include observed loopback packets');
  for (const record of [...evidence.cdp.http, ...evidence.cdp.websocket]) {
    assert.equal(new URL(record.url).hostname, '127.0.0.1', JSON.stringify(record));
  }
  for (const record of osEvidence.dns) assert.equal(record.nonLoopback, false, JSON.stringify(record));
  for (const record of osEvidence.packets) assert.equal(record.nonLoopback, false, JSON.stringify(record));
  const remoteBlocked = evidence.cdp.blocked.find((record) => record.url === 'https://app.diagrams.net/specline-release-trace-probe');
  assert.ok(remoteBlocked, 'CDP must independently observe the UI remote attempt as blocked');
  assert.equal(remoteBlocked.networkSent, false);
  assert.match(remoteBlocked.errorText, /blocked|failed|denied|not allowed/i);
  assert.equal(evidence.remoteAttempt?.source, 'actual-session-ui-trace');
  assert.equal(evidence.remoteAttempt?.code, 'REMOTE_ACCESS_BLOCKED');
  assert.equal(evidence.remoteAttempt?.fellBack, false);
}

test('DGM-002/DGM-016: independently captured complete release trace is loopback-only', {
  skip: runnable ? false : 'not_verified: require explicit release-trace gate plus absolute fixture/project/trace-dir/driver',
}, async () => {
  const env = { ...process.env, SPECLINE_DIAGRAM_RELEASE_TRACE: '1' };
  let started;
  try {
    started = run(['release-trace', '--fixture', fixture, '--project', project, '--trace-dir', traceDir, '--driver', uiDriver, '--slug', 'offline-ui'], env);
    assert.equal(started.status, 0, started.stderr);
    assert.match(started.body.state.uiUrl, /^http:\/\/127\.0\.0\.1:\d+\/sessions\/[^/]+\/$/);
    assert.doesNotMatch(started.body.state.uiUrl, /localhost|\[?::1\]?/);

    const driven = spawnSync(uiDriver, ['--protocol', 'specline-release-trace-v1', '--ui-url', started.body.state.uiUrl,
      '--session', started.body.state.sessionId, '--project', project, '--trace-dir', traceDir, '--manual-edit-marker', marker],
    { cwd: project, env, encoding: 'utf8' });
    assert.equal(driven.status, 0, driven.stderr);
    const protocol = JSON.parse(driven.stdout);
    assert.equal(protocol.schemaVersion, 1);
    assert.equal(protocol.sessionId, started.body.state.sessionId);
    assert.equal(protocol.evidenceFile.startsWith(`${traceDir}/`), true);
    assert.equal(protocol.osEvidenceFile.startsWith(`${traceDir}/`), true);
    const evidence = JSON.parse(await readFile(protocol.evidenceFile, 'utf8'));
    const osEvidence = JSON.parse(await readFile(protocol.osEvidenceFile, 'utf8'));
    validateIndependentEvidence(evidence, osEvidence);

    const drawio = resolve(project, 'specline/diagrams/offline-ui/offline-ui.drawio');
    const svg = resolve(project, 'specline/diagrams/offline-ui/offline-ui.svg');
    for (const file of [drawio, svg]) { assert.equal(await exists(file), true, file); assert.ok((await stat(file)).isFile()); assert.equal(file.startsWith(`${resolve(project, 'specline/diagrams')}/`), true); }
    const xml = await readFile(drawio, 'utf8'); const svgText = await readFile(svg, 'utf8');
    assert.match(xml, /^<mxfile[\s>]/); assert.match(xml, new RegExp(marker));
    assert.match(svgText, /^<svg[\s>]/); assert.match(svgText, new RegExp(marker));
  } finally {
    if (started?.body?.state?.sessionId) {
      const stopped = run(['stop', '--trace-dir', traceDir, '--session', started.body.state.sessionId], env);
      assert.equal(stopped.status, 0, stopped.stderr);
      assert.equal(stopped.body.state.pidExited, true);
      assert.equal(stopped.body.state.portClosed, true);
      assert.equal(stopped.body.state.daemonRemaining, false);
      assert.equal(await portOpen(started.body.state.port), false);
    }
  }
});

test('release-trace channel fails closed without every explicit guard and absolute input', () => {
  const result = run(['release-trace', '--fixture', fixture || '.', '--project', project || '.', '--trace-dir', traceDir || '.', '--driver', uiDriver || '.'], { ...process.env, SPECLINE_DIAGRAM_RELEASE_TRACE: '0' });
  assert.notEqual(result.status, 0);
  assert.equal(result.body.ok, false);
  assert.ok(['RELEASE_GATE_BLOCKED', 'INVALID_ARGUMENT'].includes(result.body.code));
});
