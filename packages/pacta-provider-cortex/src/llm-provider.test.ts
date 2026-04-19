// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for cortexLLMProvider (PRD-059 §5.1 test strategy).
 *
 * Covers:
 *   - SC-01 / G-LLM-HANDLERS-PRESENT: compose rejects missing handlers
 *   - SC-03: effort → tier mapping (including embed path)
 *   - SC-10: capabilities().budgetEnforcement === 'native'
 *   - schema-present → ctx.llm.structured; absent → ctx.llm.complete
 *   - AgentResult shape (usage, cost, stopReason, turns)
 *   - BudgetExceeded error path → stopReason: 'budget_exhausted'
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Pact, AgentRequest, AgentEvent } from '@methodts/pacta';
import { cortexLLMProvider } from './llm-provider.js';
import { CortexAdapterComposeError } from './adapter.js';
import type {
  BudgetStatus,
  CompletionRequest,
  CompletionResult,
  CortexLlmCtx,
  EmbeddingResult,
  LlmBudgetHandlers,
  LlmTier,
  StructuredResult,
} from './ctx-types.js';

// ── Helpers ──────────────────────────────────────────────────────

function noopHandlers(): LlmBudgetHandlers {
  return {
    onBudgetWarning: () => undefined,
    onBudgetCritical: () => undefined,
    onBudgetExceeded: () => undefined,
  };
}

interface MockLlmRecorder {
  lastCompleteReq?: CompletionRequest;
  lastStructuredReq?: CompletionRequest;
  embedCalls: string[];
  registered: boolean;
}

function makeMockLlm(
  overrides?: Partial<CortexLlmCtx> & { budget?: BudgetStatus; throwOn?: 'complete' | 'structured' | 'embed'; throwErr?: unknown },
): { ctx: CortexLlmCtx; recorder: MockLlmRecorder } {
  const recorder: MockLlmRecorder = { embedCalls: [], registered: false };
  const budget = overrides?.budget;
  const base: CortexLlmCtx = {
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      recorder.lastCompleteReq = req;
      if (overrides?.throwOn === 'complete') throw overrides.throwErr;
      return {
        content: `answer:${req.prompt}`,
        tokensIn: 100,
        tokensOut: 50,
        costUsd: 0.005,
        providerModel: 'test-model',
        budget,
      };
    },
    async structured<T>(req: CompletionRequest): Promise<StructuredResult<T>> {
      recorder.lastStructuredReq = req;
      if (overrides?.throwOn === 'structured') throw overrides.throwErr;
      return {
        value: { ok: true } as unknown as T,
        tokensIn: 80,
        tokensOut: 20,
        costUsd: 0.003,
        providerModel: 'test-model',
        budget,
      };
    },
    async embed(text: string): Promise<EmbeddingResult> {
      recorder.embedCalls.push(text);
      if (overrides?.throwOn === 'embed') throw overrides.throwErr;
      return {
        vector: [0.1, 0.2, 0.3],
        dimensions: 3,
        tokensIn: 10,
        costUsd: 0.0001,
        providerModel: 'test-embed',
        budget,
      };
    },
    registerBudgetHandlers: () => {
      recorder.registered = true;
    },
    ...overrides,
  };
  return { ctx: base, recorder };
}

function oneshotPact(overrides?: Partial<Pact<unknown>>): Pact<unknown> {
  return { mode: { type: 'oneshot' }, ...overrides };
}

// ── G-LLM-HANDLERS-PRESENT (compose-time gate) ───────────────────

