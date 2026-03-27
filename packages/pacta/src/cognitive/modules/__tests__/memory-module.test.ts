import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createMemoryModule } from '../memory-module.js';
import type {
  WorkspaceWritePort,
  WorkspaceEntry,
  ModuleId,
  ReadonlyWorkspaceSnapshot,
} from '../../algebra/index.js';
import { moduleId } from '../../algebra/index.js';
import type { MemoryPort, MemoryEntry } from '../../../ports/memory-port.js';
import type { MemoryModuleControl } from '../memory-module.js';

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

function createMockMemoryPort(
  overrides?: Partial<MemoryPort>,
): MemoryPort {
  return {
    store: async () => {},
    retrieve: async () => 'retrieved value',
    search: async (_query: string, limit?: number): Promise<MemoryEntry[]> => {
      return [
        { key: 'fact-1', value: 'The sky is blue' },
        { key: 'fact-2', value: 'Water is wet' },
      ].slice(0, limit ?? 5);
    },
    ...overrides,
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

function makeControl(overrides?: Partial<MemoryModuleControl>): MemoryModuleControl {
  return {
    target: 'memory' as ModuleId,
    timestamp: Date.now(),
    retrievalStrategy: 'semantic',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe('Memory Module', () => {
  it('retrieves from MemoryPort and writes to workspace via write port', async () => {
    const writePort = createMockWritePort();
    const memoryPort = createMockMemoryPort();
    const memoryModule = createMemoryModule(memoryPort, writePort);
    const state = memoryModule.initialState();

    const snapshot = makeSnapshot(['What color is the sky?']);
    const result = await memoryModule.step(
      { snapshot },
      state,
      makeControl({ retrievalStrategy: 'semantic' }),
    );

    // Should have retrieved entries
    assert.ok(result.output.count > 0, 'Should retrieve at least one entry');
    assert.strictEqual(result.output.entries.length, result.output.count);

    // Should have written to workspace
    assert.ok(writePort.entries.length > 0, 'Should write entries to workspace');
    assert.strictEqual(writePort.entries[0].source, 'memory');

    // State should be updated
    assert.ok(result.state.retrievalCount > 0);
  });

  it('emits retrievalCount and relevanceScore signals', async () => {
    const writePort = createMockWritePort();
    const memoryPort = createMockMemoryPort();
    const memoryModule = createMemoryModule(memoryPort, writePort);
    const state = memoryModule.initialState();

    const snapshot = makeSnapshot(['Tell me about weather']);
    const result = await memoryModule.step(
      { snapshot },
      state,
      makeControl({ retrievalStrategy: 'semantic' }),
    );

    // Monitoring should report retrieval metrics
    assert.strictEqual(result.monitoring.type, 'memory');
    assert.strictEqual(typeof result.monitoring.retrievalCount, 'number');
    assert.ok(result.monitoring.retrievalCount > 0);
    assert.strictEqual(typeof result.monitoring.relevanceScore, 'number');
    assert.ok(result.monitoring.relevanceScore >= 0);
    assert.ok(result.monitoring.relevanceScore <= 1);
  });

  it('respects retrievalStrategy control directive', async () => {
    let searchCalled = false;
    let retrieveCalled = false;

    const writePort = createMockWritePort();
    const memoryPort = createMockMemoryPort({
      search: async (): Promise<MemoryEntry[]> => {
        searchCalled = true;
        return [{ key: 'search-result', value: 'found via search' }];
      },
      retrieve: async (): Promise<string | null> => {
        retrieveCalled = true;
        return 'found via retrieve';
      },
    });

    const memoryModule = createMemoryModule(memoryPort, writePort);
    const state = memoryModule.initialState();
    const snapshot = makeSnapshot(['test query']);

    // Semantic strategy should use search()
    await memoryModule.step(
      { snapshot },
      state,
      makeControl({ retrievalStrategy: 'semantic' }),
    );
    assert.strictEqual(searchCalled, true, 'Semantic strategy should call search()');

    // Reset
    searchCalled = false;
    retrieveCalled = false;

    // Procedural strategy should use retrieve()
    const writePort2 = createMockWritePort();
    const memoryPort2 = createMockMemoryPort({
      search: undefined,
      retrieve: async (): Promise<string | null> => {
        retrieveCalled = true;
        return 'procedural result';
      },
    });

    const memoryModule2 = createMemoryModule(memoryPort2, writePort2);
    await memoryModule2.step(
      { snapshot },
      memoryModule2.initialState(),
      makeControl({ retrievalStrategy: 'procedural' }),
    );
    assert.strictEqual(retrieveCalled, true, 'Procedural strategy should call retrieve()');
  });

  it('step() rejection on MemoryPort failure produces StepError', async () => {
    const writePort = createMockWritePort();
    const failingMemoryPort = createMockMemoryPort({
      search: async () => {
        throw new Error('Memory search failed');
      },
      retrieve: async () => {
        throw new Error('Memory retrieve failed');
      },
    });

    const memoryModule = createMemoryModule(failingMemoryPort, writePort);
    const state = memoryModule.initialState();
    const snapshot = makeSnapshot(['test query']);

    const result = await memoryModule.step(
      { snapshot },
      state,
      makeControl({ retrievalStrategy: 'semantic' }),
    );

    // Should have error, not throw
    assert.ok(result.error, 'Should have StepError');
    assert.strictEqual(result.error.recoverable, true);
    assert.strictEqual(result.error.moduleId, 'memory');
    assert.ok(result.error.message.includes('Memory search failed'));

    // State should remain unchanged
    assert.strictEqual(result.state.retrievalCount, 0);

    // Nothing written to workspace
    assert.strictEqual(writePort.entries.length, 0);
  });
});
