import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PLUGIN_BUNDLE_PATCH,
  PROFILE_PATCH_BASENAME,
  bundleEnablesDrawio,
  buildDrawioPatchEntry,
  isPluginBundlePatch,
  isProjectLevelMcp,
  resolveDiagramFlow,
  shouldUpsertDrawio,
} from '../lib/diagram-mcp.js';

const PROFILE_PATCH = '/Users/demo/.dsh/profiles/web/cordis.patch.yml';
const PLUGIN_PATCH = join(
  fileURLToPath(new URL('../', import.meta.url)),
  PROFILE_PATCH_BASENAME,
);

describe('bundleEnablesDrawio', () => {
  it('is always false (drawio is not a default bundle MCP)', () => {
    assert.equal(bundleEnablesDrawio(), false);
  });
});

describe('buildDrawioPatchEntry', () => {
  it('matches the design upsert YAML shape', () => {
    assert.deepEqual(buildDrawioPatchEntry(), {
      id: 'mcp-drawio',
      name: '@deepseek-ai/dsh-mcp-client',
      config: {
        serverName: 'drawio',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@next-ai-drawio/mcp-server@latest'],
      },
    });
  });
});

describe('resolveDiagramFlow', () => {
  it('draws directly and does not upsert when drawio tools already exist', () => {
    const result = resolveDiagramFlow({
      hasDrawioTool: true,
      userConsent: true,
      currentProfilePatchPath: PROFILE_PATCH,
      targetPath: PROFILE_PATCH,
    });
    assert.equal(result.shouldUpsert, false);
    assert.equal(shouldUpsertDrawio({
      hasDrawioTool: true,
      currentProfilePatchPath: PROFILE_PATCH,
    }), false);
    assert.equal(result.drawDirect, true);
    assert.equal(result.askUser, false);
    assert.equal(result.fallbackAscii, false);
    assert.equal(result.writePluginPatch, false);
    assert.equal(result.writeProjectMcp, false);
  });

  it('asks before writing when tools are missing and consent is unknown', () => {
    const result = resolveDiagramFlow({
      hasDrawioTool: false,
      userConsent: null,
      currentProfilePatchPath: PROFILE_PATCH,
    });
    assert.equal(result.shouldUpsert, false);
    assert.equal(result.askUser, true);
    assert.equal(result.drawDirect, false);
    assert.equal(result.fallbackAscii, false);
  });

  it('does not write and falls back to ASCII when the user declines', () => {
    const result = resolveDiagramFlow({
      hasDrawioTool: false,
      userConsent: false,
      currentProfilePatchPath: PROFILE_PATCH,
      targetPath: PROFILE_PATCH,
    });
    assert.equal(result.shouldUpsert, false);
    assert.equal(result.fallbackAscii, true);
    assert.equal(result.askUser, false);
    assert.equal(result.writePluginPatch, false);
    assert.equal(result.writeProjectMcp, false);
  });

  it('upserts only the current profile cordis.patch.yml after consent', () => {
    const result = resolveDiagramFlow({
      hasDrawioTool: false,
      userConsent: true,
      currentProfilePatchPath: PROFILE_PATCH,
      targetPath: PROFILE_PATCH,
    });
    assert.equal(result.shouldUpsert, true);
    assert.equal(result.target, 'current-profile');
    assert.equal(result.fallbackAscii, false);
    assert.equal(result.writePluginPatch, false);
    assert.equal(result.writeProjectMcp, false);
    assert.equal(basenameOf(PROFILE_PATCH), PROFILE_PATCH_BASENAME);
  });

  it('refuses the plugin package cordis.patch.yml and falls back to ASCII', () => {
    assert.equal(isPluginBundlePatch(PLUGIN_PATCH), true);
    assert.equal(isPluginBundlePatch(PLUGIN_BUNDLE_PATCH), true);
    const result = resolveDiagramFlow({
      hasDrawioTool: false,
      userConsent: true,
      currentProfilePatchPath: PROFILE_PATCH,
      targetPath: PLUGIN_PATCH,
    });
    assert.equal(result.shouldUpsert, false);
    assert.equal(result.fallbackAscii, true);
    assert.equal(result.writePluginPatch, false);
  });

  it('refuses project-level MCP files', () => {
    const projectMcp = '/repo/.dsh/mcp.json';
    const cursorMcp = '/repo/.cursor/mcp.json';
    assert.equal(isProjectLevelMcp(projectMcp), true);
    assert.equal(isProjectLevelMcp(cursorMcp), true);
    for (const targetPath of [projectMcp, cursorMcp]) {
      const result = resolveDiagramFlow({
        hasDrawioTool: false,
        userConsent: true,
        currentProfilePatchPath: PROFILE_PATCH,
        targetPath,
      });
      assert.equal(result.shouldUpsert, false);
      assert.equal(result.writeProjectMcp, false);
      assert.equal(result.fallbackAscii, true);
    }
  });

  it('does not mutate the plugin bundle patch file', () => {
    const before = readFileSync(PLUGIN_PATCH, 'utf8');
    resolveDiagramFlow({
      hasDrawioTool: false,
      userConsent: true,
      currentProfilePatchPath: PROFILE_PATCH,
      targetPath: PLUGIN_PATCH,
    });
    shouldUpsertDrawio({
      hasDrawioTool: false,
      userConsent: true,
      currentProfilePatchPath: PROFILE_PATCH,
      targetPath: PLUGIN_PATCH,
    });
    const after = readFileSync(PLUGIN_PATCH, 'utf8');
    assert.equal(after, before);
    assert.equal(before.includes('mcp-drawio'), false);
    assert.equal(before.includes('dsh-mcp-client'), false);
  });
});

function basenameOf(p) {
  return p.split('/').pop();
}
