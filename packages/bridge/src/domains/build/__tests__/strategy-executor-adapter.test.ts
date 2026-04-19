// SPDX-License-Identifier: Apache-2.0
/**
 * StrategyExecutorAdapter tests — verifies result mapping, strategy lookup,
 * and failure-path handling without standing up a real AgentProvider chain.
 *
 * Exercises the adapter with a fake DagExecutor and an in-memory
 * SubStrategySource so we can assert on every branch of mapResult.
 */

import { describe, it, expect } from 'vitest';
import { StrategyExecutorAdapter } from '../strategy-executor-adapter.js';
import type { DagExecutor } from '../strategy-executor-adapter.js';
import type {
  StrategyDAG,
  StrategyExecutionResult as DagExecutionResult,
  SubStrategySource,
  NodeResult,
  ArtifactBundle,
  ArtifactVersion,
} from '@methodts/methodts/strategy/dag-types.js';

// ── Fixtures ──

function makeDag(id: string): StrategyDAG {
  return {
    id,
    name: `Test strategy ${id}`,
    version: '1.0.0',
    description: 'Fixture strategy for adapter tests',
    nodes: [],
    gates: [],
    capabilities: {},
    oversight: [],
    context_inputs: [],
  } as unknown as StrategyDAG;
}

function makeNodeResult(
  nodeId: string,
  status: NodeResult['status'],
  error?: string,
): NodeResult {
  return {
    node_id: nodeId,
    status,
    output: {},
    cost_usd: 0.01,
    duration_ms: 100,
    num_turns: 3,
    gate_results: [],
    retries: 0,
    error,
  };
}

function makeArtifactVersion(id: string, content: unknown): ArtifactVersion {
  return {
    artifact_id: id,
    version: 1,
    content,
    producer_node_id: 'node-1',
    timestamp: '2026-04-05T00:00:00.000Z',
  };
}

function makeResult(overrides: Partial<DagExecutionResult>): DagExecutionResult {
  return {
    strategy_id: 's-test',
    status: 'completed',
    node_results: {},
    artifacts: {} as ArtifactBundle,
    gate_results: [],
    cost_usd: 0,
    started_at: '2026-04-05T00:00:00.000Z',
    completed_at: '2026-04-05T00:00:01.000Z',
    duration_ms: 1000,
    oversight_events: [],
    ...overrides,
  };
}

// ── Fakes ──

class InMemorySource implements SubStrategySource {
  private dags = new Map<string, StrategyDAG>();

  add(dag: StrategyDAG): this {
    this.dags.set(dag.id, dag);
    return this;
  }

  async getStrategy(id: string): Promise<StrategyDAG | null> {
    return this.dags.get(id) ?? null;
  }
}

class FakeExecutor implements DagExecutor {
  calls: Array<{ dag: StrategyDAG; contextInputs: Record<string, unknown> }> = [];

  constructor(private readonly responder: (dag: StrategyDAG) => DagExecutionResult | Promise<DagExecutionResult>) {}

  async execute(
    dag: StrategyDAG,
    contextInputs: Record<string, unknown>,
  ): Promise<DagExecutionResult> {
    this.calls.push({ dag, contextInputs });
    return this.responder(dag);
  }
}

class ThrowingExecutor implements DagExecutor {
  constructor(private readonly error: Error) {}

  async execute(): Promise<DagExecutionResult> {
    throw this.error;
  }
}

// ── Tests ──

