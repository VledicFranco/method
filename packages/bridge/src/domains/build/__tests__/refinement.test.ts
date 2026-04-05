/**
 * Refinement Engine — unit tests (PRD 047 C-2).
 *
 * Tests cover:
 * - produceRefinements with a slow phase → suggests optimization
 * - produceRefinements with a failure recovery → suggests gate improvement
 * - produceRefinements with custom criteria → suggests expanding validator
 * - produceRefinements with high orchestrator overhead → suggests prompt optimization
 * - aggregateFromReports deduplicates and ranks correctly
 * - aggregateFromReports respects frequency and confidence thresholds
 * - aggregateRefinements reads from YAML files on disk
 */

import { describe, it, beforeEach as before, afterEach as after } from 'vitest';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promises as fsPromises } from 'node:fs';
import * as yaml from 'js-yaml';

import { produceRefinements, aggregateFromReports, aggregateRefinements } from '../refinement.js';
import type { PhaseResult, EvidenceReport, Refinement } from '../types.js';
import type { FeatureSpec } from '../../../ports/checkpoint.js';

// ── Test setup ─────────────────────────────────────────────────

let testRetrosDir: string;

before(async () => {
  testRetrosDir = join(tmpdir(), `method-bridge-refine-test-${Date.now()}`);
  await fsPromises.mkdir(testRetrosDir, { recursive: true });
});

after(async () => {
  try {
    await fsPromises.rm(testRetrosDir, { recursive: true, force: true });
  } catch {
    // Non-fatal cleanup
  }
});

// ── Helpers ────────────────────────────────────────────────────

function makeSpec(overrides?: Partial<FeatureSpec>): FeatureSpec {
  return {
    requirement: 'Add user authentication',
    problem: 'Users cannot log in',
    criteria: [
      { name: 'login-works', type: 'command', check: 'npm test', expect: 'pass' },
    ],
    scope: { in: ['src/auth/'], out: ['src/unrelated/'] },
    constraints: ['Must use OAuth2'],
    ...overrides,
  };
}

function makePhase(overrides?: Partial<PhaseResult>): PhaseResult {
  return {
    phase: 'implement',
    status: 'completed',
    cost: { tokens: 10_000, usd: 0.10 },
    durationMs: 30_000,
    retries: 0,
    ...overrides,
  };
}

function makeReport(overrides?: Partial<EvidenceReport>): EvidenceReport {
  return {
    requirement: 'Test feature',
    phases: [],
    validation: { criteriaTotal: 1, criteriaPassed: 1, criteriaFailed: 0, details: [] },
    delivery: {
      totalCost: { tokens: 50_000, usd: 1.0 },
      orchestratorCost: { tokens: 5_000, usd: 0.10 },
      overheadPercent: 10,
      wallClockMs: 120_000,
      humanInterventions: 0,
      failureRecoveries: { attempted: 0, succeeded: 0 },
    },
    verdict: 'fully_validated',
    artifacts: {},
    refinements: [],
    ...overrides,
  };
}

// ── produceRefinements tests ───────────────────────────────────

