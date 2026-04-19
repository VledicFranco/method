// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for the Curiosity Module (PRD 037).
 *
 * 12 test scenarios covering:
 * - Learning progress computation (positive, zero, negative)
 * - Explore/exploit decision logic
 * - Budget enforcement
 * - Workspace injection (monitoring signal contents)
 * - Multi-domain tracking
 * - Default config values
 * - Disabled module behavior
 * - State invariant validation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCuriosityModule,
  computeLearningProgress,
  decideMode,
  computeCuriositySignal,
  findMostCuriousDomain,
  generateExplorationGoal,
  defaultCuriosityConfig,
} from '../curiosity-module.js';
import type {
  CuriosityInput,
  CuriosityState,
  CuriosityConfig,
} from '../curiosity-module.js';
import type { ControlDirective, ModuleId } from '../../algebra/index.js';

// ── Test Helpers ────────────────────────────────────────────────

function makeControl(): ControlDirective {
  return {
    target: 'curiosity' as ModuleId,
    timestamp: Date.now(),
  };
}

function makeInput(errors: Map<string, number>): CuriosityInput {
  return { predictionErrors: errors };
}

function emptyInput(): CuriosityInput {
  return { predictionErrors: new Map() };
}

// ── Tests: computeLearningProgress (pure function) ──────────────

describe('computeLearningProgress', () => {
  it('returns positive LP when recent errors are higher than older errors (learning)', () => {
    // Errors are increasing — the agent is encountering new complexity
    const errors = [0.1, 0.1, 0.2, 0.2, 0.5, 0.5, 0.8, 0.8, 0.9, 0.9];
    const lp = computeLearningProgress(errors);
    assert.ok(lp > 0, `Expected positive LP, got ${lp}`);
  });

  it('returns negative LP when recent errors are lower than older errors (converging)', () => {
    // Errors are decreasing — the agent is converging on a solution
    const errors = [0.9, 0.9, 0.8, 0.8, 0.5, 0.5, 0.2, 0.2, 0.1, 0.1];
    const lp = computeLearningProgress(errors);
    assert.ok(lp < 0, `Expected negative LP, got ${lp}`);
  });

  it('returns zero LP when errors are constant (stagnating)', () => {
    const errors = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    const lp = computeLearningProgress(errors);
    assert.equal(lp, 0, 'Constant errors should produce zero LP');
  });

  it('returns zero LP with fewer than 2 data points', () => {
    assert.equal(computeLearningProgress([]), 0, 'Empty array');
    assert.equal(computeLearningProgress([0.5]), 0, 'Single element');
  });

  it('handles 2-element window correctly', () => {
    // [0.1] older, [0.5] recent → LP = 0.5 - 0.1 = 0.4
    const lp = computeLearningProgress([0.1, 0.5]);
    assert.ok(Math.abs(lp - 0.4) < 1e-10, `Expected ~0.4, got ${lp}`);
  });
});

// ── Tests: decideMode ───────────────────────────────────────────

describe('decideMode', () => {
  it('returns exploit when LP is above noise floor', () => {
    assert.equal(decideMode(0.1, 0.05, 5), 'exploit');
  });

  it('returns explore when LP is below noise floor and budget remains', () => {
    assert.equal(decideMode(0.02, 0.05, 3), 'explore');
  });

  it('returns exploit when budget is exhausted regardless of LP', () => {
    assert.equal(decideMode(0.01, 0.05, 0), 'exploit');
  });

  it('returns exploit when negative LP exceeds noise floor (converging)', () => {
    // |LP| = 0.1 > noiseFloor 0.05 → exploit (meaningful convergence)
    assert.equal(decideMode(-0.1, 0.05, 5), 'exploit');
  });
});

// ── Tests: computeCuriositySignal ───────────────────────────────

describe('computeCuriositySignal', () => {
  it('returns 0 for empty map', () => {
    assert.equal(computeCuriositySignal(new Map()), 0);
  });

  it('returns clamped max absolute LP', () => {
    const map = new Map([['code', 0.3], ['arch', -0.5], ['test', 0.1]]);
    assert.equal(computeCuriositySignal(map), 0.5);
  });

  it('clamps to 1 for very large LP values', () => {
    const map = new Map([['code', 5.0]]);
    assert.equal(computeCuriositySignal(map), 1);
  });
});

// ── Tests: findMostCuriousDomain ────────────────────────────────

describe('findMostCuriousDomain', () => {
  it('returns unknown for empty map', () => {
    assert.equal(findMostCuriousDomain(new Map()), 'unknown');
  });

  it('returns domain with highest absolute LP', () => {
    const map = new Map([['code', 0.1], ['architecture', -0.8], ['testing', 0.3]]);
    assert.equal(findMostCuriousDomain(map), 'architecture');
  });
});

// ── Tests: CognitiveModule interface ────────────────────────────

