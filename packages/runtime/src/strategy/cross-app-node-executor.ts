// SPDX-License-Identifier: Apache-2.0
/**
 * CrossAppNodeExecutorImpl — bridges the methodts `CrossAppNodeExecutor`
 * port to the runtime's `CrossAppInvoker` port.
 *
 * PRD-067 §7.3: methodts cannot depend on `@methodts/runtime` (lower FCA layer
 * can't see upper), so methodts defines `CrossAppNodeExecutor` as an
 * injection port. This class is the runtime-side adapter — it projects the
 * DAG bundle into the operation input per `input_projection`, dispatches
 * through the `CrossAppInvoker`, merges the output per `output_merge`, and
 * translates typed errors from the invoker into failures the methodts gate
 * machinery resolves as node failures (G-FAILURE-ISOLATION).
 *
 * Owner:    @methodts/runtime/strategy
 * Producer: composition root wires `new CrossAppNodeExecutorImpl(invoker)`
 * Consumer: methodts DagStrategyExecutor via the `CrossAppNodeExecutor` port
 */

import type {
  CrossAppNodeExecutor,
} from '@methodts/methodts/strategy/dag-executor.js';
import type {
  StrategyDAG,
  StrategyNode,
  CrossAppInvokeNodeConfig,
} from '@methodts/methodts/strategy/dag-types.js';
import {
  type CrossAppInvoker,
  type CrossAppInvokeRequest,
  type DelegationCarry,
} from '../ports/cross-app-invoker.js';

/** Options wired from the composition root that the executor needs per-call. */
export interface CrossAppNodeExecutorOptions {
  /**
   * Supplier of the delegation context for each dispatch. The runtime's pact
   * context carries the parent token + current exchange depth + originating
   * request id; this callback projects it into the shape the port expects.
   *
   * In the simulator this can be a static function returning a fake
   * `DelegationCarry`; in production the composition root wires the real
   * pact context from `@methodts/agent-runtime`.
   */
  readonly delegationSupplier: (args: {
    readonly sessionId: string;
    readonly nodeId: string;
  }) => DelegationCarry;
  /** Default timeout (ms) when a node doesn't override. */
  readonly defaultTimeoutMs?: number;
}

/** Dot-path projector. `"$.a.b"` → bundle.a.b. Unknown paths yield `undefined`. */
function projectDotPath(bundle: Record<string, unknown>, path: string): unknown {
  const trimmed = path.startsWith('$.') ? path.slice(2) : path;
  if (trimmed === '') return bundle;
  const segments = trimmed.split('.');
  let cursor: unknown = bundle;
  for (const seg of segments) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return cursor;
}

/** Project a DAG bundle into the target operation's input object per
 *  the `input_projection` map. */
export function applyInputProjection(
  bundle: Record<string, unknown>,
  projection: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [targetField, dotPath] of Object.entries(projection)) {
    out[targetField] = projectDotPath(bundle, dotPath);
  }
  return out;
}

/** Merge the target output into the DAG output bundle per `output_merge`. */
export function applyOutputMerge(
  nodeId: string,
  rawOutput: unknown,
  mode: 'spread' | 'namespace',
): Record<string, unknown> {
  if (mode === 'spread') {
    if (rawOutput === null || rawOutput === undefined) return {};
    if (typeof rawOutput !== 'object') {
      // Scalar output in spread mode → store under "result" for safety.
      return { result: rawOutput };
    }
    return { ...(rawOutput as Record<string, unknown>) };
  }
  // "namespace" (default, safer) — nests under node id
  return { [nodeId]: rawOutput };
}

export class CrossAppNodeExecutorImpl implements CrossAppNodeExecutor {
  constructor(
    private readonly invoker: CrossAppInvoker,
    private readonly options: CrossAppNodeExecutorOptions,
  ) {}

  async executeCrossAppInvokeNode(
    _dag: StrategyDAG,
    node: StrategyNode,
    config: CrossAppInvokeNodeConfig,
    inputBundle: Record<string, unknown>,
    sessionId: string,
  ): Promise<{
    output: Record<string, unknown>;
    cost_usd: number;
    num_turns: number;
    duration_ms: number;
  }> {
    // Project the input bundle.
    const operationInput = applyInputProjection(inputBundle, config.input_projection);

    // Resolve idempotency key — default to `${sessionId}:${nodeId}` when the
    // strategy YAML does not supply an override (PRD-067 §6.2).
    const idempotencyKey =
      config.idempotency_key && config.idempotency_key.trim() !== ''
        ? config.idempotency_key
        : `${sessionId}:${node.id}`;

    const timeoutMs = config.timeout_ms ?? this.options.defaultTimeoutMs;

    const delegation = this.options.delegationSupplier({
      sessionId,
      nodeId: node.id,
    });

    const request: CrossAppInvokeRequest<Record<string, unknown>> = {
      targetAppId: config.target_app,
      operation: config.operation,
      input: operationInput,
      timeoutMs,
      idempotencyKey,
      delegation,
      caller: { sessionId, nodeId: node.id },
    };

    const startedAt = Date.now();
    const result = await this.invoker.invoke<Record<string, unknown>, unknown>(request);
    const durationMs = Math.max(0, Date.now() - startedAt);

    const merged = applyOutputMerge(
      node.id,
      result.output,
      config.output_merge ?? 'namespace',
    );

    return {
      output: merged,
      cost_usd: result.callerCostUsd,
      num_turns: 0,
      duration_ms: durationMs,
    };
  }
}
