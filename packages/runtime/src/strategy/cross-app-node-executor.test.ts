/**
 * Tests for CrossAppNodeExecutorImpl — the runtime-side bridge from methodts
 * `CrossAppNodeExecutor` port to the `CrossAppInvoker` port.
 *
 * Covers:
 *   - Input projection (dot-paths)
 *   - Output merge modes (namespace default, spread)
 *   - Default idempotency key derivation (`${sessionId}:${nodeId}`)
 *   - Delegation supplier is invoked with caller correlation ids
 *   - Cortex stub throws NotImplementedError on invoke (Track B blocked)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type {
  StrategyDAG,
  StrategyNode,
  CrossAppInvokeNodeConfig,
} from '@method/methodts/strategy/dag-types.js';

import { InProcessCrossAppInvoker } from './in-process-cross-app-invoker.js';
import {
  CrossAppNodeExecutorImpl,
  applyInputProjection,
  applyOutputMerge,
} from './cross-app-node-executor.js';
import {
  CortexCrossAppInvoker,
  CortexCrossAppInvokerNotImplementedError,
} from './cortex-cross-app-invoker.stub.js';
import type { DelegationCarry } from '../ports/cross-app-invoker.js';

const BASE_DAG: StrategyDAG = {
  id: 'test-strategy',
  name: 'Test Strategy',
  version: '1',
  nodes: [],
  strategy_gates: [],
  capabilities: {},
  oversight_rules: [],
  context_inputs: [],
};

function makeNode(id: string): StrategyNode {
  return {
    id,
    type: 'cross-app-invoke',
    depends_on: [],
    inputs: [],
    outputs: [],
    gates: [],
    config: {
      type: 'cross-app-invoke',
      target_app: 'target',
      operation: 'op',
      input_projection: {},
    },
  };
}

function staticDelegation(): DelegationCarry {
  return {
    parentToken: 'tok',
    currentDepth: 1,
    originatingRequestId: 'req-1',
  };
}

describe('applyInputProjection', () => {
  it('projects top-level and nested dot-paths', () => {
    const bundle = { classify: { label: 'defect', severity: 'high' }, other: 'ignored' };
    const out = applyInputProjection(bundle, {
      label: '$.classify.label',
      severity: '$.classify.severity',
    });
    assert.deepEqual(out, { label: 'defect', severity: 'high' });
  });

  it('yields undefined for missing paths (caller responsible for shape)', () => {
    const out = applyInputProjection({}, { x: '$.missing.path' });
    assert.deepEqual(out, { x: undefined });
  });
});

describe('applyOutputMerge', () => {
  it('defaults to namespace mode', () => {
    const merged = applyOutputMerge('my-node', { pr_url: 'x' }, 'namespace');
    assert.deepEqual(merged, { 'my-node': { pr_url: 'x' } });
  });

  it('spread merges object outputs', () => {
    const merged = applyOutputMerge('my-node', { pr_url: 'x', effort: 'S' }, 'spread');
    assert.deepEqual(merged, { pr_url: 'x', effort: 'S' });
  });

  it('spread wraps scalar outputs as result', () => {
    const merged = applyOutputMerge('my-node', 42, 'spread');
    assert.deepEqual(merged, { result: 42 });
  });
});

describe('CrossAppNodeExecutorImpl', () => {
  it('dispatches via the CrossAppInvoker port and merges output per config', async () => {
    const invoker = new InProcessCrossAppInvoker();
    invoker.registerApp('target', {
      op: (input: { label: string }) => ({ pr_url: `pr/${input.label}` }),
    });

    const executor = new CrossAppNodeExecutorImpl(invoker, {
      delegationSupplier: staticDelegation,
    });

    const node: StrategyNode = {
      ...makeNode('commission'),
      config: {
        type: 'cross-app-invoke',
        target_app: 'target',
        operation: 'op',
        input_projection: { label: '$.classify.label' },
        output_merge: 'namespace',
      },
    };

    const result = await executor.executeCrossAppInvokeNode(
      BASE_DAG,
      node,
      node.config as CrossAppInvokeNodeConfig,
      { classify: { label: 'bug' } },
      'session-1',
    );

    assert.deepEqual(result.output, { commission: { pr_url: 'pr/bug' } });
    assert.equal(result.num_turns, 0);
    assert.ok(result.duration_ms >= 0);
  });

  it('defaults idempotency key to `${sessionId}:${nodeId}`', async () => {
    const invoker = new InProcessCrossAppInvoker();
    let invocationCount = 0;
    invoker.registerApp('target', {
      op: () => {
        invocationCount += 1;
        return { n: invocationCount };
      },
    });

    const executor = new CrossAppNodeExecutorImpl(invoker, {
      delegationSupplier: staticDelegation,
    });
    const node = makeNode('n1');

    await executor.executeCrossAppInvokeNode(
      BASE_DAG,
      node,
      node.config as CrossAppInvokeNodeConfig,
      {},
      'sess-abc',
    );
    await executor.executeCrossAppInvokeNode(
      BASE_DAG,
      node,
      node.config as CrossAppInvokeNodeConfig,
      {},
      'sess-abc',
    );

    assert.equal(invocationCount, 1, 'same (sessionId, nodeId) must dedupe');
  });

  it('passes caller correlation ids to the delegation supplier', async () => {
    const invoker = new InProcessCrossAppInvoker();
    invoker.registerApp('target', { op: () => ({}) });

    const capturedArgs: Array<{ sessionId: string; nodeId: string }> = [];
    const executor = new CrossAppNodeExecutorImpl(invoker, {
      delegationSupplier: (args) => {
        capturedArgs.push(args);
        return staticDelegation();
      },
    });
    const node = makeNode('dispatch');
    await executor.executeCrossAppInvokeNode(
      BASE_DAG,
      node,
      node.config as CrossAppInvokeNodeConfig,
      {},
      'S-99',
    );

    assert.deepEqual(capturedArgs, [{ sessionId: 'S-99', nodeId: 'dispatch' }]);
  });
});

describe('CortexCrossAppInvoker (stub — Track B blocked on PRD-080)', () => {
  it('throws NotImplementedError on invoke', async () => {
    const invoker = new CortexCrossAppInvoker({
      ctxApps: {},
      allowedTargetAppIds: new Set(['x']),
    });
    await assert.rejects(
      () =>
        invoker.invoke({
          targetAppId: 'x',
          operation: 'y',
          input: {},
          delegation: staticDelegation(),
          caller: { sessionId: 's', nodeId: 'n' },
        }),
      CortexCrossAppInvokerNotImplementedError,
    );
  });

  it('capabilities() reports disabled + echoes declared allowlist', () => {
    const allowed = new Set(['feature-dev-agent']);
    const invoker = new CortexCrossAppInvoker({
      ctxApps: {},
      allowedTargetAppIds: allowed,
    });
    const caps = invoker.capabilities();
    assert.equal(caps.enabled, false);
    assert.deepEqual([...(caps.allowedTargetAppIds ?? [])], ['feature-dev-agent']);
  });
});
