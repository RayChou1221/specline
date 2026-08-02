import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONFIG_RELATIVE_PATH,
  OPENCODE_TOOL_MAP,
  mergeConfig,
  removeConfig,
} from '../../../adapters/opencode/diagram-mcp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const TEMPLATE = readFileSync(resolve(ROOT, 'adapters/opencode/diagram-mcp.json'), 'utf8');

function expectCode(code, callback) {
  assert.throws(callback, (error) => error?.code === code);
}

describe('OpenCode diagram MCP adapter', () => {
  it('uses the supported project opencode.json format', () => {
    assert.equal(CONFIG_RELATIVE_PATH, 'opencode.json');
    const template = JSON.parse(TEMPLATE);
    assert.equal(template.mcp['specline-diagram'].type, 'local');
    assert.ok(Array.isArray(template.mcp['specline-diagram'].command));
  });

  it('preserves plugin, other servers, and unknown fields during structured merge', () => {
    const source = `${JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      plugin: ['@opencode/example'],
      theme: 'custom',
      futureOption: { enabled: true },
      mcp: {
        existing: {
          type: 'local',
          command: ['existing-server'],
          enabled: false,
        },
      },
    }, null, 2)}\n`;

    const result = mergeConfig(source, { approved: true });
    const merged = JSON.parse(result.content);

    assert.equal(result.reloadState, 'reload_required');
    assert.deepEqual(merged.plugin, ['@opencode/example']);
    assert.equal(merged.theme, 'custom');
    assert.deepEqual(merged.futureOption, { enabled: true });
    assert.deepEqual(merged.mcp.existing.command, ['existing-server']);
    assert.deepEqual(merged.mcp['specline-diagram'].command, [
      'specline',
      'diagram',
      'mcp',
      '--stdio',
    ]);
    assert.equal(merged.mcp['specline-diagram'].environment.SPECLINE_MANAGED_MCP, 'specline-diagram');
  });

  it('matches the checked-in current-format template and is idempotent', () => {
    const first = mergeConfig('', { approved: true });
    assert.equal(first.content, TEMPLATE);

    const second = mergeConfig(first.content, { approved: true });
    assert.equal(second.content, first.content);
    assert.equal(second.changed, false);
    assert.equal(second.reloadState, 'not_required');
  });

  it('rejects an unowned same-name MCP server', () => {
    const source = JSON.stringify({
      mcp: {
        'specline-diagram': {
          type: 'local',
          command: ['user-owned-server'],
        },
      },
    });

    expectCode('MCP_NAME_CONFLICT', () => mergeConfig(source, { approved: true }));
  });

  it('rejects malformed JSON and malformed MCP containers', () => {
    expectCode('CONFIG_MALFORMED', () => mergeConfig('{"mcp":', { approved: true }));
    expectCode('CONFIG_MALFORMED', () => mergeConfig('{"mcp":[]}', { approved: true }));
    expectCode('CONFIG_MALFORMED', () => mergeConfig('null', { approved: true }));
  });

  it('requires independent OpenCode permission for merge and removal', () => {
    expectCode('PLATFORM_PERMISSION_REQUIRED', () => mergeConfig('', { approved: false }));
    expectCode('PLATFORM_PERMISSION_REQUIRED', () => removeConfig(TEMPLATE));
  });

  it('reversibly removes only the managed server', () => {
    const original = {
      plugin: ['custom-plugin'],
      unknown: 42,
      mcp: {
        existing: {
          type: 'remote',
          url: 'http://127.0.0.1:4321/mcp',
        },
      },
    };
    const merged = mergeConfig(`${JSON.stringify(original, null, 2)}\n`, { approved: true });
    const removed = removeConfig(merged.content, { approved: true });
    const restored = JSON.parse(removed.content);

    assert.deepEqual(restored, original);
    assert.equal(removed.reloadState, 'reload_required');
    assert.equal(removeConfig(removed.content, { approved: true }).changed, false);
  });

  it('removes the adapter-created MCP container from an otherwise empty config', () => {
    const merged = mergeConfig('{}\n', { approved: true });
    const removed = removeConfig(merged.content, { approved: true });
    assert.deepEqual(JSON.parse(removed.content), {});
  });

  it('publishes a complete provider-neutral tool mapping', () => {
    assert.deepEqual(Object.values(OPENCODE_TOOL_MAP), [
      'diagram.create',
      'diagram.load',
      'diagram.edit',
      'diagram.readState',
      'diagram.export',
      'diagram.finish',
    ]);
  });
});
