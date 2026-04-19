// SPDX-License-Identifier: Apache-2.0
/**
 * SessionStore conformance fixtures — PRD-061 §8.2.
 *
 * Runnable against any `SessionStore` implementation. The three fixtures
 * cover the three acceptance scenarios from S4:
 *
 *   1. `resume-mid-turn`            — a session with N checkpoints survives a
 *                                     "container death" and a fresh worker
 *                                     resumes at the latest checkpoint with a
 *                                     new fencing token.
 *   2. `stale-lease-theft`          — a second worker receives FENCED while
 *                                     the first worker holds a live lease;
 *                                     after TTL expires the second worker's
 *                                     retry succeeds; the first worker's
 *                                     subsequent appendCheckpoint is FENCED.
 *   3. `schema-version-rejection`   — a v2 snapshot is rejected with
 *                                     SCHEMA_INCOMPATIBLE + retryable=false.
 *
 * The fixtures are published here (in `@methodts/runtime`) to keep the
 * PRD-061 deliverable self-contained. They will be re-exported from
 * `@methodts/pacta-testkit/conformance/session-store` once PRD-065's
 * conformance subpath settles (follow-up noted in the PRD).
 */

import type { SessionStore } from '../../ports/session-store.js';
import type {
  Checkpoint,
  SessionSnapshot,
} from '../../ports/session-store-types.js';
import { isSessionStoreError } from '../../ports/session-store-errors.js';

export type FixtureResult =
  | { readonly passed: true }
  | { readonly passed: false; readonly reason: string };

export interface SessionStoreConformanceFixture {
  readonly name:
    | 'resume-mid-turn'
    | 'stale-lease-theft'
    | 'schema-version-rejection';
  /**
   * Drives the fixture. Accepts a factory so it can instantiate multiple
   * "workers" against the same backing store — the store is created once
   * and shared across worker instances via the factory's captured state.
   */
  run(factory: SessionStoreFactory): Promise<FixtureResult>;
}

/**
 * A factory returns a `SessionStore` that points at the same backing store
 * on every call. Used to simulate multiple workers against shared storage.
 * Test harnesses that do not need multi-worker semantics can return a single
 * shared instance from every invocation.
 */
export type SessionStoreFactory = (workerHint?: string) => SessionStore;

function snap(fingerprint = 'sha256:conform'): SessionSnapshot {
  return {
    schemaVersion: 1,
    sessionId: 'conform_session',
    scopeId: 'conformance',
    pactRef: { id: 'pact', version: '1.0.0', fingerprint },
    status: 'running',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    latestCheckpointSequence: null,
    depth: 0,
  };
}

function checkpoint(sequence: number): Checkpoint {
  return {
    schemaVersion: 1,
    sequence,
    sessionId: 'conform_session',
    createdAt: new Date().toISOString(),
    eventCursor: { sequence: sequence * 100, id: `evt_${sequence}` },
    agentState: { kind: 'inline', data: { step: sequence } },
    pendingBudget: null,
    nextAction: sequence < 3 ? { kind: 'continue-turn' } : { kind: 'await-prompt' },
  };
}

// ── Fixture 1: resume-mid-turn ─────────────────────────────────────

export const resumeMidTurnFixture: SessionStoreConformanceFixture = {
  name: 'resume-mid-turn',
  async run(factory): Promise<FixtureResult> {
    const store = factory('worker-a');
    try {
      await store.create(snap());
      const rc = await store.resume('conform_session', 'worker-a');
      for (let i = 1; i <= 3; i++) {
        await store.appendCheckpoint('conform_session', checkpoint(i), rc.fencingToken);
      }
      await store.releaseLease('conform_session', rc.fencingToken);
    } catch (err) {
      return { passed: false, reason: `setup failed: ${(err as Error).message}` };
    }

    // Simulate container death — discard reference, fresh factory call.
    const fresh = factory('worker-b');
    const rc2 = await fresh.resume('conform_session', 'worker-b');
    if (rc2.checkpoint?.sequence !== 3) {
      return {
        passed: false,
        reason: `resumed checkpoint sequence was ${String(rc2.checkpoint?.sequence)}, expected 3`,
      };
    }
    const latest = await fresh.loadLatestCheckpoint('conform_session');
    if (latest?.sequence !== 3) {
      return {
        passed: false,
        reason: `loadLatestCheckpoint returned ${String(latest?.sequence)} expected 3`,
      };
    }
    // Cleanup.
    await fresh.destroy('conform_session');
    return { passed: true };
  },
};

