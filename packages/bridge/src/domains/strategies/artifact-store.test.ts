import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryArtifactStore, createArtifactStore } from './artifact-store.js';
import type { ArtifactStore } from './artifact-store.js';

// ── ArtifactStore Unit Tests (PRD 017 Phase 1a) ──────────────

describe('InMemoryArtifactStore', () => {
  describe('put()', () => {
    it('creates version 1 on first write', () => {
      const store = new InMemoryArtifactStore();
      const v = store.put('plan', { steps: ['a', 'b'] }, 'planner-node');

      assert.equal(v.artifact_id, 'plan');
      assert.equal(v.version, 1);
      assert.deepEqual(v.content, { steps: ['a', 'b'] });
      assert.equal(v.producer_node_id, 'planner-node');
      assert.ok(v.timestamp, 'timestamp should be set');
      // Validate ISO 8601 format
      assert.ok(!isNaN(Date.parse(v.timestamp)), 'timestamp should be valid ISO 8601');
    });

    it('increments version on subsequent writes', () => {
      const store = new InMemoryArtifactStore();
      const v1 = store.put('code', 'function a() {}', 'coder');
      const v2 = store.put('code', 'function a() { return 1; }', 'coder');
      const v3 = store.put('code', 'function a() { return 2; }', 'reviewer');

      assert.equal(v1.version, 1);
      assert.equal(v2.version, 2);
      assert.equal(v3.version, 3);
      assert.equal(v3.producer_node_id, 'reviewer');
    });
  });

  describe('get()', () => {
    it('returns the latest version', () => {
      const store = new InMemoryArtifactStore();
      store.put('doc', 'draft 1', 'writer');
      store.put('doc', 'draft 2', 'writer');
      store.put('doc', 'final', 'editor');

      const latest = store.get('doc');
      assert.ok(latest);
      assert.equal(latest.version, 3);
      assert.equal(latest.content, 'final');
      assert.equal(latest.producer_node_id, 'editor');
    });

    it('returns null for non-existent artifact', () => {
      const store = new InMemoryArtifactStore();
      assert.equal(store.get('does-not-exist'), null);
    });
  });

  describe('getVersion()', () => {
    it('returns a specific version (1-indexed)', () => {
      const store = new InMemoryArtifactStore();
      store.put('config', { debug: false }, 'init');
      store.put('config', { debug: true }, 'toggle');

      const v1 = store.getVersion('config', 1);
      assert.ok(v1);
      assert.deepEqual(v1.content, { debug: false });
      assert.equal(v1.producer_node_id, 'init');

      const v2 = store.getVersion('config', 2);
      assert.ok(v2);
      assert.deepEqual(v2.content, { debug: true });
      assert.equal(v2.producer_node_id, 'toggle');
    });

    it('returns null for non-existent version', () => {
      const store = new InMemoryArtifactStore();
      store.put('x', 'data', 'producer');

      assert.equal(store.getVersion('x', 0), null);
      assert.equal(store.getVersion('x', 2), null);
      assert.equal(store.getVersion('x', -1), null);
    });

    it('returns null for non-existent artifact', () => {
      const store = new InMemoryArtifactStore();
      assert.equal(store.getVersion('ghost', 1), null);
    });
  });

  describe('snapshot()', () => {
    it('returns frozen object with latest versions', () => {
      const store = new InMemoryArtifactStore();
      store.put('plan', 'v1', 'planner');
      store.put('plan', 'v2', 'planner');
      store.put('code', 'impl', 'coder');

      const snap = store.snapshot();

      assert.equal(Object.keys(snap).length, 2);
      assert.equal(snap['plan'].version, 2);
      assert.equal(snap['plan'].content, 'v2');
      assert.equal(snap['code'].version, 1);
      assert.equal(snap['code'].content, 'impl');

      // Frozen — mutations should throw
      assert.ok(Object.isFrozen(snap));
      assert.throws(() => {
        (snap as Record<string, unknown>)['new_key'] = 'fail';
      }, TypeError);
    });

    it('is independent of subsequent puts (immutability)', () => {
      const store = new InMemoryArtifactStore();
      store.put('file', 'original', 'writer');

      const snap = store.snapshot();
      assert.equal(snap['file'].content, 'original');

      // Put a new version after snapshot
      store.put('file', 'updated', 'writer');
      store.put('new-artifact', 'data', 'producer');

      // Snapshot should be unchanged
      assert.equal(snap['file'].content, 'original');
      assert.equal(snap['file'].version, 1);
      assert.equal(snap['new-artifact'], undefined);
    });
  });

  describe('history()', () => {
    it('returns all versions in order', () => {
      const store = new InMemoryArtifactStore();
      store.put('report', 'draft', 'analyst');
      store.put('report', 'revised', 'analyst');
      store.put('report', 'final', 'reviewer');

      const hist = store.history('report');
      assert.equal(hist.length, 3);
      assert.equal(hist[0].version, 1);
      assert.equal(hist[0].content, 'draft');
      assert.equal(hist[1].version, 2);
      assert.equal(hist[1].content, 'revised');
      assert.equal(hist[2].version, 3);
      assert.equal(hist[2].content, 'final');
      assert.equal(hist[2].producer_node_id, 'reviewer');
    });

    it('returns empty array for non-existent artifact', () => {
      const store = new InMemoryArtifactStore();
      const hist = store.history('nothing');
      assert.deepEqual(hist, []);
    });

    it('returns a defensive copy (not the internal array)', () => {
      const store = new InMemoryArtifactStore();
      store.put('data', 'v1', 'p');

      const hist1 = store.history('data');
      hist1.push({
        artifact_id: 'data',
        version: 99,
        content: 'injected',
        producer_node_id: 'attacker',
        timestamp: new Date().toISOString(),
      });

      const hist2 = store.history('data');
      assert.equal(hist2.length, 1, 'internal state should not be affected by external mutation');
    });
  });

  describe('multiple artifacts', () => {
    it('can coexist independently', () => {
      const store = new InMemoryArtifactStore();
      store.put('alpha', 'a1', 'node-a');
      store.put('beta', 'b1', 'node-b');
      store.put('alpha', 'a2', 'node-a');
      store.put('gamma', 'g1', 'node-c');
      store.put('beta', 'b2', 'node-b');

      assert.equal(store.get('alpha')!.version, 2);
      assert.equal(store.get('alpha')!.content, 'a2');
      assert.equal(store.get('beta')!.version, 2);
      assert.equal(store.get('beta')!.content, 'b2');
      assert.equal(store.get('gamma')!.version, 1);

      assert.equal(store.history('alpha').length, 2);
      assert.equal(store.history('beta').length, 2);
      assert.equal(store.history('gamma').length, 1);

      const snap = store.snapshot();
      assert.equal(Object.keys(snap).length, 3);
    });
  });

  describe('createArtifactStore()', () => {
    it('returns a functional ArtifactStore', () => {
      const store: ArtifactStore = createArtifactStore();
      const v = store.put('test', 42, 'factory-test');
      assert.equal(v.version, 1);
      assert.equal(store.get('test')!.content, 42);
    });
  });
});
