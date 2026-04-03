/**
 * Unit tests for goal-state discrepancy function.
 *
 * Tests: term extraction, constraint satisfaction, write detection,
 * term overlap, subgoal scoring, full discrepancy computation,
 * confidence estimation, GoalDiscrepancy builder, aspiration dynamics.
 *
 * PRD 045 / RFC 004.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { moduleId } from '../module.js';
import type { WorkspaceEntry } from '../workspace-types.js';
import type { GoalRepresentation } from '../goal-types.js';
import {
  extractKeyTerms,
  computeTermOverlap,
  checkConstraintSatisfaction,
  detectWriteActivity,
  computeSubgoalScore,
  computeDiscrepancy,
  estimateConfidence,
  buildGoalDiscrepancy,
  updateAspiration,
  DEFAULT_ASPIRATION,
  ASPIRATION_FLOOR,
  ASPIRATION_CEILING,
} from '../discrepancy-function.js';

// ── Helpers ────────────────────────────────────────────────────

function entry(content: string, source = 'test'): WorkspaceEntry {
  return {
    source: moduleId(source),
    content,
    salience: 0.5,
    timestamp: Date.now(),
  };
}

function goal(overrides: Partial<GoalRepresentation> = {}): GoalRepresentation {
  return {
    objective: 'Fix the applyDiscount function to use the correct formula',
    constraints: ['Do not modify the test expectations'],
    subgoals: [],
    aspiration: 0.80,
    ...overrides,
  };
}

// ── Term Extraction ────────────────────────────────────────────

describe('extractKeyTerms', () => {
  it('extracts meaningful terms (3+ chars)', () => {
    const terms = extractKeyTerms('Fix the applyDiscount function');
    assert.ok(terms.has('fix'));
    assert.ok(terms.has('applydiscount'));
    assert.ok(terms.has('function'));
    assert.ok(!terms.has('the')); // stop word
  });

  it('handles empty input', () => {
    assert.equal(extractKeyTerms('').size, 0);
  });

  it('deduplicates terms', () => {
    const terms = extractKeyTerms('fix fix fix the fix');
    assert.equal(terms.size, 1);
  });

  it('extracts snake_case identifiers', () => {
    const terms = extractKeyTerms('apply_discount calculate_total');
    assert.ok(terms.has('apply_discount'));
    assert.ok(terms.has('calculate_total'));
  });
});

// ── Constraint Satisfaction ────────────────────────────────────

describe('checkConstraintSatisfaction', () => {
  it('returns 1.0 for empty constraints', () => {
    assert.equal(checkConstraintSatisfaction([], []), 1.0);
  });

  it('returns 1.0 when prohibition terms are absent from workspace', () => {
    const workspace = [entry('The function looks correct')];
    const constraints = ['Do not import the notifications service'];
    const score = checkConstraintSatisfaction(workspace, constraints);
    assert.equal(score, 1.0);
  });

  it('returns 0.0 when prohibition terms appear in workspace', () => {
    const workspace = [entry('import { notifications } from notifications service')];
    const constraints = ['Must not import the notifications service'];
    const score = checkConstraintSatisfaction(workspace, constraints);
    assert.equal(score, 0.0);
  });
});

// ── Write Activity ─────────────────────────────────────────────

describe('detectWriteActivity', () => {
  it('returns 0.0 for read-only workspace', () => {
    const workspace = [entry('Read file src/index.ts'), entry('Grep found 3 matches')];
    assert.equal(detectWriteActivity(workspace), 0.0);
  });

  it('returns 1.0 when Write action detected', () => {
    const workspace = [entry('Write to src/index.ts: function fixed')];
    assert.equal(detectWriteActivity(workspace), 1.0);
  });

  it('returns 1.0 when Edit action detected', () => {
    const workspace = [entry('Edit src/utils.ts: modified line 42')];
    assert.equal(detectWriteActivity(workspace), 1.0);
  });
});

// ── Term Overlap ───────────────────────────────────────────────

describe('computeTermOverlap', () => {
  it('returns 0 for empty goal terms', () => {
    assert.equal(computeTermOverlap(new Set(), [entry('anything')]), 0);
  });

  it('returns 1.0 when all goal terms present', () => {
    const terms = new Set(['applydiscount', 'fix', 'formula']);
    const workspace = [entry('Fixed the applyDiscount formula correctly')];
    assert.equal(computeTermOverlap(terms, workspace), 1.0);
  });

  it('returns fractional score for partial overlap', () => {
    const terms = new Set(['applydiscount', 'fix', 'formula', 'missing']);
    const workspace = [entry('Fixed the applyDiscount function')];
    const overlap = computeTermOverlap(terms, workspace);
    assert.ok(overlap > 0 && overlap < 1);
  });
});

// ── Subgoal Score ──────────────────────────────────────────────

describe('computeSubgoalScore', () => {
  it('returns 0 for no subgoals', () => {
    assert.equal(computeSubgoalScore(goal()), 0);
  });

  it('returns 1.0 when all subgoals satisfied', () => {
    const g = goal({
      subgoals: [
        { description: 'Find the bug', satisfied: true },
        { description: 'Fix the bug', satisfied: true },
      ],
    });
    assert.equal(computeSubgoalScore(g), 1.0);
  });

  it('returns 0.5 when half satisfied', () => {
    const g = goal({
      subgoals: [
        { description: 'Find the bug', satisfied: true },
        { description: 'Fix the bug', satisfied: false },
      ],
    });
    assert.equal(computeSubgoalScore(g), 0.5);
  });
});

// ── Full Discrepancy ───────────────────────────────────────────

describe('computeDiscrepancy', () => {
  it('returns high discrepancy for empty workspace', () => {
    const d = computeDiscrepancy([], goal());
    assert.ok(d > 0.5, `Expected > 0.5, got ${d}`);
  });

  it('returns lower discrepancy when goal terms overlap and writes detected', () => {
    const workspace = [
      entry('Write to src/pricing.ts: fixed applyDiscount formula'),
      entry('The discount function now uses the correct calculation'),
    ];
    const d = computeDiscrepancy(workspace, goal());
    assert.ok(d < 0.5, `Expected < 0.5, got ${d}`);
  });

  it('uses subgoal scoring when subgoals defined', () => {
    const g = goal({
      subgoals: [
        { description: 'Find the bug', satisfied: true },
        { description: 'Fix the bug', satisfied: true },
      ],
    });
    const workspace = [entry('Fixed the applyDiscount formula')];
    const d = computeDiscrepancy(workspace, g);
    assert.ok(d < 0.3, `Expected < 0.3 with all subgoals satisfied, got ${d}`);
  });

  it('returns value in [0, 1]', () => {
    const d = computeDiscrepancy([entry('random content')], goal());
    assert.ok(d >= 0 && d <= 1, `Expected [0,1], got ${d}`);
  });
});

// ── Confidence ─────────────────────────────────────────────────

describe('estimateConfidence', () => {
  it('returns low confidence for vague goals', () => {
    const c = estimateConfidence(goal({ objective: 'do it', constraints: [], subgoals: [] }));
    assert.ok(c <= 0.5, `Expected <= 0.5, got ${c}`);
  });

  it('returns higher confidence with constraints and subgoals', () => {
    const c = estimateConfidence(goal({
      subgoals: [{ description: 'step 1', satisfied: false }],
    }));
    assert.ok(c > 0.5, `Expected > 0.5, got ${c}`);
  });
});

// ── GoalDiscrepancy Builder ────────────────────────────────────

describe('buildGoalDiscrepancy', () => {
  it('produces a valid GoalDiscrepancy signal', () => {
    const workspace = [entry('Write fixed applyDiscount formula')];
    const gd = buildGoalDiscrepancy(workspace, goal(), undefined, 0.80, moduleId('evaluator'));
    assert.equal(gd.type, 'goal-discrepancy');
    assert.equal(gd.source, 'evaluator');
    assert.ok(gd.discrepancy >= 0 && gd.discrepancy <= 1);
    assert.equal(gd.rate, 0); // no previous discrepancy
    assert.ok(gd.confidence >= 0 && gd.confidence <= 1);
    assert.equal(typeof gd.satisfied, 'boolean');
    assert.ok(gd.basis.length > 0);
  });

  it('computes positive rate when discrepancy decreasing', () => {
    const workspace = [entry('Write fixed applyDiscount formula')];
    const gd = buildGoalDiscrepancy(workspace, goal(), 0.9, 0.80, moduleId('evaluator'));
    assert.ok(gd.rate > 0, `Expected positive rate, got ${gd.rate}`);
  });

  it('marks satisfied when discrepancy below threshold', () => {
    const g = goal({
      subgoals: [
        { description: 'a', satisfied: true },
        { description: 'b', satisfied: true },
      ],
    });
    const workspace = [entry('All done correctly with applyDiscount fixed')];
    const gd = buildGoalDiscrepancy(workspace, g, undefined, 0.80, moduleId('evaluator'));
    // With all subgoals satisfied and good term overlap, discrepancy should be low
    if (gd.discrepancy < 0.20) {
      assert.ok(gd.satisfied, `Expected satisfied=true when discrepancy=${gd.discrepancy}`);
    }
  });
});

// ── Aspiration Dynamics ────────────────────────────────────────

describe('updateAspiration', () => {
  it('raises aspiration on positive rate', () => {
    const next = updateAspiration(0.80, 0.1);
    assert.ok(Math.abs(next - 0.85) < 1e-10, `Expected ~0.85, got ${next}`);
  });

  it('lowers aspiration cautiously on zero rate', () => {
    const next = updateAspiration(0.80, 0);
    assert.ok(Math.abs(next - 0.75) < 1e-10, `Expected ~0.75, got ${next}`);
  });

  it('lowers aspiration faster on negative rate', () => {
    const next = updateAspiration(0.80, -0.1);
    assert.ok(Math.abs(next - 0.70) < 1e-10, `Expected ~0.70, got ${next}`);
  });

  it('never goes below floor', () => {
    const next = updateAspiration(ASPIRATION_FLOOR, -0.5);
    assert.equal(next, ASPIRATION_FLOOR);
  });

  it('never goes above ceiling', () => {
    const next = updateAspiration(ASPIRATION_CEILING, 0.5);
    assert.equal(next, ASPIRATION_CEILING);
  });

  it('default aspiration is 0.80', () => {
    assert.equal(DEFAULT_ASPIRATION, 0.80);
  });

  it('floor is 0.60', () => {
    assert.equal(ASPIRATION_FLOOR, 0.60);
  });
});
