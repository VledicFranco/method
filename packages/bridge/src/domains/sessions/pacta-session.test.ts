import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPactFromSessionParams,
  buildRequestFromSessionParams,
  createPactaSession,
  invokePactaSession,
  type PactaSessionParams,
} from './pacta-session.js';
import { RecordingProvider } from '@method/pacta-testkit';
import type { AgentResult, TokenUsage, CostReport } from '@method/pacta';

// ── Helpers ─────────────────────────────────────────────────────

function defaultResult(): AgentResult {
  return {
    output: 'test output',
    sessionId: 'test-session-123',
    completed: true,
    stopReason: 'complete',
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 150,
    },
    cost: { totalUsd: 0.01, perModel: {} },
    durationMs: 1000,
    turns: 1,
  };
}

function minimalParams(): PactaSessionParams {
  return {
    nickname: 'test-session',
    workdir: '/tmp/test',
    prompt: 'Do a thing',
  };
}

// ── Tests ───────────────────────────────────────────────────────

describe('pacta-session: buildPactFromSessionParams', () => {
  it('builds a minimal pact with oneshot mode by default', () => {
    const pact = buildPactFromSessionParams(minimalParams());
    assert.deepStrictEqual(pact.mode, { type: 'oneshot' });
    assert.strictEqual(pact.budget, undefined);
    assert.strictEqual(pact.scope, undefined);
    assert.strictEqual(pact.reasoning, undefined);
  });

  it('maps budget parameters to BudgetContract', () => {
    const pact = buildPactFromSessionParams({
      ...minimalParams(),
      maxCostUsd: 0.50,
      maxDurationMs: 60_000,
      maxTurns: 10,
    });
    assert.deepStrictEqual(pact.budget, {
      maxCostUsd: 0.50,
      maxDurationMs: 60_000,
      maxTurns: 10,
    });
  });

  it('maps scope parameters to ScopeContract', () => {
    const pact = buildPactFromSessionParams({
      ...minimalParams(),
      allowedTools: ['Read', 'Write'],
      allowedPaths: ['packages/bridge/**'],
      model: 'claude-sonnet-4-20250514',
    });
    assert.deepStrictEqual(pact.scope, {
      allowedTools: ['Read', 'Write'],
      allowedPaths: ['packages/bridge/**'],
      model: 'claude-sonnet-4-20250514',
    });
  });

  it('maps reasoning effort to ReasoningPolicy', () => {
    const pact = buildPactFromSessionParams({
      ...minimalParams(),
      reasoningEffort: 'high',
    });
    assert.deepStrictEqual(pact.reasoning, { effort: 'high' });
  });

  it('respects resumable mode', () => {
    const pact = buildPactFromSessionParams({
      ...minimalParams(),
      mode: 'resumable',
    });
    assert.deepStrictEqual(pact.mode, { type: 'resumable' });
  });

  it('omits optional sections when not configured', () => {
    const pact = buildPactFromSessionParams(minimalParams());
    // No budget, scope, or reasoning when no params provided
    assert.strictEqual(pact.budget, undefined);
    assert.strictEqual(pact.scope, undefined);
    assert.strictEqual(pact.reasoning, undefined);
  });
});

describe('pacta-session: buildRequestFromSessionParams', () => {
  it('maps prompt and workdir', () => {
    const req = buildRequestFromSessionParams(minimalParams());
    assert.strictEqual(req.prompt, 'Do a thing');
    assert.strictEqual(req.workdir, '/tmp/test');
  });

  it('includes systemPrompt when provided', () => {
    const req = buildRequestFromSessionParams({
      ...minimalParams(),
      systemPrompt: 'You are a helpful agent.',
    });
    assert.strictEqual(req.systemPrompt, 'You are a helpful agent.');
  });

  it('includes nickname in metadata', () => {
    const req = buildRequestFromSessionParams(minimalParams());
    assert.deepStrictEqual(req.metadata, { nickname: 'test-session' });
  });

  it('includes resumeSessionId when provided', () => {
    const req = buildRequestFromSessionParams({
      ...minimalParams(),
      resumeSessionId: 'resume-abc',
    });
    assert.strictEqual(req.resumeSessionId, 'resume-abc');
  });
});

describe('pacta-session: createPactaSession', () => {
  let provider: RecordingProvider;

  beforeEach(() => {
    provider = new RecordingProvider();
    provider.setDefaultResult(defaultResult());
  });

  it('creates an Agent with the correct pact', () => {
    const agent = createPactaSession(minimalParams(), provider);
    assert.deepStrictEqual(agent.pact.mode, { type: 'oneshot' });
    assert.strictEqual(agent.provider.name, 'recording');
  });

  it('creates an Agent with budget constraints from params', () => {
    const agent = createPactaSession({
      ...minimalParams(),
      maxCostUsd: 1.0,
      maxTurns: 5,
    }, provider);
    assert.deepStrictEqual(agent.pact.budget, {
      maxCostUsd: 1.0,
      maxDurationMs: undefined,
      maxTurns: 5,
    });
  });

  it('creates an Agent with scope constraints from params', () => {
    const agent = createPactaSession({
      ...minimalParams(),
      allowedTools: ['Read'],
      model: 'claude-haiku-4-5-20241022',
    }, provider);
    assert.deepStrictEqual(agent.pact.scope, {
      allowedTools: ['Read'],
      allowedPaths: undefined,
      model: 'claude-haiku-4-5-20241022',
    });
  });
});

describe('pacta-session: invokePactaSession', () => {
  let provider: RecordingProvider;

  beforeEach(() => {
    provider = new RecordingProvider();
    provider.setDefaultResult(defaultResult());
  });

  it('invokes the agent and returns a result', async () => {
    const result = await invokePactaSession(minimalParams(), provider);
    assert.strictEqual(result.completed, true);
    assert.strictEqual(result.stopReason, 'complete');
    assert.strictEqual(result.output, 'test output');
  });

  it('passes the correct prompt to the provider', async () => {
    await invokePactaSession({
      ...minimalParams(),
      prompt: 'Implement feature X',
    }, provider);
    assert.strictEqual(provider.recordings.length, 1);
  });

  it('result includes usage and cost data', async () => {
    const result = await invokePactaSession(minimalParams(), provider);
    assert.strictEqual(result.usage.totalTokens, 150);
    assert.strictEqual(result.cost.totalUsd, 0.01);
    assert.strictEqual(result.durationMs, 1000);
    assert.strictEqual(result.turns, 1);
  });

  it('works with full bridge session parameters', async () => {
    const result = await invokePactaSession({
      nickname: 'full-test',
      workdir: '/tmp/project',
      prompt: 'Build the module',
      systemPrompt: 'You are a code agent.',
      maxCostUsd: 2.0,
      maxDurationMs: 120_000,
      maxTurns: 20,
      allowedTools: ['Read', 'Write', 'Bash'],
      allowedPaths: ['packages/**'],
      model: 'claude-sonnet-4-20250514',
      reasoningEffort: 'high',
      mode: 'oneshot',
    }, provider);
    assert.strictEqual(result.completed, true);
  });
});
