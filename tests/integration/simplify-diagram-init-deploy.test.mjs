/**
 * Simplify Diagram — init/sync/deploy 公开路径（集成 / 黑盒）
 *
 * Spec:
 *   - MDR-005-S1 deploy/init 清单不含 specline/runtime/diagram
 *   - DCE-004-S1 init/sync 不得静默写入上游 drawio MCP
 *   - DCE-007-S1 不强制删除用户 specline/diagrams 产物
 *
 * Design 对外接口契约:
 *   - lib/deploy 停止打包 specline/runtime/diagram
 *   - specline sync / init 不得静默写各平台 drawio MCP
 *   - 可选 lib/upstream-drawio-mcp.mjs 为内部实现，无公开 npm API → 本文件不测 helper
 *
 * 框架: node:test；仅通过 CLI 子进程与文件系统验收。
 */

import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
} from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(PROJECT_ROOT, 'cli.mjs');
const tempDirs = new Set();

function runSpecline(args = [], opts = {}) {
  const result = spawnSync('node', [CLI, ...args], {
    cwd: opts.cwd || PROJECT_ROOT,
    encoding: 'utf-8',
    timeout: opts.timeout || 30_000,
    env: { ...process.env, ...(opts.env || {}) },
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    exitCode: result.status ?? (result.error ? 1 : 0),
    error: result.error || null,
    combined() {
      return `${this.stdout}\n${this.stderr}`.trim();
    },
  };
}

function createTempDir(prefix = 'specline-simplify-diagram-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.add(dir);
  return dir;
}

function listRelPaths(root) {
  if (!existsSync(root)) return [];
  const out = [];
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      const rel = relative(root, full).split('\\').join('/');
      if (entry.isDirectory()) {
        out.push(`${rel}/`);
        walk(full);
      } else {
        out.push(rel);
      }
    }
  }
  walk(root);
  return out;
}

function collectMcpConfigFiles(projectRoot) {
  const candidates = [
    join(projectRoot, '.cursor', 'mcp.json'),
    join(projectRoot, '.mcp.json'),
    join(projectRoot, '.codex', 'config.toml'),
    join(projectRoot, 'opencode.json'),
    join(projectRoot, '.opencode', 'opencode.json'),
  ];
  return candidates.filter((p) => existsSync(p));
}

