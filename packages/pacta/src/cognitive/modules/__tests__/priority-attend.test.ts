// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for PriorityAttend — three-factor biased competition salience function.
 *
 * Tests: stimulus salience (Desimone & Duncan 1995), goal relevance (top-down),
 * selection history (Awh et al. 2012), winner suppression (lateral inhibition),
 * composite scoring, custom weights, SalienceFunction signature compliance.
 *
 * 10 test scenarios covering AC-05 and AC-06.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { moduleId } from '../../algebra/index.js';
import type {
  WorkspaceEntry,
  SalienceContext,
  SalienceFunction,
  SelectionOutcome,
} from '../../algebra/index.js';
import type { PriorityScore, PriorityAttendConfig } from '../../algebra/enriched-signals.js';
import {
  prioritySalienceFunction,
  createPriorityAttendConfig,
  computePriorityScore,
  applySuppression,
} from '../priority-attend.js';

// ── Helpers ──────────────────────────────────────────────────────────

const MODULE_A = moduleId('module-a');
const MODULE_B = moduleId('module-b');

const NOW = Date.now();

function makeEntry(
  source: string,
  content: string,
  timestampOffset: number = 0,
  salience: number = 0,
): WorkspaceEntry {
  return {
    source: moduleId(source),
    content,
    salience,
    timestamp: NOW - timestampOffset,
  };
}

function makeContext(overrides?: Partial<SalienceContext>): SalienceContext {
  return {
    now: NOW,
    goals: overrides?.goals ?? [],
    sourcePriorities: overrides?.sourcePriorities ?? new Map(),
    selectionOutcomes: overrides?.selectionOutcomes,
    activeSubgoals: overrides?.activeSubgoals,
  };
}

