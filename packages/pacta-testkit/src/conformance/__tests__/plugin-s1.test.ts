// SPDX-License-Identifier: Apache-2.0
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  s1MethodAgentPortPlugin,
  createMockCortexCtx,
  incidentTriageFixture,
  featureDevCommissionFixture,
  dailyReportFixture,
  type CheckVerdict,
} from '../index.js';
import type { MethodAgentResult } from '../cortex-types.js';

function emptyRun(fixtureId: string): {
  fixtureId: string;
  durationMs: number;
  callCounts: Record<string, number>;
  maxDelegationDepth: number;
} {
  return {
    fixtureId,
    durationMs: 0,
    callCounts: { audit: 0, llm: 0, storage: 0, jobs: 0, events: 0, auth: 0 },
    maxDelegationDepth: 0,
  };
}

function goodResult(): MethodAgentResult<unknown> {
  return {
    output: { ok: true },
    sessionId: 's',
    completed: true,
    stopReason: 'complete',
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 2,
    },
    cost: { totalUsd: 0, perModel: {} },
    durationMs: 1,
    turns: 1,
    appId: 'stub',
    auditEventCount: 3,
  } as unknown as MethodAgentResult<unknown>;
}

describe('s1MethodAgentPortPlugin — C1 port entry', () => {
  it('fails C1 when app returns no MethodAgentResult', async () => {
    const ctx = createMockCortexCtx({ appId: 'stub' });
    const verdicts = await s1MethodAgentPortPlugin.run({
      fixture: incidentTriageFixture,
      fixtureRun: emptyRun('incident-triage') as never,
      ctx,
      recorder: ctx.recorder,
      agentResult: undefined,
    });
    const c1 = verdicts.find((v) => v.id === 'S1-C1-invokes-via-createMethodAgent')!;
    assert.equal(c1.passed, false);
  });

  it('passes C1 when MethodAgentResult has appId + auditEventCount', async () => {
    const ctx = createMockCortexCtx({ appId: 'stub' });
    const verdicts = await s1MethodAgentPortPlugin.run({
      fixture: incidentTriageFixture,
      fixtureRun: emptyRun('incident-triage') as never,
      ctx,
      recorder: ctx.recorder,
      agentResult: goodResult(),
    });
    const c1 = verdicts.find((v) => v.id === 'S1-C1-invokes-via-createMethodAgent')!;
    assert.equal(c1.passed, true);
  });
});

describe('s1MethodAgentPortPlugin — C2 budget handlers', () => {
  it('fails C2 when pact requires LLM but no registerBudgetHandlers call recorded', async () => {
    const ctx = createMockCortexCtx({ appId: 'stub' });
    // Simulate one llm.complete call without prior register
    ctx.scriptLlmResponse({
      text: 't',
      usage: { inputTokens: 1, outputTokens: 1 },
      costUsd: 0,
    });
    await ctx.llm.complete({ tier: 'balanced', prompt: 'p' });
    const verdicts = await s1MethodAgentPortPlugin.run({
      fixture: incidentTriageFixture,
      fixtureRun: emptyRun('incident-triage') as never,
      ctx,
      recorder: ctx.recorder,
      agentResult: goodResult(),
    });
    const c2 = verdicts.find((v) => v.id === 'S1-C2-budget-handlers-registered')!;
    assert.equal(c2.passed, false);
  });

  it('passes C2 after registerBudgetHandlers call', async () => {
    const ctx = createMockCortexCtx({ appId: 'stub' });
    ctx.llm.registerBudgetHandlers!({
      onBudgetWarning: () => undefined,
      onBudgetCritical: () => undefined,
      onBudgetExceeded: () => undefined,
    });
    const verdicts = await s1MethodAgentPortPlugin.run({
      fixture: incidentTriageFixture,
      fixtureRun: emptyRun('incident-triage') as never,
      ctx,
      recorder: ctx.recorder,
      agentResult: goodResult(),
    });
    const c2 = verdicts.find((v) => v.id === 'S1-C2-budget-handlers-registered')!;
    assert.equal(c2.passed, true);
  });
});

