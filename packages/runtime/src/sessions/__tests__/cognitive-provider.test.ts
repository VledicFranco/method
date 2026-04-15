/**
 * Tests for cognitive-provider v2 (PRD 040 C-2).
 *
 * Mocks the ProviderAdapter and ToolProvider to test:
 * 1. Multi-tool cycles
 * 2. Workspace persistence across prompts
 * 3. Cost/token accumulation
 * 4. Cycle limit enforcement
 * 5. Edit tool execution in a cycle
 * 6. Impasse detection (consecutive identical actions)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ProviderAdapter, ToolProvider, ToolResult } from '@method/pacta';
import { createCognitiveSession } from '../cognitive-provider.js';
import type { StreamEvent } from '../pool.js';

// ── Test Helpers ───────────────────────────────────────────────

/** Build an LLM response in the expected XML format. */
function buildResponse(plan: string, reasoning: string, action: { tool: string; input?: Record<string, unknown> }): string {
  return `<plan>${plan}</plan>\n<reasoning>${reasoning}</reasoning>\n<action>${JSON.stringify(action)}</action>`;
}

/** Create a mock adapter that returns responses from a queue. */
function createMockAdapter(responses: string[]): ProviderAdapter {
  let callIndex = 0;
  return {
    async invoke() {
      const idx = callIndex++;
      const output = idx < responses.length ? responses[idx] : responses[responses.length - 1];
      return {
        output,
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cacheReadTokens: 0, cacheWriteTokens: 0 },
        cost: { totalUsd: 0.001, perModel: {} },
      };
    },
  };
}

/** Create a mock tool provider. */
function createMockTools(resultMap?: Record<string, ToolResult>): ToolProvider {
  const executedTools: Array<{ name: string; input: unknown }> = [];
  return {
    list: () => [
      { name: 'Read', description: 'Read a file by path. Input: { path: string }' },
      { name: 'Write', description: 'Write content to a file. Input: { path: string, content: string }' },
      { name: 'Edit', description: 'Replace a specific string in a file. Input: { path: string, old_string: string, new_string: string }' },
      { name: 'Glob', description: 'Find files matching a glob pattern. Input: { pattern: string }' },
      { name: 'Grep', description: 'Search file contents with a regex. Input: { pattern: string, path?: string }' },
      { name: 'Bash', description: 'Execute a shell command. Input: { command: string }' },
    ],
    async execute(name: string, input: unknown): Promise<ToolResult> {
      executedTools.push({ name, input });
      if (resultMap && name in resultMap) {
        return resultMap[name];
      }
      return { output: `Mock result for ${name}` };
    },
    // Expose for assertions
    get _executed() { return executedTools; },
  } as ToolProvider & { _executed: Array<{ name: string; input: unknown }> };
}