// ── Fixture 2: stale-lease-theft ───────────────────────────────────

export const staleLeaseTheftFixture: SessionStoreConformanceFixture = {
  name: 'stale-lease-theft',
  async run(factory): Promise<FixtureResult> {
    const storeA = factory('worker-a');
    const storeB = factory('worker-b');
    try {
      await storeA.create(snap());
      const rcA = await storeA.resume('conform_session', 'worker-a');

      // Worker B tries to steal — expect FENCED.
      try {
        await storeB.resume('conform_session', 'worker-b');
        return { passed: false, reason: 'worker-b resume should have thrown FENCED' };
      } catch (err) {
        if (!isSessionStoreError(err) || err.code !== 'FENCED') {
          return {
            passed: false,
            reason: `expected FENCED, got ${(err as Error).message}`,
          };
        }
      }

      // Worker A can still appendCheckpoint with its token.
      await storeA.appendCheckpoint('conform_session', checkpoint(1), rcA.fencingToken);

      // Cleanup (do not test TTL expiry — the fixture does not assume a
      // clock override seam; that coverage lives in adapter-specific tests).
      await storeA.releaseLease('conform_session', rcA.fencingToken);
      await storeA.destroy('conform_session');
      return { passed: true };
    } catch (err) {
      return { passed: false, reason: (err as Error).message };
    }
  },
};

// ── Fixture 3: schema-version-rejection ────────────────────────────

export const schemaVersionRejectionFixture: SessionStoreConformanceFixture = {
  name: 'schema-version-rejection',
  async run(factory): Promise<FixtureResult> {
    const store = factory();
    try {
      await store.create({
        ...snap(),
        schemaVersion: 2 as unknown as 1,
      });
      return { passed: false, reason: 'schemaVersion=2 should have been rejected' };
    } catch (err) {
      if (!isSessionStoreError(err)) {
        return { passed: false, reason: `non-typed error: ${(err as Error).message}` };
      }
      if (err.code !== 'SCHEMA_INCOMPATIBLE') {
        return { passed: false, reason: `got ${err.code}, expected SCHEMA_INCOMPATIBLE` };
      }
      if (err.retryable !== false) {
        return { passed: false, reason: 'SCHEMA_INCOMPATIBLE should be non-retryable' };
      }
      return { passed: true };
    }
  },
};

export const DEFAULT_SESSION_STORE_FIXTURES: readonly SessionStoreConformanceFixture[] = [
  resumeMidTurnFixture,
  staleLeaseTheftFixture,
  schemaVersionRejectionFixture,
];

/**
 * Drive every fixture against the supplied factory. Returns per-fixture
 * verdicts without aborting on the first failure — callers inspect the list.
 */
export async function runSessionStoreConformance(
  factory: SessionStoreFactory,
  fixtures: readonly SessionStoreConformanceFixture[] = DEFAULT_SESSION_STORE_FIXTURES,
): Promise<Array<{ readonly name: string; readonly result: FixtureResult }>> {
  const out: Array<{ readonly name: string; readonly result: FixtureResult }> = [];
  for (const fixture of fixtures) {
    let result: FixtureResult;
    try {
      result = await fixture.run(factory);
    } catch (err) {
      result = { passed: false, reason: `threw: ${(err as Error).message}` };
    }
    out.push({ name: fixture.name, result });
  }
  return out;
}
