import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { join } from 'node:path';

import {
  claudeConfigPath,
  mergeClaudeDiagramConfig,
  removeClaudeDiagramConfig,
  toolNameForClaude,
} from '../../../adapters/claude/diagram-mcp.mjs';

const existing = JSON.stringify({
  settings: {
    permissions: { allow: ['Read'] },
  },
  hooks: {
    SessionStart: [{ command: 'user-hook' }],
  },
  customField: ['keep-me'],
  mcpServers: {
    userServer: {
      type: 'stdio',
      command: 'node',
      args: ['user-server.mjs'],
    },
  },
});

describe('Claude Code diagram MCP adapter', () => {
  it('locates current supported project and user config files', () => {
    assert.equal(
      claudeConfigPath({ projectRoot: '/project', scope: 'project' }),
      join('/project', '.mcp.json'),
    );
    assert.equal(
      claudeConfigPath({ homeDir: '/home/user', scope: 'user' }),
      join('/home/user', '.claude.json'),
    );
  });

  it('preserves settings, hooks, unknown fields, and other servers', () => {
    const result = mergeClaudeDiagramConfig(existing, { approved: true });
    const parsed = JSON.parse(result.content);

    assert.equal(result.ok, true);
    assert.equal(result.reloadState, 'reload_required');
    assert.deepEqual(parsed.settings.permissions.allow, ['Read']);
    assert.deepEqual(parsed.hooks.SessionStart, [{ command: 'user-hook' }]);
    assert.deepEqual(parsed.customField, ['keep-me']);
    assert.equal(parsed.mcpServers.userServer.command, 'node');
    assert.equal(parsed.mcpServers['specline-diagram'].type, 'stdio');
  });

  it('is idempotent and reversibly removes only the managed fragment', () => {
    const first = mergeClaudeDiagramConfig(existing, { approved: true });
    const second = mergeClaudeDiagramConfig(first.content, { approved: true });
    assert.equal(second.changed, false);
    assert.equal(second.content, first.content);

    const removed = removeClaudeDiagramConfig(second.content, { approved: true });
    const parsed = JSON.parse(removed.content);
    assert.equal(removed.changed, true);
    assert.equal(parsed.mcpServers['specline-diagram'], undefined);
    assert.deepEqual(parsed.hooks.SessionStart, [{ command: 'user-hook' }]);
    assert.deepEqual(parsed.customField, ['keep-me']);
  });

  it('rejects same-name user configuration and malformed input', () => {
    const conflict = JSON.stringify({
      mcpServers: {
        'specline-diagram': { type: 'stdio', command: 'user-command' },
      },
    });
    const conflictResult = mergeClaudeDiagramConfig(conflict, { approved: true });
    assert.equal(conflictResult.ok, false);
    assert.equal(conflictResult.code, 'MCP_SERVER_CONFLICT');
    assert.equal(conflictResult.content, conflict);

    const malformed = '{"hooks":';
    const malformedResult = mergeClaudeDiagramConfig(malformed, { approved: true });
    assert.equal(malformedResult.ok, false);
    assert.equal(malformedResult.code, 'MALFORMED_CONFIG');
    assert.equal(malformedResult.content, malformed);
  });

  it('requires independent Claude permission when another platform is current', () => {
    const denied = mergeClaudeDiagramConfig(existing, {
      approved: true,
      currentPlatform: 'cursor',
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.code, 'PLATFORM_PERMISSION_REQUIRED');
    assert.equal(denied.content, existing);

    const allowed = mergeClaudeDiagramConfig(existing, {
      approved: true,
      currentPlatform: 'cursor',
      explicitPlatformApproval: true,
    });
    assert.equal(allowed.ok, true);
  });

  it('maps only provider-neutral operations', () => {
    assert.equal(toolNameForClaude('diagram.finish'), 'mcp__specline-diagram__diagram_finish');
    assert.throws(() => toolNameForClaude('filesystem.read'), /Unsupported diagram operation/);
  });
});
