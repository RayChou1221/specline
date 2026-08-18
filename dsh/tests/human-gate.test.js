import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolveHumanGate } from '../lib/human-gate.js';

const POLICIES = ['full', 'minimal', 'none'];
const GATES = ['HG1', 'HG2', 'HG3'];

describe('resolveHumanGate headless', () => {
  for (const policy of POLICIES) {
    for (const gate of GATES) {
      it(`kind=headless policy=${policy} ${gate} auto-passes with warn and no config write`, () => {
        const result = resolveHumanGate('headless', policy, gate, {
          warnings: 4,
          errors: 0,
        });
        assert.deepEqual(result, {
          autoPass: true,
          warn: true,
          writeConfig: false,
          approval: false,
        });
      });
    }
  }

  it('does not treat Headless auto-pass as a Settings / yaml mutation', () => {
    const result = resolveHumanGate('headless', 'full', 'HG3');
    assert.equal(result.writeConfig, false);
    assert.equal(result.warn, true);
  });
});

describe('resolveHumanGate web + full', () => {
  it('HG1 requires approval', () => {
    const result = resolveHumanGate('web', 'full', 'HG1');
    assert.equal(result.autoPass, false);
    assert.equal(result.approval, true);
    assert.equal(result.writeConfig, false);
    assert.equal(result.warn, false);
  });

  it('HG3 requires approval', () => {
    const result = resolveHumanGate('web', 'full', 'HG3');
    assert.equal(result.autoPass, false);
    assert.equal(result.approval, true);
    assert.equal(result.writeConfig, false);
  });

  it('HG2 auto-passes when there are no review warnings', () => {
    const result = resolveHumanGate('web', 'full', 'HG2', { warnings: 0, errors: 0 });
    assert.equal(result.autoPass, true);
    assert.equal(result.approval, false);
  });

  it('HG2 requires approval when warnings>0 and errors=0 (conditional review)', () => {
    const result = resolveHumanGate('web', 'full', 'HG2', { warnings: 2, errors: 0 });
    assert.equal(result.autoPass, false);
    assert.equal(result.approval, true);
    assert.equal(result.writeConfig, false);
  });

  it('HG2 does not ask when errors>0 (lint/review gate owns that path)', () => {
    const result = resolveHumanGate('web', 'full', 'HG2', { warnings: 3, errors: 1 });
    assert.equal(result.autoPass, true);
    assert.equal(result.approval, false);
  });
});

describe('resolveHumanGate web + minimal', () => {
  it('HG1 auto-passes', () => {
    const result = resolveHumanGate('web', 'minimal', 'HG1');
    assert.equal(result.autoPass, true);
    assert.equal(result.approval, false);
    assert.equal(result.writeConfig, false);
  });

  it('HG2 auto-passes even when review has warnings', () => {
    const result = resolveHumanGate('web', 'minimal', 'HG2', { warnings: 5, errors: 0 });
    assert.equal(result.autoPass, true);
    assert.equal(result.approval, false);
  });

  it('HG3 still requires approval (minimal is not skip-all)', () => {
    const result = resolveHumanGate('web', 'minimal', 'HG3');
    assert.equal(result.autoPass, false);
    assert.equal(result.approval, true);
    assert.equal(result.writeConfig, false);
  });

  it('does not flatten minimal into none for archive', () => {
    const noneHg3 = resolveHumanGate('web', 'none', 'HG3');
    const minimalHg3 = resolveHumanGate('web', 'minimal', 'HG3');
    assert.equal(noneHg3.autoPass, true);
    assert.equal(minimalHg3.autoPass, false);
    assert.equal(minimalHg3.approval, true);
  });
});

describe('resolveHumanGate web + none', () => {
  for (const gate of GATES) {
    it(`${gate} auto-passes`, () => {
      const result = resolveHumanGate('web', 'none', gate, { warnings: 9, errors: 0 });
      assert.equal(result.autoPass, true);
      assert.equal(result.approval, false);
      assert.equal(result.writeConfig, false);
      assert.equal(result.warn, false);
    });
  }
});

describe('resolveHumanGate aliases and guards', () => {
  it('accepts human_gate_3 as HG3', () => {
    const result = resolveHumanGate('web', 'minimal', 'human_gate_3');
    assert.equal(result.approval, true);
    assert.equal(result.autoPass, false);
  });

  it('never writes config on web', () => {
    for (const policy of POLICIES) {
      for (const gate of GATES) {
        assert.equal(resolveHumanGate('web', policy, gate).writeConfig, false);
      }
    }
  });
});
