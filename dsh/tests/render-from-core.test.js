import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  DSH_VARS,
  renderDshSkill,
  renderFrontendDevPersona,
  yamlNameToToolName,
} from '../lib/render-from-core.js';

describe('yaml name to DSH toolName', () => {
  it('maps specline-spec-creator to specline_spec_creator', () => {
    assert.equal(yamlNameToToolName('specline-spec-creator'), 'specline_spec_creator');
  });

  it('maps the ten role yaml names to specline_* tools', () => {
    const expected = {
      'specline-spec-creator': 'specline_spec_creator',
      'specline-spec-reviewer': 'specline_spec_reviewer',
      'specline-frontend-dev': 'specline_frontend_dev',
      'specline-backend-dev': 'specline_backend_dev',
      'specline-config-dev': 'specline_config_dev',
      'specline-config-reviewer': 'specline_config_reviewer',
      'specline-code-reviewer': 'specline_code_reviewer',
      'specline-test-writer': 'specline_test_writer',
      'specline-test-runner': 'specline_test_runner',
      'specline-explore-assistant': 'specline_explore_assistant',
    };
    for (const [yamlName, toolName] of Object.entries(expected)) {
      assert.equal(yamlNameToToolName(yamlName), toolName);
    }
  });
});

describe('DSH_VARS and skill rendering', () => {
  it('defines DISPATCH/CONFIRM/LINT for DSH', () => {
    assert.equal(typeof DSH_VARS.DISPATCH, 'string');
    assert.match(DSH_VARS.DISPATCH, /specline_\*/);
    assert.equal(DSH_VARS.CONFIRM, '直接向用户提问');
    assert.match(DSH_VARS.LINT, /bash lint/);
  });

  it('replaces DISPATCH with specline_* tool names and strips cursor blocks', () => {
    const source = [
      '{{DISPATCH}}，role="specline-spec-creator"',
      '<!-- platform:cursor -->',
      'CURSOR_ONLY',
      '<!-- /platform:cursor -->',
      '<!-- platform:claude,codex,opencode -->',
      'NON_CURSOR_BLOCK',
      '<!-- /platform:claude,codex,opencode -->',
      '{{CONFIRM}}',
      '{{LINT}}',
      '',
    ].join('\n');

    const rendered = renderDshSkill(source);

    assert.doesNotMatch(rendered, /\{\{DISPATCH\}\}/);
    assert.doesNotMatch(rendered, /\{\{CONFIRM\}\}/);
    assert.doesNotMatch(rendered, /\{\{LINT\}\}/);
    assert.match(rendered, /specline_spec_creator/);
    assert.doesNotMatch(rendered, /role="specline-spec-creator"/);
    assert.doesNotMatch(rendered, /CURSOR_ONLY/);
    assert.match(rendered, /NON_CURSOR_BLOCK/);
    assert.match(rendered, /直接向用户提问/);
    assert.match(rendered, /bash lint/);
  });
});

describe('frontend-dev persona inlines frontend-design', () => {
  it('appends frontend-design body to the yaml persona', () => {
    const yaml = [
      'name: specline-frontend-dev',
      'description: frontend agent',
      'instructions: |',
      '  PERSONA_INSTRUCTIONS',
      '',
    ].join('\n');
    const skill = [
      '---',
      'name: frontend-design',
      'description: design skill',
      '---',
      '',
      '# Frontend Design',
      'SIGNATURE_ELEMENT_DOC',
      '',
    ].join('\n');

    const persona = renderFrontendDevPersona(yaml, skill);

    assert.match(persona, /PERSONA_INSTRUCTIONS/);
    assert.match(persona, /Frontend Design/);
    assert.match(persona, /SIGNATURE_ELEMENT_DOC/);
    assert.doesNotMatch(persona, /^---$/m);
  });
});
