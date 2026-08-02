import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DRAWIO_SERVER_NAME,
  LEGACY_SERVER_NAME,
  UPSTREAM_ARGS,
  UPSTREAM_COMMAND,
  UPSTREAM_PACKAGE,
  buildDrawioServerEntry,
  detectMcpConfigFormat,
  upsertDrawioMcpContent,
  writeDrawioMcpConfig,
} from '../../lib/upstream-drawio-mcp.mjs';

test('buildDrawioServerEntry emits npx @next-ai-drawio/mcp-server@latest for mcpServers', () => {
  assert.deepEqual(buildDrawioServerEntry('mcpServers'), {
    command: UPSTREAM_COMMAND,
    args: [...UPSTREAM_ARGS],
  });
  assert.equal(UPSTREAM_PACKAGE, '@next-ai-drawio/mcp-server@latest');
  assert.deepEqual(UPSTREAM_ARGS, ['@next-ai-drawio/mcp-server@latest']);
});

test('buildDrawioServerEntry emits OpenCode local command array', () => {
  assert.deepEqual(buildDrawioServerEntry('opencode'), {
    type: 'local',
    command: ['npx', '@next-ai-drawio/mcp-server@latest'],
    enabled: true,
  });
});

test('detectMcpConfigFormat maps common explicit paths', () => {
  assert.equal(detectMcpConfigFormat('/home/u/.cursor/mcp.json'), 'mcpServers');
  assert.equal(detectMcpConfigFormat('/repo/.mcp.json'), 'mcpServers');
  assert.equal(detectMcpConfigFormat('/repo/.codex/config.toml'), 'codex');
  assert.equal(detectMcpConfigFormat('/home/u/.codex/config.toml'), 'codex');
  assert.equal(detectMcpConfigFormat('/repo/config.toml'), 'codex');
  assert.equal(detectMcpConfigFormat('/repo/opencode.json'), 'opencode');
});

test('detectMcpConfigFormat rejects arbitrary *.toml (e.g. Cargo.toml)', () => {
  assert.throws(
    () => detectMcpConfigFormat('/repo/Cargo.toml'),
    /Unable to detect MCP config format/,
  );
  assert.throws(
    () => detectMcpConfigFormat('/repo/pyproject.toml'),
    /Unable to detect MCP config format/,
  );
  assert.throws(
    () => detectMcpConfigFormat('/repo/random.toml'),
    /Unable to detect MCP config format/,
  );
});

test('upsertDrawioMcpContent rejects malformed JSON', () => {
  assert.throws(
    () => upsertDrawioMcpContent('{ not valid json', { format: 'mcpServers' }),
    /Malformed JSON MCP config/,
  );
  assert.throws(
    () => upsertDrawioMcpContent('[1, 2, 3]', { format: 'mcpServers' }),
    /MCP config must be a JSON object/,
  );
  assert.throws(
    () => upsertDrawioMcpContent('{', { format: 'opencode' }),
    /Malformed JSON MCP config/,
  );
});

test('writeDrawioMcpConfig refuses Cargo.toml without explicit format', async () => {
  const root = await mkdtemp(join(tmpdir(), 'specline-upstream-drawio-cargo-'));
  const targetPath = join(root, 'Cargo.toml');
  await writeFile(targetPath, '[package]\nname = "x"\n');

  await assert.rejects(
    () => writeDrawioMcpConfig({ targetPath }),
    /Unable to detect MCP config format/,
  );

  // Explicit format still allowed (caller owns the choice)
  const result = await writeDrawioMcpConfig({ targetPath, format: 'codex' });
  assert.equal(result.format, 'codex');
  assert.match(result.content, /\[mcp_servers\.drawio\]/);
});

test('upsertDrawioMcpContent replaces managed specline-diagram and upserts drawio (Cursor JSON)', () => {
  const before = {
    mcpServers: {
      other: { command: 'keep-me', args: ['x'] },
      [LEGACY_SERVER_NAME]: {
        command: 'specline',
        args: ['diagram', 'mcp', '--stdio'],
        env: { SPECLINE_MANAGED: 'diagram-adapter-v1' },
      },
    },
  };

  const { content, changed } = upsertDrawioMcpContent(JSON.stringify(before, null, 2), {
    format: 'mcpServers',
  });
  assert.equal(changed, true);

  const parsed = JSON.parse(content);
  assert.equal(parsed.mcpServers[LEGACY_SERVER_NAME], undefined);
  assert.deepEqual(parsed.mcpServers[DRAWIO_SERVER_NAME], {
    command: 'npx',
    args: ['@next-ai-drawio/mcp-server@latest'],
  });
  assert.deepEqual(parsed.mcpServers.other, { command: 'keep-me', args: ['x'] });
});

test('upsertDrawioMcpContent preserves unrelated Claude mcpServers entries', () => {
  const before = {
    mcpServers: {
      filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
      [LEGACY_SERVER_NAME]: {
        type: 'stdio',
        command: 'specline',
        args: ['diagram', 'mcp', '--stdio'],
      },
    },
  };

  const { content } = upsertDrawioMcpContent(`${JSON.stringify(before)}\n`, {
    format: 'mcpServers',
  });
  const parsed = JSON.parse(content);
  assert.ok(parsed.mcpServers.filesystem);
  assert.equal(parsed.mcpServers[LEGACY_SERVER_NAME], undefined);
  assert.equal(parsed.mcpServers.drawio.command, 'npx');
});

