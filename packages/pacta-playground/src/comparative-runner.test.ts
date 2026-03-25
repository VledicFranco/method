import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentResult, AgentEvent } from '@method/pacta';
import { RecordingProvider, pactBuilder } from '@method/pacta-testkit';
import { scenario, filesystem, prompt, toolsCalled } from './scenario.js';
import type { ScenarioAgentConfig } from './scenario.js';
import { compareAgents } from './comparative-runner.js';

// ── Helpers ──────────────────────────────────────────────────────

function makeResult(overrides?: Partial<AgentResult>): AgentResult {
  return {
    output: 'test output',
    sessionId: 'test-session',
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
    durationMs: 500,
    turns: 1,
    ...overrides,
  };
}

function makeAgentConfig(
  name: string,
  result: AgentResult,
  events?: AgentEvent[],
): ScenarioAgentConfig {
  const provider = new RecordingProvider();
  provider.addResponse({ result, events });
  return {
    name,
    pact: pactBuilder().build(),
    provider,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe('Comparative Runner', () => {
  it('compares two agents and produces a comparative report', async () => {
    const s = scenario('compare-test')
      .given(filesystem({ '/a.ts': 'code' }))
      .when(prompt('Review'))
      .then(toolsCalled([]));

    const agentA = makeAgentConfig('agent-a', makeResult({
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 150,
      },
      cost: { totalUsd: 0.01, perModel: {} },
      turns: 1,
      durationMs: 500,
    }));

    const agentB = makeAgentConfig('agent-b', makeResult({
      usage: {
        inputTokens: 200,
        outputTokens: 100,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 300,
      },
      cost: { totalUsd: 0.03, perModel: {} },
      turns: 2,
      durationMs: 1000,
    }));

    const report = await compareAgents(s, agentA, agentB);

    assert.equal(report.scenario, 'compare-test');
    assert.deepEqual(report.agents, ['agent-a', 'agent-b']);
    assert.equal(report.reports.length, 2);
    assert.equal(report.reports[0].agent, 'agent-a');
    assert.equal(report.reports[1].agent, 'agent-b');

    // Diff checks
    assert.equal(report.diff.tokenDelta, 150); // 300 - 150
    assert.ok(Math.abs(report.diff.costDelta - 0.02) < 1e-10); // 0.03 - 0.01
    assert.equal(report.diff.turnsDelta, 1); // 2 - 1
    assert.equal(report.diff.durationDelta, 500); // 1000 - 500
    assert.equal(report.diff.bothCorrect, true);
    assert.equal(report.diff.bothSchemaValid, true);
  });

  it('reports bothCorrect=false when one agent has wrong tools', async () => {
    const events: AgentEvent[] = [
      { type: 'tool_use', tool: 'Write', input: {}, toolUseId: 'tu1' },
      { type: 'tool_result', tool: 'Write', output: 'ok', toolUseId: 'tu1', durationMs: 10 },
    ];

    const s = scenario('mismatch')
      .given(filesystem({}))
      .when(prompt('Review'))
      .then(toolsCalled(['Read']));

    const correct = makeAgentConfig('correct', makeResult(), [
      { type: 'tool_use', tool: 'Read', input: {}, toolUseId: 'tu1' },
      { type: 'tool_result', tool: 'Read', output: 'ok', toolUseId: 'tu1', durationMs: 10 },
    ]);
    const wrong = makeAgentConfig('wrong', makeResult(), events);

    const report = await compareAgents(s, correct, wrong);
    assert.equal(report.diff.bothCorrect, false);
  });
});
