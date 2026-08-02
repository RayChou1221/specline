import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { join } from 'node:path';

import {
  cursorConfigPath,
  mergeCursorDiagramConfig,
  removeCursorDiagramConfig,
  toolNameForCursor,
} from '../../../adapters/cursor/diagram-mcp.mjs';

const existing = JSON.stringify({
  version: 1,
  unknown: { keep: true },
  mcpServers: {
    userServer: {
      command: 'node',
      args: ['user-server.mjs'],
    },
  },
});

describe('Cursor diagram MCP adapter', () => {
  it('locates current supported project and user config files', () => {
    assert.equal(
      cursorConfigPath({ projectRoot: '/project', scope: 'project' }),
      join('/project', '.cursor', 'mcp.json'),
    );
    assert.equal(
      cursorConfigPath({ homeDir: '/home/user', scope: 'user' }),
      join('/home/user', '.cursor', 'mcp.json'),
    );
  });

  it('preserves unrelated configuration and marks first reload', () => {
    const result = mergeCursorDiagramConfig(existing, { approved: true });
    const parsed = JSON.parse(result.content);

    assert.equal(result.ok, true);
    assert.equal(result.changed, true);
    assert.equal(result.reloadState, 'reload_required');
    assert.deepEqual(parsed.unknown, { keep: true });
    assert.deepEqual(parsed.mcpServers.userServer.args, ['user-server.mjs']);
    assert.equal(
      parsed.mcpServers['specline-diagram'].env.SPECLINE_MANAGED,
      'diagram-adapter-v1',
    );
  });

  it('is idempotent after the managed entry exists', () => {
    const first = mergeCursorDiagramConfig(existing, { approved: true });
    const second = mergeCursorDiagramConfig(first.content, { approved: true });

    assert.equal(second.ok, true);
    assert.equal(second.changed, false);
    assert.equal(second.reloadState, 'not_required');
    assert.equal(second.content, first.content);
  });

  it('rejects same-name user configuration without overwriting it', () => {
    const conflict = JSON.stringify({
      mcpServers: {
        'specline-diagram': { command: 'user-command' },
      },
    });
    const result = mergeCursorDiagramConfig(conflict, { approved: true });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'MCP_SERVER_CONFLICT');
    assert.equal(result.changed, false);
    assert.equal(result.content, conflict);
  });

  it('rejects malformed input with zero mutation', () => {
    const malformed = '{"mcpServers":';
    const result = mergeCursorDiagramConfig(malformed, { approved: true });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'MALFORMED_CONFIG');
    assert.equal(result.content, malformed);
  });

  it('requires independent permission when Cursor is not current', () => {
    const result = mergeCursorDiagramConfig(existing, {
      approved: true,
      currentPlatform: 'claude',
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'PLATFORM_PERMISSION_REQUIRED');
    assert.equal(result.content, existing);

    const explicitlyApproved = mergeCursorDiagramConfig(existing, {
      approved: true,
      currentPlatform: 'claude',
      explicitPlatformApproval: true,
    });
    assert.equal(explicitlyApproved.ok, true);
  });

  it('removes only the managed entry and preserves all unrelated fields', () => {
    const merged = mergeCursorDiagramConfig(existing, { approved: true });
    const removed = removeCursorDiagramConfig(merged.content, { approved: true });
    const parsed = JSON.parse(removed.content);

    assert.equal(removed.ok, true);
    assert.equal(removed.changed, true);
    assert.equal(parsed.mcpServers['specline-diagram'], undefined);
    assert.deepEqual(parsed.mcpServers.userServer.args, ['user-server.mjs']);
    assert.deepEqual(parsed.unknown, { keep: true });
  });

  it('maps only provider-neutral operations', () => {
    assert.equal(toolNameForCursor('diagram.create'), 'specline_diagram_create');
    assert.throws(() => toolNameForCursor('filesystem.read'), /Unsupported diagram operation/);
  });
});