describe('produceRefinements', () => {
  it('detects a slow phase (> 50% of total duration) and suggests optimization', () => {
    const phases: PhaseResult[] = [
      makePhase({ phase: 'explore', durationMs: 5_000 }),
      makePhase({ phase: 'implement', durationMs: 60_000 }),    // 85.7% of total
      makePhase({ phase: 'review', durationMs: 5_000 }),
    ];

    const refinements = produceRefinements(phases, makeSpec());

    const slowPhaseRefinement = refinements.find((r) => r.target === 'strategy' && r.proposal.includes('implement'));
    assert.ok(slowPhaseRefinement, 'should propose optimization for slow implement phase');
    assert.ok(slowPhaseRefinement.observation.includes('implement'));
    assert.ok(slowPhaseRefinement.evidence.includes('implement'));
  });

  it('does not flag a phase that is under 50% of total duration', () => {
    const phases: PhaseResult[] = [
      makePhase({ phase: 'explore', durationMs: 30_000 }),
      makePhase({ phase: 'implement', durationMs: 30_000 }),
      makePhase({ phase: 'review', durationMs: 30_000 }),
    ];

    const refinements = produceRefinements(phases, makeSpec());
    const slowPhaseRefinements = refinements.filter((r) => r.target === 'strategy');
    assert.equal(slowPhaseRefinements.length, 0, 'no phase exceeds 50% threshold');
  });

  it('detects failure recovery (retries > 0) and suggests gate improvement', () => {
    const phases: PhaseResult[] = [
      makePhase({ phase: 'implement', retries: 2, failureContext: 'type errors in output' }),
    ];

    const refinements = produceRefinements(phases, makeSpec());
    const retryRefinement = refinements.find((r) => r.target === 'gate');
    assert.ok(retryRefinement, 'should propose gate improvement for retried phase');
    assert.ok(retryRefinement.observation.includes('2 retry'));
    assert.ok(retryRefinement.observation.includes('type errors in output'));
  });

  it('detects custom criteria and suggests expanding validator', () => {
    const spec = makeSpec({
      criteria: [
        { name: 'manual-check', type: 'custom', check: 'verify manually', expect: 'looks right' },
      ],
    });

    const refinements = produceRefinements([], spec);
    const validatorRefinement = refinements.find((r) => r.target === 'bridge');
    assert.ok(validatorRefinement, 'should propose expanding validator for custom criteria');
    assert.ok(validatorRefinement.observation.includes('manual-check'));
    assert.ok(validatorRefinement.proposal.includes('manual-check'));
  });

  it('detects high orchestrator overhead (> 15%) and suggests prompt optimization', () => {
    const phases: PhaseResult[] = [
      makePhase({ phase: 'implement', durationMs: 10_000 }),
    ];

    const refinements = produceRefinements(phases, makeSpec(), {
      orchestratorCost: { tokens: 50_000, usd: 1.0 },
      totalCost: { tokens: 200_000, usd: 4.0 },  // 25% overhead
    });

    const overheadRefinement = refinements.find((r) => r.target === 'orchestrator');
    assert.ok(overheadRefinement, 'should propose prompt optimization for high overhead');
    assert.ok(overheadRefinement.observation.includes('25.0%'));
  });

  it('does not flag orchestrator overhead at or below 15%', () => {
    const phases: PhaseResult[] = [
      makePhase({ phase: 'implement', durationMs: 10_000 }),
    ];

    const refinements = produceRefinements(phases, makeSpec(), {
      orchestratorCost: { tokens: 10_000, usd: 0.10 },
      totalCost: { tokens: 100_000, usd: 1.0 },  // 10% overhead
    });

    const overheadRefinement = refinements.filter((r) => r.target === 'orchestrator');
    assert.equal(overheadRefinement.length, 0, 'should not flag 10% overhead');
  });
});

// ── aggregateFromReports tests ─────────────────────────────────

