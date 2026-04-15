/**
 * Runs the SessionStore conformance fixtures against the in-memory
 * reference store. Every production adapter should pass the same suite;
 * adapter-specific tests live in their respective packages.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SESSION_STORE_FIXTURES,
  runSessionStoreConformance,
} from './conformance.js';
import { createInMemorySessionStore } from './in-memory-session-store.js';

describe('SessionStore conformance — in-memory reference', () => {
  it('all three fixtures pass', async () => {
    // All workers share the same underlying store.
    const store = createInMemorySessionStore();
    const results = await runSessionStoreConformance(() => store, DEFAULT_SESSION_STORE_FIXTURES);
    for (const r of results) {
      assert.equal(r.result.passed, true, `${r.name}: ${r.result.passed ? '' : r.result.reason}`);
    }
    assert.equal(results.length, 3);
  });
});
