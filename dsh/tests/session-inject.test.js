import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRE_STEP_HOOK,
  SESSION_START_HOOK,
  createSessionInjectTracker,
  shouldInjectOrchestrator,
} from '../lib/session-inject.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'session-inject.ts');

describe('shouldInjectOrchestrator', () => {
  it('is true only for an empty parent session', () => {
    assert.equal(shouldInjectOrchestrator(undefined), true);
    assert.equal(shouldInjectOrchestrator(null), true);
    assert.equal(shouldInjectOrchestrator(''), true);
    assert.equal(shouldInjectOrchestrator('parent-sess'), false);
    assert.equal(shouldInjectOrchestrator('0'), false);
  });
});

describe('native session inject hooks', () => {
  it('prefers agent/session-start when it catches the first packet', () => {
    const tracker = createSessionInjectTracker();
    const inject = tracker.handle({
      hook: SESSION_START_HOOK,
      sessionId: 'sess-1',
      parentSession: null,
    });
    assert.equal(SESSION_START_HOOK, 'agent/session-start');
    assert.equal(inject, true);
    assert.equal(
      tracker.handle({
        hook: PRE_STEP_HOOK,
        sessionId: 'sess-1',
        parentSession: null,
      }),
      false,
    );
  });

  it('falls back to the session first agent/pre-step when session-start misses the first packet', () => {
    const tracker = createSessionInjectTracker();
    assert.equal(PRE_STEP_HOOK, 'agent/pre-step');
    assert.equal(
      tracker.handle({
        hook: SESSION_START_HOOK,
        sessionId: 'sess-late',
        parentSession: undefined,
        missedFirstPacket: true,
      }),
      false,
    );
    assert.equal(
      tracker.handle({
        hook: PRE_STEP_HOOK,
        sessionId: 'sess-late',
        parentSession: undefined,
      }),
      true,
    );
    assert.equal(
      tracker.handle({
        hook: PRE_STEP_HOOK,
        sessionId: 'sess-late',
        parentSession: undefined,
      }),
      false,
    );
  });

  it('injects on the first pre-step when session-start never ran', () => {
    const tracker = createSessionInjectTracker();
    assert.equal(
      tracker.handle({
        hook: PRE_STEP_HOOK,
        sessionId: 'sess-no-start',
        parentSession: '',
      }),
      true,
    );
    assert.equal(
      tracker.handle({
        hook: PRE_STEP_HOOK,
        sessionId: 'sess-no-start',
        parentSession: '',
      }),
      false,
    );
  });

  it('does not inject into child sessions', () => {
    const tracker = createSessionInjectTracker();
    assert.equal(
      tracker.handle({
        hook: SESSION_START_HOOK,
        sessionId: 'child-1',
        parentSession: 'parent-1',
      }),
      false,
    );
    assert.equal(
      tracker.handle({
        hook: PRE_STEP_HOOK,
        sessionId: 'child-1',
        parentSession: 'parent-1',
      }),
      false,
    );
  });

  it('ignores unrelated hooks', () => {
    const tracker = createSessionInjectTracker();
    assert.equal(
      tracker.handle({
        hook: 'agent/session-end',
        sessionId: 'sess-1',
        parentSession: null,
      }),
      false,
    );
  });
});

describe('no Claude/Codex hook bridge', () => {
  it('does not import or call a hook-bridge', () => {
    const src = readFileSync(SRC, 'utf8');
    assert.equal(/hook-bridge|hookBridge|hook_bridge/i.test(src), false);
    assert.equal(/adapters\/(claude|codex)/.test(src), false);
    assert.equal(/configPath/.test(src), false);
    assert.match(src, /agent\/session-start/);
    assert.match(src, /agent\/pre-step/);
  });
});
