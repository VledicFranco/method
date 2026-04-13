/**
 * Mock executor — wires testkit mock DagNodeExecutor into DagStrategyExecutor.
 *
 * Runs strategy YAML fixtures end-to-end without real API calls. Each methodology
 * node returns scripted output based on node ID. Script/context-load nodes execute
 * natively (no mocking needed — they're deterministic).
 */

import {
  DagStrategyExecutor,
  type DagNodeExecutor,
  type ContextLoadExecutor,
  type ContextLoadResult,
} from '@method/methodts/strategy/dag-executor.js';
import { parseStrategyYaml } from '@method/methodts/strategy/dag-parser.js';
import type {
  StrategyDAG,
  StrategyNode,
  NodeResult,
  NodeStatus,
  MethodologyNodeConfig,
  StrategyExecutorConfig,
  SubStrategySource,
  HumanApprovalResolver,
  HumanApprovalDecision,
  StrategyExecutionResult,
  ContextLoadNodeConfig,
  DagGateResult,
  DagGateType,
  OversightEvent,
} from '@method/methodts/strategy/dag-types.js';
import { readFileSync } from 'node:fs';
import { load as loadYaml } from 'js-yaml';
import type { RunFlow } from './run-flow.js';

// ── Scripted outputs per node ID ────────────────────────────────

export type ScriptedOutputs = Record<string, Record<string, unknown>>;

/**
 * For gate-retry-feedback: returns different output on each invocation.
 * Call count tracked per node ID.
 */
export type DynamicOutputFn = (
  nodeId: string,
  attempt: number,
  retryFeedback?: string,
) => Record<string, unknown>;

// ── Mock DagNodeExecutor ────────────────────────────────────────

export function makeMockNodeExecutor(
  outputs: ScriptedOutputs = {},
  dynamicFn?: DynamicOutputFn,
): DagNodeExecutor & { callLog: Array<{ nodeId: string; attempt: number; feedback?: string }> } {
  const callCounts: Record<string, number> = {};
  const callLog: Array<{ nodeId: string; attempt: number; feedback?: string }> = [];

  return {
    callLog,
    async executeMethodologyNode(
      _dag: StrategyDAG,
      node: StrategyNode,
      _config: MethodologyNodeConfig,
      _inputBundle: Record<string, unknown>,
      _sessionId: string,
      retryFeedback?: string,
    ) {
      const attempt = (callCounts[node.id] ?? 0);
      callCounts[node.id] = attempt + 1;
      callLog.push({ nodeId: node.id, attempt, feedback: retryFeedback });

      const output = dynamicFn
        ? dynamicFn(node.id, attempt, retryFeedback)
        : (outputs[node.id] ?? { result: 'mock-default' });

      return {
        output,
        cost_usd: 0.005,
        num_turns: 1,
        duration_ms: 50 + Math.random() * 100,
      };
    },
  };
}

// ── Mock ContextLoadExecutor ────────────────────────────────────

export function makeMockContextLoadExecutor(): ContextLoadExecutor {
  return {
    async executeContextLoad(
      config: ContextLoadNodeConfig,
      _projectRoot: string,
    ): Promise<ContextLoadResult> {
      return {
        components: [
          {
            path: 'packages/methodts/src/strategy',
            level: 'L2',
            docText: '[port]\nexport interface DagNodeExecutor { ... }',
            coverageScore: 0.85,
            score: 0.92,
          },
          {
            path: 'packages/bridge/src/domains/strategies',
            level: 'L4',
            docText: '[interface]\nexport class StrategyExecutor { ... }',
            coverageScore: 0.78,
            score: 0.88,
          },
        ],
        queryTime: 15,
        mode: 'production',
      };
    },
  };
}

// ── Mock HumanApprovalResolver ──────────────────────────────────

export function makeMockHumanApprovalResolver(
  decision: HumanApprovalDecision = { approved: true },
): HumanApprovalResolver {
  return {
    async requestApproval() {
      return decision;
    },
  };
}

// ── Mock SubStrategySource ──────────────────────────────────────

export function makeMockSubStrategySource(
  strategies: Record<string, string>,
): SubStrategySource {
  return {
    async getStrategy(id: string) {
      const yaml = strategies[id];
      if (!yaml) return null;
      return parseStrategyYaml(yaml);
    },
  };
}

