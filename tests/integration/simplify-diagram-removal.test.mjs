/**
 * Simplify Diagram — 受管控制面删除（集成 / 黑盒）
 *
 * Spec:
 *   - specline/changes/simplify-diagram/specs/managed-drawio-removal/spec.md
 *   - specline/changes/simplify-diagram/specs/diagram-convenience-entry/spec.md
 * Design 对外接口契约: CLI 删除；helper 无公开 npm API（本文件不测内部 helper）
 *
 * 框架: node:test；仅通过子进程 CLI 与仓库树/配置文件检查验收。
 */

import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(PROJECT_ROOT, 'cli.mjs');

function runSpecline(args = [], opts = {}) {
  const result = spawnSync('node', [CLI, ...args], {
    cwd: opts.cwd || PROJECT_ROOT,
    encoding: 'utf-8',
    timeout: opts.timeout || 15_000,
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

function listFilesRecursive(dir, { ignoreDirNames = new Set() } = {}) {
  if (!existsSync(dir)) return [];
  const out = [];
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (ignoreDirNames.has(entry.name)) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full);
    }
  }
  walk(dir);
  return out;
}

function stripAnsi(text) {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

// ---------------------------------------------------------------------------
// MDR-001 — Remove diagram CLI and lib control plane
// ---------------------------------------------------------------------------

describe('MDR-001 Remove diagram CLI and lib control plane', () => {
  it('Scenario: MDR-001-S1 — specline diagram doctor fails as unknown/unsupported command', () => {
    const unknown = runSpecline(['totally-unknown-cmd-xyz']);
    assert.notEqual(unknown.exitCode, 0, 'baseline unknown command must fail');

    const r = runSpecline(['diagram', 'doctor']);
    assert.notEqual(
      r.exitCode,
      0,
      `specline diagram doctor MUST fail as unsupported. got exit=${r.exitCode} out=${r.combined()}`,
    );

    const out = stripAnsi(r.combined());
    assert.match(
      out,
      /未知命令|unknown command|Unknown command|不支持/i,
      `output MUST indicate unknown/unsupported command. got: ${out}`,
    );
    assert.doesNotMatch(
      out,
      /Diagram runtime inspected|install plan|releaseGate|planDigest/i,
      'MUST NOT start managed runtime / MCP wrapper style success path',
    );
  });

  it('Scenario: MDR-001-S1 — help MUST NOT list specline diagram', () => {
    const r = runSpecline(['--help']);
    assert.equal(r.exitCode, 0, r.combined());
    const help = stripAnsi(r.combined());
    assert.doesNotMatch(
      help,
      /^\s*specline diagram\b/m,
      'help MUST NOT advertise specline diagram subcommand',
    );
  });

  it('Scenario: MDR-001-S2 — product tree MUST NOT contain lib/diagram source', () => {
    assert.equal(
      existsSync(join(PROJECT_ROOT, 'lib', 'diagram.mjs')),
      false,
      'lib/diagram.mjs MUST NOT exist as product source',
    );
    assert.equal(
      existsSync(join(PROJECT_ROOT, 'lib', 'diagram')),
      false,
      'lib/diagram/ MUST NOT exist as product source',
    );
  });
});

// ---------------------------------------------------------------------------
// MDR-002 — Remove managed runtime source and platform adapters
// ---------------------------------------------------------------------------

describe('MDR-002 Remove managed runtime source and platform adapters', () => {
  it('Scenario: MDR-002-S1 — core/runtimes/ MUST NOT contain drawio/', () => {
    assert.equal(
      existsSync(join(PROJECT_ROOT, 'core', 'runtimes', 'drawio')),
      false,
      'core/runtimes/drawio/ MUST NOT exist',
    );
  });

  it('Scenario: MDR-002-S2 — adapters MUST NOT contain diagram-mcp.*', () => {
    const platforms = ['cursor', 'claude', 'codex', 'opencode'];
    const suffixes = ['diagram-mcp.mjs', 'diagram-mcp.json', 'diagram-mcp.toml'];
    for (const platform of platforms) {
      const dir = join(PROJECT_ROOT, 'adapters', platform);
      for (const name of suffixes) {
        assert.equal(
          existsSync(join(dir, name)),
          false,
          `adapters/${platform}/${name} MUST NOT exist`,
        );
      }
      if (existsSync(dir)) {
        const leftover = readdirSync(dir).filter((n) => n.startsWith('diagram-mcp'));
        assert.deepEqual(leftover, [], `adapters/${platform}/ MUST NOT retain diagram-mcp*`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// MDR-003 — Remove managed-diagram tests and production scripts
// ---------------------------------------------------------------------------

describe('MDR-003 Remove managed-diagram tests and package scripts', () => {
  it('Scenario: MDR-003-S1 — managed diagram test trees MUST be gone', () => {
    const mustGone = [
      'tests/unit/diagram',
      'tests/integration/diagram',
      'tests/e2e/diagram',
      'tests/diagram-production.test.mjs',
      'tests/fixtures/diagram-runtime',
    ];
    for (const rel of mustGone) {
      assert.equal(
        existsSync(join(PROJECT_ROOT, rel)),
        false,
        `${rel} MUST be deleted so default suite no longer depends on managed diagram`,
      );
    }
  });

  it('Scenario: MDR-003-S1 — remaining tests MUST NOT import lib/diagram', () => {
    const testRoots = [
      join(PROJECT_ROOT, 'tests'),
    ];
    const offenders = [];
    for (const root of testRoots) {
      for (const file of listFilesRecursive(root, {
        ignoreDirNames: new Set(['node_modules', '.git']),
      })) {
        if (!/\.(mjs|cjs|js)$/.test(file)) continue;
        const text = readFileSync(file, 'utf-8');
        if (
          /from\s+['"][^'"]*lib\/diagram(\.mjs)?['"]/.test(text) ||
          /from\s+['"][^'"]*lib\/diagram\//.test(text) ||
          /require\(['"][^'"]*lib\/diagram/.test(text)
        ) {
          offenders.push(relative(PROJECT_ROOT, file));
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `default test tree MUST NOT import lib/diagram. offenders: ${offenders.join(', ')}`,
    );
  });

  it('Scenario: MDR-003-S2 — package.json managed diagram scripts/files cleaned', () => {
    const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8'));
    const scripts = pkg.scripts || {};
    assert.equal(
      Object.prototype.hasOwnProperty.call(scripts, 'test:diagram'),
      false,
      'scripts.test:diagram MUST be removed',
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(scripts, 'verify:diagram-production'),
      false,
      'scripts.verify:diagram-production MUST be removed',
    );

    const files = pkg.files || [];
    assert.equal(
      files.includes('docs/diagram-runtime.md'),
      false,
      'package.json files MUST NOT distribute docs/diagram-runtime.md as managed ops contract',
    );
  });
});

// ---------------------------------------------------------------------------
// MDR-004 / MDR-006 — docs surfaces (filesystem contract, not Skill UX)
// ---------------------------------------------------------------------------

describe('MDR-004 / MDR-006 Docs no longer teach managed control plane', () => {
  it('Scenario: MDR-004-S1 — howto MUST NOT guide specline diagram plan/install/configure', () => {
    const howto = join(
      PROJECT_ROOT,
      'docs',
      'knowledge',
      'howtos',
      'local-drawio-diagrams.md',
    );
    if (!existsSync(howto)) {
      // File may be deleted entirely; that also satisfies "rewrite or delete"
      return;
    }
    const text = readFileSync(howto, 'utf-8');
    assert.doesNotMatch(
      text,
      /specline\s+diagram\s+(plan|install|configure)\b/i,
      'howto MUST NOT guide managed specline diagram plan/install/configure',
    );
    assert.match(
      text,
      /@next-ai-drawio\/mcp-server|上游 MCP|specline-diagram/i,
      'howto (if kept) MUST describe thin Skill + upstream MCP setup',
    );
  });

  it('Scenario: MDR-004-S2 — old ADR superseded and new ADR records convenience entry', () => {
    const oldAdr = join(
      PROJECT_ROOT,
      'docs',
      'knowledge',
      'decisions',
      '2026-08-02-local-drawio-diagram-skill.md',
    );
    assert.ok(existsSync(oldAdr), 'old ADR file SHOULD remain for supersede trail');
    const oldText = readFileSync(oldAdr, 'utf-8');
    assert.match(oldText, /superseded|已被取代|已取代/i, '2026-08-02 ADR MUST show superseded');

    const newAdr = join(
      PROJECT_ROOT,
      'docs',
      'knowledge',
      'decisions',
      '2026-08-03-diagram-upstream-mcp-convenience.md',
    );
    assert.ok(existsSync(newAdr), 'new ADR MUST exist for convenience-entry decision');
    const newText = readFileSync(newAdr, 'utf-8');
    assert.match(
      newText,
      /便利入口|上游 MCP|删除受管|convenience/i,
      'new ADR MUST record convenience entry / managed-control-plane removal',
    );
  });

  it('Scenario: MDR-006-S1 — Skill/docs MUST NOT recommend managed advanced mode', () => {
    const skill = join(PROJECT_ROOT, 'core', 'skills', 'specline-diagram', 'SKILL.md');
    assert.ok(existsSync(skill), 'specline-diagram Skill source MUST exist');
    const skillText = readFileSync(skill, 'utf-8');
    // Spec: MUST NOT guide users to enable managed advanced mode OR restore
    // `specline diagram mcp` as the recommended path. Mentions inside bans /
    // migration ("remove old specline-diagram entry") are allowed.
    assert.doesNotMatch(
      skillText,
      /启用\s*受管\s*diagram\s*高级模式|推荐.*specline\s+diagram\s+mcp|使用\s*`?specline\s+diagram\s+mcp`?\s*(作为|来)|command\s*[:=]\s*["']?specline["']?[\s\S]{0,80}diagram\s+mcp/i,
      'Skill MUST NOT recommend enabling managed advanced mode or specline diagram mcp',
    );

    const readme = join(PROJECT_ROOT, 'README.md');
    if (existsSync(readme)) {
      const readmeText = readFileSync(readme, 'utf-8');
      assert.doesNotMatch(
        readmeText,
        /启用.*受管 diagram 高级模式|推荐.*specline diagram mcp/i,
        'README MUST NOT recommend restoring managed diagram MCP path',
      );
    }
  });
});

// ---------------------------------------------------------------------------
// DCE-006 — package.json MUST NOT add next-ai-drawio as resident dependency
// ---------------------------------------------------------------------------

describe('DCE-006 Unchanged product boundaries (package surface)', () => {
  it('Scenario: DCE-006-S2 — package.json MUST NOT add @next-ai-drawio/mcp-server dependency', () => {
    const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8'));
    for (const field of ['dependencies', 'optionalDependencies', 'devDependencies', 'peerDependencies']) {
      const deps = pkg[field] || {};
      assert.equal(
        Object.keys(deps).some((name) => name.includes('next-ai-drawio')),
        false,
        `${field} MUST NOT include next-ai-drawio resident dependency`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// DCE-007 — user diagrams artifacts preserved (repo tree check)
// ---------------------------------------------------------------------------

describe('DCE-007 Preserve user artifacts', () => {
  it('Scenario: DCE-007-S1 — specline/diagrams path is not removed as product deletion', () => {
    // Change MUST NOT force-delete the user artifact directory convention.
    // If the directory exists in this repo, it must remain a directory.
    const diagrams = join(PROJECT_ROOT, 'specline', 'diagrams');
    if (existsSync(diagrams)) {
      assert.ok(statSync(diagrams).isDirectory(), 'specline/diagrams MUST remain a directory');
    }
    // Absence in a fresh clone is also fine; the contract is "do not force-delete".
  });
});

after(() => {
  // no temp dirs in this suite
});
