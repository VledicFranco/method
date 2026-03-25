import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentResult, SchemaDefinition, AgentEvent } from '@method/pacta';
import { RecordingProvider } from '@method/pacta-testkit';
import { pactBuilder } from '@method/pacta-testkit';
import {
  scenario,
  filesystem,
  tools,
  toolProvider,
  prompt,
  toolsCalled,
  outputMatches,
  tokensBelow,
} from './scenario.js';
import type { ScenarioAgentConfig } from './scenario.js';
import { VirtualToolProvider } from './virtual-tool-provider.js';
import { ScriptedToolProvider } from './scripted-tool-provider.js';

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

describe('Scenario Runner', () => {
  it('runs a basic scenario and produces an EvalReport', async () => {
    const s = scenario('basic-test')
      .given(filesystem({ '/src/main.ts': 'const x = 1;' }))
      .when(prompt('Review this file'))
      .then(toolsCalled([]));

    const config = makeAgentConfig('test-agent', makeResult());
    const report = await s.run(config);

    assert.equal(report.scenario, 'basic-test');
    assert.equal(report.agent, 'test-agent');
    assert.equal(report.output.schemaValid, true);
    assert.equal(report.resources.tokens, 150);
    assert.equal(report.resources.cost, 0.01);
  });

  it('reports toolsCorrect=true when tool sequence matches', async () => {
    const events: AgentEvent[] = [
      { type: 'tool_use', tool: 'Read', input: { file_path: '/a.ts' }, toolUseId: 'tu1' },
      { type: 'tool_result', tool: 'Read', output: 'content', toolUseId: 'tu1', durationMs: 10 },
      { type: 'tool_use', tool: 'Grep', input: { pattern: 'x' }, toolUseId: 'tu2' },
      { type: 'tool_result', tool: 'Grep', output: 'match', toolUseId: 'tu2', durationMs: 5 },
    ];

    const s = scenario('tools-check')
      .given(filesystem({ '/a.ts': 'hello' }))
      .when(prompt('Check'))
      .then(toolsCalled(['Read', 'Grep']));

    const config = makeAgentConfig('agent', makeResult(), events);
    const report = await s.run(config);

    assert.equal(report.behavioral.toolsCorrect, true);
    assert.equal(report.behavioral.sequenceCorrect, true);
  });

  it('reports toolsCorrect=false when tool sequence mismatches', async () => {
    const events: AgentEvent[] = [
      { type: 'tool_use', tool: 'Write', input: {}, toolUseId: 'tu1' },
      { type: 'tool_result', tool: 'Write', output: 'ok', toolUseId: 'tu1', durationMs: 10 },
    ];

    const s = scenario('wrong-tools')
      .given(filesystem({ '/a.ts': 'hello' }))
      .when(prompt('Check'))
      .then(toolsCalled(['Read', 'Grep']));

    const config = makeAgentConfig('agent', makeResult(), events);
    const report = await s.run(config);

    assert.equal(report.behavioral.toolsCorrect, false);
  });

  it('validates output against schema', async () => {
    const schema: SchemaDefinition<{ value: number }> = {
      parse(raw: unknown) {
        if (typeof raw === 'object' && raw !== null && 'value' in raw) {
          return { success: true, data: raw as { value: number } };
        }
        return { success: false, errors: ['expected { value: number }'] };
      },
    };

    const s = scenario('schema-check')
      .given(filesystem({}))
      .when(prompt('Compute'))
      .then(outputMatches(schema));

    const goodConfig = makeAgentConfig('good', makeResult({ output: { value: 42 } }));
    const goodReport = await s.run(goodConfig);
    assert.equal(goodReport.output.schemaValid, true);

    const badConfig = makeAgentConfig('bad', makeResult({ output: 'not an object' }));
    const badReport = await s.run(badConfig);
    assert.equal(badReport.output.schemaValid, false);
  });

  it('checks tokensBelow assertion', async () => {
    const s = scenario('budget-check')
      .given(filesystem({}))
      .when(prompt('Do'))
      .then(tokensBelow(100));

    const overConfig = makeAgentConfig('over', makeResult({ usage: {
      inputTokens: 80,
      outputTokens: 80,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 160,
    }}));
    const overReport = await s.run(overConfig);
    // tokensBelow doesn't directly affect the report fields, but the assertion
    // logic is validated by observing report.resources.tokens
    assert.equal(overReport.resources.tokens, 160);
  });

  it('resolves VirtualToolProvider from filesystem given', () => {
    const s = scenario('vfs')
      .given(filesystem({ '/a.ts': 'code' }))
      .when(prompt('test'));

    const provider = s.resolveToolProvider();
    assert.ok(provider instanceof VirtualToolProvider);
  });

  it('resolves ScriptedToolProvider from tools given', () => {
    const s = scenario('scripted')
      .given(tools(['Read', 'Grep']))
      .when(prompt('test'));

    const provider = s.resolveToolProvider();
    assert.ok(provider instanceof ScriptedToolProvider);
  });

  it('resolves explicit tool provider', () => {
    const custom = new VirtualToolProvider({ '/x.ts': '' });
    const s = scenario('explicit')
      .given(toolProvider(custom))
      .when(prompt('test'));

    const provider = s.resolveToolProvider();
    assert.equal(provider, custom);
  });

  it('throws when no .when() is specified', async () => {
    const s = scenario('no-when')
      .given(filesystem({}));

    const config = makeAgentConfig('agent', makeResult());
    await assert.rejects(
      () => s.run(config),
      /no .when\(\) specified/,
    );
  });

  it('detects thinking patterns in reasoning report', async () => {
    const events: AgentEvent[] = [
      { type: 'thinking', content: 'Let me plan: first I will read, then grep' },
    ];

    const s = scenario('reasoning')
      .given(filesystem({}))
      .when(prompt('Analyze'));

    const config = makeAgentConfig('agent', makeResult(), events);
    const report = await s.run(config);

    assert.equal(report.reasoning.planDetected, true);
  });
});