// ── Run a fixture ───────────────────────────────────────────────

export interface MockRunOptions {
  /** Scripted outputs keyed by node ID */
  outputs?: ScriptedOutputs;
  /** Dynamic output function (overrides outputs when set) */
  dynamicFn?: DynamicOutputFn;
  /** Context inputs passed to the strategy */
  contextInputs?: Record<string, unknown>;
  /** Additional sub-strategy YAML strings keyed by strategy ID */
  subStrategies?: Record<string, string>;
  /** Human approval decision (default: approved) */
  approvalDecision?: HumanApprovalDecision;
  /** Executor config overrides */
  config?: Partial<StrategyExecutorConfig>;
}

export interface MockRunResult {
  result: StrategyExecutionResult;
  callLog: Array<{ nodeId: string; attempt: number; feedback?: string }>;
  dag: StrategyDAG;
  /**
   * RunFlow enrichment (PRD 056 Wave 0 Surface 6).
   *
   * Populated for every successful strategy execution — walks the parsed DAG
   * and records nodes, gates, edges, artifacts, and oversight events for the
   * SVG DAG renderer in the feature detail view.
   *
   * `undefined` only when DAG parsing failed before execution (callers should
   * still handle that shape defensively; renderer treats `undefined` as no-op).
   */
  flow?: RunFlow;
}

/**
 * Load a strategy YAML fixture and run it with mock providers.
 */
export function loadFixtureYaml(fixturePath: string): string {
  return readFileSync(fixturePath, 'utf8');
}

export async function runMockStrategy(
  yamlContent: string,
  options: MockRunOptions = {},
): Promise<MockRunResult> {
  const dag = parseStrategyYaml(yamlContent);

  const nodeExecutor = makeMockNodeExecutor(
    options.outputs ?? {},
    options.dynamicFn,
  );

  const config: StrategyExecutorConfig = {
    maxParallel: 3,
    defaultGateRetries: 3,
    defaultTimeoutMs: 60_000,
    retroDir: '.method/retros',
    projectRoot: process.cwd(),
    ...options.config,
  };

  const subSource = options.subStrategies
    ? makeMockSubStrategySource(options.subStrategies)
    : null;

  const approvalResolver = makeMockHumanApprovalResolver(
    options.approvalDecision ?? { approved: true },
  );

  const contextLoadExecutor = makeMockContextLoadExecutor();

  const executor = new DagStrategyExecutor(
    nodeExecutor,
    config,
    subSource,
    approvalResolver,
    contextLoadExecutor,
  );

  const result = await executor.execute(
    dag,
    options.contextInputs ?? {},
  );

  const flow = buildRunFlow(dag, result, nodeExecutor.callLog);

  return {
    result,
    callLog: nodeExecutor.callLog,
    dag,
    flow,
  };
}

// ── RunFlow builder ─────────────────────────────────────────────

/** Map methodts NodeStatus → RunFlow node status. */
function mapNodeStatus(
  status: NodeStatus | undefined,
): RunFlow['nodes'][number]['status'] {
  if (status === 'completed') return 'completed';
  if (status === 'suspended') return 'suspended';
  if (status === 'failed' || status === 'gate_failed') return 'failed';
  // pending/running at end-of-execution or not-present → skipped
  return 'skipped';
}

/** Map methodts DagGateType → RunFlow gate type. */
function mapGateType(type: DagGateType): RunFlow['gates'][number]['type'] {
  if (type === 'human_approval') return 'human-approval';
  return type; // 'algorithmic' | 'observation'
}

/** Extract node id from a gate_id of the form `${nodeId}:gate[${index}]`. */
function extractNodeIdFromGateId(gateId: string): string | null {
  const match = gateId.match(/^(.+):gate\[\d+\]$/);
  return match ? match[1] : null;
}

/** Map methodts oversight action → RunFlow oversight event type. */
function mapOversightAction(
  action: OversightEvent['rule']['action'],
): RunFlow['oversightEvents'][number]['type'] {
  if (action === 'warn_human') return 'warn';
  // escalate_to_human and kill_and_requeue both surface as 'escalate'
  // (the RunFlow schema only has escalate|warn; kill_and_requeue is
  // semantically the severest outcome, closest to escalate)
  return 'escalate';
}