describe('s1MethodAgentPortPlugin — C3 audit minimum', () => {
  it('fails C3 when required audit kinds are missing', async () => {
    const ctx = createMockCortexCtx({ appId: 'stub' });
    await ctx.audit.event({ kind: 'method.agent.started' });
    const verdicts = await s1MethodAgentPortPlugin.run({
      fixture: incidentTriageFixture,
      fixtureRun: emptyRun('incident-triage') as never,
      ctx,
      recorder: ctx.recorder,
      agentResult: goodResult(),
    });
    const c3 = verdicts.find((v) => v.id === 'S1-C3-audit-minimum-set')!;
    assert.equal(c3.passed, false);
    assert.ok(c3.evidence);
  });

  it('passes C3 when all required audit kinds emitted', async () => {
    const ctx = createMockCortexCtx({ appId: 'stub' });
    await ctx.audit.event({ kind: 'method.agent.started' });
    await ctx.audit.event({ kind: 'method.agent.turn_complete' });
    await ctx.audit.event({ kind: 'method.agent.completed' });
    const verdicts = await s1MethodAgentPortPlugin.run({
      fixture: incidentTriageFixture,
      fixtureRun: emptyRun('incident-triage') as never,
      ctx,
      recorder: ctx.recorder,
      agentResult: goodResult(),
    });
    const c3 = verdicts.find((v) => v.id === 'S1-C3-audit-minimum-set')!;
    assert.equal(c3.passed, true);
  });
});

describe('s1MethodAgentPortPlugin — C4 token exchange depth', () => {
  it('fails C4 when delegation expected but depth != 2', async () => {
    const ctx = createMockCortexCtx({ appId: 'stub' });
    await ctx.auth!.exchangeForAgent!('parent-token-0', ['a']);
    const verdicts = await s1MethodAgentPortPlugin.run({
      fixture: featureDevCommissionFixture,
      fixtureRun: emptyRun('feature-dev-commission') as never,
      ctx,
      recorder: ctx.recorder,
      agentResult: goodResult(),
    });
    const c4 = verdicts.find((v) => v.id === 'S1-C4-token-exchange-depth')!;
    assert.equal(c4.passed, false);
  });

  it('passes C4 when delegation expected and depth === 2', async () => {
    const ctx = createMockCortexCtx({ appId: 'stub' });
    const first = await ctx.auth!.exchangeForAgent!('parent-token-0', ['a']);
    await ctx.auth!.exchangeForAgent!(first.token, ['a']);
    const verdicts = await s1MethodAgentPortPlugin.run({
      fixture: featureDevCommissionFixture,
      fixtureRun: emptyRun('feature-dev-commission') as never,
      ctx,
      recorder: ctx.recorder,
      agentResult: goodResult(),
    });
    const c4 = verdicts.find((v) => v.id === 'S1-C4-token-exchange-depth')!;
    assert.equal(c4.passed, true);
  });

  it('fails C4 when depth exceeds 2 even if no delegation expected', async () => {
    const ctx = createMockCortexCtx({ appId: 'stub' });
    const first = await ctx.auth!.exchangeForAgent!('parent-token-0', ['a']);
    const second = await ctx.auth!.exchangeForAgent!(first.token, ['a']);
    await ctx.auth!.exchangeForAgent!(second.token, ['a']);
    const verdicts = await s1MethodAgentPortPlugin.run({
      fixture: incidentTriageFixture,
      fixtureRun: emptyRun('incident-triage') as never,
      ctx,
      recorder: ctx.recorder,
      agentResult: goodResult(),
    });
    const c4 = verdicts.find((v) => v.id === 'S1-C4-token-exchange-depth')!;
    assert.equal(c4.passed, false);
  });
});

