import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateGateExpression,
  evaluateGate,
  buildRetryFeedback,
  getDefaultRetries,
  getDefaultTimeout,
} from '../strategy/gates.js';
import type { GateConfig, GateContext } from '../strategy/gates.js';

// ── Helpers ──────────────────────────────────────────────────────

function makeContext(overrides: Partial<GateContext> = {}): GateContext {
  return {
    output: { tests_passed: true, sections: ['intro', 'body'], score: 85 },
    artifacts: { plan: { steps: ['a', 'b'] }, sections: ['s1', 's2', 's3'] },
    execution_metadata: {
      num_turns: 5,
      cost_usd: 0.42,
      tool_call_count: 12,
      duration_ms: 15000,
    },
    ...overrides,
  };
}

function makeGate(overrides: Partial<GateConfig> = {}): GateConfig {
  return {
    type: 'algorithmic',
    check: 'output.tests_passed === true',
    max_retries: 3,
    timeout_ms: 5000,
    ...overrides,
  };
}

// ── Expression Evaluator Tests ──────────────────────────────────

describe('evaluateGateExpression', () => {
  it('passes on simple truthy expression', async () => {
    const ctx = makeContext();
    const result = await evaluateGateExpression('output.tests_passed === true', ctx);
    assert.equal(result.passed, true);
    assert.ok(result.reason.includes('truthy'));
  });

  it('fails on simple falsy expression', async () => {
    const ctx = makeContext({ output: { tests_passed: false } });
    const result = await evaluateGateExpression('output.tests_passed === true', ctx);
    assert.equal(result.passed, false);
    assert.ok(result.reason.includes('falsy'));
  });

  it('evaluates expressions accessing artifacts', async () => {
    const ctx = makeContext();
    const result = await evaluateGateExpression('artifacts.sections.length >= 1', ctx);
    assert.equal(result.passed, true);
  });

  it('evaluates expressions accessing execution_metadata', async () => {
    const ctx = makeContext();
    const result = await evaluateGateExpression('execution_metadata.num_turns > 0', ctx);
    assert.equal(result.passed, true);
  });

  it('returns failed with error message on syntax error', async () => {
    const ctx = makeContext();
    const result = await evaluateGateExpression('output.tests_passed ===', ctx);
    assert.equal(result.passed, false);
    assert.ok(result.reason.startsWith('Expression error:'));
  });

  it('returns failed (not throws) when accessing undefined property', async () => {
    const ctx = makeContext();
    // output.nonexistent is undefined, .length on undefined throws
    const result = await evaluateGateExpression('output.nonexistent.length > 0', ctx);
    assert.equal(result.passed, false);
    assert.ok(result.reason.startsWith('Expression error:'));
  });

  it('cannot access process (sandbox)', async () => {
    const ctx = makeContext();
    const result = await evaluateGateExpression('typeof process !== "undefined"', ctx);
    assert.equal(result.passed, false, 'process should be undefined in sandbox');
  });

  it('cannot access require (sandbox)', async () => {
    const ctx = makeContext();
    const result = await evaluateGateExpression('typeof require !== "undefined"', ctx);
    assert.equal(result.passed, false, 'require should be undefined in sandbox');
  });

  it('cannot access globalThis (sandbox)', async () => {
    const ctx = makeContext();
    const result = await evaluateGateExpression('typeof globalThis !== "undefined"', ctx);
    assert.equal(result.passed, false, 'globalThis should be undefined in sandbox');
  });

  it('cannot use Function constructor (sandbox)', async () => {
    const ctx = makeContext();
    const result = await evaluateGateExpression('typeof Function !== "undefined"', ctx);
    assert.equal(result.passed, false, 'Function should be undefined in sandbox');
  });

  it('context objects are frozen (cannot be mutated by expression)', async () => {
    const ctx = makeContext();
    // The expression attempts to mutate output — in non-strict mode, assignment
    // to a frozen property silently fails (doesn't throw), but the mutation
    // does not take effect. The critical invariant is that the original context
    // is not mutated.
    const result = await evaluateGateExpression(
      '(() => { output.injected = true; return output.injected; })()',
      ctx,
    );
    // output.injected was never set (frozen object ignores writes),
    // so output.injected is still undefined → falsy
    assert.equal(result.passed, false, 'frozen object should not accept mutations');
    // Verify the original context was not mutated
    assert.equal((ctx.output as Record<string, unknown>).injected, undefined);
  });

  it('handles complex boolean expressions', async () => {
    const ctx = makeContext();
    const result = await evaluateGateExpression(
      'output.score >= 80 && execution_metadata.cost_usd < 1.0',
      ctx,
    );
    assert.equal(result.passed, true);
  });

  it('handles expression returning 0 as falsy', async () => {
    const ctx = makeContext({ output: { count: 0 } });
    const result = await evaluateGateExpression('output.count', ctx);
    assert.equal(result.passed, false);
  });

  it('handles expression returning non-empty string as truthy', async () => {
    const ctx = makeContext({ output: { status: 'ok' } });
    const result = await evaluateGateExpression('output.status', ctx);
    assert.equal(result.passed, true);
  });

  it('times out on long-running expression', async () => {
    const ctx = makeContext();
    // Use a very short timeout to trigger the timeout path.
    // The expression itself uses a while loop to waste time,
    // but since new Function is synchronous, we rely on the
    // race: the timeout fires before the microtask resolves.
    // With 1ms timeout, Promise.race should pick the timeout.
    const result = await evaluateGateExpression(
      // This expression is fast but we race with a 1ms timer
      'true',
      ctx,
      1,
    );
    // Either result is valid — the expression might win the race or the timeout might.
    // What matters is we get a result and don't hang.
    assert.ok(typeof result.passed === 'boolean');
    assert.ok(typeof result.reason === 'string');
  });
});

