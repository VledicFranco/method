// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for Verifier cognitive module (PRD 048).
 *
 * Tests: programmatic KPI checks, LLM fallback, CorrectionSignal production,
 * consecutiveFailures tracking, no-check + no-provider pass-through,
 * mixed mode (programmatic + LLM), empty KPI list, state invariant,
 * LLM parse failure handling, multi-step failure streak.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { moduleId } from '../../algebra/index.js';
import type {
  ModuleId,
  ProviderAdapter,
  AdapterConfig,
  ProviderAdapterResult,
  ReadonlyWorkspaceSnapshot,
  CheckableKPI,
  VerificationState,
  KPICheckResult,
} from '../../algebra/index.js';
import { createVerifier } from '../verifier.js';
import type { VerifierInput, VerifierControl, VerifierState as VState } from '../verifier.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeControl(): VerifierControl {
  return {
    target: moduleId('verifier'),
    timestamp: Date.now(),
  };
}

function makeInput(overrides?: Partial<VerifierInput>): VerifierInput {
  return {
    lastAction: overrides?.lastAction ?? { tool: 'write_file', input: { path: 'src/handler.ts' }, result: { success: true } },
    workspaceSnapshot: overrides?.workspaceSnapshot ?? [],
    kpis: overrides?.kpis ?? [],
    currentSubgoal: overrides?.currentSubgoal ?? 'Create handler file',
  };
}

function makeCheckableKPI(
  description: string,
  check?: (state: VerificationState) => KPICheckResult,
): CheckableKPI {
  return {
    description,
    check,
    met: false,
    evidence: '',
  };
}

function makeMockProvider(response: string): ProviderAdapter {
  return {
    async invoke(
      _snapshot: ReadonlyWorkspaceSnapshot,
      _config: AdapterConfig,
    ): Promise<ProviderAdapterResult> {
      return {
        output: response,
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 150,
        },
        cost: { totalUsd: 0.001, perModel: {} },
      };
    },
  };
}

function makeFailingProvider(): ProviderAdapter {
  return {
    async invoke(): Promise<ProviderAdapterResult> {
      throw new Error('LLM provider unavailable');
    },
  };
}

/**
 * Build a workspace snapshot with file entries for programmatic checks.
 * Uses structured { path, content } entries that the verifier can extract.
 */