/** Collect events from onEvent callback. */
function createEventCollector(): { events: StreamEvent[]; onEvent: (e: StreamEvent) => void } {
  const events: StreamEvent[] = [];
  return {
    events,
    onEvent: (e: StreamEvent) => events.push(e),
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe('cognitive-provider v2 (PRD 040 C-2)', () => {

  it('multi-tool cycle: Read then done in one cycle', async () => {
    // Mock: first LLM call returns Read, second returns done — both within one cycle
    const responses = [
      buildResponse('Read the file', 'Need to check contents', { tool: 'Read', input: { path: 'test.txt' } }),
      buildResponse('File read, task complete', 'Content looks good', { tool: 'done', input: { result: 'File contents verified' } }),
    ];
    const adapter = createMockAdapter(responses);
    const mockTools = createMockTools();
    const { events, onEvent } = createEventCollector();

    const session = createCognitiveSession({
      id: 'test-multi-tool',
      workdir: '/tmp/test',
      onEvent,
      adapter,
      tools: mockTools,
      config: { maxCycles: 5, maxToolsPerCycle: 5 },
    });

    const result = await session.sendPrompt('Read test.txt and confirm it looks good');
    assert.equal(result.timedOut, false);
    assert.ok(result.output.includes('File contents verified'));

    // Should have exactly 1 cycle-start (both tools in same cycle)
    const cycleStarts = events.filter(e => e.type === 'cycle-start');
    assert.equal(cycleStarts.length, 1, 'Should have exactly 1 cycle-start for multi-tool cycle');

    // Should have 2 cycle-actions: Read + done
    const cycleActions = events.filter(e => e.type === 'cycle-action');
    assert.equal(cycleActions.length, 2);
    assert.equal(cycleActions[0].action, 'Read');
    assert.equal(cycleActions[1].action, 'done');

    // Verify Read was actually executed
    const executed = (mockTools as unknown as { _executed: Array<{ name: string }> })._executed;
    assert.equal(executed.length, 1);
    assert.equal(executed[0].name, 'Read');

    // done event should be present
    const doneEvent = events.find(e => e.type === 'done');
    assert.ok(doneEvent, 'Should have a done event');
  });

  it('workspace persistence: second prompt has workspace entries from first', async () => {
    let callCount = 0;
    const adapter: ProviderAdapter = {
      async invoke(snapshot) {
        callCount++;
        // On the second prompt's first LLM call, check if workspace has entries from prompt 1
        if (callCount >= 3) {
          // snapshot includes workspace entries — look for content from prior prompt
          const snapshotText = snapshot.map(e =>
            typeof e.content === 'string' ? e.content : JSON.stringify(e.content),
          ).join(' ');
          // The workspace should contain entries from the previous cycle's tool results
          if (snapshotText.includes('Mock result for Read')) {
            return {
              output: buildResponse('Done', 'Found prior workspace data', { tool: 'done', input: { result: 'workspace-persisted' } }),
              usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cacheReadTokens: 0, cacheWriteTokens: 0 },
              cost: { totalUsd: 0.001, perModel: {} },
            };
          }
        }
        if (callCount <= 2) {
          // First prompt: Read then done
          if (callCount === 1) {
            return {
              output: buildResponse('Read file', 'Reading', { tool: 'Read', input: { path: 'a.txt' } }),
              usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cacheReadTokens: 0, cacheWriteTokens: 0 },
              cost: { totalUsd: 0.001, perModel: {} },
            };
          }
          return {
            output: buildResponse('Done', 'Finished', { tool: 'done', input: { result: 'prompt-1-done' } }),
            usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cacheReadTokens: 0, cacheWriteTokens: 0 },
            cost: { totalUsd: 0.001, perModel: {} },
          };
        }
        // Fallback
        return {
          output: buildResponse('Done', 'Fallback', { tool: 'done', input: { result: 'fallback' } }),
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cacheReadTokens: 0, cacheWriteTokens: 0 },
          cost: { totalUsd: 0.001, perModel: {} },
        };
      },
    };
    const mockTools = createMockTools();
    const { events, onEvent } = createEventCollector();

    const session = createCognitiveSession({
      id: 'test-persistence',
      workdir: '/tmp/test',
      onEvent,
      adapter,
      tools: mockTools,
      config: { maxCycles: 5, maxToolsPerCycle: 5, workspaceCapacity: 20 },
    });

    // First prompt
    const r1 = await session.sendPrompt('First task');
    assert.equal(r1.output, 'prompt-1-done');

    // Second prompt — workspace should contain entries from first prompt
    const r2 = await session.sendPrompt('Second task');
    assert.equal(r2.output, 'workspace-persisted', 'Second prompt should see workspace entries from first');
  });

  it('cost accumulation: done event metadata has accumulated tokens', async () => {
    // 3 LLM calls: Read, Grep, done
    const responses = [
      buildResponse('Read', 'Checking', { tool: 'Read', input: { path: 'a.txt' } }),
      buildResponse('Search', 'Searching', { tool: 'Grep', input: { pattern: 'foo' } }),
      buildResponse('Complete', 'All done', { tool: 'done', input: { result: 'task-complete' } }),
    ];
    const adapter = createMockAdapter(responses);
    const mockTools = createMockTools();
    const { events, onEvent } = createEventCollector();

    const session = createCognitiveSession({
      id: 'test-cost',
      workdir: '/tmp/test',
      onEvent,
      adapter,
      tools: mockTools,
      config: { maxCycles: 5, maxToolsPerCycle: 5 },
    });

    await session.sendPrompt('Find foo');

    const doneEvent = events.find(e => e.type === 'done');
    assert.ok(doneEvent, 'Should have a done event');
    assert.ok(doneEvent.metadata, 'done event should have metadata');

    // 3 LLM calls x 100 input tokens each = 300
    assert.equal(doneEvent.metadata!.inputTokens, 300, 'Should accumulate input tokens');
    // 3 LLM calls x 50 output tokens each = 150
    assert.equal(doneEvent.metadata!.outputTokens, 150, 'Should accumulate output tokens');
    // totalTokens = inputTokens + outputTokens = 450
    assert.equal(doneEvent.metadata!.totalTokens, 450, 'Should accumulate total tokens');
    // costUsd should be > 0
    assert.ok((doneEvent.metadata!.costUsd as number) > 0, 'Should have positive cost');
    // Verify cost estimation: 300 * 3/1M + 150 * 15/1M = 0.0009 + 0.00225 = 0.00315
    const expectedCost = 300 * (3 / 1_000_000) + 150 * (15 / 1_000_000);
    assert.ok(
      Math.abs((doneEvent.metadata!.costUsd as number) - expectedCost) < 0.0001,
      `Cost should be approximately ${expectedCost}, got ${doneEvent.metadata!.costUsd}`,
    );
    assert.equal(doneEvent.metadata!.workdir, '/tmp/test', 'Should include workdir in metadata');
  });

  it('cycle limit: stops execution when maxCycles is exceeded', async () => {
    // Adapter never says done — always returns Read
    const neverDone = buildResponse('Keep reading', 'Still working', { tool: 'Read', input: { path: 'file.txt' } });
    const adapter = createMockAdapter([neverDone]);
    const mockTools = createMockTools();
    const { events, onEvent } = createEventCollector();

    const session = createCognitiveSession({
      id: 'test-limit',
      workdir: '/tmp/test',
      onEvent,
      adapter,
      tools: mockTools,
      config: { maxCycles: 3, maxToolsPerCycle: 2 },
    });

    const result = await session.sendPrompt('Infinite task');

    assert.ok(result.output.includes('Cycle limit reached'), 'Should indicate cycle limit was reached');

    // Should have exactly 3 cycle-starts
    const cycleStarts = events.filter(e => e.type === 'cycle-start');
    assert.equal(cycleStarts.length, 3, 'Should have exactly 3 cycle-starts');

    // done event should still be emitted
    const doneEvent = events.find(e => e.type === 'done');
    assert.ok(doneEvent, 'Should have a done event even when limit reached');
    assert.equal(doneEvent.metadata!.totalCycles, 3, 'Should report 3 total cycles');
  });

  it('Edit tool in cycle: executes Edit and returns result', async () => {
    const responses = [
      buildResponse(
        'Edit the file',
        'Replacing old text with new text',
        { tool: 'Edit', input: { path: 'config.ts', old_string: 'foo', new_string: 'bar' } },
      ),
      buildResponse('Done', 'Edit applied', { tool: 'done', input: { result: 'Edit completed successfully' } }),
    ];
    const adapter = createMockAdapter(responses);
    const editResult: ToolResult = { output: 'Edit applied successfully' };
    const mockTools = createMockTools({ Edit: editResult });
    const { events, onEvent } = createEventCollector();

    const session = createCognitiveSession({
      id: 'test-edit',
      workdir: '/tmp/test',
      onEvent,
      adapter,
      tools: mockTools,
      config: { maxCycles: 5, maxToolsPerCycle: 5 },
    });

    const result = await session.sendPrompt('Replace foo with bar in config.ts');
    assert.ok(result.output.includes('Edit completed successfully'));

    // Verify Edit was executed with correct input
    const executed = (mockTools as unknown as { _executed: Array<{ name: string; input: unknown }> })._executed;
    const editCall = executed.find(e => e.name === 'Edit');
    assert.ok(editCall, 'Edit tool should have been executed');
    assert.deepEqual(editCall.input, { path: 'config.ts', old_string: 'foo', new_string: 'bar' });

    // Should have cycle-action for Edit
    const editAction = events.find(e => e.type === 'cycle-action' && e.action === 'Edit');
    assert.ok(editAction, 'Should have a cycle-action event for Edit');
    assert.equal(editAction.confidence, 0.7, 'Successful tool should have 0.7 confidence');
  });

  it('impasse detection: emits monitor event on consecutive identical actions', async () => {
    // Same Read action twice in a row, then done
    const sameRead = buildResponse('Read file', 'Reading same file', { tool: 'Read', input: { path: 'same.txt' } });
    const responses = [
      sameRead,
      sameRead,
      buildResponse('Done', 'Giving up', { tool: 'done', input: { result: 'impasse-resolved' } }),
    ];
    const adapter = createMockAdapter(responses);
    const mockTools = createMockTools();
    const { events, onEvent } = createEventCollector();

    const session = createCognitiveSession({
      id: 'test-impasse',
      workdir: '/tmp/test',
      onEvent,
      adapter,
      tools: mockTools,
      config: { maxCycles: 5, maxToolsPerCycle: 5 },
    });

    await session.sendPrompt('Do something');

    // Should have at least one impasse monitor event
    const impasseEvents = events.filter(
      e => e.type === 'monitor' && e.intervention === 'impasse-detected',
    );
    assert.ok(impasseEvents.length >= 1, `Should detect impasse, got ${impasseEvents.length} impasse events`);
  });

  it('streaming: text events include cycle number and are emitted immediately', async () => {
    const responses = [
      buildResponse('Plan step', 'Deep analysis of the problem at hand', { tool: 'Read', input: { path: 'x.txt' } }),
      buildResponse('Done', 'Completed', { tool: 'done', input: { result: 'ok' } }),
    ];
    const adapter = createMockAdapter(responses);
    const mockTools = createMockTools();
    const { events, onEvent } = createEventCollector();
    const chunks: string[] = [];

    const session = createCognitiveSession({
      id: 'test-stream',
      workdir: '/tmp/test',
      onEvent,
      adapter,
      tools: mockTools,
      config: { maxCycles: 5, maxToolsPerCycle: 5 },
    });

    await session.sendPromptStream!('Stream test', (chunk) => chunks.push(chunk));

    // Text events should include cycle number
    const textEvents = events.filter(e => e.type === 'text');
    assert.ok(textEvents.length >= 1, 'Should have at least one text event');
    assert.ok(
      textEvents[0].content!.includes('[Cycle 1/'),
      'Text events should include cycle number',
    );

    // Chunks should have been streamed
    assert.ok(chunks.length >= 1, 'Should have at least one streamed chunk');
    assert.ok(chunks[0].includes('[Cycle 1/'), 'Streamed chunks should include cycle number');
  });

  it('session-level cost accumulation across multiple prompts', async () => {
    const responses = [
      buildResponse('Done', 'Quick', { tool: 'done', input: { result: 'first' } }),
    ];
    const adapter = createMockAdapter(responses);
    const mockTools = createMockTools();
    const { events, onEvent } = createEventCollector();

    const session = createCognitiveSession({
      id: 'test-session-cost',
      workdir: '/tmp/test',
      onEvent,
      adapter,
      tools: mockTools,
      config: { maxCycles: 5, maxToolsPerCycle: 5 },
    });

    // First prompt: 1 LLM call
    await session.sendPrompt('First');
    // Second prompt: 1 LLM call
    await session.sendPrompt('Second');

    const doneEvents = events.filter(e => e.type === 'done');
    assert.equal(doneEvents.length, 2, 'Should have 2 done events');

    // Second done event should have session-level accumulated tokens
    const secondDone = doneEvents[1];
    assert.ok(secondDone.metadata, 'Second done should have metadata');
    // Each prompt: 100 input + 50 output. Session total after 2 prompts: 200 + 100
    assert.equal(secondDone.metadata!.sessionInputTokens, 200, 'Session input tokens should accumulate');
    assert.equal(secondDone.metadata!.sessionOutputTokens, 100, 'Session output tokens should accumulate');
    assert.ok((secondDone.metadata!.sessionCostUsd as number) > 0, 'Session cost should be positive');
  });
});