test('upsertDrawioMcpContent handles minimal Codex TOML', () => {
  const before = [
    '[mcp_servers.filesystem]',
    'command = "npx"',
    'args = ["-y", "fs"]',
    '',
    '[mcp_servers.specline-diagram]',
    'command = "specline"',
    'args = ["diagram", "mcp", "--stdio"]',
    'enabled = true',
    '',
    '[mcp_servers.specline-diagram.env]',
    'SPECLINE_MANAGED_MCP = "specline-diagram"',
    '',
  ].join('\n');

  const { content, changed } = upsertDrawioMcpContent(before, { format: 'codex' });
  assert.equal(changed, true);
  assert.match(content, /\[mcp_servers\.drawio\]/);
  assert.match(content, /command = "npx"/);
  assert.match(content, /@next-ai-drawio\/mcp-server@latest/);
  assert.match(content, /\[mcp_servers\.filesystem\]/);
  assert.doesNotMatch(content, /mcp_servers\.specline-diagram/);
});

test('upsertDrawioMcpContent handles OpenCode JSON mcp map', () => {
  const before = {
    $schema: 'https://opencode.ai/config.json',
    mcp: {
      keep: {
        type: 'local',
        command: ['echo'],
        enabled: true,
      },
      [LEGACY_SERVER_NAME]: {
        type: 'local',
        command: ['specline', 'diagram', 'mcp', '--stdio'],
        enabled: true,
        environment: { SPECLINE_MANAGED_MCP: 'specline-diagram' },
      },
    },
  };

  const { content } = upsertDrawioMcpContent(JSON.stringify(before, null, 2), {
    format: 'opencode',
  });
  const parsed = JSON.parse(content);
  assert.ok(parsed.mcp.keep);
  assert.equal(parsed.mcp[LEGACY_SERVER_NAME], undefined);
  assert.deepEqual(parsed.mcp.drawio, {
    type: 'local',
    command: ['npx', '@next-ai-drawio/mcp-server@latest'],
    enabled: true,
  });
});

test('writeDrawioMcpConfig requires explicit targetPath', async () => {
  await assert.rejects(
    () => writeDrawioMcpConfig({}),
    /targetPath is required|refusing silent multi-platform/,
  );
  await assert.rejects(
    () => writeDrawioMcpConfig({ targetPath: '' }),
    /targetPath is required|refusing silent multi-platform/,
  );
  await assert.rejects(
    () => writeDrawioMcpConfig({ targetPath: '   ' }),
    /targetPath is required|refusing silent multi-platform/,
  );
});

test('writeDrawioMcpConfig writes only the explicit path and replaces legacy entry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'specline-upstream-drawio-'));
  const targetPath = join(root, '.cursor', 'mcp.json');
  const otherPath = join(root, '.mcp.json');

  await mkdir(join(root, '.cursor'), { recursive: true });
  await writeFile(
    targetPath,
    `${JSON.stringify({
      mcpServers: {
        other: { command: 'stay' },
        [LEGACY_SERVER_NAME]: {
          command: 'specline',
          args: ['diagram', 'mcp', '--stdio'],
        },
      },
    }, null, 2)}\n`,
  );
  await writeFile(
    otherPath,
    `${JSON.stringify({
      mcpServers: {
        untouched: { command: 'leave-alone' },
        [LEGACY_SERVER_NAME]: {
          command: 'specline',
          args: ['diagram', 'mcp', '--stdio'],
        },
      },
    }, null, 2)}\n`,
  );

  const result = await writeDrawioMcpConfig({ targetPath });
  assert.equal(result.targetPath, targetPath);
  assert.equal(result.format, 'mcpServers');
  assert.equal(result.changed, true);

  const written = JSON.parse(await readFile(targetPath, 'utf8'));
  assert.equal(written.mcpServers[LEGACY_SERVER_NAME], undefined);
  assert.deepEqual(written.mcpServers.drawio, {
    command: 'npx',
    args: ['@next-ai-drawio/mcp-server@latest'],
  });
  assert.deepEqual(written.mcpServers.other, { command: 'stay' });

  // Other platform / path must remain untouched (no silent multi-platform write)
  const other = JSON.parse(await readFile(otherPath, 'utf8'));
  assert.ok(other.mcpServers[LEGACY_SERVER_NAME]);
  assert.equal(other.mcpServers.drawio, undefined);
  assert.deepEqual(other.mcpServers.untouched, { command: 'leave-alone' });
});

test('helper module surface has no planDigest/runtime/session/releaseGate exports', async () => {
  const mod = await import('../../lib/upstream-drawio-mcp.mjs');
  const forbidden = [
    'planDigest',
    'runtime',
    'session',
    'releaseGate',
    'auditState',
    'doctor',
    'install',
  ];
  for (const name of forbidden) {
    assert.equal(
      Object.hasOwn(mod, name),
      false,
      `must not export managed control-plane symbol: ${name}`,
    );
  }
  assert.equal(typeof mod.writeDrawioMcpConfig, 'function');
  assert.equal(typeof mod.upsertDrawioMcpContent, 'function');
});
