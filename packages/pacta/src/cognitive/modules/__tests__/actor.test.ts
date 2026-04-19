// SPDX-License-Identifier: Apache-2.0
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createActor } from '../actor.js';
import type {
  WorkspaceWritePort,
  WorkspaceEntry,
  ModuleId,
  ReadonlyWorkspaceSnapshot,
} from '../../algebra/index.js';
import { moduleId } from '../../algebra/index.js';
import type { ToolProvider, ToolDefinition, ToolResult } from '../../../ports/tool-provider.js';
import type { ActorControl } from '../actor.js';

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

function createMockToolProvider(
  overrides?: Partial<ToolProvider>,
): ToolProvider {
  return {
    list(): ToolDefinition[] {
      return [
        { name: 'read_file', description: 'Read a file from disk' },
        { name: 'write_file', description: 'Write content to a file' },
        { name: 'search_code', description: 'Search the codebase for patterns' },
      ];
    },
    async execute(name: string, _input: unknown): Promise<ToolResult> {
      return { output: `Executed ${name} successfully` };
    },
    ...overrides,
  };
}

function makeSnapshot(contents: string[]): ReadonlyWorkspaceSnapshot {
  return contents.map((content, i) => ({
    source: moduleId('test'),
    content,
    salience: 0.5 + (i === 0 ? 0.2 : 0),
    timestamp: Date.now() - i * 100,
  }));
}

function makeControl(overrides?: Partial<ActorControl>): ActorControl {
  return {
    target: 'actor' as ModuleId,
    timestamp: Date.now(),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe('Actor Module', () => {
  it('selects and executes action via ToolProvider', async () => {
    let executedTool: string | null = null;

    const writePort = createMockWritePort();
    const toolProvider = createMockToolProvider({
      async execute(name: string, _input: unknown): Promise<ToolResult> {
        executedTool = name;
        return { output: `Result from ${name}` };
      },
    });

    const actor = createActor(toolProvider, writePort);
    const state = actor.initialState();

    const snapshot = makeSnapshot(['Read the configuration file']);
    const result = await actor.step({ snapshot }, state, makeControl());

    // Should have executed a tool
    assert.ok(executedTool, 'A tool should have been executed');
    assert.ok(result.output.actionName.length > 0, 'Action name should be non-empty');
    assert.ok(result.output.result, 'Tool result should be present');
    assert.strictEqual(result.output.escalated, false);

    // Should have written to workspace
    assert.strictEqual(writePort.entries.length, 1);
    assert.strictEqual(writePort.entries[0].source, 'actor');

    // State should be updated
    assert.strictEqual(result.state.actionCount, 1);
    assert.ok(result.state.lastActionName);

    // Monitoring
    assert.strictEqual(result.monitoring.type, 'actor');
    assert.strictEqual(result.monitoring.success, true);
  });

  it('emits unexpectedResult when tool output is anomalous', async () => {
    const writePort = createMockWritePort();
    const toolProvider = createMockToolProvider({
      async execute(_name: string, _input: unknown): Promise<ToolResult> {
        return { output: '', isError: true };
      },
    });

    const actor = createActor(toolProvider, writePort);
    const state = actor.initialState();

    const snapshot = makeSnapshot(['Do something']);
    const result = await actor.step({ snapshot }, state, makeControl());

    // Monitoring should flag unexpected result
    assert.strictEqual(result.monitoring.type, 'actor');
    assert.strictEqual(result.monitoring.unexpectedResult, true);
    assert.strictEqual(result.monitoring.success, false);
  });

  it('respects allowedActions filter from control directive', async () => {
    let executedTool: string | null = null;

    const writePort = createMockWritePort();
    const toolProvider = createMockToolProvider({
      async execute(name: string, _input: unknown): Promise<ToolResult> {
        executedTool = name;
        return { output: `Result from ${name}` };
      },
    });

    const actor = createActor(toolProvider, writePort);
    const state = actor.initialState();

    const snapshot = makeSnapshot(['Write some data to the file']);
    const result = await actor.step(
      { snapshot },
      state,
      makeControl({ allowedActions: ['write_file'] }),
    );

    // Should only have executed write_file since it's the only allowed action
    assert.strictEqual(executedTool, 'write_file');
    assert.strictEqual(result.output.actionName, 'write_file');
    assert.strictEqual(result.monitoring.actionTaken, 'write_file');

    // Test with empty allowed list — should result in no action
    const writePort2 = createMockWritePort();
    const actor2 = createActor(toolProvider, writePort2);
    const result2 = await actor2.step(
      { snapshot },
      actor2.initialState(),
      makeControl({ allowedActions: [] }),
    );

    assert.strictEqual(result2.output.actionName, 'none');
    assert.strictEqual(result2.monitoring.unexpectedResult, true);

    // Test escalation
    const writePort3 = createMockWritePort();
    const actor3 = createActor(toolProvider, writePort3);
    const result3 = await actor3.step(
      { snapshot },
      actor3.initialState(),
      makeControl({ escalate: true }),
    );

    assert.strictEqual(result3.output.escalated, true);
    assert.strictEqual(result3.output.actionName, 'escalate');
  });

  it('tool execution error maps to StepError', async () => {
    const writePort = createMockWritePort();
    const toolProvider = createMockToolProvider({
      async execute(_name: string, _input: unknown): Promise<ToolResult> {
        throw new Error('Tool execution crashed');
      },
    });

    const actor = createActor(toolProvider, writePort);
    const state = actor.initialState();

    const snapshot = makeSnapshot(['Execute something']);
    const result = await actor.step({ snapshot }, state, makeControl());

    // Should have error, not throw
    assert.ok(result.error, 'Should have StepError');
    assert.strictEqual(result.error.recoverable, true);
    assert.strictEqual(result.error.moduleId, 'actor');
    assert.ok(result.error.message.includes('Tool execution crashed'));

    // State should remain unchanged
    assert.strictEqual(result.state.actionCount, 0);

    // Nothing written to workspace
    assert.strictEqual(writePort.entries.length, 0);

    // Monitoring should reflect failure
    assert.strictEqual(result.monitoring.success, false);
    assert.strictEqual(result.monitoring.unexpectedResult, true);
  });
});
