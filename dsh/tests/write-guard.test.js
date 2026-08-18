import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { parentWriteAllowed } from '../lib/write-guard.js';

describe('parentWriteAllowed — parent session', () => {
  for (const parentSession of [undefined, null, '']) {
    const label = parentSession === '' ? 'empty string' : String(parentSession);

    it(`allows Specline runtime paths when parentSession is ${label}`, () => {
      assert.equal(parentWriteAllowed('specline/changes/dsh-plugin/proposal.md', parentSession), true);
      assert.equal(parentWriteAllowed('specline/changes/dsh-plugin/.pipeline-state.json', parentSession), true);
      assert.equal(parentWriteAllowed('specline/.pipeline-sessions.json', parentSession), true);
      assert.equal(parentWriteAllowed('.pipeline-state.json', parentSession), true);
      assert.equal(parentWriteAllowed('.pipeline-sessions.json', parentSession), true);
      assert.equal(parentWriteAllowed('specline/changes/dsh-plugin/.tmp/task-9-result.json', parentSession), true);
      assert.equal(parentWriteAllowed('.tmp/gate-output.json', parentSession), true);
    });

    it(`denies application source when parentSession is ${label}`, () => {
      assert.equal(parentWriteAllowed('src/app.ts', parentSession), false);
      assert.equal(parentWriteAllowed('lib/gate.mjs', parentSession), false);
      assert.equal(parentWriteAllowed('package.json', parentSession), false);
      assert.equal(parentWriteAllowed('specline/config.yaml', parentSession), false);
      assert.equal(parentWriteAllowed('dsh/src/write-guard.ts', parentSession), false);
      assert.equal(parentWriteAllowed('.dsh/skills/pipeline.md', parentSession), false);
      assert.equal(parentWriteAllowed('specline/changes/../src/app.ts', parentSession), false);
    });
  }
});

describe('parentWriteAllowed — child session', () => {
  it('allows application source when parentSession is set', () => {
    assert.equal(parentWriteAllowed('src/app.ts', 'sess-parent'), true);
    assert.equal(parentWriteAllowed('lib/gate.mjs', 'parent-1'), true);
    assert.equal(parentWriteAllowed('package.json', 'p'), true);
    assert.equal(parentWriteAllowed('dsh/src/write-guard.ts', 'orchestrator'), true);
    assert.equal(parentWriteAllowed('specline/changes/foo/spec.md', 'sess-parent'), true);
  });
});