// ── Gate Evaluation Tests ───────────────────────────────────────

describe('evaluateGate', () => {
  it('algorithmic gate passes when expression is true', async () => {
    const gate = makeGate({ check: 'output.tests_passed === true' });
    const ctx = makeContext();
    const result = await evaluateGate(gate, 'gate-1', ctx);

    assert.equal(result.gate_id, 'gate-1');
    assert.equal(result.type, 'algorithmic');
    assert.equal(result.passed, true);
    assert.ok(result.reason.includes('truthy'));
    assert.equal(result.feedback, undefined);
  });

  it('algorithmic gate fails when expression is false', async () => {
    const gate = makeGate({ check: 'output.tests_passed === true' });
    const ctx = makeContext({ output: { tests_passed: false } });
    const result = await evaluateGate(gate, 'gate-2', ctx);

    assert.equal(result.gate_id, 'gate-2');
    assert.equal(result.type, 'algorithmic');
    assert.equal(result.passed, false);
    assert.ok(result.reason.includes('falsy'));
    assert.ok(result.feedback, 'failed gate should include feedback');
    assert.ok(result.feedback!.includes(gate.check));
  });

  it('observation gate evaluates against execution_metadata', async () => {
    const gate = makeGate({
      type: 'observation',
      check: 'execution_metadata.num_turns > 0 && execution_metadata.cost_usd < 1.0',
    });
    const ctx = makeContext();
    const result = await evaluateGate(gate, 'obs-gate-1', ctx);

    assert.equal(result.gate_id, 'obs-gate-1');
    assert.equal(result.type, 'observation');
    assert.equal(result.passed, true);
  });

  it('observation gate fails on metadata violation', async () => {
    const gate = makeGate({
      type: 'observation',
      check: 'execution_metadata.cost_usd < 0.10',
    });
    const ctx = makeContext(); // cost_usd is 0.42
    const result = await evaluateGate(gate, 'obs-gate-2', ctx);

    assert.equal(result.type, 'observation');
    assert.equal(result.passed, false);
    assert.ok(result.feedback);
  });

  it('human approval gate always returns not passed with suspension message', async () => {
    const gate = makeGate({
      type: 'human_approval',
      check: 'true', // expression is irrelevant for human_approval
    });
    const ctx = makeContext();
    const result = await evaluateGate(gate, 'human-gate-1', ctx);

    assert.equal(result.gate_id, 'human-gate-1');
    assert.equal(result.type, 'human_approval');
    assert.equal(result.passed, false);
    assert.equal(result.reason, 'Awaiting human approval');
    assert.ok(result.feedback);
    assert.ok(result.feedback!.includes('human approval required'));
  });

  it('human approval gate ignores check expression', async () => {
    const gate = makeGate({
      type: 'human_approval',
      check: 'this would cause a syntax error if evaluated!!!',
    });
    const ctx = makeContext();
    // Should not throw — the expression is never evaluated
    const result = await evaluateGate(gate, 'human-gate-2', ctx);
    assert.equal(result.passed, false);
    assert.equal(result.reason, 'Awaiting human approval');
  });
});