function assertNoUpstreamDrawioMcp(filePath) {
  const text = readFileSync(filePath, 'utf-8');
  assert.doesNotMatch(
    text,
    /@next-ai-drawio\/mcp-server/i,
    `${relative(PROJECT_ROOT, filePath) || filePath} MUST NOT contain upstream drawio MCP after init/sync`,
  );
  assert.doesNotMatch(
    text,
    /["']drawio["']\s*:/,
    `${filePath} MUST NOT silently gain a drawio MCP server entry from init/sync`,
  );
}

function assertNoManagedDiagramRuntime(projectRoot) {
  const runtimeDiagram = join(projectRoot, 'specline', 'runtime', 'diagram');
  assert.equal(
    existsSync(runtimeDiagram),
    false,
    'init/deploy MUST NOT create specline/runtime/diagram managed control plane',
  );

  const runtimeRoot = join(projectRoot, 'specline', 'runtime');
  if (existsSync(runtimeRoot)) {
    const hits = listRelPaths(runtimeRoot).filter((p) =>
      /(^|\/)diagram(\/|\.mjs$|$)/.test(p),
    );
    assert.deepEqual(
      hits,
      [],
      `specline/runtime MUST NOT contain diagram control-plane files. found: ${hits.join(', ')}`,
    );
  }
}

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// MDR-005 — Unwire deploy packaging for diagram runtime
// ---------------------------------------------------------------------------

describe('MDR-005 Unwire deploy packaging for diagram runtime', () => {
  it('Scenario: MDR-005-S1 — init on clean project MUST NOT deploy specline/runtime/diagram', () => {
    const dir = createTempDir();
    const r = runSpecline(['init', dir, '--platform', 'cursor'], { env: { CI: '1' } });
    assert.equal(
      r.exitCode,
      0,
      `init MUST succeed without managed diagram runtime sources. out=${r.combined()}`,
    );
    assertNoManagedDiagramRuntime(dir);
  });

  it('Scenario: MDR-005-S1 — init --platform all MUST NOT deploy diagram runtime closure', () => {
    const dir = createTempDir();
    const r = runSpecline(['init', dir, '--platform', 'all'], { env: { CI: '1' } });
    assert.equal(
      r.exitCode,
      0,
      `init --platform all MUST succeed without diagram runtime. out=${r.combined()}`,
    );
    assertNoManagedDiagramRuntime(dir);

    // adapters must not materialize managed diagram-mcp configs into the project either
    const adapterLike = listRelPaths(dir).filter((p) => p.includes('diagram-mcp'));
    assert.deepEqual(adapterLike, [], `project MUST NOT receive diagram-mcp files: ${adapterLike}`);
  });
});

// ---------------------------------------------------------------------------
// DCE-004 — On-demand current platform only (no silent MCP write on init/sync)
// ---------------------------------------------------------------------------

describe('DCE-004 init/sync MUST NOT silently write drawio MCP', () => {
  it('Scenario: DCE-004-S1 — specline init MUST NOT auto-write upstream drawio MCP', () => {
    const dir = createTempDir();
    const r = runSpecline(['init', dir, '--platform', 'cursor,claude,codex,opencode'], {
      env: { CI: '1' },
    });
    assert.equal(r.exitCode, 0, `init failed: ${r.combined()}`);

    const mcpFiles = collectMcpConfigFiles(dir);
    for (const file of mcpFiles) {
      assertNoUpstreamDrawioMcp(file);
    }

    // Also scan any newly written json/toml under platform dirs for silent drawio MCP
    for (const rel of listRelPaths(dir)) {
      if (!/\.(json|toml)$/i.test(rel)) continue;
      const full = join(dir, rel);
      const text = readFileSync(full, 'utf-8');
      assert.doesNotMatch(
        text,
        /@next-ai-drawio\/mcp-server/i,
        `init MUST NOT write upstream drawio MCP into ${rel}`,
      );
      assert.doesNotMatch(
        text,
        /specline\s+diagram\s+mcp/i,
        `init MUST NOT write managed specline diagram mcp into ${rel}`,
      );
    }
  });

  it('Scenario: DCE-004-S1 — specline sync MUST NOT auto-write upstream drawio MCP', () => {
    const dir = createTempDir();
    const init = runSpecline(['init', dir, '--platform', 'cursor'], { env: { CI: '1' } });
    assert.equal(init.exitCode, 0, `init failed: ${init.combined()}`);

    // Pre-existing unrelated MCP entry should be left alone / not replaced with drawio by sync
    const cursorMcp = join(dir, '.cursor', 'mcp.json');
    mkdirSync(dirname(cursorMcp), { recursive: true });
    writeFileSync(
      cursorMcp,
      JSON.stringify(
        {
          mcpServers: {
            other: { command: 'echo', args: ['ok'] },
          },
        },
        null,
        2,
      ),
    );

    const sync = runSpecline(['sync', dir, '--platform', 'cursor'], {
      cwd: dir,
      env: { CI: '1' },
    });
    assert.equal(sync.exitCode, 0, `sync failed: ${sync.combined()}`);

    assert.ok(existsSync(cursorMcp), '.cursor/mcp.json should still exist after sync');
    const after = JSON.parse(readFileSync(cursorMcp, 'utf-8'));
    assert.ok(after.mcpServers?.other, 'sync MUST preserve unrelated MCP entries');
    assert.equal(
      after.mcpServers?.drawio,
      undefined,
      'sync MUST NOT silently add drawio MCP server',
    );
    assert.equal(
      after.mcpServers?.['specline-diagram'],
      undefined,
      'sync MUST NOT silently add managed specline-diagram MCP',
    );
    assertNoUpstreamDrawioMcp(cursorMcp);
  });
});

// ---------------------------------------------------------------------------
// DCE-007 — preserve user specline/diagrams across init/sync
// ---------------------------------------------------------------------------

describe('DCE-007 Preserve user diagram artifacts across CLI paths', () => {
  it('Scenario: DCE-007-S1 — sync MUST NOT delete existing specline/diagrams artifacts', () => {
    const dir = createTempDir();
    const init = runSpecline(['init', dir, '--platform', 'cursor'], { env: { CI: '1' } });
    assert.equal(init.exitCode, 0, `init failed: ${init.combined()}`);

    const artifactDir = join(dir, 'specline', 'diagrams', 'kept-slug');
    mkdirSync(artifactDir, { recursive: true });
    const artifact = join(artifactDir, 'kept.drawio');
    writeFileSync(artifact, '<mxfile><diagram id="1">kept</diagram></mxfile>\n');

    const sync = runSpecline(['sync', dir], { cwd: dir, env: { CI: '1' } });
    assert.equal(sync.exitCode, 0, `sync failed: ${sync.combined()}`);

    assert.ok(existsSync(artifact), 'user specline/diagrams/** MUST remain after sync');
    assert.equal(
      readFileSync(artifact, 'utf-8').includes('kept'),
      true,
      'diagram artifact content MUST be preserved',
    );
    assert.ok(statSync(join(dir, 'specline', 'diagrams')).isDirectory());
  });
});