/**
 * Build a RunFlow enrichment from the parsed DAG, execution result, and
 * the mock executor's per-call log.
 *
 * The RunFlow shape is frozen in Wave 0 of PRD 056 at
 * `packages/smoke-test/src/executor/run-flow.ts`. This function populates it
 * for the SVG DAG renderer consumed by the feature-detail view.
 */
export function buildRunFlow(
  dag: StrategyDAG,
  result: StrategyExecutionResult,
  callLog: Array<{ nodeId: string; attempt: number; feedback?: string }>,
): RunFlow {
  // ── Nodes ────────────────────────────────────────────────────
  const nodes: RunFlow['nodes'] = dag.nodes.map((node) => {
    const nr: NodeResult | undefined = result.node_results[node.id];
    const status = mapNodeStatus(nr?.status);

    // Collect this node's call-log entries (methodology nodes only go
    // through callLog; script/context-load/semantic/strategy nodes execute
    // natively and are represented as a single synthetic attempt).
    const entries = callLog
      .filter((e) => e.nodeId === node.id)
      .sort((a, b) => a.attempt - b.attempt);

    const attempts: RunFlow['nodes'][number]['attempts'] = [];

    if (entries.length > 0) {
      // Methodology node — one attempt record per invocation the mock
      // executor saw. Methodts only surfaces the final NodeResult output;
      // earlier attempts share that output (mock dynamicFn may also have
      // produced different per-attempt outputs, but we can't recover the
      // intermediate ones from methodts state — use empty for retries
      // and the final output on the last attempt).
      const totalCost = nr?.cost_usd ?? 0;
      const totalDuration = nr?.duration_ms ?? 0;
      const perAttemptCost = entries.length > 0 ? totalCost / entries.length : 0;
      const perAttemptDuration =
        entries.length > 0 ? totalDuration / entries.length : 0;

      for (let i = 0; i < entries.length; i++) {
        const isLast = i === entries.length - 1;
        const entry = entries[i];
        attempts.push({
          attempt: entry.attempt + 1, // callLog is 0-indexed; RunFlow is 1-indexed
          output: isLast ? (nr?.output ?? {}) : {},
          cost_usd: perAttemptCost,
          duration_ms: perAttemptDuration,
          ...(entry.feedback !== undefined ? { feedback: entry.feedback } : {}),
        });
      }
    } else if (nr) {
      // Non-methodology node (script/context-load/semantic/strategy) —
      // synthesize a single attempt from the NodeResult.
      attempts.push({
        attempt: 1,
        output: nr.output,
        cost_usd: nr.cost_usd,
        duration_ms: nr.duration_ms,
      });
    } else {
      // Node never ran (skipped / suspended before reaching it) — emit a
      // zero-cost placeholder attempt so the renderer has something to show.
      attempts.push({
        attempt: 1,
        output: {},
        cost_usd: 0,
        duration_ms: 0,
      });
    }

    return {
      id: node.id,
      type: node.type,
      status,
      attempts,
      artifactsProduced: [...node.outputs],
      artifactsConsumed: [...node.inputs],
    };
  });

  // ── Gates ────────────────────────────────────────────────────
  //
  // The per-node final gate_results are mirrored at both the node level and
  // the top-level result.gate_results. Collect unique gates (by gate_id),
  // preferring the top-level entry which includes strategy-level gates.
  const gateMap = new Map<string, DagGateResult>();
  for (const gr of result.gate_results) {
    gateMap.set(gr.gate_id, gr);
  }
  // Also catch any node-level gates not present at top-level (defensive).
  for (const nr of Object.values(result.node_results)) {
    for (const gr of nr.gate_results) {
      if (!gateMap.has(gr.gate_id)) {
        gateMap.set(gr.gate_id, gr);
      }
    }
  }

  // Build a node-id → node lookup for expression/retry lookups.
  const nodeById = new Map(dag.nodes.map((n) => [n.id, n]));
  // Build a node-id → latest retry-feedback lookup from the callLog. The
  // latest entry with a feedback string is the most recent retry that was
  // injected into the node; it mirrors what the renderer wants to show as
  // "why did this gate need a retry?".
  const latestFeedbackByNode = new Map<string, string>();
  for (const entry of callLog) {
    if (entry.feedback !== undefined) {
      latestFeedbackByNode.set(entry.nodeId, entry.feedback);
    }
  }

  const gates: RunFlow['gates'] = [];
  for (const gr of gateMap.values()) {
    // Strategy-level gates: `strategy:${sg.id}`
    if (gr.gate_id.startsWith('strategy:')) {
      const sgId = gr.gate_id.slice('strategy:'.length);
      const sg = dag.strategy_gates.find((s) => s.id === sgId);
      gates.push({
        id: gr.gate_id,
        afterNode: sg && sg.depends_on.length > 0 ? sg.depends_on[sg.depends_on.length - 1] : '',
        type: 'strategy-level',
        ...(sg ? { expression: sg.gate.check } : {}),
        passed: gr.passed,
        evaluationDetail: gr.reason,
      });
      continue;
    }

    // Node-level gates: `${nodeId}:gate[${index}]`
    const nodeId = extractNodeIdFromGateId(gr.gate_id) ?? '';
    const node = nodeId ? nodeById.get(nodeId) : undefined;
    const gateIndexMatch = gr.gate_id.match(/:gate\[(\d+)\]$/);
    const gateIdx = gateIndexMatch ? parseInt(gateIndexMatch[1], 10) : -1;
    const gateConfig =
      node && gateIdx >= 0 && gateIdx < node.gates.length
        ? node.gates[gateIdx]
        : undefined;

    // Retry feedback: set when the underlying node had retries > 0 (a retry
    // was triggered), even if the final gate result itself passed.
    const nodeResult = nodeId ? result.node_results[nodeId] : undefined;
    const hadRetries = (nodeResult?.retries ?? 0) > 0;
    const retryFeedback = hadRetries
      ? latestFeedbackByNode.get(nodeId) ?? nodeResult?.gate_results.find((g) => !g.passed)?.feedback
      : undefined;

    gates.push({
      id: gr.gate_id,
      afterNode: nodeId,
      type: mapGateType(gr.type),
      ...(gateConfig ? { expression: gateConfig.check } : {}),
      passed: gr.passed,
      evaluationDetail: gr.reason,
      ...(retryFeedback !== undefined ? { retryFeedback } : {}),
    });
  }

  // ── Edges ────────────────────────────────────────────────────
  //
  // Derive edges from `depends_on`. When the consumer node's `inputs`
  // intersect the producer node's `outputs`, attach the artifact name to
  // the edge (first overlap wins — the UI just needs a label).
  const edges: RunFlow['edges'] = [];
  for (const node of dag.nodes) {
    for (const depId of node.depends_on) {
      const dep = nodeById.get(depId);
      let artifact: string | undefined;
      if (dep) {
        const overlap = node.inputs.find((inp) => dep.outputs.includes(inp));
        if (overlap !== undefined) artifact = overlap;
      }
      edges.push({
        from: depId,
        to: node.id,
        ...(artifact !== undefined ? { artifact } : {}),
      });
    }
  }

  // ── Oversight events ────────────────────────────────────────
  //
  // Methodts captures the per-rule trigger but not which node finished most
  // recently. Reconstruct afterNode by scanning the event's node_statuses
  // snapshot in DAG-topological order and picking the last node that was
  // already `completed` at event time.
  const oversightEvents: RunFlow['oversightEvents'] = result.oversight_events.map(
    (event) => {
      const statuses = (event.context.node_statuses ?? {}) as Record<
        string,
        NodeStatus
      >;
      let afterNode = '';
      for (const node of dag.nodes) {
        if (statuses[node.id] === 'completed') {
          afterNode = node.id;
        }
      }
      if (afterNode === '' && dag.nodes.length > 0) {
        afterNode = dag.nodes[0].id;
      }
      return {
        type: mapOversightAction(event.rule.action),
        trigger: event.rule.condition,
        afterNode,
      };
    },
  );

  return {
    nodes,
    gates,
    edges,
    oversightEvents,
  };
}
