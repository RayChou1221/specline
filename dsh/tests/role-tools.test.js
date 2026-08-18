import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CHILD_SESSION_CAN_GATE_ARCHIVE,
  CHILD_SESSION_MAX_DEPTH,
  FRONTEND_DEV_PERSONA_MODULE,
  ROLE_PERSONA_SOURCES,
  ROLE_TOOL_NAMES,
  createRoleToolConfigs,
  filterChildSessionTools,
} from '../lib/role-tools.js';

const EXPECTED_NAMES = [
  'specline_spec_creator',
  'specline_spec_reviewer',
  'specline_frontend_dev',
  'specline_backend_dev',
  'specline_config_dev',
  'specline_config_reviewer',
  'specline_code_reviewer',
  'specline_test_writer',
  'specline_test_runner',
  'specline_explore_assistant',
];

describe('ROLE_TOOL_NAMES', () => {
  it('lists exactly ten specline_* role tools in contract order', () => {
    assert.equal(ROLE_TOOL_NAMES.length, 10);
    assert.deepEqual([...ROLE_TOOL_NAMES], EXPECTED_NAMES);
  });
});

describe('createRoleToolConfigs', () => {
  it('returns ten dsh-tool-subagent instances', () => {
    const configs = createRoleToolConfigs();
    assert.equal(configs.length, 10);
    assert.deepEqual(
      configs.map((c) => c.toolName),
      EXPECTED_NAMES,
    );
    for (const config of configs) {
      assert.equal(config.kind, 'dsh-tool-subagent');
    }
  });

  it('maps each toolName to a core/agents yaml persona source', () => {
    const configs = createRoleToolConfigs();
    for (const config of configs) {
      assert.equal(config.personaSource, ROLE_PERSONA_SOURCES[config.toolName]);
      assert.match(config.personaSource, /^core\/agents\/specline-[a-z-]+\.yaml$/);
      assert.equal(
        config.personaSource,
        `core/agents/${config.toolName.replaceAll('_', '-')}.yaml`,
      );
    }
  });

  it('strips every role tool from the child session toolFilter', () => {
    const extra = ['bash', 'write', 'read'];
    const input = [...extra, ...ROLE_TOOL_NAMES, 'specline_gate'];
    const configs = createRoleToolConfigs();
    for (const config of configs) {
      assert.equal(config.maxDepth, CHILD_SESSION_MAX_DEPTH);
      assert.equal(config.maxDepth, 1);
      const filtered = config.toolFilter(input);
      assert.deepEqual(filtered, [...extra, 'specline_gate']);
      for (const name of ROLE_TOOL_NAMES) {
        assert.equal(filtered.includes(name), false, `${name} must be filtered`);
      }
    }
    assert.deepEqual(filterChildSessionTools(input), [...extra, 'specline_gate']);
  });

  it('does not allow child sessions to Gate archive', () => {
    const configs = createRoleToolConfigs();
    for (const config of configs) {
      assert.equal(config.canGateArchive, false);
      assert.equal(config.canGateArchive, CHILD_SESSION_CAN_GATE_ARCHIVE);
    }
  });

  it('points frontend_dev persona inlining at render-from-core without writing agent md', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-role-tools-'));
    try {
      const configs = createRoleToolConfigs();
      const frontend = configs.find((c) => c.toolName === 'specline_frontend_dev');
      assert.ok(frontend);
      assert.equal(frontend.inlineFrontendDesign, true);
      assert.equal(frontend.personaRendererModule, FRONTEND_DEV_PERSONA_MODULE);
      assert.equal(FRONTEND_DEV_PERSONA_MODULE, './render-from-core.js');
      for (const config of configs) {
        if (config.toolName !== 'specline_frontend_dev') {
          assert.equal(config.inlineFrontendDesign, false);
          assert.equal(config.personaRendererModule, undefined);
        }
      }
      assert.deepEqual(readdirSync(dir), []);
      assert.equal(existsSync(join(dir, '.cursor')), false);
      assert.equal(existsSync(join(dir, 'agents')), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
