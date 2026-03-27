import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createReasoner } from '../reasoner.js';
import type {
  WorkspaceWritePort,
  WorkspaceEntry,
  ModuleId,
  ReadonlyWorkspaceSnapshot,
  ProviderAdapter,
  AdapterConfig,
  ProviderAdapterResult,
} from '../../algebra/index.js';
import { moduleId } from '../../algebra/index.js';
import type { ReasonerControl } from '../reasoner.js';

// ── Test Helpers ─────────────────────────────────────────────────

function createMockWritePort(): WorkspaceWritePort & { entries: WorkspaceEntry[] } {
  const entries: WorkspaceEntry[] = [];
  return {
    entries,
    write(entry: WorkspaceEntry): void {
      entries.push(entry);
    },
  };
}

function createMockAdapter(
  response?: string,
  shouldThrow?: boolean,
): ProviderAdapter {
  return {
    async invoke(
      _snapshot: ReadonlyWorkspaceSnapshot,
      _config: AdapterConfig,
    ): Promise<ProviderAdapterResult> {
      if (shouldThrow) {
        throw new Error('Provider invocation failed');
      }
      return {
        output: response ?? 'Step 1: Analyze the problem. Step 2: Form hypothesis. I am confident this is correct.',
        usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 150 },
        cost: { totalUsd: 0.001, perModel: {} },
      };
    },
  };
}

function makeSnapshot(contents: string[]): ReadonlyWorkspaceSnapshot {
  return contents.map((content, i) => ({
    source: moduleId('test'),
    content,
    salience: 0.5,
    timestamp: Date.now() - i * 100,
  }));
}

function makeControl(overrides?: Partial<ReasonerControl>): ReasonerControl {
  return {
    target: 'reasoner' as ModuleId,
    timestamp: Date.now(),
    strategy: 'cot',
    effort: 'medium',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe('Reasoner Module', () => {
  it('invokes ProviderAdapter with workspace contents and writes trace to workspace', async () => {
    const writePort = createMockWritePort();
    const adapter = createMockAdapter('The answer is 42. I am confident.');
    const reasoner = createReasoner(adapter, writePort);
    const state = reasoner.initialState();

    const snapshot = makeSnapshot(['What is the meaning of life?']);
    const result = await reasoner.step(
      { snapshot },
      state,
      makeControl(),
    );

    // Output should contain the reasoning trace
    assert.strictEqual(result.output.trace, 'The answer is 42. I am confident.');
    assert.strictEqual(typeof result.output.confidence, 'number');

    // Should have written trace to workspace
    assert.strictEqual(writePort.entries.length, 1);
    assert.strictEqual(writePort.entries[0].source, 'reasoner');
    assert.strictEqual(writePort.entries[0].content, 'The answer is 42. I am confident.');

    // State should be updated
    assert.strictEqual(result.state.invocationCount, 1);
    assert.strictEqual(result.state.chainOfThought.length, 1);
  });

  it('emits confidence and conflictDetected signals', async () => {
    const writePort = createMockWritePort();
    // Response with conflict indicators
    const adapter = createMockAdapter(
      'The evidence suggests X. However, on the other hand, Y contradicts this. But we can still conclude Z.',
    );
    const reasoner = createReasoner(adapter, writePort);
    const state = reasoner.initialState();

    const snapshot = makeSnapshot(['Analyze the conflicting data']);
    const result = await reasoner.step(
      { snapshot },
      state,
      makeControl(),
    );

    // Monitoring should have reasoner type
    assert.strictEqual(result.monitoring.type, 'reasoner');
    assert.strictEqual(typeof result.monitoring.confidence, 'number');
    assert.ok(result.monitoring.confidence >= 0);
    assert.ok(result.monitoring.confidence <= 1);

    // Conflict should be detected (multiple conflict keywords present)
    assert.strictEqual(result.monitoring.conflictDetected, true);
    assert.strictEqual(result.output.conflictDetected, true);
  });

  it('respects strategy and effort control directives', async () => {
    let capturedConfig: AdapterConfig | null = null;

    const writePort = createMockWritePort();
    const adapter: ProviderAdapter = {
      async invoke(
        _snapshot: ReadonlyWorkspaceSnapshot,
        config: AdapterConfig,
      ): Promise<ProviderAdapterResult> {
        capturedConfig = config;
        return {
          output: 'Plan: 1. Do X, 2. Do Y',
          usage: { inputTokens: 50, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 80 },
          cost: { totalUsd: 0.0005, perModel: {} },
        };
      },
    };

    const reasoner = createReasoner(adapter, writePort);
    const state = reasoner.initialState();
    const snapshot = makeSnapshot(['Create a plan']);

    // Use 'plan' strategy with 'high' effort
    await reasoner.step(
      { snapshot },
      state,
      makeControl({ strategy: 'plan', effort: 'high' }),
    );

    assert.notStrictEqual(capturedConfig, null, 'Adapter should have been invoked');
    const captured = capturedConfig as unknown as AdapterConfig;
    assert.ok(captured.systemPrompt, 'System prompt should be set');
    assert.ok(
      captured.systemPrompt!.includes('plan'),
      'System prompt should mention plan strategy',
    );
    assert.ok(
      captured.systemPrompt!.includes('Thoroughly'),
      'System prompt should include high effort prefix',
    );

    // Monitoring should reflect the effort level
    // (We need a second call to check monitoring)
    const result = await reasoner.step(
      { snapshot },
      state,
      makeControl({ strategy: 'cot', effort: 'low' }),
    );
    assert.strictEqual(result.monitoring.effortLevel, 'low');
  });

  it('provider adapter error maps to StepError', async () => {
    const writePort = createMockWritePort();
    const adapter = createMockAdapter(undefined, true);
    const reasoner = createReasoner(adapter, writePort);
    const state = reasoner.initialState();

    const snapshot = makeSnapshot(['test reasoning']);
    const result = await reasoner.step(
      { snapshot },
      state,
      makeControl(),
    );

    // Should have error, not throw
    assert.ok(result.error, 'Should have StepError');
    assert.strictEqual(result.error.recoverable, true);
    assert.strictEqual(result.error.moduleId, 'reasoner');
    assert.ok(result.error.message.includes('Provider invocation failed'));

    // State should remain unchanged
    assert.strictEqual(result.state.invocationCount, 0);

    // Nothing written to workspace
    assert.strictEqual(writePort.entries.length, 0);
  });
});
