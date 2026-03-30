/**
 * Unit tests for Persona Module (PRD 032, P4).
 *
 * Tests: workspace injection, auto-selection from context, explicit override,
 * mid-task persona switching, default persona fallback, disable control,
 * error recovery, monitoring signal structure.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { moduleId } from '../../algebra/index.js';
import type { WorkspaceWritePort, WorkspaceEntry, ModuleId, ReadonlyWorkspaceSnapshot } from '../../algebra/index.js';
import { createPersonaModule } from '../persona-module.js';
import type { PersonaModuleControl } from '../persona-module.js';

// ── Test Helpers ────────────────────────────────────────────────

function createMockWritePort(): WorkspaceWritePort & { entries: WorkspaceEntry[] } {
  const entries: WorkspaceEntry[] = [];
  return {
    entries,
    write(entry: WorkspaceEntry): void {
      entries.push(entry);
    },
  };
}

function makeControl(overrides?: Partial<PersonaModuleControl>): PersonaModuleControl {
  return {
    target: 'persona' as ModuleId,
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeSnapshot(contents: Array<{ content: string; salience?: number }>): ReadonlyWorkspaceSnapshot {
  return contents.map((c, i) => ({
    source: moduleId('test'),
    content: c.content,
    salience: c.salience ?? 0.5,
    timestamp: Date.now() - i * 100,
  }));
}

// ── Tests ───────────────────────────────────────────────────────

describe('Persona Module', () => {
  it('writes persona guidance to workspace when auto-selecting from context', async () => {
    const writePort = createMockWritePort();
    const mod = createPersonaModule(writePort);
    const state = mod.initialState();

    const snapshot = makeSnapshot([
      { content: 'We need to debug this error in the parser', salience: 0.8 },
    ]);

    const result = await mod.step({ snapshot }, state, makeControl());

    // Should auto-select debugger
    assert.strictEqual(result.output.activePersonaId, 'debugger');
    assert.strictEqual(result.output.activePersona?.name, 'Debugger');
    assert.strictEqual(result.output.selectionMethod, 'auto');
    assert.strictEqual(result.output.switched, true);

    // Should write guidance to workspace
    assert.strictEqual(writePort.entries.length, 1);
    assert.ok(
      (writePort.entries[0].content as string).includes('[PERSONA]'),
      'Guidance should contain [PERSONA] tag',
    );
    assert.ok(
      (writePort.entries[0].content as string).includes('Debugger'),
      'Guidance should mention the persona name',
    );
    assert.ok(
      (writePort.entries[0].content as string).includes('fault isolation'),
      'Guidance should include reasoning style',
    );
  });

  it('selects architect persona for design-related workspace content', async () => {
    const writePort = createMockWritePort();
    const mod = createPersonaModule(writePort);
    const state = mod.initialState();

    const snapshot = makeSnapshot([
      { content: 'Need to design the new API boundary for the module', salience: 0.9 },
    ]);

    const result = await mod.step({ snapshot }, state, makeControl());

    assert.strictEqual(result.output.activePersonaId, 'architect');
    assert.strictEqual(result.output.selectionMethod, 'auto');
    assert.strictEqual(writePort.entries.length, 1);
  });

  it('explicit forcePersona overrides auto-selection', async () => {
    const writePort = createMockWritePort();
    const mod = createPersonaModule(writePort);
    const state = mod.initialState();

    // Workspace suggests debugging, but we force reviewer
    const snapshot = makeSnapshot([
      { content: 'There is a bug in the parser', salience: 0.8 },
    ]);

    const result = await mod.step(
      { snapshot },
      state,
      makeControl({ forcePersona: 'reviewer' }),
    );

    assert.strictEqual(result.output.activePersonaId, 'reviewer');
    assert.strictEqual(result.output.selectionMethod, 'explicit');
    assert.strictEqual(result.output.activePersona?.name, 'Reviewer');
  });

  it('supports mid-task persona switching when task type changes', async () => {
    const writePort = createMockWritePort();
    const mod = createPersonaModule(writePort);
    let state = mod.initialState();

    // Cycle 1: debug task
    const snapshot1 = makeSnapshot([
      { content: 'Debug the error in module X', salience: 0.8 },
    ]);
    const result1 = await mod.step({ snapshot: snapshot1 }, state, makeControl());
    assert.strictEqual(result1.output.activePersonaId, 'debugger');
    assert.strictEqual(result1.output.switched, true);
    state = result1.state;

    // Cycle 2: same persona, no switch
    const result2 = await mod.step({ snapshot: snapshot1 }, state, makeControl());
    assert.strictEqual(result2.output.activePersonaId, 'debugger');
    assert.strictEqual(result2.output.switched, false);
    state = result2.state;

    // Cycle 3: task changes to design
    const snapshot3 = makeSnapshot([
      { content: 'Now we need to design a new architecture', salience: 0.9 },
    ]);
    const result3 = await mod.step({ snapshot: snapshot3 }, state, makeControl());
    assert.strictEqual(result3.output.activePersonaId, 'architect');
    assert.strictEqual(result3.output.switched, true);
    assert.strictEqual(result3.state.switchCount, 2); // initial + switch
  });

  it('uses default persona when auto-selection finds no match', async () => {
    const writePort = createMockWritePort();
    const mod = createPersonaModule(writePort, { defaultPersona: 'explorer' });
    const state = mod.initialState();

    // Workspace with no recognizable task type keywords
    const snapshot = makeSnapshot([
      { content: 'Process the data and generate output', salience: 0.5 },
    ]);

    const result = await mod.step({ snapshot }, state, makeControl());

    assert.strictEqual(result.output.activePersonaId, 'explorer');
    assert.strictEqual(result.output.selectionMethod, 'explicit');
  });

  it('returns no persona when auto-selection finds no match and no default', async () => {
    const writePort = createMockWritePort();
    const mod = createPersonaModule(writePort);
    const state = mod.initialState();

    const snapshot = makeSnapshot([
      { content: 'Something entirely unrelated to any known category', salience: 0.5 },
    ]);

    const result = await mod.step({ snapshot }, state, makeControl());

    assert.strictEqual(result.output.activePersonaId, null);
    assert.strictEqual(result.output.activePersona, null);
    assert.strictEqual(result.output.selectionMethod, 'none');
    assert.strictEqual(writePort.entries.length, 0);
  });

  it('respects disable control directive', async () => {
    const writePort = createMockWritePort();
    const mod = createPersonaModule(writePort, { defaultPersona: 'debugger' });
    const state = mod.initialState();

    const snapshot = makeSnapshot([
      { content: 'Debug an error', salience: 0.8 },
    ]);

    const result = await mod.step(
      { snapshot },
      state,
      makeControl({ disable: true }),
    );

    assert.strictEqual(result.output.activePersonaId, null);
    assert.strictEqual(result.output.selectionMethod, 'none');
    assert.strictEqual(writePort.entries.length, 0);
  });

  it('emits correct monitoring signal structure', async () => {
    const writePort = createMockWritePort();
    const mod = createPersonaModule(writePort);
    const state = mod.initialState();

    const snapshot = makeSnapshot([
      { content: 'Review the code for quality issues', salience: 0.7 },
    ]);

    const result = await mod.step({ snapshot }, state, makeControl());

    assert.strictEqual(result.monitoring.type, 'persona');
    assert.strictEqual(result.monitoring.activePersonaId, 'reviewer');
    assert.strictEqual(result.monitoring.switched, true);
    assert.strictEqual(result.monitoring.selectionMethod, 'auto');
    assert.strictEqual(typeof result.monitoring.timestamp, 'number');
    assert.strictEqual(result.monitoring.source, 'persona');
  });

  it('handles empty workspace snapshot gracefully', async () => {
    const writePort = createMockWritePort();
    const mod = createPersonaModule(writePort);
    const state = mod.initialState();

    const result = await mod.step({ snapshot: [] }, state, makeControl());

    assert.strictEqual(result.output.activePersonaId, null);
    assert.strictEqual(result.output.selectionMethod, 'none');
    assert.strictEqual(writePort.entries.length, 0);
  });

  it('produces StepError with recoverable flag on write port failure', async () => {
    const throwingWritePort: WorkspaceWritePort = {
      write(): void {
        throw new Error('Workspace write failure');
      },
    };

    const mod = createPersonaModule(throwingWritePort);
    const state = mod.initialState();

    const snapshot = makeSnapshot([
      { content: 'Debug an error', salience: 0.8 },
    ]);

    const result = await mod.step({ snapshot }, state, makeControl());

    assert.ok(result.error, 'Should have StepError');
    assert.strictEqual(result.error.recoverable, true);
    assert.strictEqual(result.error.moduleId, 'persona');
    assert.ok(result.error.message.includes('Workspace write failure'));
    assert.strictEqual(result.state.activePersonaId, null);
  });

  it('forcePersona with invalid ID falls through to auto-selection', async () => {
    const writePort = createMockWritePort();
    const mod = createPersonaModule(writePort);
    const state = mod.initialState();

    const snapshot = makeSnapshot([
      { content: 'Debug an error in the system', salience: 0.8 },
    ]);

    const result = await mod.step(
      { snapshot },
      state,
      makeControl({ forcePersona: 'nonexistent' }),
    );

    // Should fall through to auto-selection since forced persona is invalid
    assert.strictEqual(result.output.activePersonaId, 'debugger');
    assert.strictEqual(result.output.selectionMethod, 'auto');
  });

  it('tracks switch count across multiple persona changes', async () => {
    const writePort = createMockWritePort();
    const mod = createPersonaModule(writePort);
    let state = mod.initialState();

    // Switch 1: null -> debugger
    const snap1 = makeSnapshot([{ content: 'Debug error', salience: 0.8 }]);
    const r1 = await mod.step({ snapshot: snap1 }, state, makeControl());
    state = r1.state;
    assert.strictEqual(state.switchCount, 1);

    // Switch 2: debugger -> architect
    const snap2 = makeSnapshot([{ content: 'Design the system', salience: 0.9 }]);
    const r2 = await mod.step({ snapshot: snap2 }, state, makeControl());
    state = r2.state;
    assert.strictEqual(state.switchCount, 2);

    // No switch: architect -> architect
    const r3 = await mod.step({ snapshot: snap2 }, state, makeControl());
    state = r3.state;
    assert.strictEqual(state.switchCount, 2); // unchanged
  });
});
