/**
 * LLM Monitor v2 — unit tests.
 *
 * Uses mock ProviderAdapter (no real LLM). Covers 5 scenarios:
 * 1. Normal signals → empty anomalies, no escalation, forceReplan=false
 * 2. Low-confidence reasoner signal → low-confidence anomaly detected
 * 3. Compound anomaly (low-confidence + unexpected-result) → compound type
 * 4. Structured JSON output → parses correctly to MonitorReport
 * 5. Malformed LLM output → graceful fallback to safe default
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLlmMonitor } from '../src/llm-monitor.js';
import { parseLlmResponse } from '../src/llm-monitor.js';
import type {
  ProviderAdapter,
  ProviderAdapterResult,
  AggregatedSignals,
  NoControl,
  TokenUsage,
  CostReport,
} from '../src/types.js';
import { moduleId } from '../src/types.js';

// ── Mock Provider Factory ───────────────────────────────────────

function mockUsage(inputTokens = 100, outputTokens = 50): TokenUsage {
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: inputTokens + outputTokens,
  };
}

function mockCost(): CostReport {
  return {
    totalUsd: 0.001,
    perModel: {
      'mock-model': { tokens: mockUsage(), costUsd: 0.001 },
    },
  };
}

function createMockAdapter(responseJson: unknown): ProviderAdapter {
  return {
    async invoke(): Promise<ProviderAdapterResult> {
      return {
        output: JSON.stringify(responseJson),
        usage: mockUsage(),
        cost: mockCost(),
      };
    },
  };
}

function createMockAdapterRaw(rawOutput: string): ProviderAdapter {
  return {
    async invoke(): Promise<ProviderAdapterResult> {
      return {
        output: rawOutput,
        usage: mockUsage(),
        cost: mockCost(),
      };
    },
  };
}

// ── Helpers ─────────────────────────────────────────────────────

const NO_CONTROL = { target: moduleId('llm-monitor'), timestamp: Date.now() } as NoControl;

function normalSignals(): AggregatedSignals {
  const signals: AggregatedSignals = new Map();
  signals.set(moduleId('reasoner'), {
    type: 'reasoner',
    source: moduleId('reasoner'),
    timestamp: Date.now(),
    confidence: 0.85,
    conflictDetected: false,
    effortLevel: 'medium',
  } as any);
  signals.set(moduleId('actor'), {
    type: 'actor',
    source: moduleId('actor'),
    timestamp: Date.now(),
    actionTaken: 'Edit',
    success: true,
    unexpectedResult: false,
  } as any);
  return signals;
}

function lowConfidenceSignals(): AggregatedSignals {
  const signals: AggregatedSignals = new Map();
  signals.set(moduleId('reasoner'), {
    type: 'reasoner',
    source: moduleId('reasoner'),
    timestamp: Date.now(),
    confidence: 0.15,
    conflictDetected: false,
    effortLevel: 'high',
  } as any);
  return signals;
}

function compoundSignals(): AggregatedSignals {
  const signals: AggregatedSignals = new Map();
  signals.set(moduleId('reasoner'), {
    type: 'reasoner',
    source: moduleId('reasoner'),
    timestamp: Date.now(),
    confidence: 0.1,
    conflictDetected: true,
    effortLevel: 'high',
  } as any);
  signals.set(moduleId('actor'), {
    type: 'actor',
    source: moduleId('actor'),
    timestamp: Date.now(),
    actionTaken: 'Read',
    success: false,
    unexpectedResult: true,
  } as any);
  return signals;
}

// ── Tests ───────────────────────────────────────────────────────

describe('LLM Monitor v2', () => {
  it('1. Normal signals — no anomalies, no escalation, forceReplan=false', async () => {
    // The LLM returns a clean report with null escalation (JSON null -> undefined)
    const adapter = createMockAdapter({
      anomalies: [],
      escalation: null,
      restrictedActions: [],
      forceReplan: false,
    });

    const monitor = createLlmMonitor(adapter);
    const state = monitor.initialState();
    const result = await monitor.step(normalSignals(), state, NO_CONTROL);

    assert.deepStrictEqual(result.output.anomalies, []);
    assert.strictEqual(result.output.escalation, undefined);
    assert.deepStrictEqual(result.output.restrictedActions, []);
    assert.strictEqual(result.output.forceReplan, false);
    assert.strictEqual(result.monitoring.anomalyDetected, false);
    assert.strictEqual(result.state.invocationCount, 1);
  });

  it('2. Low-confidence reasoner signal — anomaly detected with type low-confidence', async () => {
    const adapter = createMockAdapter({
      anomalies: [
        {
          moduleId: 'reasoner',
          type: 'low-confidence',
          detail: 'Confidence 0.15 is well below threshold 0.3',
        },
      ],
      escalation: null,
      restrictedActions: [],
      forceReplan: false,
    });

    const monitor = createLlmMonitor(adapter);
    const state = monitor.initialState();
    const result = await monitor.step(lowConfidenceSignals(), state, NO_CONTROL);

    assert.strictEqual(result.output.anomalies.length, 1);
    assert.strictEqual(result.output.anomalies[0].type, 'low-confidence');
    assert.strictEqual(result.output.anomalies[0].moduleId, 'reasoner');
    assert.strictEqual(result.monitoring.anomalyDetected, true);
    assert.strictEqual(result.output.forceReplan, false);
  });

  it('3. Compound anomaly (low-confidence + unexpected-result) — compound type', async () => {
    const adapter = createMockAdapter({
      anomalies: [
        {
          moduleId: 'reasoner',
          type: 'low-confidence',
          detail: 'Confidence 0.1 below threshold',
        },
        {
          moduleId: 'actor',
          type: 'unexpected-result',
          detail: 'Action Read failed unexpectedly',
        },
        {
          moduleId: 'llm-monitor',
          type: 'compound',
          detail: 'Compound anomaly: low confidence combined with unexpected result',
        },
      ],
      escalation: 'Compound anomaly: low confidence combined with unexpected result',
      restrictedActions: ['Read'],
      forceReplan: true,
    });

    const monitor = createLlmMonitor(adapter);
    const state = monitor.initialState();
    const result = await monitor.step(compoundSignals(), state, NO_CONTROL);

    assert.strictEqual(result.output.anomalies.length, 3);

    const compoundAnomaly = result.output.anomalies.find(a => a.type === 'compound');
    assert.ok(compoundAnomaly, 'Should have a compound anomaly');
    assert.ok(compoundAnomaly.detail.includes('compound') || compoundAnomaly.detail.includes('Compound'));

    assert.ok(result.output.escalation !== undefined, 'Should have an escalation');
    assert.strictEqual(result.output.forceReplan, true);
    assert.ok(result.output.restrictedActions.length > 0);
    assert.strictEqual(result.monitoring.anomalyDetected, true);
    assert.ok(result.monitoring.escalation !== undefined);
  });

  it('4. Structured JSON output — parses correctly to MonitorReport', async () => {
    // Test the parser directly with well-formed JSON
    const rawJson = JSON.stringify({
      anomalies: [
        {
          moduleId: 'observer',
          type: 'low-confidence',
          detail: 'Novelty score below expected range',
        },
      ],
      escalation: null,
      restrictedActions: ['Grep'],
      forceReplan: false,
    });

    const report = parseLlmResponse(rawJson);

    assert.strictEqual(report.anomalies.length, 1);
    assert.strictEqual(report.anomalies[0].moduleId, 'observer');
    assert.strictEqual(report.anomalies[0].type, 'low-confidence');
    assert.strictEqual(report.anomalies[0].detail, 'Novelty score below expected range');
    assert.strictEqual(report.escalation, undefined);
    assert.deepStrictEqual(report.restrictedActions, ['Grep']);
    assert.strictEqual(report.forceReplan, false);

    // Also test that the full round-trip through the module works
    const adapter = createMockAdapterRaw(rawJson);
    const monitor = createLlmMonitor(adapter);
    const state = monitor.initialState();
    const result = await monitor.step(normalSignals(), state, NO_CONTROL);

    assert.strictEqual(result.output.anomalies.length, 1);
    assert.strictEqual(result.output.anomalies[0].moduleId, 'observer');
    assert.deepStrictEqual(result.output.restrictedActions, ['Grep']);
    assert.strictEqual(result.state.totalTokens, 150); // 100 input + 50 output
  });

  it('5. Malformed LLM output — graceful fallback to safe default report', async () => {
    // Test various malformed outputs
    const malformedCases = [
      'This is not JSON at all',
      '{"anomalies": "not an array"}',
      '{invalid json}}}',
      '',
      '```json\nnot actually json\n```',
      'null',
      '42',
    ];

    for (const malformed of malformedCases) {
      const report = parseLlmResponse(malformed);
      assert.deepStrictEqual(report.anomalies, [], `Should have empty anomalies for: ${malformed}`);
      assert.strictEqual(report.escalation, undefined, `Should have no escalation for: ${malformed}`);
      assert.deepStrictEqual(report.restrictedActions, [], `Should have no restricted actions for: ${malformed}`);
      assert.strictEqual(report.forceReplan, false, `Should not force replan for: ${malformed}`);
    }

    // Test that the module itself handles malformed output gracefully
    const adapter = createMockAdapterRaw('totally broken output {{{{');
    const monitor = createLlmMonitor(adapter);
    const state = monitor.initialState();
    const result = await monitor.step(normalSignals(), state, NO_CONTROL);

    assert.deepStrictEqual(result.output.anomalies, []);
    assert.strictEqual(result.output.escalation, undefined);
    assert.strictEqual(result.output.forceReplan, false);
    assert.strictEqual(result.state.invocationCount, 1);
    assert.strictEqual(result.monitoring.anomalyDetected, false);

    // Test that a provider exception is also handled gracefully
    const throwingAdapter: ProviderAdapter = {
      async invoke() { throw new Error('Provider connection failed'); },
    };
    const throwingMonitor = createLlmMonitor(throwingAdapter);
    const throwingState = throwingMonitor.initialState();
    const throwResult = await throwingMonitor.step(normalSignals(), throwingState, NO_CONTROL);

    assert.deepStrictEqual(throwResult.output.anomalies, []);
    assert.strictEqual(throwResult.output.forceReplan, false);
    assert.strictEqual(throwResult.state.invocationCount, 1);
    assert.strictEqual(throwResult.state.totalTokens, 0); // No tokens used on failure
  });
});

describe('parseLlmResponse edge cases', () => {
  it('handles markdown-wrapped JSON', () => {
    const wrapped = '```json\n{"anomalies":[],"escalation":null,"restrictedActions":[],"forceReplan":false}\n```';
    const report = parseLlmResponse(wrapped);
    assert.deepStrictEqual(report.anomalies, []);
    assert.strictEqual(report.forceReplan, false);
  });

  it('filters out anomalies with invalid types', () => {
    const json = JSON.stringify({
      anomalies: [
        { moduleId: 'a', type: 'low-confidence', detail: 'valid' },
        { moduleId: 'b', type: 'invalid-type', detail: 'should be filtered' },
        { moduleId: 'c', type: 'compound', detail: 'also valid' },
      ],
      escalation: null,
      restrictedActions: [],
      forceReplan: false,
    });
    const report = parseLlmResponse(json);
    assert.strictEqual(report.anomalies.length, 2);
    assert.strictEqual(report.anomalies[0].type, 'low-confidence');
    assert.strictEqual(report.anomalies[1].type, 'compound');
  });

  it('state invariant holds after multiple invocations', async () => {
    const adapter = createMockAdapter({
      anomalies: [],
      escalation: null,
      restrictedActions: [],
      forceReplan: false,
    });

    const monitor = createLlmMonitor(adapter);
    let state = monitor.initialState();
    assert.ok(monitor.stateInvariant!(state));

    for (let i = 0; i < 5; i++) {
      const result = await monitor.step(normalSignals(), state, NO_CONTROL);
      state = result.state;
      assert.ok(monitor.stateInvariant!(state), `Invariant should hold after invocation ${i + 1}`);
    }

    assert.strictEqual(state.invocationCount, 5);
    assert.strictEqual(state.totalTokens, 750); // 5 * 150
  });
});
