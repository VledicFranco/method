/**
 * SLM Provider Adapter — unit tests.
 *
 * Uses mock SLM and mock fallback ProviderAdapter. Covers 6 scenarios:
 * 1. SLM success path — valid DSL, high confidence -> SLM result, no fallback
 * 2. DSL parse failure -> fallback called, result returned
 * 3. Low confidence -> fallback called
 * 4. Metrics tracking — after mixed calls, metrics are correct
 * 5. TokenUsage populated correctly — costUsd: 0, correct token counts
 * 6. Fallback error propagation — both SLM and fallback fail -> error propagates
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSLMProviderAdapter } from '../src/slm-provider-adapter.js';
import { createMockSLMInference } from '../src/slm-inference.js';
import type { SLMResult } from '../src/slm-inference.js';
import type {
  ProviderAdapter,
  ProviderAdapterResult,
  ReadonlyWorkspaceSnapshot,
  MonitorReport,
  TokenUsage,
} from '../../phase-1-llm-monitor/src/types.js';
import { moduleId } from '../../phase-1-llm-monitor/src/types.js';

// ── Helpers ────────────────────────────────────────────────────

/** Build a minimal workspace snapshot with a single content entry. */
function makeSnapshot(content: string): ReadonlyWorkspaceSnapshot {
  return [
    {
      source: moduleId('test'),
      content,
      salience: 1.0,
      timestamp: Date.now(),
    },
  ];
}

/** Build a mock fallback ProviderAdapter that records calls. */
function createMockFallback(
  result: ProviderAdapterResult,
): ProviderAdapter & { callCount: number } {
  const mock = {
    callCount: 0,
    async invoke(): Promise<ProviderAdapterResult> {
      mock.callCount++;
      return result;
    },
  };
  return mock;
}

/** Build a mock fallback that always throws. */
function createThrowingFallback(message: string): ProviderAdapter {
  return {
    async invoke(): Promise<ProviderAdapterResult> {
      throw new Error(message);
    },
  };
}

/** Standard fallback result simulating an LLM response. */
function fallbackResult(): ProviderAdapterResult {
  const report: MonitorReport = {
    anomalies: [],
    escalation: undefined,
    restrictedActions: [],
    forceReplan: false,
  };
  const usage: TokenUsage = {
    inputTokens: 500,
    outputTokens: 80,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 580,
  };
  return {
    output: JSON.stringify(report),
    usage,
    cost: {
      totalUsd: 0.001,
      perModel: {
        'claude-3-haiku': { tokens: usage, costUsd: 0.001 },
      },
    },
  };
}

/** Simple DSL parser mock — parses JSON directly (simulates successful parse). */
function mockParseDsl(dsl: string): MonitorReport | null {
  try {
    const parsed = JSON.parse(dsl);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.anomalies)) {
      return parsed as MonitorReport;
    }
    return null;
  } catch {
    return null;
  }
}

/** Simple DSL encoder mock. */
function mockEncodeDsl(report: MonitorReport): string {
  return JSON.stringify(report);
}

/** Build a valid SLM result with a parseable MonitorReport as JSON. */
function validSlmResult(confidence: number = 0.9): SLMResult {
  const report: MonitorReport = {
    anomalies: [],
    escalation: undefined,
    restrictedActions: [],
    forceReplan: false,
  };
  return {
    tokens: JSON.stringify(report),
    confidence,
    inputTokenCount: 120,
    outputTokenCount: 45,
    latencyMs: 15,
  };
}

/** Build an SLM result with garbage output that won't parse. */
function garbageSlmResult(): SLMResult {
  return {
    tokens: '<<GARBAGE NOT PARSEABLE>>',
    confidence: 0.85,
    inputTokenCount: 120,
    outputTokenCount: 10,
    latencyMs: 8,
  };
}

const ADAPTER_CONFIG = { pactTemplate: { mode: { type: 'oneshot' } } } as const;

// ── Tests ──────────────────────────────────────────────────────