function makeOutcome(
  source: string,
  content: string,
  outcome: 'positive' | 'negative' | 'neutral',
  timestamp: number = NOW,
): SelectionOutcome {
  return {
    entryHash: `${source}:${content}`,
    outcome,
    timestamp,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('PriorityAttend', () => {
  // ── Scenario 1: Priority score computed from all three factors ────

  it('computes priority score from all three factors (stimulus, goal, history)', () => {
    const entry = makeEntry('module-a', 'optimize database query performance', 5_000);
    const context = makeContext({
      goals: ['optimize database performance'],
      selectionOutcomes: [
        makeOutcome('module-a', 'optimize database query performance', 'positive'),
      ],
    });

    const score = computePriorityScore(entry, context);

    // All three factors should contribute
    assert.ok(score.stimulusSalience > 0, 'stimulus salience should be positive');
    assert.ok(score.goalRelevance > 0, 'goal relevance should be positive');
    assert.ok(score.selectionHistory > 0, 'selection history should be positive');
    assert.ok(score.composite > 0, 'composite should be positive');

    // Composite should be the weighted sum with default weights (0.3, 0.4, 0.3)
    const expectedComposite =
      0.3 * score.stimulusSalience +
      0.4 * score.goalRelevance +
      0.3 * score.selectionHistory;
    assert.ok(
      Math.abs(score.composite - expectedComposite) < 0.001,
      `composite ${score.composite} should equal weighted sum ${expectedComposite}`,
    );
  });

  // ── Scenario 2: Stimulus salience increases for novel entries ─────

  it('stimulus salience increases for novel entries (low age)', () => {
    const novelEntry = makeEntry('module-a', 'fresh data received', 0); // just now
    const oldEntry = makeEntry('module-a', 'fresh data received', 300_000); // 5 minutes ago

    const context = makeContext();

    const novelScore = computePriorityScore(novelEntry, context);
    const oldScore = computePriorityScore(oldEntry, context);

    assert.ok(
      novelScore.stimulusSalience > oldScore.stimulusSalience,
      `novel stimulus ${novelScore.stimulusSalience} should exceed old stimulus ${oldScore.stimulusSalience}`,
    );
  });

  // ── Scenario 3: Goal relevance increases for entries matching active subgoals ─

  it('goal relevance increases for entries matching active subgoals', () => {
    // Content matches subgoal keywords ("authentication", "module") but NOT goal keywords
    const entry = makeEntry('module-a', 'authentication module needs refactoring');

    // Goals use words NOT present in the content — zero goal overlap
    const contextWithoutSubgoals = makeContext({
      goals: ['improve security posture'],
    });

    // Subgoals add words that ARE in the content — non-zero subgoal overlap
    const contextWithSubgoals = makeContext({
      goals: ['improve security posture'],
      activeSubgoals: ['refactor authentication module'],
    });

    const scoreWithout = computePriorityScore(entry, contextWithoutSubgoals);
    const scoreWith = computePriorityScore(entry, contextWithSubgoals);

    assert.ok(
      scoreWith.goalRelevance > scoreWithout.goalRelevance,
      `goal relevance with subgoals ${scoreWith.goalRelevance} should exceed without ${scoreWithout.goalRelevance}`,
    );
  });

  // ── Scenario 4: Selection history boosts entries with successful outcomes ─

  it('selection history boosts entries that led to successful actions', () => {
    const entry = makeEntry('module-a', 'analyze error logs');
    const contextWithPositive = makeContext({
      selectionOutcomes: [
        makeOutcome('module-a', 'analyze error logs', 'positive'),
      ],
    });

    const contextWithoutHistory = makeContext();

    const scorePositive = computePriorityScore(entry, contextWithPositive);
    const scoreNeutral = computePriorityScore(entry, contextWithoutHistory);

    assert.ok(
      scorePositive.selectionHistory > 0,
      `positive history should yield positive bias: ${scorePositive.selectionHistory}`,
    );
    assert.equal(
      scoreNeutral.selectionHistory,
      0,
      'no history should yield 0 bias',
    );
    assert.ok(
      scorePositive.composite > scoreNeutral.composite,
      'positive history should increase composite score',
    );
  });

  // ── Scenario 5: Selection history suppresses entries with failed outcomes ─

  it('selection history suppresses entries that led to failures', () => {
    const entry = makeEntry('module-a', 'retry failed API call');
    const contextNegative = makeContext({
      selectionOutcomes: [
        makeOutcome('module-a', 'retry failed API call', 'negative'),
      ],
    });

    const contextNone = makeContext();

    const scoreNegative = computePriorityScore(entry, contextNegative);
    const scoreNone = computePriorityScore(entry, contextNone);

    assert.ok(
      scoreNegative.selectionHistory < 0,
      `negative history should yield negative bias: ${scoreNegative.selectionHistory}`,
    );
    assert.ok(
      scoreNegative.composite < scoreNone.composite,
      'negative history should decrease composite score',
    );
  });

  // ── Scenario 6: Winner suppression reduces salience of non-selected entries ─

  it('winner suppression reduces salience of non-selected entries', () => {
    const entries: WorkspaceEntry[] = [
      makeEntry('module-a', 'winner', 0, 0.9),
      makeEntry('module-b', 'loser-1', 0, 0.5),
      makeEntry('module-a', 'loser-2', 0, 0.3),
    ];

    const suppressed = applySuppression(entries, [0], 0.2);

    // Winner unchanged
    assert.equal(suppressed[0].salience, 0.9, 'winner salience should be unchanged');
    // Losers suppressed by factor 0.2 (salience * 0.8)
    assert.ok(
      Math.abs(suppressed[1].salience - 0.4) < 0.001,
      `loser-1 salience should be 0.4, got ${suppressed[1].salience}`,
    );
    assert.ok(
      Math.abs(suppressed[2].salience - 0.24) < 0.001,
      `loser-2 salience should be 0.24, got ${suppressed[2].salience}`,
    );
  });

  // ── Scenario 7: Default weights produce balanced scoring ──────────

  it('default weights (0.3, 0.4, 0.3) produce balanced scoring', () => {
    const config = createPriorityAttendConfig();

    assert.equal(config.stimulusWeight, 0.3);
    assert.equal(config.goalWeight, 0.4);
    assert.equal(config.historyWeight, 0.3);
    assert.equal(config.suppressionFactor, 0.2);
    assert.equal(config.maxHistoryEntries, 100);

    // Verify weights sum to 1.0
    const sum = config.stimulusWeight + config.goalWeight + config.historyWeight;
    assert.ok(
      Math.abs(sum - 1.0) < 0.001,
      `weights should sum to 1.0, got ${sum}`,
    );
  });

  // ── Scenario 8: Custom weights respected ──────────────────────────

  it('custom weights are respected in priority score computation', () => {
    const entry = makeEntry('module-a', 'matching goal keyword content', 1_000);
    const context = makeContext({
      goals: ['matching goal keyword content'],
      selectionOutcomes: [
        makeOutcome('module-a', 'matching goal keyword content', 'positive'),
      ],
    });

    // Heavy goal weight
    const goalHeavy: PriorityAttendConfig = {
      stimulusWeight: 0.1,
      goalWeight: 0.8,
      historyWeight: 0.1,
    };

    // Heavy stimulus weight
    const stimulusHeavy: PriorityAttendConfig = {
      stimulusWeight: 0.8,
      goalWeight: 0.1,
      historyWeight: 0.1,
    };

    const scoreGoalHeavy = computePriorityScore(entry, context, goalHeavy);
    const scoreStimulusHeavy = computePriorityScore(entry, context, stimulusHeavy);

    // Goal-heavy should weight goal relevance more
    const expectedGoalHeavy =
      0.1 * scoreGoalHeavy.stimulusSalience +
      0.8 * scoreGoalHeavy.goalRelevance +
      0.1 * scoreGoalHeavy.selectionHistory;

    const expectedStimulusHeavy =
      0.8 * scoreStimulusHeavy.stimulusSalience +
      0.1 * scoreStimulusHeavy.goalRelevance +
      0.1 * scoreStimulusHeavy.selectionHistory;

    assert.ok(
      Math.abs(scoreGoalHeavy.composite - expectedGoalHeavy) < 0.001,
      'goal-heavy composite should match expected weighted sum',
    );
    assert.ok(
      Math.abs(scoreStimulusHeavy.composite - expectedStimulusHeavy) < 0.001,
      'stimulus-heavy composite should match expected weighted sum',
    );
  });

  // ── Scenario 9: Selection history bounded to maxHistoryEntries ────

  it('selection history bounded to maxHistoryEntries', () => {
    const config = createPriorityAttendConfig({ maxHistoryEntries: 5 });
    assert.equal(config.maxHistoryEntries, 5, 'maxHistoryEntries should be 5');

    // Verify the config is respected (maxHistoryEntries is a config param
    // that consumers use to trim the selectionOutcomes list before passing
    // to SalienceContext — the function itself processes whatever it receives)
    const entry = makeEntry('module-a', 'test content');

    // Generate many outcomes — consumer would trim to maxHistoryEntries
    const manyOutcomes: SelectionOutcome[] = [];
    for (let i = 0; i < 20; i++) {
      manyOutcomes.push(makeOutcome('module-a', 'test content', 'positive', NOW - i * 1000));
    }

    // With all outcomes (simulating no trim)
    const contextFull = makeContext({ selectionOutcomes: manyOutcomes });
    const scoreFull = computePriorityScore(entry, contextFull);

    // With trimmed outcomes (simulating consumer respecting maxHistoryEntries)
    const trimmedOutcomes = manyOutcomes.slice(0, config.maxHistoryEntries);
    const contextTrimmed = makeContext({ selectionOutcomes: trimmedOutcomes });
    const scoreTrimmed = computePriorityScore(entry, contextTrimmed);

    // Both should produce positive history (all positive outcomes)
    assert.ok(scoreFull.selectionHistory > 0, 'full history should be positive');
    assert.ok(scoreTrimmed.selectionHistory > 0, 'trimmed history should be positive');

    // Both should be exactly 1.0 since all outcomes are positive
    assert.ok(
      Math.abs(scoreFull.selectionHistory - 1.0) < 0.001,
      'all-positive history should yield 1.0',
    );
    assert.ok(
      Math.abs(scoreTrimmed.selectionHistory - 1.0) < 0.001,
      'trimmed all-positive history should yield 1.0',
    );
  });

  // ── Scenario 10: prioritySalienceFunction matches SalienceFunction signature ─

  it('prioritySalienceFunction matches SalienceFunction signature (type-check test)', () => {
    // Type assertion: prioritySalienceFunction must be assignable to SalienceFunction
    const fn: SalienceFunction = prioritySalienceFunction;

    // Verify it accepts the correct arguments and returns a number
    const entry = makeEntry('module-a', 'test content', 0);
    const context = makeContext({ goals: ['test'] });

    const result = fn(entry, context);

    assert.equal(typeof result, 'number', 'should return a number');
    assert.ok(Number.isFinite(result), 'should return a finite number');
  });

  // ── AC-05: Three-entry ranking scenario ───────────────────────────

  it('AC-05: EntryB (goal+history) > EntryA (stimulus) > EntryC (negative history)', () => {
    // EntryA: novel/goal-irrelevant — high stimulus, no goal match, no history
    const entryA = makeEntry('module-a', 'completely unrelated novel information', 0);

    // EntryB: old/goal-relevant/positive-history — low stimulus, high goal, positive history
    const entryB = makeEntry('module-b', 'optimize the database query for performance', 120_000);

    // EntryC: old/goal-irrelevant/negative-history — low stimulus, no goal, negative history
    const entryC = makeEntry('module-a', 'retry the broken endpoint call', 120_000);

    const context = makeContext({
      goals: ['optimize database query performance'],
      selectionOutcomes: [
        makeOutcome('module-b', 'optimize the database query for performance', 'positive'),
        makeOutcome('module-a', 'retry the broken endpoint call', 'negative'),
      ],
    });

    const scoreA = computePriorityScore(entryA, context);
    const scoreB = computePriorityScore(entryB, context);
    const scoreC = computePriorityScore(entryC, context);

    // EntryB should rank highest (goal + positive history)
    assert.ok(
      scoreB.composite > scoreA.composite,
      `EntryB (${scoreB.composite}) should rank above EntryA (${scoreA.composite})`,
    );

    // EntryA should rank above EntryC (stimulus vs negative history)
    assert.ok(
      scoreA.composite > scoreC.composite,
      `EntryA (${scoreA.composite}) should rank above EntryC (${scoreC.composite})`,
    );
  });

  // ── AC-06: Positive selection history boost across cycles ─────────

  it('AC-06: entry attended in cycle N with success gets positive boost in cycle N+1', () => {
    const entry = makeEntry('module-a', 'investigate memory leak', 30_000);

    // Cycle N: no history yet
    const contextCycleN = makeContext();
    const scoreCycleN = computePriorityScore(entry, contextCycleN);

    // Cycle N+1: entry was attended and led to successful outcome
    const contextCycleN1 = makeContext({
      selectionOutcomes: [
        makeOutcome('module-a', 'investigate memory leak', 'positive'),
      ],
    });
    const scoreCycleN1 = computePriorityScore(entry, contextCycleN1);

    assert.equal(scoreCycleN.selectionHistory, 0, 'cycle N should have no history bias');
    assert.ok(
      scoreCycleN1.selectionHistory > 0,
      `cycle N+1 should have positive history bias: ${scoreCycleN1.selectionHistory}`,
    );
    assert.ok(
      scoreCycleN1.composite > scoreCycleN.composite,
      `cycle N+1 composite (${scoreCycleN1.composite}) should exceed cycle N (${scoreCycleN.composite})`,
    );
  });
});