describe('createCuriosityModule', () => {
  it('has correct default config values', () => {
    const config = defaultCuriosityConfig();
    assert.equal(config.windowSize, 10);
    assert.equal(config.noiseFloor, 0.05);
    assert.equal(config.explorationBudgetMax, 5);
    assert.equal(config.enabled, true);
  });

  it('initialState returns valid empty state', () => {
    const mod = createCuriosityModule();
    const state = mod.initialState();

    assert.equal(state.predictionErrors.size, 0);
    assert.equal(state.learningProgress.size, 0);
    assert.equal(state.explorationBudget, 5);
    assert.equal(state.currentMode, 'exploit');
    assert.equal(state.totalExplorations, 0);
  });

  it('stateInvariant validates initial state', () => {
    const mod = createCuriosityModule();
    const state = mod.initialState();
    assert.ok(mod.stateInvariant!(state));
  });

  it('step with empty input produces neutral exploit output', async () => {
    const mod = createCuriosityModule();
    const state = mod.initialState();
    const result = await mod.step(emptyInput(), state, makeControl());

    assert.equal(result.output.signal, 0);
    assert.equal(result.output.domain, 'unknown');
    assert.equal(result.output.mode, 'exploit');
    assert.equal(result.output.explorationGoal, undefined);
  });

  it('tracks prediction errors per domain across steps', async () => {
    const mod = createCuriosityModule({ windowSize: 4 });
    let state = mod.initialState();

    // Step 1: feed code=0.5, arch=0.3
    const r1 = await mod.step(
      makeInput(new Map([['code', 0.5], ['arch', 0.3]])),
      state,
      makeControl(),
    );
    state = r1.state;

    assert.equal(state.predictionErrors.get('code')!.length, 1);
    assert.equal(state.predictionErrors.get('arch')!.length, 1);

    // Step 2: feed code=0.6
    const r2 = await mod.step(
      makeInput(new Map([['code', 0.6]])),
      state,
      makeControl(),
    );
    state = r2.state;

    assert.equal(state.predictionErrors.get('code')!.length, 2);
    assert.equal(state.predictionErrors.get('arch')!.length, 1);
  });

  it('enforces sliding window size', async () => {
    const mod = createCuriosityModule({ windowSize: 3 });
    let state = mod.initialState();

    // Feed 5 errors into the same domain
    for (let i = 0; i < 5; i++) {
      const result = await mod.step(
        makeInput(new Map([['code', i * 0.1]])),
        state,
        makeControl(),
      );
      state = result.state;
    }

    // Window should contain only the last 3 errors
    const errors = state.predictionErrors.get('code')!;
    assert.equal(errors.length, 3);
    assert.ok(Math.abs(errors[0] - 0.2) < 1e-10, `Expected 0.2, got ${errors[0]}`);
    assert.ok(Math.abs(errors[1] - 0.3) < 1e-10, `Expected 0.3, got ${errors[1]}`);
    assert.ok(Math.abs(errors[2] - 0.4) < 1e-10, `Expected 0.4, got ${errors[2]}`);
  });

  it('triggers explore when LP is below noise floor', async () => {
    const mod = createCuriosityModule({ windowSize: 6, noiseFloor: 0.05 });
    let state = mod.initialState();

    // Feed constant errors — LP will be zero → stagnation → explore
    for (let i = 0; i < 6; i++) {
      const result = await mod.step(
        makeInput(new Map([['code', 0.5]])),
        state,
        makeControl(),
      );
      state = result.state;
    }

    // LP should be zero (constant errors), triggering explore
    assert.equal(state.learningProgress.get('code'), 0);
    assert.equal(state.currentMode, 'explore');
  });

  it('maintains exploit when LP is meaningful', async () => {
    const mod = createCuriosityModule({ windowSize: 6, noiseFloor: 0.05 });
    let state = mod.initialState();

    // Feed increasing errors — positive LP → exploit
    for (let i = 0; i < 6; i++) {
      const result = await mod.step(
        makeInput(new Map([['code', 0.1 * (i + 1)]])),
        state,
        makeControl(),
      );
      state = result.state;
    }

    const lp = state.learningProgress.get('code')!;
    assert.ok(lp > 0.05, `Expected LP > noiseFloor, got ${lp}`);
    assert.equal(state.currentMode, 'exploit');
  });

  it('enforces exploration budget (capped exploration steps)', async () => {
    const mod = createCuriosityModule({
      windowSize: 10,
      noiseFloor: 0.05,
      explorationBudgetMax: 3,
    });
    let state = mod.initialState();

    // Prime with 2 constant errors so hasEnoughData = true and LP = 0
    // With windowSize=10 and budget=3, we have enough room to observe the full cycle.
    // Step 1: 1 data point, hasEnoughData=false → exploit, budget=3
    // Step 2: 2 data points, hasEnoughData=true, LP=0 → explore, budget=2
    const r1 = await mod.step(makeInput(new Map([['code', 0.5]])), state, makeControl());
    state = r1.state;
    assert.equal(state.currentMode, 'exploit', 'Step 1: exploit (insufficient data)');
    assert.equal(state.explorationBudget, 3);

    const r2 = await mod.step(makeInput(new Map([['code', 0.5]])), state, makeControl());
    state = r2.state;
    assert.equal(state.currentMode, 'explore', 'Step 2: explore (LP=0, has data)');
    assert.equal(state.explorationBudget, 2);

    // Step 3: explore, budget=1
    const r3 = await mod.step(makeInput(new Map([['code', 0.5]])), state, makeControl());
    state = r3.state;
    assert.equal(state.currentMode, 'explore', 'Step 3: still exploring');
    assert.equal(state.explorationBudget, 1);

    // Step 4: explore, budget=0
    const r4 = await mod.step(makeInput(new Map([['code', 0.5]])), state, makeControl());
    state = r4.state;
    assert.equal(state.currentMode, 'explore', 'Step 4: last explore step');
    assert.equal(state.explorationBudget, 0);

    // Step 5: budget exhausted → forced exploit
    const r5 = await mod.step(makeInput(new Map([['code', 0.5]])), state, makeControl());
    state = r5.state;
    assert.equal(state.explorationBudget, 0, 'Budget exhausted');
    assert.equal(state.currentMode, 'exploit', 'Step 5: forced exploit (budget=0)');
  });

  it('emits correct monitoring signal fields', async () => {
    const mod = createCuriosityModule();
    const state = mod.initialState();

    const result = await mod.step(
      makeInput(new Map([['code', 0.3]])),
      state,
      makeControl(),
    );

    const mon = result.monitoring;
    assert.equal(mon.type, 'curiosity');
    assert.equal(mon.source, mod.id);
    assert.equal(typeof mon.timestamp, 'number');
    assert.equal(typeof mon.signal, 'number');
    assert.ok(mon.mode === 'exploit' || mon.mode === 'explore');
    assert.equal(typeof mon.domain, 'string');
    assert.equal(typeof mon.explorationBudget, 'number');
  });

  it('tracks multiple domains independently', async () => {
    const mod = createCuriosityModule({ windowSize: 4 });
    let state = mod.initialState();

    // Code domain: increasing errors (positive LP)
    // Architecture domain: constant errors (zero LP)
    for (let i = 0; i < 4; i++) {
      const result = await mod.step(
        makeInput(new Map([
          ['code', 0.1 * (i + 1)],     // 0.1, 0.2, 0.3, 0.4
          ['architecture', 0.5],         // constant
        ])),
        state,
        makeControl(),
      );
      state = result.state;
    }

    const codeLp = state.learningProgress.get('code')!;
    const archLp = state.learningProgress.get('architecture')!;

    assert.ok(codeLp > 0, `Code LP should be positive (learning), got ${codeLp}`);
    assert.equal(archLp, 0, 'Architecture LP should be zero (stagnating)');
  });

  it('disabled module passes through with neutral output', async () => {
    const mod = createCuriosityModule({ enabled: false });
    const state = mod.initialState();

    const result = await mod.step(
      makeInput(new Map([['code', 0.5]])),
      state,
      makeControl(),
    );

    assert.equal(result.output.signal, 0);
    assert.equal(result.output.mode, 'exploit');
    assert.equal(result.output.domain, 'unknown');
    // State should be unchanged (same reference)
    assert.equal(result.state, state);
  });

  it('stateInvariant rejects invalid state', () => {
    const mod = createCuriosityModule({ explorationBudgetMax: 5 });

    // Budget exceeding max
    const badState: CuriosityState = {
      predictionErrors: new Map(),
      learningProgress: new Map(),
      explorationBudget: 10, // exceeds max of 5
      currentMode: 'exploit',
      totalExplorations: 0,
    };
    assert.equal(mod.stateInvariant!(badState), false);

    // Negative budget
    const badState2: CuriosityState = {
      ...badState,
      explorationBudget: -1,
    };
    assert.equal(mod.stateInvariant!(badState2), false);
  });
});

// ── Tests: generateExplorationGoal ──────────────────────────────

describe('generateExplorationGoal', () => {
  it('generates different goals based on LP direction', () => {
    const declining = generateExplorationGoal('code', -0.1);
    const stalled = generateExplorationGoal('code', 0.0);
    const incremental = generateExplorationGoal('code', 0.1);

    assert.ok(declining.includes('declining'), `Declining goal: ${declining}`);
    assert.ok(stalled.includes('stalled'), `Stalled goal: ${stalled}`);
    assert.ok(incremental.includes('edge cases'), `Incremental goal: ${incremental}`);
  });

  it('includes domain name in the goal', () => {
    const goal = generateExplorationGoal('architecture', 0.0);
    assert.ok(goal.includes('architecture'), `Goal should include domain: ${goal}`);
  });
});
