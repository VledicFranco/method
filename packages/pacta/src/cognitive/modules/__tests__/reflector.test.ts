// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for Reflector meta-level cognitive module.
 *
 * Tests: lesson extraction from traces, memory storage via MemoryPort,
 * reflection depth handling, error resilience (no state corruption).
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { moduleId } from '../../algebra/index.js';
import type { TraceRecord, MonitoringSignal } from '../../algebra/index.js';
import type { MemoryPort } from '../../../ports/memory-port.js';
import { createReflector } from '../reflector.js';
import type { ReflectorControl, ReflectorInput } from '../reflector.js';

// ── Stub MemoryPort ──────────────────────────────────────────────────

function makeStubMemory(): MemoryPort & { stored: Array<{ key: string; value: string; metadata?: Record<string, unknown> }> } {
  const stored: Array<{ key: string; value: string; metadata?: Record<string, unknown> }> = [];
  return {
    stored,
    async store(key: string, value: string, metadata?: Record<string, unknown>): Promise<void> {
      stored.push({ key, value, metadata });
    },
    async retrieve(key: string): Promise<string | null> {
      const entry = stored.find(s => s.key === key);
      return entry ? entry.value : null;
    },
  };
}

function makeFailingMemory(): MemoryPort {
  return {
    async store(): Promise<void> {
      throw new Error('Memory storage failure');
    },
    async retrieve(): Promise<string | null> {
      return null;
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function makeControl(depth: 'shallow' | 'deep'): ReflectorControl {
  return {
    target: moduleId('reflector'),
    timestamp: Date.now(),
    reflectionDepth: depth,
  };
}

function makeTrace(mod: string, phase: string, durationMs: number, summary: string): TraceRecord {
  const monitoring: MonitoringSignal = {
    source: moduleId(mod),
    timestamp: Date.now(),
  };
  return {
    moduleId: moduleId(mod),
    phase,
    timestamp: Date.now(),
    inputHash: 'hash-' + mod,
    outputSummary: summary,
    monitoring,
    stateHash: 'state-' + mod,
    durationMs,
  };
}

function makeInput(traces: TraceRecord[]): ReflectorInput {
  return { traces };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Reflector module', () => {
  it('reads cycle traces, extracts lessons, writes to MemoryPort', async () => {
    const memory = makeStubMemory();
    const reflector = createReflector(memory);
    const state = reflector.initialState();

    const traces = [
      makeTrace('reasoner-1', 'REASON', 150, 'Generated analysis'),
      makeTrace('actor-1', 'ACT', 200, 'Executed read_file'),
    ];

    const result = await reflector.step(
      makeInput(traces),
      state,
      makeControl('shallow'),
    );

    // Should extract lessons from both traces
    assert.equal(result.output.lessons.length, 2);
    assert.ok(result.output.lessons[0].summary.includes('reasoner-1'));
    assert.ok(result.output.lessons[1].summary.includes('actor-1'));

    // Should have updated state
    assert.equal(result.state.lessonCount, 2);
    assert.equal(result.state.cycleCount, 1);

    // Monitoring should report lessons extracted
    assert.equal(result.monitoring.type, 'reflector');
    assert.equal(result.monitoring.lessonsExtracted, 2);
  });

  it('writes distilled memories via memory.store()', async () => {
    const memory = makeStubMemory();
    const reflector = createReflector(memory);
    const state = reflector.initialState();

    const traces = [
      makeTrace('reasoner-1', 'REASON', 100, 'Produced reasoning trace'),
    ];

    await reflector.step(makeInput(traces), state, makeControl('shallow'));

    // Verify that memory.store() was called
    assert.equal(memory.stored.length, 1);
    assert.ok(memory.stored[0].key.startsWith('lesson-'));
    assert.ok(memory.stored[0].value.includes('reasoner-1'));
    assert.ok(memory.stored[0].metadata !== undefined);
    assert.equal(memory.stored[0].metadata!.depth, 'shallow');
  });

  it('respects reflectionDepth directive (shallow vs deep)', async () => {
    const memoryShallow = makeStubMemory();
    const memoryDeep = makeStubMemory();
    const reflectorShallow = createReflector(memoryShallow);
    const reflectorDeep = createReflector(memoryDeep);
    const state = reflectorShallow.initialState();

    const traces = [
      makeTrace('reasoner-1', 'REASON', 100, 'Fast reasoning'),
      makeTrace('actor-1', 'ACT', 300, 'Slow action'),
      makeTrace('observer-1', 'OBSERVE', 50, 'Input processed'),
    ];

    const shallowResult = await reflectorShallow.step(
      makeInput(traces),
      state,
      makeControl('shallow'),
    );

    const deepResult = await reflectorDeep.step(
      makeInput(traces),
      state,
      makeControl('deep'),
    );

    // Shallow: one lesson per trace
    assert.equal(shallowResult.output.lessons.length, 3);
    assert.ok(shallowResult.output.lessons.every(l => l.depth === 'shallow'));

    // Deep: per-trace lessons + cross-trace pattern analysis
    assert.ok(deepResult.output.lessons.length > shallowResult.output.lessons.length);
    assert.ok(deepResult.output.lessons.every(l => l.depth === 'deep'));

    // Deep should detect the slow actor module as a performance pattern
    const patternLessons = deepResult.output.lessons.filter(l =>
      l.summary.includes('Performance pattern') || l.summary.includes('phases'),
    );
    assert.ok(patternLessons.length > 0);
  });

  it('failure does not corrupt state (state remains at pre-step values)', async () => {
    const memory = makeFailingMemory();
    const reflector = createReflector(memory);

    const preStepState = {
      lessonCount: 5,
      reflectionDepth: 'shallow' as const,
      cycleCount: 3,
    };

    const traces = [
      makeTrace('reasoner-1', 'REASON', 100, 'Some reasoning'),
    ];

    const result = await reflector.step(
      makeInput(traces),
      preStepState,
      makeControl('shallow'),
    );

    // State should be unchanged — fire-and-forget semantics
    assert.equal(result.state.lessonCount, preStepState.lessonCount);
    assert.equal(result.state.cycleCount, preStepState.cycleCount);
    assert.equal(result.state.reflectionDepth, preStepState.reflectionDepth);

    // Error should be reported
    assert.ok(result.error !== undefined);
    assert.ok(result.error!.message.includes('Memory storage failure'));
    assert.equal(result.error!.recoverable, true);
    assert.equal(result.error!.phase, 'LEARN');

    // Monitoring should report 0 lessons extracted
    assert.equal(result.monitoring.lessonsExtracted, 0);

    // Output should be empty lessons
    assert.equal(result.output.lessons.length, 0);
  });
});