describe('s1MethodAgentPortPlugin — C5 scope respect', () => {
  it('fails C5 when tools requested outside scope.allowedTools', async () => {
    const ctx = createMockCortexCtx({ appId: 'stub' });
    ctx.scriptLlmResponse({
      text: 't',
      usage: { inputTokens: 1, outputTokens: 1 },
      costUsd: 0,
      toolsRequested: ['Grep', 'UnauthorizedTool'],
    });
    await ctx.llm.complete({ tier: 'balanced', prompt: 'p' });
    const verdicts = await s1MethodAgentPortPlugin.run({
      fixture: incidentTriageFixture,
      fixtureRun: emptyRun('incident-triage') as never,
      ctx,
      recorder: ctx.recorder,
      agentResult: goodResult(),
    });
    const c5 = verdicts.find((v) => v.id === 'S1-C5-scope-respect')!;
    assert.equal(c5.passed, false);
    assert.ok((c5.evidence ?? '').includes('UnauthorizedTool'));
  });

  it('passes C5 when all tools within scope', async () => {
    const ctx = createMockCortexCtx({ appId: 'stub' });
    ctx.scriptLlmResponse({
      text: 't',
      usage: { inputTokens: 1, outputTokens: 1 },
      costUsd: 0,
      toolsRequested: ['Grep'],
    });
    await ctx.llm.complete({ tier: 'balanced', prompt: 'p' });
    const verdicts = await s1MethodAgentPortPlugin.run({
      fixture: incidentTriageFixture,
      fixtureRun: emptyRun('incident-triage') as never,
      ctx,
      recorder: ctx.recorder,
      agentResult: goodResult(),
    });
    const c5 = verdicts.find((v) => v.id === 'S1-C5-scope-respect')!;
    assert.equal(c5.passed, true);
  });

  it('skips C5 when fixture does not exercise scope', async () => {
    const ctx = createMockCortexCtx({ appId: 'stub' });
    const verdicts: ReadonlyArray<CheckVerdict> = await s1MethodAgentPortPlugin.run({
      fixture: dailyReportFixture,
      fixtureRun: emptyRun('daily-report') as never,
      ctx,
      recorder: ctx.recorder,
      agentResult: goodResult(),
    });
    const c5 = verdicts.find((v) => v.id === 'S1-C5-scope-respect')!;
    assert.equal(c5.passed, true);
    assert.ok((c5.evidence ?? '').includes('skipped'));
  });
});

describe('s1MethodAgentPortPlugin — C6 resume roundtrip', () => {
  it('fails C6 when resume expected but no suspended/resumed audit', async () => {
    const ctx = createMockCortexCtx({ appId: 'stub' });
    await ctx.audit.event({ kind: 'method.agent.started' });
    await ctx.audit.event({ kind: 'method.agent.completed' });
    const verdicts = await s1MethodAgentPortPlugin.run({
      fixture: featureDevCommissionFixture,
      fixtureRun: emptyRun('feature-dev-commission') as never,
      ctx,
      recorder: ctx.recorder,
      agentResult: goodResult(),
    });
    const c6 = verdicts.find((v) => v.id === 'S1-C6-resume-roundtrip')!;
    assert.equal(c6.passed, false);
  });

  it('passes C6 when full suspended/resumed/completed trio present', async () => {
    const ctx = createMockCortexCtx({ appId: 'stub' });
    await ctx.audit.event({ kind: 'method.agent.started' });
    await ctx.audit.event({ kind: 'method.agent.suspended' });
    await ctx.audit.event({ kind: 'method.agent.resumed' });
    await ctx.audit.event({ kind: 'method.agent.completed' });
    const verdicts = await s1MethodAgentPortPlugin.run({
      fixture: featureDevCommissionFixture,
      fixtureRun: emptyRun('feature-dev-commission') as never,
      ctx,
      recorder: ctx.recorder,
      agentResult: goodResult(),
    });
    const c6 = verdicts.find((v) => v.id === 'S1-C6-resume-roundtrip')!;
    assert.equal(c6.passed, true);
  });

  it('skips C6 when fixture is not resumable', async () => {
    const ctx = createMockCortexCtx({ appId: 'stub' });
    const verdicts = await s1MethodAgentPortPlugin.run({
      fixture: incidentTriageFixture,
      fixtureRun: emptyRun('incident-triage') as never,
      ctx,
      recorder: ctx.recorder,
      agentResult: goodResult(),
    });
    const c6 = verdicts.find((v) => v.id === 'S1-C6-resume-roundtrip')!;
    assert.equal(c6.passed, true);
    assert.ok((c6.evidence ?? '').includes('skipped'));
  });
});
