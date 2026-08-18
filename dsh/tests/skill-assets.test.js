import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadBakedSkill, renderSkillContent, resolveSkillsDir } from '../lib/skill-assets.js';

describe('loadBakedSkill', () => {
  it('loads the baked explore skill body from dsh/assets', () => {
    const loaded = loadBakedSkill('specline-explore');
    assert.ok(loaded);
    assert.equal(loaded.name, 'specline-explore');
    assert.match(loaded.description, /探索/);
    assert.match(loaded.body, /思考伙伴/);
    assert.equal(existsSync(join(loaded.dir, 'SKILL.md')), true);
    assert.equal(loaded.body.startsWith('---'), false);
  });

  it('returns null for missing or unsafe skill dirs', () => {
    assert.equal(loadBakedSkill('no-such-skill'), null);
    assert.equal(loadBakedSkill('../core'), null);
    assert.equal(loadBakedSkill(''), null);
  });
});

describe('renderSkillContent', () => {
  it('wraps the body in DSH skill_content markup', () => {
    const rendered = renderSkillContent('specline-explore', 'be a thinking partner', resolveSkillsDir());
    assert.match(rendered, /<skill_content name="specline-explore">/);
    assert.match(rendered, /<skill_instructions>/);
    assert.match(rendered, /be a thinking partner/);
  });
});