describe('cortexLLMProvider — compose gates', () => {
  it('G-LLM-HANDLERS-PRESENT: throws on missing ctx.llm', () => {
    const adapter = cortexLLMProvider({ handlers: noopHandlers() });
    assert.throws(
      () => adapter.compose({ ctx: {} as any, pact: oneshotPact() }),
      (err: unknown) => {
        assert.ok(err instanceof CortexAdapterComposeError);
        assert.equal((err as CortexAdapterComposeError).reason, 'missing_ctx_service');
        return true;
      },
    );
  });

  it('G-LLM-HANDLERS-PRESENT: throws on missing onBudgetWarning', () => {
    const { ctx } = makeMockLlm();
    const adapter = cortexLLMProvider({
      handlers: {
        onBudgetCritical: () => undefined,
        onBudgetExceeded: () => undefined,
      } as unknown as LlmBudgetHandlers,
    });
    assert.throws(
      () => adapter.compose({ ctx: { llm: ctx }, pact: oneshotPact() }),
      (err: unknown) => {
        assert.ok(err instanceof CortexAdapterComposeError);
        assert.equal((err as CortexAdapterComposeError).reason, 'missing_mandatory_handler');
        assert.equal((err as CortexAdapterComposeError).details.handler, 'onBudgetWarning');
        return true;
      },
    );
  });

  it('G-LLM-HANDLERS-PRESENT: throws on missing onBudgetCritical', () => {
    const { ctx } = makeMockLlm();
    const adapter = cortexLLMProvider({
      handlers: {
        onBudgetWarning: () => undefined,
        onBudgetExceeded: () => undefined,
      } as unknown as LlmBudgetHandlers,
    });
    assert.throws(
      () => adapter.compose({ ctx: { llm: ctx }, pact: oneshotPact() }),
      (err: unknown) =>
        err instanceof CortexAdapterComposeError &&
        err.reason === 'missing_mandatory_handler' &&
        err.details.handler === 'onBudgetCritical',
    );
  });

  it('G-LLM-HANDLERS-PRESENT: throws on missing onBudgetExceeded', () => {
    const { ctx } = makeMockLlm();
    const adapter = cortexLLMProvider({
      handlers: {
        onBudgetWarning: () => undefined,
        onBudgetCritical: () => undefined,
      } as unknown as LlmBudgetHandlers,
    });
    assert.throws(
      () => adapter.compose({ ctx: { llm: ctx }, pact: oneshotPact() }),
      (err: unknown) =>
        err instanceof CortexAdapterComposeError &&
        err.reason === 'missing_mandatory_handler' &&
        err.details.handler === 'onBudgetExceeded',
    );
  });

  it('successful compose returns adapter with name "cortex-llm" and requires = [llm]', () => {
    const { ctx, recorder } = makeMockLlm();
    const adapter = cortexLLMProvider({ handlers: noopHandlers() });
    const composed = adapter.compose({ ctx: { llm: ctx }, pact: oneshotPact() });
    assert.equal(composed.name, 'cortex-llm');
    assert.deepEqual([...composed.requires], ['llm']);
    assert.equal(recorder.registered, true, 'registerBudgetHandlers called');
  });
});

// ── SC-10 — capabilities ─────────────────────────────────────────

describe('cortexLLMProvider — capabilities', () => {
  it('SC-10: budgetEnforcement === "native"', () => {
    const { ctx } = makeMockLlm();
    const composed = cortexLLMProvider({ handlers: noopHandlers() }).compose({
      ctx: { llm: ctx },
      pact: oneshotPact(),
    });
    const caps = composed.capabilities();
    assert.equal(caps.budgetEnforcement, 'native');
    assert.equal(caps.streaming, false);
    assert.equal(caps.resumable, false);
    assert.equal(caps.outputValidation, 'client');
    assert.equal(caps.toolModel, 'none');
  });
});

// ── SC-03 — tier mapping ─────────────────────────────────────────

describe('cortexLLMProvider — tier mapping (SC-03)', () => {
  async function runAndGetTier(
    effort: 'low' | 'medium' | 'high' | undefined,
  ): Promise<LlmTier> {
    const { ctx, recorder } = makeMockLlm();
    const composed = cortexLLMProvider({ handlers: noopHandlers() }).compose({
      ctx: { llm: ctx },
      pact: oneshotPact({ reasoning: effort ? { effort } : undefined }),
    });
    await composed.invoke(composed.pact as Pact<unknown>, { prompt: 'x' });
    return recorder.lastCompleteReq!.tier;
  }

  it('low → fast', async () => assert.equal(await runAndGetTier('low'), 'fast'));
  it('medium → balanced', async () =>
    assert.equal(await runAndGetTier('medium'), 'balanced'));
  it('high → powerful', async () =>
    assert.equal(await runAndGetTier('high'), 'powerful'));
  it('undefined → balanced', async () =>
    assert.equal(await runAndGetTier(undefined), 'balanced'));

  it('tierOverride wins over effort', async () => {
    const { ctx, recorder } = makeMockLlm();
    const composed = cortexLLMProvider({
      handlers: noopHandlers(),
      tierOverride: 'powerful',
    }).compose({
      ctx: { llm: ctx },
      pact: oneshotPact({ reasoning: { effort: 'low' } }),
    });
    await composed.invoke(composed.pact as Pact<unknown>, { prompt: 'x' });
    assert.equal(recorder.lastCompleteReq!.tier, 'powerful');
  });

  it('cortexEmbed hint routes to ctx.llm.embed with tier "embedding"', async () => {
    const { ctx, recorder } = makeMockLlm();
    const composed = cortexLLMProvider({ handlers: noopHandlers() }).compose({
      ctx: { llm: ctx },
      pact: oneshotPact(),
    });
    await composed.invoke(composed.pact as Pact<unknown>, {
      prompt: 'embed me',
      metadata: { cortexEmbed: true },
    });
    assert.deepEqual(recorder.embedCalls, ['embed me']);
  });
});

// ── structured vs complete selection ─────────────────────────────

