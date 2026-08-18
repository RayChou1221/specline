import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  diagramAsciiFallbackInvokesVisualize,
  resolveDiagramFailureFallback,
  resolveVisualizePath,
  visualizeCallsDiagramUpsert,
  visualizeUsesMcp,
} from '../lib/visualize-contract.js';
import { shouldUpsertDrawio } from '../lib/diagram-mcp.js';

describe('visualizeUsesMcp', () => {
  it('is always false', () => {
    assert.equal(visualizeUsesMcp(), false);
  });
});

describe('visualize path does not call diagram upsert', () => {
  it('visualizeCallsDiagramUpsert is false', () => {
    assert.equal(visualizeCallsDiagramUpsert(), false);
  });

  it('resolveVisualizePath never requires mcp-drawio or upsert', () => {
    const path = resolveVisualizePath();
    assert.equal(path.usesMcp, false);
    assert.equal(path.callsDiagramUpsert, false);
    assert.equal(path.requiresMcpDrawio, false);
    assert.equal(path.output, 'single-file-html');
  });

  it('visualize routing does not flip shouldUpsertDrawio', () => {
    assert.equal(visualizeCallsDiagramUpsert(), false);
    assert.equal(
      shouldUpsertDrawio({
        hasDrawioTool: true,
        currentProfilePatchPath: '/tmp/profiles/web/cordis.patch.yml',
      }),
      false,
    );
  });
});

describe('diagram ASCII fallback does not become visualize', () => {
  it('does not invoke visualize', () => {
    assert.equal(diagramAsciiFallbackInvokesVisualize(), false);
  });

  it('keeps ASCII, does not merge contracts, and does not interrupt Explore', () => {
    const fallback = resolveDiagramFailureFallback();
    assert.equal(fallback.fallback, 'ascii');
    assert.equal(fallback.invokeVisualize, false);
    assert.equal(fallback.mergeContracts, false);
    assert.equal(fallback.interruptExplore, false);
  });
});
