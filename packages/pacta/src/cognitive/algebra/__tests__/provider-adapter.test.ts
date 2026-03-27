/**
 * Unit tests for the provider adapter factory.
 *
 * Tests: wrapping AgentProvider with workspace snapshot, mapping AgentResult
 * to ProviderAdapterResult, error propagation as StepError.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { createProviderAdapter } from '../provider-adapter.js';
import type { AdapterConfig, ProviderAdapterResult } from '../provider-adapter.js';
import type { Pact, AgentRequest, AgentResult, TokenUsage, CostReport } from '../../../pact.js';
import type { AgentProvider, ProviderCapabilities } from '../../../ports/agent-provider.js';
import type { ReadonlyWorkspaceSnapshot } from '../workspace-types.js';
import type { StepError } from '../module.js';
import { moduleId } from '../module.js';

// ── Helpers ──────────────────────────────────────────────────────

function makeUsage(total = 100): TokenUsage {
  return {
    inputTokens: 60,
    outputTokens: 40,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: total,
  };
}

function makeCost(usd = 0.01): CostReport {
  return { totalUsd: usd, perModel: {} };
}

function makeSnapshot(contents: string[]): ReadonlyWorkspaceSnapshot {
  return contents.map((content, i) => ({
    source: moduleId(`module-${i}`),
    content,
    salience: 0.5,
    timestamp: Date.now(),
  }));
}

function makeProvider(opts?: {
  output?: unknown;
  usage?: TokenUsage;
  cost?: CostReport;
  throwError?: Error;
  captureRequest?: (pact: Pact, req: AgentRequest) => void;
}): AgentProvider {
  return {
    name: 'test-provider',
    capabilities(): ProviderCapabilities {
      return {
        modes: ['oneshot'],
        streaming: false,
        resumable: false,
        budgetEnforcement: 'none',
        outputValidation: 'none',
        toolModel: 'none',
      };
    },
    async invoke<T>(pact: Pact<T>, request: AgentRequest): Promise<AgentResult<T>> {
      opts?.captureRequest?.(pact, request);
      if (opts?.throwError) throw opts.throwError;
      return {
        output: (opts?.output ?? 'default output') as T,
        sessionId: 'test-session',
        completed: true,
        stopReason: 'complete',
        usage: opts?.usage ?? makeUsage(),
        cost: opts?.cost ?? makeCost(),
        durationMs: 50,
        turns: 1,
      };
    },
  };
}

const defaultConfig: AdapterConfig = {
  pactTemplate: {},
  systemPrompt: 'You are a cognitive module.',
};

// ── Tests ────────────────────────────────────────────────────────

describe('createProviderAdapter', () => {
  it('wraps AgentProvider, builds AgentRequest from workspace snapshot', async () => {
    let capturedPact: Pact | undefined;
    let capturedRequest: AgentRequest | undefined;

    const provider = makeProvider({
      output: 'test result',
      captureRequest(pact, req) {
        capturedPact = pact;
        capturedRequest = req;
      },
    });

    const adapter = createProviderAdapter(provider, defaultConfig);
    const snapshot = makeSnapshot(['context entry 1', 'context entry 2']);

    const result = await adapter.invoke(snapshot, {
      pactTemplate: {},
      systemPrompt: 'Think carefully.',
    });

    // Verify the adapter built a proper request
    assert.ok(capturedPact, 'Pact should have been passed to provider');
    assert.equal(capturedPact!.mode.type, 'oneshot', 'Default mode should be oneshot');

    assert.ok(capturedRequest, 'Request should have been passed to provider');
    assert.ok(
      capturedRequest!.prompt.includes('context entry 1'),
      'Prompt should contain first workspace entry',
    );
    assert.ok(
      capturedRequest!.prompt.includes('context entry 2'),
      'Prompt should contain second workspace entry',
    );
    assert.equal(capturedRequest!.systemPrompt, 'Think carefully.');

    // Verify result mapping
    assert.equal(result.output, 'test result');
  });

  it('maps AgentResult to ProviderAdapterResult with usage/cost', async () => {
    const expectedUsage = makeUsage(500);
    const expectedCost = makeCost(0.05);

    const provider = makeProvider({
      output: 'analysis complete',
      usage: expectedUsage,
      cost: expectedCost,
    });

    const adapter = createProviderAdapter(provider, defaultConfig);
    const snapshot = makeSnapshot(['data to analyze']);

    const result = await adapter.invoke(snapshot, { pactTemplate: {} });

    assert.equal(result.output, 'analysis complete');
    assert.deepStrictEqual(result.usage, expectedUsage);
    assert.deepStrictEqual(result.cost, expectedCost);
  });

  it('propagates errors from provider as recoverable StepError', async () => {
    const provider = makeProvider({
      throwError: new Error('API rate limit exceeded'),
    });

    const adapter = createProviderAdapter(provider, defaultConfig);
    const snapshot = makeSnapshot(['some input']);

    try {
      await adapter.invoke(snapshot, { pactTemplate: {} });
      assert.fail('Expected error to be thrown');
    } catch (err: unknown) {
      assert.ok(err instanceof Error);
      assert.equal(err.message, 'API rate limit exceeded');

      // Verify StepError is attached
      const stepError = (err as Error & { stepError: StepError }).stepError;
      assert.ok(stepError, 'stepError should be attached to the error');
      assert.equal(stepError.message, 'API rate limit exceeded');
      assert.equal(stepError.recoverable, true);
      assert.equal(stepError.phase, 'invoke');
    }
  });
});