describe('SLM Provider Adapter', () => {
  it('1. SLM success path — valid DSL output, high confidence -> returns SLM result, fallback not called', async () => {
    const inputContent = 'test input content';
    const slmResponses = new Map<string, SLMResult>();
    slmResponses.set(inputContent, validSlmResult(0.92));

    const mockSlm = createMockSLMInference(slmResponses);
    await mockSlm.init();

    const fb = createMockFallback(fallbackResult());

    const adapter = createSLMProviderAdapter({
      slm: mockSlm,
      fallback: fb,
      parseDsl: mockParseDsl,
      encodeDsl: mockEncodeDsl,
      escalationThreshold: 0.7,
    });

    const result = await adapter.invoke(makeSnapshot(inputContent), ADAPTER_CONFIG);

    // SLM handled, fallback not called
    assert.strictEqual(fb.callCount, 0);

    // Output is valid MonitorReport JSON
    const report = JSON.parse(result.output) as MonitorReport;
    assert.deepStrictEqual(report.anomalies, []);
    assert.strictEqual(report.forceReplan, false);

    // Cost is zero (local inference)
    assert.strictEqual(result.cost.totalUsd, 0);

    // Token counts reflect SLM
    assert.strictEqual(result.usage.inputTokens, 120);
    assert.strictEqual(result.usage.outputTokens, 45);
    assert.strictEqual(result.usage.totalTokens, 165);
  });

  it('2. DSL parse failure -> fallback called, result returned', async () => {
    const inputContent = 'trigger garbage';
    const slmResponses = new Map<string, SLMResult>();
    slmResponses.set(inputContent, garbageSlmResult());

    const mockSlm = createMockSLMInference(slmResponses);
    await mockSlm.init();

    const fb = createMockFallback(fallbackResult());

    const adapter = createSLMProviderAdapter({
      slm: mockSlm,
      fallback: fb,
      parseDsl: mockParseDsl,
      encodeDsl: mockEncodeDsl,
      escalationThreshold: 0.7,
    });

    const result = await adapter.invoke(makeSnapshot(inputContent), ADAPTER_CONFIG);

    // Fallback was called
    assert.strictEqual(fb.callCount, 1);

    // Result comes from fallback
    assert.strictEqual(result.usage.inputTokens, 500);
    assert.strictEqual(result.cost.totalUsd, 0.001);

    // Metrics reflect parse failure
    const m = adapter.getMetrics();
    assert.strictEqual(m.parseFailures, 1);
    assert.strictEqual(m.fallbackCalls, 1);
    assert.strictEqual(m.slmHandled, 0);
  });

  it('3. Low confidence -> fallback called', async () => {
    const inputContent = 'low conf input';
    const lowConfResult = validSlmResult(0.3); // below threshold of 0.7
    const slmResponses = new Map<string, SLMResult>();
    slmResponses.set(inputContent, lowConfResult);

    const mockSlm = createMockSLMInference(slmResponses);
    await mockSlm.init();

    const fb = createMockFallback(fallbackResult());

    const adapter = createSLMProviderAdapter({
      slm: mockSlm,
      fallback: fb,
      parseDsl: mockParseDsl,
      encodeDsl: mockEncodeDsl,
      escalationThreshold: 0.7,
    });

    const result = await adapter.invoke(makeSnapshot(inputContent), ADAPTER_CONFIG);

    // Fallback was called
    assert.strictEqual(fb.callCount, 1);

    // Result comes from fallback
    assert.strictEqual(result.cost.totalUsd, 0.001);

    // Metrics reflect low-confidence escalation
    const m = adapter.getMetrics();
    assert.strictEqual(m.lowConfidenceEscalations, 1);
    assert.strictEqual(m.fallbackCalls, 1);
    assert.strictEqual(m.parseFailures, 0);
    assert.strictEqual(m.slmHandled, 0);
  });

  it('4. Metrics tracking — after 10 calls (mix of success/fallback), metrics are correct', async () => {
    // Set up: 6 success, 2 parse failures, 2 low-confidence escalations
    const slmResponses = new Map<string, SLMResult>();

    // 6 inputs that produce valid, high-confidence results
    for (let i = 0; i < 6; i++) {
      slmResponses.set(`good-${i}`, validSlmResult(0.9));
    }
    // 2 inputs that produce garbage (parse failure)
    for (let i = 0; i < 2; i++) {
      slmResponses.set(`bad-${i}`, garbageSlmResult());
    }
    // 2 inputs that produce valid DSL but low confidence
    for (let i = 0; i < 2; i++) {
      slmResponses.set(`lowconf-${i}`, validSlmResult(0.4));
    }

    const mockSlm = createMockSLMInference(slmResponses);
    await mockSlm.init();

    const fb = createMockFallback(fallbackResult());

    const adapter = createSLMProviderAdapter({
      slm: mockSlm,
      fallback: fb,
      parseDsl: mockParseDsl,
      encodeDsl: mockEncodeDsl,
      escalationThreshold: 0.7,
    });

    // Run 10 calls
    for (let i = 0; i < 6; i++) {
      await adapter.invoke(makeSnapshot(`good-${i}`), ADAPTER_CONFIG);
    }
    for (let i = 0; i < 2; i++) {
      await adapter.invoke(makeSnapshot(`bad-${i}`), ADAPTER_CONFIG);
    }
    for (let i = 0; i < 2; i++) {
      await adapter.invoke(makeSnapshot(`lowconf-${i}`), ADAPTER_CONFIG);
    }

    const m = adapter.getMetrics();
    assert.strictEqual(m.totalCalls, 10);
    assert.strictEqual(m.slmHandled, 6);
    assert.strictEqual(m.fallbackCalls, 4);
    assert.strictEqual(m.parseFailures, 2);
    assert.strictEqual(m.lowConfidenceEscalations, 2);
    assert.ok(Math.abs(m.escalationRate - 0.4) < 0.001, `Expected escalation rate ~0.4, got ${m.escalationRate}`);
  });

  it('5. TokenUsage populated correctly — SLM result has costUsd: 0, correct token counts', async () => {
    const inputContent = 'token-test';
    const slmResponses = new Map<string, SLMResult>();
    slmResponses.set(inputContent, {
      tokens: JSON.stringify({
        anomalies: [{ moduleId: 'reasoner', type: 'low-confidence', detail: 'test' }],
        escalation: undefined,
        restrictedActions: [],
        forceReplan: false,
      }),
      confidence: 0.88,
      inputTokenCount: 200,
      outputTokenCount: 60,
      latencyMs: 22,
    });

    const mockSlm = createMockSLMInference(slmResponses);
    await mockSlm.init();

    const fb = createMockFallback(fallbackResult());

    const adapter = createSLMProviderAdapter({
      slm: mockSlm,
      fallback: fb,
      parseDsl: mockParseDsl,
      encodeDsl: mockEncodeDsl,
      escalationThreshold: 0.7,
    });

    const result = await adapter.invoke(makeSnapshot(inputContent), ADAPTER_CONFIG);

    // Token counts match SLM result
    assert.strictEqual(result.usage.inputTokens, 200);
    assert.strictEqual(result.usage.outputTokens, 60);
    assert.strictEqual(result.usage.cacheReadTokens, 0);
    assert.strictEqual(result.usage.cacheWriteTokens, 0);
    assert.strictEqual(result.usage.totalTokens, 260);

    // Cost is zero for local SLM
    assert.strictEqual(result.cost.totalUsd, 0);
    const slmModelKey = `slm:mock-slm`;
    assert.ok(slmModelKey in result.cost.perModel);
    assert.strictEqual(result.cost.perModel[slmModelKey].costUsd, 0);
    assert.strictEqual(result.cost.perModel[slmModelKey].tokens.inputTokens, 200);
    assert.strictEqual(result.cost.perModel[slmModelKey].tokens.outputTokens, 60);
  });

  it('6. Fallback error propagation — if both SLM and fallback fail, error propagates', async () => {
    // SLM will produce garbage (parse failure), then fallback will throw
    const inputContent = 'double-failure';
    const slmResponses = new Map<string, SLMResult>();
    slmResponses.set(inputContent, garbageSlmResult());

    const mockSlm = createMockSLMInference(slmResponses);
    await mockSlm.init();

    const throwingFb = createThrowingFallback('Fallback LLM connection refused');

    const adapter = createSLMProviderAdapter({
      slm: mockSlm,
      fallback: throwingFb,
      parseDsl: mockParseDsl,
      encodeDsl: mockEncodeDsl,
      escalationThreshold: 0.7,
    });

    await assert.rejects(
      () => adapter.invoke(makeSnapshot(inputContent), ADAPTER_CONFIG),
      (err: Error) => {
        assert.ok(err.message.includes('Fallback LLM connection refused'));
        return true;
      },
    );

    // Metrics still track the attempt
    const m = adapter.getMetrics();
    assert.strictEqual(m.totalCalls, 1);
    assert.strictEqual(m.parseFailures, 1);
    assert.strictEqual(m.fallbackCalls, 1);
    assert.strictEqual(m.slmHandled, 0);
  });
});
