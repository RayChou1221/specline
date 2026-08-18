import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  BOOT_POLICY,
  USER_SLASH_SKILLS,
} from '../lib/skills.js';

const EXPECTED_IDS = [
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
];

describe('USER_SLASH_SKILLS', () => {
  it('covers exactly ten user-facing slash skills', () => {
    assert.equal(USER_SLASH_SKILLS.length, 10);
    assert.deepEqual(
      USER_SLASH_SKILLS.map((skill) => skill.id),
      EXPECTED_IDS,
    );
  });

  it('uses /specline-* slash names and user-only invocation flags', () => {
    for (const skill of USER_SLASH_SKILLS) {
      assert.equal(skill.slash, `/specline-${skill.id}`);
      assert.equal(skill.skillDir, `specline-${skill.id}`);
      assert.equal(skill['user-invocable'], true);
      assert.equal(skill['disable-model-invocation'], true);
    }
  });

  it('does not register using-specline, presets, or frontend-design as a slash', () => {
    const dirs = USER_SLASH_SKILLS.map((skill) => skill.skillDir);
    const slashes = USER_SLASH_SKILLS.map((skill) => skill.slash);
    assert.equal(dirs.includes('using-specline'), false);
    assert.equal(dirs.includes('frontend-design'), false);
    assert.equal(slashes.includes('/specline-using-specline'), false);
    assert.equal(slashes.includes('/frontend-design'), false);
    assert.equal(BOOT_POLICY.injectUsingSpecline, false);
    assert.equal(BOOT_POLICY.registerPreset, false);
    assert.equal(BOOT_POLICY.frontendDesignAsSlash, false);
  });
});