describe('StrategyExecutorAdapter', () => {
  it('returns success=false with error when strategy not found', async () => {
    const source = new InMemorySource();
    const executor = new FakeExecutor(() => makeResult({}));
    const adapter = new StrategyExecutorAdapter(executor, source);

    const result = await adapter.executeStrategy('missing', {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
    expect(result.executionId).toMatch(/^exec-missing-/);
    expect(executor.calls.length).toBe(0);
  });

  it('maps a completed DAG result to success=true with artifacts and cost', async () => {
    const dag = makeDag('s-good');
    const source = new InMemorySource().add(dag);
    const executor = new FakeExecutor(() =>
      makeResult({
        strategy_id: 's-good',
        status: 'completed',
        node_results: {
          'node-1': makeNodeResult('node-1', 'completed'),
          'node-2': makeNodeResult('node-2', 'completed'),
        },
        artifacts: {
          plan: makeArtifactVersion('plan', 'Plan content here'),
          design: makeArtifactVersion('design', { sections: ['a', 'b'] }),
        } as ArtifactBundle,
        cost_usd: 0.42,
      }),
    );
    const adapter = new StrategyExecutorAdapter(executor, source);

    const result = await adapter.executeStrategy('s-good', { input: 'x' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('s-good');
    expect(result.output).toContain('2/2 nodes');
    expect(result.cost.usd).toBe(0.42);
    expect(result.cost.tokens).toBe(6); // num_turns summed across nodes
    expect(result.artifacts).toBeDefined();
    expect(result.artifacts!.plan).toBe('Plan content here');
    expect(result.artifacts!.design).toBe(JSON.stringify({ sections: ['a', 'b'] }));
    expect(result.error).toBeUndefined();
    expect(result.failureContext).toBeUndefined();
    expect(executor.calls.length).toBe(1);
    expect(executor.calls[0].contextInputs).toEqual({ input: 'x' });
  });

  it('maps a failed DAG result to success=false with error and failureContext', async () => {
    const dag = makeDag('s-fail');
    const source = new InMemorySource().add(dag);
    const executor = new FakeExecutor(() =>
      makeResult({
        strategy_id: 's-fail',
        status: 'failed',
        node_results: {
          'node-1': makeNodeResult('node-1', 'completed'),
          'node-2': makeNodeResult('node-2', 'failed', 'Compilation error'),
        },
        cost_usd: 0.2,
      }),
    );
    const adapter = new StrategyExecutorAdapter(executor, source);

    const result = await adapter.executeStrategy('s-fail', {});

    expect(result.success).toBe(false);
    expect(result.output).toContain('failed');
    expect(result.output).toContain('1/2 completed');
    expect(result.cost.usd).toBe(0.2);
    expect(result.error).toContain('node-2');
    expect(result.error).toContain('Compilation error');
    expect(result.failureContext).toBeDefined();
    const ctx = JSON.parse(result.failureContext!);
    expect(ctx.status).toBe('failed');
    expect(ctx.node_errors).toHaveLength(1);
    expect(ctx.node_errors[0].node).toBe('node-2');
  });

  it('maps a suspended DAG result with no node-level error using a default error message', async () => {
    const dag = makeDag('s-suspend');
    const source = new InMemorySource().add(dag);
    const executor = new FakeExecutor(() =>
      makeResult({
        strategy_id: 's-suspend',
        status: 'suspended',
        node_results: { 'node-1': makeNodeResult('node-1', 'completed') },
        cost_usd: 0.1,
      }),
    );
    const adapter = new StrategyExecutorAdapter(executor, source);

    const result = await adapter.executeStrategy('s-suspend', {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('suspended');
    expect(result.failureContext).toBeDefined();
  });

  it('captures executor exceptions as success=false with error', async () => {
    const dag = makeDag('s-throw');
    const source = new InMemorySource().add(dag);
    const executor = new ThrowingExecutor(new Error('boom'));
    const adapter = new StrategyExecutorAdapter(executor, source);

    const result = await adapter.executeStrategy('s-throw', {});

    expect(result.success).toBe(false);
    expect(result.error).toBe('boom');
    expect(result.cost).toEqual({ tokens: 0, usd: 0 });
    expect(result.executionId).toMatch(/^exec-s-throw-/);
  });

  it('omits artifacts field when the bundle is empty', async () => {
    const dag = makeDag('s-empty-artifacts');
    const source = new InMemorySource().add(dag);
    const executor = new FakeExecutor(() =>
      makeResult({
        strategy_id: 's-empty-artifacts',
        status: 'completed',
        node_results: { 'node-1': makeNodeResult('node-1', 'completed') },
        artifacts: {} as ArtifactBundle,
      }),
    );
    const adapter = new StrategyExecutorAdapter(executor, source);

    const result = await adapter.executeStrategy('s-empty-artifacts', {});

    expect(result.success).toBe(true);
    expect(result.artifacts).toBeUndefined();
  });

  it('passes contextInputs through to the underlying executor', async () => {
    const dag = makeDag('s-ctx');
    const source = new InMemorySource().add(dag);
    const executor = new FakeExecutor(() =>
      makeResult({ strategy_id: 's-ctx', status: 'completed' }),
    );
    const adapter = new StrategyExecutorAdapter(executor, source);

    await adapter.executeStrategy('s-ctx', {
      previousError: 'Type error in module X',
      retry: true,
    });

    expect(executor.calls.length).toBe(1);
    expect(executor.calls[0].contextInputs).toEqual({
      previousError: 'Type error in module X',
      retry: true,
    });
  });
});