describe('cortexLLMProvider — structured vs complete', () => {
  it('pact.output.schema present → routes to ctx.llm.structured', async () => {
    const { ctx, recorder } = makeMockLlm();
    const schemaPact = oneshotPact({
      output: {
        schema: {
          parse: (raw: unknown) => ({ success: true as const, data: raw }),
        },
      },
    });
    const composed = cortexLLMProvider({ handlers: noopHandlers() }).compose({
      ctx: { llm: ctx },
      pact: schemaPact,
    });
    await composed.invoke(composed.pact as Pact<unknown>, { prompt: 'x' });
    assert.ok(recorder.lastStructuredReq, 'structured should be called');
    assert.equal(recorder.lastCompleteReq, undefined);
  });

  it('no schema → routes to ctx.llm.complete', async () => {
    const { ctx, recorder } = makeMockLlm();
    const composed = cortexLLMProvider({ handlers: noopHandlers() }).compose({
      ctx: { llm: ctx },
      pact: oneshotPact(),
    });
    await composed.invoke(composed.pact as Pact<unknown>, { prompt: 'x' });
    assert.ok(recorder.lastCompleteReq);
    assert.equal(recorder.lastStructuredReq, undefined);
  });
});

// ── Result shape ─────────────────────────────────────────────────

describe('cortexLLMProvider — invoke result shape', () => {
  it('maps CompletionResult to AgentResult {usage, cost, stopReason: complete, turns: 1}', async () => {
    const { ctx } = makeMockLlm();
    const composed = cortexLLMProvider({ handlers: noopHandlers() }).compose({
      ctx: { llm: ctx },
      pact: oneshotPact(),
    });
    const result = await composed.invoke(composed.pact as Pact<unknown>, {
      prompt: 'hi',
    });
    assert.equal(result.stopReason, 'complete');
    assert.equal(result.completed, true);
    assert.equal(result.turns, 1);
    assert.equal(result.usage.inputTokens, 100);
    assert.equal(result.usage.outputTokens, 50);
    assert.equal(result.usage.totalTokens, 150);
    assert.equal(result.cost.totalUsd, 0.005);
    assert.ok(result.cost.perModel['test-model']);
    assert.equal(result.cost.perModel['test-model']?.costUsd, 0.005);
  });

  it('BudgetExceeded error → stopReason: "budget_exhausted"', async () => {
    class BudgetExceeded extends Error {
      readonly code = 'BudgetExceeded';
    }
    const { ctx } = makeMockLlm({
      throwOn: 'complete',
      throwErr: new BudgetExceeded('limit'),
    });
    const composed = cortexLLMProvider({ handlers: noopHandlers() }).compose({
      ctx: { llm: ctx },
      pact: oneshotPact(),
    });
    const result = await composed.invoke(composed.pact as Pact<unknown>, {
      prompt: 'hi',
    });
    assert.equal(result.stopReason, 'budget_exhausted');
    assert.equal(result.completed, false);
  });

  it('emits turn_complete and completed events on success', async () => {
    const { ctx } = makeMockLlm();
    const composed = cortexLLMProvider({ handlers: noopHandlers() }).compose({
      ctx: { llm: ctx },
      pact: oneshotPact(),
    });
    const events: AgentEvent[] = [];
    await composed.invoke(composed.pact as Pact<unknown>, {
      prompt: 'hi',
      metadata: { onEvent: (e: AgentEvent) => events.push(e) },
    });
    const types = events.map(e => e.type);
    assert.ok(types.includes('started'));
    assert.ok(types.includes('turn_complete'));
    assert.ok(types.includes('completed'));
  });

  it('mirrors ctx.llm BudgetStatus to pacta budget_warning event at >=80%', async () => {
    const { ctx } = makeMockLlm({
      budget: { totalCostUsd: 0.9, limitUsd: 1.0, percentUsed: 90 },
    });
    const composed = cortexLLMProvider({ handlers: noopHandlers() }).compose({
      ctx: { llm: ctx },
      pact: oneshotPact(),
    });
    const events: AgentEvent[] = [];
    await composed.invoke(composed.pact as Pact<unknown>, {
      prompt: 'hi',
      metadata: { onEvent: (e: AgentEvent) => events.push(e) },
    });
    const warn = events.find(e => e.type === 'budget_warning');
    assert.ok(warn, 'budget_warning should be mirrored');
  });

  it('streaming stub throws (PRD-068 Wave 7 gated)', async () => {
    const { ctx } = makeMockLlm();
    const composed = cortexLLMProvider({ handlers: noopHandlers() }).compose({
      ctx: { llm: ctx },
      pact: oneshotPact(),
    });
    await assert.rejects(async () => {
      for await (const _ of composed.stream(
        composed.pact as Pact<unknown>,
        { prompt: 'x' },
      )) {
        void _;
      }
    }, /streaming is not implemented in v1/);
  });
});