function makeFileSnapshot(files: Record<string, string>): ReadonlyWorkspaceSnapshot {
  return Object.entries(files).map(([path, content]) => ({
    source: `file:${path}` as ModuleId,
    content,
    salience: 1.0,
    timestamp: Date.now(),
  }));
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Verifier module', () => {

  // ── 1. Programmatic check: fileExists passes ──────────────────

  it('programmatic check passes when file exists in workspace', async () => {
    const verifier = createVerifier();
    const state = verifier.initialState();

    const kpis: CheckableKPI[] = [
      makeCheckableKPI('handler file created', (vs) => {
        const exists = vs.files.has('src/handler.ts');
        return { met: exists, evidence: exists ? 'src/handler.ts exists' : 'src/handler.ts missing' };
      }),
    ];

    const snapshot = makeFileSnapshot({ 'src/handler.ts': 'export function handle() {}' });
    const input = makeInput({ kpis, workspaceSnapshot: snapshot });

    const result = await verifier.step(input, state, makeControl());

    assert.equal(result.output.verification.verified, true);
    assert.equal(result.output.verification.kpiStatus.length, 1);
    assert.equal(result.output.verification.kpiStatus[0].met, true);
    assert.equal(result.output.correctionSignal, undefined);
    assert.equal(result.monitoring.verified, true);
    assert.equal(result.monitoring.kpisChecked, 1);
    assert.equal(result.monitoring.kpisPassing, 1);
    assert.equal(result.monitoring.failureStreak, 0);
    assert.equal(result.monitoring.type, 'verifier');
  });

  // ── 2. Programmatic check: fileExists fails ───────────────────

  it('programmatic check fails when file missing from workspace', async () => {
    const verifier = createVerifier();
    const state = verifier.initialState();

    const kpis: CheckableKPI[] = [
      makeCheckableKPI('handler file created', (vs) => {
        const exists = vs.files.has('src/handler.ts');
        return { met: exists, evidence: exists ? 'src/handler.ts exists' : 'src/handler.ts missing' };
      }),
    ];

    // Empty workspace — no files
    const input = makeInput({ kpis, workspaceSnapshot: [] });

    const result = await verifier.step(input, state, makeControl());

    assert.equal(result.output.verification.verified, false);
    assert.equal(result.output.verification.kpiStatus[0].met, false);
    assert.ok(result.output.verification.diagnosis);
    assert.ok(result.output.correctionSignal);
    assert.equal(result.output.correctionSignal!.unmetKPIs.length, 1);
    assert.equal(result.output.correctionSignal!.unmetKPIs[0], 'handler file created');
    assert.equal(result.output.correctionSignal!.failureCount, 1);
    assert.equal(result.monitoring.verified, false);
    assert.equal(result.monitoring.failureStreak, 1);
  });

  // ── 3. LLM fallback with mock provider ────────────────────────

  it('uses LLM fallback for KPIs without check()', async () => {
    const llmResponse = JSON.stringify({
      results: [
        { kpi: 'tests pass', met: true, evidence: 'All 12 tests green' },
      ],
    });
    const provider = makeMockProvider(llmResponse);
    const verifier = createVerifier(provider);
    const state = verifier.initialState();

    const kpis: CheckableKPI[] = [
      makeCheckableKPI('tests pass'), // No check() — requires LLM
    ];

    const input = makeInput({ kpis });
    const result = await verifier.step(input, state, makeControl());

    assert.equal(result.output.verification.verified, true);
    assert.equal(result.output.verification.kpiStatus.length, 1);
    assert.equal(result.output.verification.kpiStatus[0].met, true);
    assert.equal(result.output.verification.kpiStatus[0].evidence, 'All 12 tests green');
    assert.equal(result.output.correctionSignal, undefined);
  });

  // ── 4. LLM fallback reports failure ───────────────────────────

  it('LLM fallback produces CorrectionSignal when KPI not met', async () => {
    const llmResponse = JSON.stringify({
      results: [
        { kpi: 'endpoint returns 200', met: false, evidence: 'Endpoint returns 404 — route not registered' },
      ],
    });
    const provider = makeMockProvider(llmResponse);
    const verifier = createVerifier(provider);
    const state = verifier.initialState();

    const kpis: CheckableKPI[] = [
      makeCheckableKPI('endpoint returns 200'),
    ];

    const input = makeInput({ kpis });
    const result = await verifier.step(input, state, makeControl());

    assert.equal(result.output.verification.verified, false);
    assert.ok(result.output.correctionSignal);
    assert.equal(result.output.correctionSignal!.unmetKPIs[0], 'endpoint returns 200');
    assert.equal(result.output.correctionSignal!.failureCount, 1);
    assert.ok(result.output.verification.diagnosis!.includes('endpoint returns 200'));
  });

  // ── 5. CorrectionSignal structure on failure ──────────────────

  it('CorrectionSignal contains problem, suggestion, unmetKPIs, and failureCount', async () => {
    const verifier = createVerifier();
    const state = verifier.initialState();

    const kpis: CheckableKPI[] = [
      makeCheckableKPI('file A created', (vs) => ({
        met: vs.files.has('a.ts'),
        evidence: vs.files.has('a.ts') ? 'a.ts exists' : 'a.ts missing',
      })),
      makeCheckableKPI('file B created', (vs) => ({
        met: vs.files.has('b.ts'),
        evidence: vs.files.has('b.ts') ? 'b.ts exists' : 'b.ts missing',
      })),
    ];

    // Only file A exists
    const snapshot = makeFileSnapshot({ 'a.ts': 'export const a = 1;' });
    const input = makeInput({ kpis, workspaceSnapshot: snapshot });

    const result = await verifier.step(input, state, makeControl());

    assert.equal(result.output.verification.verified, false);
    const cs = result.output.correctionSignal!;
    assert.ok(cs.problem.length > 0);
    assert.ok(cs.suggestion.length > 0);
    assert.deepEqual(cs.unmetKPIs, ['file B created']);
    assert.equal(cs.failureCount, 1);
  });

  // ── 6. consecutiveFailures tracks across steps ────────────────

  it('consecutiveFailures increments on failure and resets on success', async () => {
    const verifier = createVerifier();
    let state = verifier.initialState();

    const failingKpi: CheckableKPI[] = [
      makeCheckableKPI('always fails', () => ({ met: false, evidence: 'nope' })),
    ];

    const passingKpi: CheckableKPI[] = [
      makeCheckableKPI('always passes', () => ({ met: true, evidence: 'yes' })),
    ];

    // Step 1: failure
    const r1 = await verifier.step(
      makeInput({ kpis: failingKpi }),
      state,
      makeControl(),
    );
    assert.equal(r1.state.consecutiveFailures, 1);
    assert.equal(r1.monitoring.failureStreak, 1);

    // Step 2: another failure
    const r2 = await verifier.step(
      makeInput({ kpis: failingKpi }),
      r1.state,
      makeControl(),
    );
    assert.equal(r2.state.consecutiveFailures, 2);
    assert.equal(r2.monitoring.failureStreak, 2);
    assert.equal(r2.output.correctionSignal!.failureCount, 2);

    // Step 3: success — resets streak
    const r3 = await verifier.step(
      makeInput({ kpis: passingKpi }),
      r2.state,
      makeControl(),
    );
    assert.equal(r3.state.consecutiveFailures, 0);
    assert.equal(r3.monitoring.failureStreak, 0);
  });

  // ── 7. No check() + no provider → verified=true ──────────────

  it('returns verified=true when no check() and no provider available', async () => {
    const verifier = createVerifier(); // No provider
    const state = verifier.initialState();

    const kpis: CheckableKPI[] = [
      makeCheckableKPI('manual review needed'), // No check(), no provider
      makeCheckableKPI('visual inspection required'),
    ];

    const input = makeInput({ kpis });
    const result = await verifier.step(input, state, makeControl());

    assert.equal(result.output.verification.verified, true);
    assert.equal(result.output.verification.kpiStatus.length, 2);
    assert.equal(result.output.correctionSignal, undefined);
    // Both should be marked as met with explanation
    for (const status of result.output.verification.kpiStatus) {
      assert.equal(status.met, true);
      assert.ok(status.evidence.includes('assumed met'));
    }
  });

  // ── 8. Mixed mode: some programmatic, some LLM ───────────────

  it('handles mixed mode with some programmatic and some LLM KPIs', async () => {
    const llmResponse = JSON.stringify({
      results: [
        { kpi: 'integration tests pass', met: true, evidence: 'Tests green' },
      ],
    });
    const provider = makeMockProvider(llmResponse);
    const verifier = createVerifier(provider);
    const state = verifier.initialState();

    const kpis: CheckableKPI[] = [
      // Programmatic — will pass
      makeCheckableKPI('handler file exists', (vs) => ({
        met: vs.files.has('src/handler.ts'),
        evidence: vs.files.has('src/handler.ts') ? 'exists' : 'missing',
      })),
      // LLM fallback — will pass via mock
      makeCheckableKPI('integration tests pass'),
    ];

    const snapshot = makeFileSnapshot({ 'src/handler.ts': 'export function handle() {}' });
    const input = makeInput({ kpis, workspaceSnapshot: snapshot });

    const result = await verifier.step(input, state, makeControl());

    assert.equal(result.output.verification.verified, true);
    assert.equal(result.output.verification.kpiStatus.length, 2);
    assert.equal(result.monitoring.kpisChecked, 2);
    assert.equal(result.monitoring.kpisPassing, 2);
  });

  // ── 9. Empty KPI list → verified=true ─────────────────────────

  it('returns verified=true with empty KPI list', async () => {
    const verifier = createVerifier();
    const state = verifier.initialState();

    const input = makeInput({ kpis: [] });
    const result = await verifier.step(input, state, makeControl());

    assert.equal(result.output.verification.verified, true);
    assert.equal(result.output.verification.kpiStatus.length, 0);
    assert.equal(result.output.correctionSignal, undefined);
    assert.equal(result.monitoring.kpisChecked, 0);
    assert.equal(result.monitoring.kpisPassing, 0);
  });

  // ── 10. State invariant validation ────────────────────────────

  it('stateInvariant validates consecutiveFailures >= 0', () => {
    const verifier = createVerifier();

    assert.equal(verifier.stateInvariant!({ verificationHistory: [], consecutiveFailures: 0 }), true);
    assert.equal(verifier.stateInvariant!({ verificationHistory: [], consecutiveFailures: 5 }), true);
    assert.equal(verifier.stateInvariant!({ verificationHistory: [], consecutiveFailures: -1 }), false);
  });

  // ── 11. LLM parse failure → conservative not-met ──────────────

  it('marks KPIs as not met when LLM returns unparseable response', async () => {
    const provider = makeMockProvider('This is not valid JSON at all!');
    const verifier = createVerifier(provider);
    const state = verifier.initialState();

    const kpis: CheckableKPI[] = [
      makeCheckableKPI('route registered'),
    ];

    const input = makeInput({ kpis });
    const result = await verifier.step(input, state, makeControl());

    assert.equal(result.output.verification.verified, false);
    assert.equal(result.output.verification.kpiStatus[0].met, false);
    assert.ok(result.output.verification.kpiStatus[0].evidence.includes('parse'));
    assert.ok(result.output.correctionSignal);
  });

  // ── 12. LLM provider failure → conservative not-met ───────────

  it('marks KPIs as not met when LLM provider throws', async () => {
    const provider = makeFailingProvider();
    const verifier = createVerifier(provider);
    const state = verifier.initialState();

    const kpis: CheckableKPI[] = [
      makeCheckableKPI('deployment succeeded'),
    ];

    const input = makeInput({ kpis });
    const result = await verifier.step(input, state, makeControl());

    assert.equal(result.output.verification.verified, false);
    assert.equal(result.output.verification.kpiStatus[0].met, false);
    assert.ok(result.output.correctionSignal);
  });

  // ── 13. verificationHistory grows across steps ────────────────

  it('accumulates verification results in state history', async () => {
    const verifier = createVerifier();
    let state = verifier.initialState();

    const passingKpi: CheckableKPI[] = [
      makeCheckableKPI('always passes', () => ({ met: true, evidence: 'yes' })),
    ];

    assert.equal(state.verificationHistory.length, 0);

    const r1 = await verifier.step(makeInput({ kpis: passingKpi }), state, makeControl());
    assert.equal(r1.state.verificationHistory.length, 1);
    assert.equal(r1.state.verificationHistory[0].verified, true);

    const r2 = await verifier.step(makeInput({ kpis: passingKpi }), r1.state, makeControl());
    assert.equal(r2.state.verificationHistory.length, 2);
  });

  // ── 14. Module ID defaults and overrides ──────────────────────

  it('uses default id "verifier" and allows override', () => {
    const v1 = createVerifier();
    assert.equal(v1.id, 'verifier');

    const v2 = createVerifier(undefined, { id: 'verifier-2' });
    assert.equal(v2.id, 'verifier-2');
  });

  // ── 15. Monitoring signal has correct type ────────────────────

  it('monitoring signal has type "verifier" and correct source', async () => {
    const verifier = createVerifier(undefined, { id: 'v-1' });
    const state = verifier.initialState();

    const input = makeInput({ kpis: [] });
    const result = await verifier.step(input, state, makeControl());

    assert.equal(result.monitoring.type, 'verifier');
    assert.equal(result.monitoring.source, 'v-1');
    assert.equal(typeof result.monitoring.timestamp, 'number');
  });

  // ── 16. Mixed mode: programmatic fails, LLM passes ───────────

  it('reports failure when programmatic KPI fails even if LLM KPIs pass', async () => {
    const llmResponse = JSON.stringify({
      results: [
        { kpi: 'code review approved', met: true, evidence: 'Approved' },
      ],
    });
    const provider = makeMockProvider(llmResponse);
    const verifier = createVerifier(provider);
    const state = verifier.initialState();

    const kpis: CheckableKPI[] = [
      // Programmatic — will fail
      makeCheckableKPI('config.json exists', (vs) => ({
        met: vs.files.has('config.json'),
        evidence: vs.files.has('config.json') ? 'exists' : 'missing',
      })),
      // LLM — will pass
      makeCheckableKPI('code review approved'),
    ];

    const input = makeInput({ kpis, workspaceSnapshot: [] });
    const result = await verifier.step(input, state, makeControl());

    assert.equal(result.output.verification.verified, false);
    assert.equal(result.monitoring.kpisChecked, 2);
    assert.equal(result.monitoring.kpisPassing, 1);
    assert.ok(result.output.correctionSignal);
    assert.deepEqual(result.output.correctionSignal!.unmetKPIs, ['config.json exists']);
  });

  // ── 17. Structured file entries in workspace ──────────────────

  it('extracts files from structured workspace entries', async () => {
    const verifier = createVerifier();
    const state = verifier.initialState();

    const kpis: CheckableKPI[] = [
      makeCheckableKPI('index.ts exists', (vs) => ({
        met: vs.files.has('index.ts'),
        evidence: vs.files.has('index.ts') ? 'exists' : 'missing',
      })),
    ];

    // Structured entry format: { path, content }
    const snapshot: ReadonlyWorkspaceSnapshot = [
      {
        source: moduleId('actor-1'),
        content: { path: 'index.ts', content: 'export const x = 1;' },
        salience: 1.0,
        timestamp: Date.now(),
      },
    ];

    const input = makeInput({ kpis, workspaceSnapshot: snapshot });
    const result = await verifier.step(input, state, makeControl());

    assert.equal(result.output.verification.verified, true);
    assert.equal(result.output.verification.kpiStatus[0].met, true);
  });

  // ── 18. initialState returns clean state ──────────────────────

  it('initialState returns correct defaults', () => {
    const verifier = createVerifier();
    const state = verifier.initialState();

    assert.deepEqual(state.verificationHistory, []);
    assert.equal(state.consecutiveFailures, 0);
    assert.equal(state.workingMemory, undefined);
  });

  // ── 19. Multi-KPI: all fail → all listed in correction ────────

  it('lists all unmet KPIs in correction signal when multiple fail', async () => {
    const verifier = createVerifier();
    const state = verifier.initialState();

    const kpis: CheckableKPI[] = [
      makeCheckableKPI('file A', () => ({ met: false, evidence: 'missing' })),
      makeCheckableKPI('file B', () => ({ met: false, evidence: 'missing' })),
      makeCheckableKPI('file C', () => ({ met: false, evidence: 'missing' })),
    ];

    const input = makeInput({ kpis });
    const result = await verifier.step(input, state, makeControl());

    assert.equal(result.output.verification.verified, false);
    assert.equal(result.output.correctionSignal!.unmetKPIs.length, 3);
    assert.deepEqual(result.output.correctionSignal!.unmetKPIs, ['file A', 'file B', 'file C']);
    assert.ok(result.output.correctionSignal!.suggestion.includes('3 unmet KPIs'));
  });
});
