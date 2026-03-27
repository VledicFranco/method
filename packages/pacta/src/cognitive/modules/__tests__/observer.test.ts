import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createObserver } from '../observer.js';
import type { WorkspaceWritePort, WorkspaceEntry, ModuleId } from '../../algebra/index.js';
import type { ObserverControl } from '../observer.js';

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

function makeControl(overrides?: Partial<ObserverControl>): ObserverControl {
  return {
    target: 'observer' as ModuleId,
    timestamp: Date.now(),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe('Observer Module', () => {
  it('processes input and writes observation to workspace via write port', async () => {
    const writePort = createMockWritePort();
    const observer = createObserver(writePort);
    const state = observer.initialState();

    const result = await observer.step(
      { content: 'Hello, world!', source: 'user' },
      state,
      makeControl(),
    );

    // Output should contain the observation
    assert.strictEqual(result.output.observation, 'Hello, world!');
    assert.strictEqual(result.output.filtered, false);

    // Workspace should have the entry
    assert.strictEqual(writePort.entries.length, 1);
    assert.strictEqual(writePort.entries[0].content, 'Hello, world!');
    assert.strictEqual(writePort.entries[0].source, 'observer');

    // State should be updated
    assert.strictEqual(result.state.observationCount, 1);
    assert.notStrictEqual(result.state.previousContent, null);
  });

  it('emits noveltyScore monitoring signal', async () => {
    const writePort = createMockWritePort();
    const observer = createObserver(writePort);
    const state = observer.initialState();

    const result = await observer.step(
      { content: 'A novel observation with significant content length for scoring' },
      state,
      makeControl(),
    );

    // Monitoring should have observer type with noveltyScore
    assert.strictEqual(result.monitoring.type, 'observer');
    assert.strictEqual(result.monitoring.inputProcessed, true);
    assert.strictEqual(typeof result.monitoring.noveltyScore, 'number');
    assert.ok(result.monitoring.noveltyScore > 0, 'noveltyScore should be positive');
    assert.ok(result.monitoring.noveltyScore <= 1, 'noveltyScore should be <= 1');

    // Output noveltyScore should match monitoring
    assert.strictEqual(result.output.noveltyScore, result.monitoring.noveltyScore);
  });

  it('respects focusFilter control directive and filters non-matching input', async () => {
    const writePort = createMockWritePort();
    const observer = createObserver(writePort);
    const state = observer.initialState();

    // Input that does NOT match the focus filter
    const result = await observer.step(
      { content: 'This is about cooking recipes' },
      state,
      makeControl({ focusFilter: ['programming', 'typescript'] }),
    );

    // Should be filtered out
    assert.strictEqual(result.output.filtered, true);
    assert.strictEqual(result.output.observation, '');
    assert.strictEqual(result.output.noveltyScore, 0);
    assert.strictEqual(result.monitoring.inputProcessed, false);

    // Nothing written to workspace
    assert.strictEqual(writePort.entries.length, 0);

    // Input that DOES match the focus filter
    const result2 = await observer.step(
      { content: 'This is about TypeScript programming' },
      state,
      makeControl({ focusFilter: ['programming', 'typescript'] }),
    );

    assert.strictEqual(result2.output.filtered, false);
    assert.ok(result2.output.observation.length > 0);
    assert.strictEqual(result2.monitoring.inputProcessed, true);
    assert.strictEqual(writePort.entries.length, 1);
  });

  it('step() rejection produces StepError with recoverable flag', async () => {
    // Create a write port that throws
    const throwingWritePort: WorkspaceWritePort = {
      write(): void {
        throw new Error('Workspace write failure');
      },
    };

    const observer = createObserver(throwingWritePort);
    const state = observer.initialState();

    const result = await observer.step(
      { content: 'test input' },
      state,
      makeControl(),
    );

    // Should have error, not throw
    assert.ok(result.error, 'Should have StepError');
    assert.strictEqual(result.error.recoverable, true);
    assert.strictEqual(result.error.moduleId, 'observer');
    assert.ok(result.error.message.includes('Workspace write failure'));

    // State should remain unchanged
    assert.strictEqual(result.state.observationCount, 0);
  });
});