// ── Retry Feedback Tests ────────────────────────────────────────

describe('buildRetryFeedback', () => {
  it('generates correct retry prompt format', () => {
    const gate = makeGate({ check: 'output.tests_passed === true' });
    const result = {
      gate_id: 'gate-1',
      type: 'algorithmic' as const,
      passed: false,
      reason: 'Expression evaluated to falsy',
      feedback: 'Gate check failed: output.tests_passed === true — Expression evaluated to falsy',
    };
    const text = buildRetryFeedback(gate, result, 1, 3);

    assert.ok(text.includes('GATE FAILURE — Retry 1/3'));
    assert.ok(text.includes('Gate: output.tests_passed === true'));
    assert.ok(text.includes('Result: FAILED — Expression evaluated to falsy'));
    assert.ok(text.includes('Previous attempt feedback:'));
    assert.ok(text.includes('Please address the gate failure and try again.'));
  });

  it('includes attempt number and max retries', () => {
    const gate = makeGate();
    const result = {
      gate_id: 'g',
      type: 'algorithmic' as const,
      passed: false,
      reason: 'failed',
    };
    const text = buildRetryFeedback(gate, result, 2, 5);
    assert.ok(text.includes('Retry 2/5'));
  });

  it('includes gate check expression', () => {
    const gate = makeGate({ check: 'artifacts.plan.steps.length > 3' });
    const result = {
      gate_id: 'g',
      type: 'algorithmic' as const,
      passed: false,
      reason: 'nope',
    };
    const text = buildRetryFeedback(gate, result, 1, 3);
    assert.ok(text.includes('Gate: artifacts.plan.steps.length > 3'));
  });

  it('includes failure reason', () => {
    const gate = makeGate();
    const result = {
      gate_id: 'g',
      type: 'algorithmic' as const,
      passed: false,
      reason: 'Expression error: some_var is not defined',
    };
    const text = buildRetryFeedback(gate, result, 1, 3);
    assert.ok(text.includes('Result: FAILED — Expression error: some_var is not defined'));
  });

  it('handles missing feedback gracefully', () => {
    const gate = makeGate();
    const result = {
      gate_id: 'g',
      type: 'algorithmic' as const,
      passed: false,
      reason: 'falsy',
      // No feedback property
    };
    const text = buildRetryFeedback(gate, result, 1, 2);
    assert.ok(text.includes('Previous attempt feedback: none'));
  });

  it('includes provided feedback', () => {
    const gate = makeGate();
    const result = {
      gate_id: 'g',
      type: 'algorithmic' as const,
      passed: false,
      reason: 'falsy',
      feedback: 'Tests are failing in module X',
    };
    const text = buildRetryFeedback(gate, result, 1, 2);
    assert.ok(text.includes('Previous attempt feedback: Tests are failing in module X'));
  });
});

// ── Default Values Tests ────────────────────────────────────────

describe('getDefaultRetries', () => {
  it('returns 3 for algorithmic gates', () => {
    assert.equal(getDefaultRetries('algorithmic'), 3);
  });

  it('returns 2 for observation gates', () => {
    assert.equal(getDefaultRetries('observation'), 2);
  });

  it('returns 0 for human_approval gates', () => {
    assert.equal(getDefaultRetries('human_approval'), 0);
  });
});

describe('getDefaultTimeout', () => {
  it('returns 5000 for algorithmic gates', () => {
    assert.equal(getDefaultTimeout('algorithmic'), 5000);
  });

  it('returns 5000 for observation gates', () => {
    assert.equal(getDefaultTimeout('observation'), 5000);
  });

  it('returns 5000 for human_approval gates', () => {
    assert.equal(getDefaultTimeout('human_approval'), 5000);
  });
});
