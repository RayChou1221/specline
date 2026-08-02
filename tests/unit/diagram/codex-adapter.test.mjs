import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CODEX_TOOL_MAP,
  CONFIG_RELATIVE_PATH,
  SKILLS_RELATIVE_PATH,
  mergeConfig,
  removeConfig,
} from '../../../adapters/codex/diagram-mcp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const TEMPLATE = readFileSync(
  resolve(ROOT, 'adapters/codex/diagram-mcp.toml'),
  'utf8',
).trimEnd();

function expectCode(code, callback) {
  assert.throws(callback, (error) => error?.code === code);
}

describe('Codex diagram MCP adapter', () => {
  it('uses the supported project TOML path and authoritative shared Skill path', () => {
    assert.equal(CONFIG_RELATIVE_PATH, '.codex/config.toml');
    assert.equal(SKILLS_RELATIVE_PATH, '.agents/skills');
    assert.ok(!SKILLS_RELATIVE_PATH.startsWith('.codex/'));
  });

  it('adds the managed MCP table while preserving unrelated config and hooks', () => {
    const source = [
      'model = "gpt-5"',
      '',
      '[features]',
      'shell_snapshot = true',
      'experimental = [',
      '  "one",',
      '  "two",',
      ']',
      'instructions = """',
      'preserve this multiline value',
      'including = and [characters]',
      '"""',
      '',
      '[hooks]',
      'notify = ["./notify.sh"]',
      '',
      '[mcp_servers.existing]',
      'command = "existing-server"',
    ].join('\n');

    const result = mergeConfig(source, { approved: true });

    assert.equal(result.reloadState, 'reload_required');
    assert.match(result.content, /model = "gpt-5"/);
    assert.match(result.content, /experimental = \[\n  "one",\n  "two",\n\]/);
    assert.match(result.content, /instructions = """\npreserve this multiline value/);
    assert.match(result.content, /\[hooks\]\nnotify = \["\.\/notify\.sh"\]/);
    assert.match(result.content, /\[mcp_servers\.existing\]/);
    assert.match(result.content, /\[mcp_servers\.specline-diagram\]/);
    assert.match(result.content, /SPECLINE_MANAGED_MCP = "specline-diagram"/);
  });

  it('matches the checked-in current-format template and is idempotent', () => {
    const first = mergeConfig('', { approved: true });
    assert.equal(first.content, TEMPLATE);

    const second = mergeConfig(first.content, { approved: true });
    assert.equal(second.content, first.content);
    assert.equal(second.changed, false);
    assert.equal(second.reloadState, 'not_required');
  });

  it('rejects an unowned same-name server without modifying input', () => {
    const source = [
      '[mcp_servers.specline-diagram]',
      'command = "user-server"',
      'args = []',
    ].join('\n');

    expectCode('MCP_NAME_CONFLICT', () => mergeConfig(source, { approved: true }));
    assert.equal(source.includes('user-server'), true);
  });

  it('rejects malformed TOML before producing merged content', () => {
    expectCode('CONFIG_MALFORMED', () =>
      mergeConfig('[mcp_servers.broken\ncommand = "oops"', { approved: true }),
    );
    expectCode('CONFIG_MALFORMED', () =>
      mergeConfig('[mcp_servers.one]\ncommand = "a"\n[mcp_servers.one]\ncommand = "b"', {
        approved: true,
      }),
    );
  });

  it('requires independent Codex permission for merge and removal', () => {
    expectCode('PLATFORM_PERMISSION_REQUIRED', () => mergeConfig('', { approved: false }));
    expectCode('PLATFORM_PERMISSION_REQUIRED', () => removeConfig(TEMPLATE));
  });

  it('removes only the owned server and preserves unrelated TOML', () => {
    const source = [
      'model = "gpt-5"',
      '',
      TEMPLATE,
      '',
      '[mcp_servers.other]',
      'command = "other"',
      '',
      '[hooks]',
      'notify = ["./notify.sh"]',
    ].join('\n');

    const removed = removeConfig(source, { approved: true });

    assert.equal(removed.reloadState, 'reload_required');
    assert.doesNotMatch(removed.content, /mcp_servers\.specline-diagram/);
    assert.match(removed.content, /\[mcp_servers\.other\]\ncommand = "other"/);
    assert.match(removed.content, /\[hooks\]\nnotify = \["\.\/notify\.sh"\]/);
    assert.equal(removeConfig(removed.content, { approved: true }).changed, false);
  });

  it('publishes a complete provider-neutral tool mapping', () => {
    assert.deepEqual(Object.values(CODEX_TOOL_MAP), [
      'diagram.create',
      'diagram.load',
      'diagram.edit',
      'diagram.readState',
      'diagram.export',
      'diagram.finish',
    ]);
  });
});
