/**
 * Stub sample app — exercises every canonical conformance fixture end-to-end
 * so the testkit's own tests can validate the runner without depending on
 * `samples/cortex-incident-triage-agent/`. Fulfils the I-SAMPLE gate
 * (PRD-065 §12.3) as an in-repo stub. This file is excluded from the
 * published conformance subpath by virtue of living under `__tests__/`.
 */

import type { CortexCtx, MethodAgentResult } from '@method/agent-runtime';

export interface SampleAppMeta {
  readonly scriptedTurns: number;
  readonly expectsDelegation: boolean;
  readonly expectsResume: boolean;
  readonly toolsRequestedByTurn?: ReadonlyArray<ReadonlyArray<string>>;
  readonly publishDailyReport?: boolean;
}

/**
 * A tenant app that conforms to MethodAgentPort for every canonical fixture.
 * Behaviour is parameterised by `meta` — callers pick the right parameters
 * for the fixture under test (the test file, not the runner, does this).
 */
export function buildConformingApp(
  meta: SampleAppMeta,
): (ctx: CortexCtx) => Promise<MethodAgentResult<unknown>> {
  return async (ctx) => {
    let auditCount = 0;
    const emit = async (
      kind: string,
      payload?: Readonly<Record<string, unknown>>,
    ): Promise<void> => {
      await Promise.resolve(
        ctx.audit.event({ kind, ...(payload ? { payload } : {}) }),
      );
      auditCount += 1;
    };

    ctx.llm.registerBudgetHandlers?.({
      onBudgetWarning: () => undefined,
      onBudgetCritical: () => undefined,
      onBudgetExceeded: () => undefined,
    });

    await emit('method.agent.started');

    if (meta.expectsDelegation && ctx.auth?.exchangeForAgent) {
      const first = await ctx.auth.exchangeForAgent('parent-token-0', ['agent:invoke']);
      await ctx.auth.exchangeForAgent(first.token, ['agent:invoke']);
    }

    for (let i = 0; i < meta.scriptedTurns; i++) {
      await ctx.llm.complete({
        tier: 'balanced',
        prompt: `turn ${i + 1}`,
        _handlers: true,
      } as never);
      await emit('method.agent.turn_complete', { turnNumber: i + 1 });

      if (meta.expectsResume && i === 2) {
        await emit('method.agent.suspended');
        await emit('method.agent.resumed');
      }
    }

    if (meta.publishDailyReport && ctx.events) {
      await Promise.resolve(
        ctx.events.publish('daily-report', { status: 'ok' }),
      );
    }

    await emit('method.agent.completed');

    const pacta = {
      output: { ok: true },
      sessionId: `sample-${ctx.app.id}`,
      completed: true,
      stopReason: 'complete' as const,
      usage: {
        inputTokens: 100,
        outputTokens: 40,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 140,
      },
      cost: { totalUsd: 0, perModel: {} },
      durationMs: 1,
      turns: meta.scriptedTurns,
    };
    const annotated = {
      ...pacta,
      appId: ctx.app.id,
      auditEventCount: auditCount,
    };
    return annotated as unknown as MethodAgentResult<unknown>;
  };
}

/**
 * Fixture-aware wrapper: inspects the fixture id baked into `ctx.input`
 * (set by test code) and routes to the appropriate `buildConformingApp`
 * parametrization, so one app function can pass every fixture.
 */
export function passAllFixturesApp(
  ctx: CortexCtx,
): Promise<MethodAgentResult<unknown>> {
  const input = (ctx.input ?? {}) as { readonly fixtureId?: string };
  switch (input.fixtureId) {
    case 'incident-triage':
      return buildConformingApp({
        scriptedTurns: 2,
        expectsDelegation: false,
        expectsResume: false,
      })(ctx);
    case 'feature-dev-commission':
      return buildConformingApp({
        scriptedTurns: 6,
        expectsDelegation: true,
        expectsResume: true,
      })(ctx);
    case 'daily-report':
      return buildConformingApp({
        scriptedTurns: 2,
        expectsDelegation: false,
        expectsResume: false,
        publishDailyReport: true,
      })(ctx);
    default:
      return buildConformingApp({
        scriptedTurns: 2,
        expectsDelegation: false,
        expectsResume: false,
      })(ctx);
  }
}