describe('aggregateFromReports', () => {
  it('deduplicates refinements by exact proposal string match', () => {
    const sharedProposal = 'Optimize strategy for phase "implement"';
    const reports: EvidenceReport[] = [
      makeReport({
        refinements: [
          { target: 'strategy', observation: 'slow A', proposal: sharedProposal, evidence: 'A' },
        ],
      }),
      makeReport({
        refinements: [
          { target: 'strategy', observation: 'slow B', proposal: sharedProposal, evidence: 'B' },
        ],
      }),
      makeReport({
        refinements: [
          { target: 'strategy', observation: 'slow C', proposal: sharedProposal, evidence: 'C' },
        ],
      }),
    ];

    const result = aggregateFromReports(reports, {
      refinementFrequencyThreshold: 2,
      refinementConfidenceThreshold: 0.5,
    });

    assert.equal(result.length, 1, 'should deduplicate to one unique proposal');
    assert.equal(result[0].frequency, 3);
    assert.equal(result[0].proposal, sharedProposal);
  });

  it('ranks by frequency descending', () => {
    const reports: EvidenceReport[] = [
      makeReport({
        refinements: [
          { target: 'gate', observation: 'x', proposal: 'fix gate A', evidence: 'e' },
          { target: 'strategy', observation: 'y', proposal: 'optimize B', evidence: 'e' },
        ],
      }),
      makeReport({
        refinements: [
          { target: 'strategy', observation: 'y', proposal: 'optimize B', evidence: 'e' },
          { target: 'gate', observation: 'x', proposal: 'fix gate A', evidence: 'e' },
          { target: 'strategy', observation: 'z', proposal: 'optimize B', evidence: 'e' },
        ],
      }),
    ];

    const result = aggregateFromReports(reports, {
      refinementFrequencyThreshold: 2,
      refinementConfidenceThreshold: 0.5,
    });

    assert.ok(result.length >= 1);
    // 'optimize B' appears 3 times, 'fix gate A' appears 2 times
    assert.equal(result[0].proposal, 'optimize B');
    assert.equal(result[0].frequency, 3);
    if (result.length > 1) {
      assert.equal(result[1].proposal, 'fix gate A');
      assert.equal(result[1].frequency, 2);
    }
  });

  it('filters out refinements below frequency threshold', () => {
    const reports: EvidenceReport[] = [
      makeReport({
        refinements: [
          { target: 'gate', observation: 'x', proposal: 'rare fix', evidence: 'e' },
        ],
      }),
      makeReport({
        refinements: [
          { target: 'strategy', observation: 'y', proposal: 'common fix', evidence: 'e' },
        ],
      }),
      makeReport({
        refinements: [
          { target: 'strategy', observation: 'y', proposal: 'common fix', evidence: 'e' },
        ],
      }),
    ];

    const result = aggregateFromReports(reports, {
      refinementFrequencyThreshold: 2,
      refinementConfidenceThreshold: 0.5,
    });

    assert.equal(result.length, 1);
    assert.equal(result[0].proposal, 'common fix');
  });

  it('filters out refinements below confidence threshold', () => {
    // 10 reports, proposal appears 2 times → confidence = 2/10 = 0.2, below 0.5
    const reports: EvidenceReport[] = Array.from({ length: 10 }, (_, i) =>
      makeReport({
        refinements: i < 2
          ? [{ target: 'gate', observation: 'x', proposal: 'low confidence', evidence: 'e' }]
          : [],
      }),
    );

    const result = aggregateFromReports(reports, {
      refinementFrequencyThreshold: 2,
      refinementConfidenceThreshold: 0.5,
    });

    assert.equal(result.length, 0, 'should filter out low-confidence refinement');
  });

  it('returns empty array when no reports', () => {
    const result = aggregateFromReports([], {
      refinementFrequencyThreshold: 2,
      refinementConfidenceThreshold: 0.5,
    });

    assert.deepEqual(result, []);
  });
});

// ── aggregateRefinements (filesystem) ──────────────────────────

describe('aggregateRefinements (filesystem)', () => {
  it('reads YAML retro files and aggregates refinements', async () => {
    const refinement: Refinement = {
      target: 'strategy',
      observation: 'slow implement',
      proposal: 'optimize implement phase',
      evidence: 'took 80% of time',
    };

    const report1 = makeReport({ refinements: [refinement] });
    const report2 = makeReport({ refinements: [refinement] });

    await fsPromises.writeFile(
      join(testRetrosDir, 'retro-build-001.yaml'),
      yaml.dump(report1),
      'utf-8',
    );
    await fsPromises.writeFile(
      join(testRetrosDir, 'retro-build-002.yaml'),
      yaml.dump(report2),
      'utf-8',
    );

    const result = await aggregateRefinements(testRetrosDir, {
      refinementFrequencyThreshold: 2,
      refinementConfidenceThreshold: 0.5,
    });

    assert.equal(result.length, 1);
    assert.equal(result[0].proposal, 'optimize implement phase');
    assert.equal(result[0].frequency, 2);
  });

  it('ignores non-retro-build files', async () => {
    // Create a file that doesn't match retro-build-*.yaml pattern
    await fsPromises.writeFile(
      join(testRetrosDir, 'retro-2024-01-01-001.yaml'),
      yaml.dump(makeReport({
        refinements: [{ target: 'gate', observation: 'x', proposal: 'should be ignored', evidence: 'e' }],
      })),
      'utf-8',
    );

    const result = await aggregateRefinements(testRetrosDir, {
      refinementFrequencyThreshold: 1,
      refinementConfidenceThreshold: 0.0,
    });

    const ignored = result.find((r) => r.proposal === 'should be ignored');
    assert.equal(ignored, undefined, 'non-build retro files should be ignored');
  });

  it('returns empty array when retros dir does not exist', async () => {
    const result = await aggregateRefinements('/nonexistent/path', {
      refinementFrequencyThreshold: 1,
      refinementConfidenceThreshold: 0.0,
    });

    assert.deepEqual(result, []);
  });
});
