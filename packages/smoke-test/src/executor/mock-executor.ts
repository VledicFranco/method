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
  MethodologyNodeConfig,
  StrategyExecutorConfig,
  SubStrategySource,
  HumanApprovalResolver,
  HumanApprovalDecision,
  StrategyExecutionResult,
  ContextLoadNodeConfig,
} from '@method/methodts/strategy/dag-types.js';
import { readFileSync } from 'node:fs';
import { load as loadYaml } from 'js-yaml';

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

  return {
    result,
    callLog: nodeExecutor.callLog,
    dag,
  };
}
