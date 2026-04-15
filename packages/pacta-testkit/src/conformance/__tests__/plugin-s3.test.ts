import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  s3ServiceAdaptersPlugin,
  createMockCortexCtx,
  incidentTriageFixture,
  featureDevCommissionFixture,
  dailyReportFixture,
} from '../index.js';

const baseFixtureRun = {
  fixtureId: 'incident-triage' as const,
  durationMs: 0,
  callCounts: { audit: 0, llm: 0, storage: 0, jobs: 0, events: 0, auth: 0 },
  maxDelegationDepth: 0,
};
const emptyFixtureRun = baseFixtureRun as never;

describe('s3ServiceAdaptersPlugin — adapter invariants', () => {
  it('A1 fails when pact requires LLM but no complete call recorded', async () => {
    const ctx = createMockCortexCtx({ appId: 'stub' });
    const verdicts = await s3ServiceAdaptersPlugin.run({
      fixture: incidentTriageFixture,
      fixtureRun: emptyFixtureRun,
      ctx,
      recorder: ctx.recorder,
    });
    const a1 = verdicts.find((v) => v.id === 'S3-A1-llm-routed-via-ctx')!;
    assert.equal(a1.passed, false);
  });

  it('A1 passes when at least one ctx.llm.complete call recorded', async () => {
    const ctx = createMockCortexCtx({ appId: 'stub' });
    ctx.scriptLlmResponse({
      text: 't',
      usage: { inputTokens: 1, outputTokens: 1 },
      costUsd: 0,
    });
    await ctx.llm.complete({ tier: 'balanced', prompt: 'p' });
    const verdicts = await s3ServiceAdaptersPlugin.run({
      fixture: incidentTriageFixture,
      fixtureRun: emptyFixtureRun,
      ctx,
      recorder: ctx.recorder,
    });
    const a1 = verdicts.find((v) => v.id === 'S3-A1-llm-routed-via-ctx')!;
    assert.equal(a1.passed, true);
  });

  it('A2 fails when delegation expected but no exchange recorded', async () => {
    const ctx = createMockCortexCtx({ appId: 'stub' });
    const verdicts = await s3ServiceAdaptersPlugin.run({
      fixture: featureDevCommissionFixture,
      fixtureRun: { ...baseFixtureRun, fixtureId: 'feature-dev-commission' as const } as never,
      ctx,
      recorder: ctx.recorder,
    });
    const a2 = verdicts.find((v) => v.id === 'S3-A2-token-exchange-wired')!;
    assert.equal(a2.passed, false);
  });

  it('A2 fails when delegation NOT expected but exchange recorded', async () => {
    const ctx = createMockCortexCtx({ appId: 'stub' });
    await ctx.auth!.exchangeForAgent!('parent-token-0', ['a']);
    const verdicts = await s3ServiceAdaptersPlugin.run({
      fixture: incidentTriageFixture,
      fixtureRun: emptyFixtureRun,
      ctx,
      recorder: ctx.recorder,
    });
    const a2 = verdicts.find((v) => v.id === 'S3-A2-token-exchange-wired')!;
    assert.equal(a2.passed, false);
  });

  it('A3 fails when no method.agent.* audit events recorded', async () => {
    const ctx = createMockCortexCtx({ appId: 'stub' });
    await ctx.audit.event({ kind: 'some.other.event' });
    const verdicts = await s3ServiceAdaptersPlugin.run({
      fixture: dailyReportFixture,
      fixtureRun: { ...baseFixtureRun, fixtureId: 'daily-report' as const } as never,
      ctx,
      recorder: ctx.recorder,
    });
    const a3 = verdicts.find((v) => v.id === 'S3-A3-audit-adapter-live')!;
    assert.equal(a3.passed, false);
  });

  it('A3 passes with a single method.agent.* audit event', async () => {
    const ctx = createMockCortexCtx({ appId: 'stub' });
    await ctx.audit.event({ kind: 'method.agent.started' });
    const verdicts = await s3ServiceAdaptersPlugin.run({
      fixture: dailyReportFixture,
      fixtureRun: { ...baseFixtureRun, fixtureId: 'daily-report' as const } as never,
      ctx,
      recorder: ctx.recorder,
    });
    const a3 = verdicts.find((v) => v.id === 'S3-A3-audit-adapter-live')!;
    assert.equal(a3.passed, true);
  });
});
