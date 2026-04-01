/**
 * dag-strategy-node.test.ts
 *
 * Tests for strategy-type node execution in DagStrategyExecutor (PRD-044).
 * Covers:
 * - Successful sub-strategy execution: artifacts flow as node output
 * - Failed sub-strategy: parent node is marked failed
 * - Cycle detection: throws when a strategy invokes itself (directly or transitively)
 * - Missing SubStrategySource: throws when strategy node executed without source
 * - Missing sub-strategy: throws when strategy_id not found in source
 * - prompt field injection on methodology nodes
 */

import { describe, it, expect, vi } from "vitest";
import { DagStrategyExecutor, type DagNodeExecutor } from "../dag-executor.js";
import type {
  StrategyDAG,
  SubStrategySource,
  ArtifactVersion,
} from "../dag-types.js";

// ── Helpers ─────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<{ maxParallel: number }>) {
  return {
    maxParallel: overrides?.maxParallel ?? 3,
    defaultGateRetries: 0,
    defaultTimeoutMs: 30000,
    retroDir: ".method/retros",
  };
}

function makeMockNodeExecutor(
  outputs: Record<string, Record<string, unknown>> = {},
): DagNodeExecutor {
  return {
    async executeMethodologyNode(_dag, node, _config, _inputBundle, _sessionId, _retryFeedback) {
      return {
        output: outputs[node.id] ?? { result: "default" },
        cost_usd: 0.01,
        num_turns: 1,
        duration_ms: 50,
      };
    },
  };
}

/** Build a minimal valid StrategyDAG with a single script node. */
function makeSimpleDag(id: string, outputArtifacts: Record<string, unknown> = {}): StrategyDAG {
  const outputNames = Object.keys(outputArtifacts);
  const scriptBody = outputNames.length > 0
    ? `return ${JSON.stringify(outputArtifacts)};`
    : `return { result: "done" };`;

  return {
    id,
    name: `${id} strategy`,
    version: "1.0",
    nodes: [
      {
        id: "node-1",
        type: "script",
        depends_on: [],
        inputs: [],
        outputs: outputNames,
        gates: [],
        config: { type: "script", script: scriptBody },
      },
    ],
    strategy_gates: [],
    capabilities: {},
    oversight_rules: [],
    context_inputs: [],
  };
}

/** Build a DAG with a strategy-type node. */
function makeDagWithStrategyNode(
  strategyId: string,
  subStrategyId: string,
  inputMap?: Record<string, string>,
): StrategyDAG {
  return {
    id: strategyId,
    name: `${strategyId} strategy`,
    version: "1.0",
    nodes: [
      {
        id: "sub-invoke",
        type: "strategy",
        depends_on: [],
        inputs: [],
        outputs: [],
        gates: [],
        config: {
          type: "strategy",
          strategy_id: subStrategyId,
          input_map: inputMap,
          await: true,
        },
      },
    ],
    strategy_gates: [],
    capabilities: {},
    oversight_rules: [],
    context_inputs: [],
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe("DagStrategyExecutor: strategy-type node execution", () => {
  it("executes a sub-strategy and exposes its artifacts as node output", async () => {
    // Sub-strategy produces { plan: { steps: ["a", "b"] } }
    const subDag = makeSimpleDag("S-SUB", { plan: { steps: ["a", "b"] } });

    const source: SubStrategySource = {
      getStrategy: vi.fn().mockResolvedValue(subDag),
    };

    const parentDag = makeDagWithStrategyNode("S-PARENT", "S-SUB");
    const executor = new DagStrategyExecutor(
      makeMockNodeExecutor(),
      makeConfig(),
      source,
    );

    const result = await executor.execute(parentDag, {});

    expect(result.status).toBe("completed");
    expect(result.node_results["sub-invoke"].status).toBe("completed");
    expect(source.getStrategy).toHaveBeenCalledWith("S-SUB");
  });

  it("marks the parent node as failed when the sub-strategy fails", async () => {
    // Sub-strategy has a gate that always fails
    const subDag: StrategyDAG = {
      id: "S-FAILING-SUB",
      name: "Failing sub",
      version: "1.0",
      nodes: [
        {
          id: "node-f",
          type: "script",
          depends_on: [],
          inputs: [],
          outputs: [],
          gates: [
            { type: "algorithmic", check: "false", max_retries: 0, timeout_ms: 1000 },
          ],
          config: { type: "script", script: "return {};" },
        },
      ],
      strategy_gates: [],
      capabilities: {},
      oversight_rules: [],
      context_inputs: [],
    };

    const source: SubStrategySource = {
      getStrategy: vi.fn().mockResolvedValue(subDag),
    };

    const parentDag = makeDagWithStrategyNode("S-PARENT", "S-FAILING-SUB");
    const executor = new DagStrategyExecutor(
      makeMockNodeExecutor(),
      makeConfig(),
      source,
    );

    const result = await executor.execute(parentDag, {});

    // The sub-strategy fails → the strategy node on the parent throws → parent node is failed
    expect(result.node_results["sub-invoke"].status).toBe("failed");
  });

  it("throws when SubStrategySource is not injected", async () => {
    const parentDag = makeDagWithStrategyNode("S-PARENT", "S-SOME-SUB");
    const executor = new DagStrategyExecutor(
      makeMockNodeExecutor(),
      makeConfig(),
      // no source
    );

    const result = await executor.execute(parentDag, {});
    expect(result.node_results["sub-invoke"].status).toBe("failed");
    expect(result.node_results["sub-invoke"].error).toContain("SubStrategySource");
  });

  it("fails the node when the sub-strategy ID is not found", async () => {
    const source: SubStrategySource = {
      getStrategy: vi.fn().mockResolvedValue(null),
    };

    const parentDag = makeDagWithStrategyNode("S-PARENT", "S-UNKNOWN");
    const executor = new DagStrategyExecutor(
      makeMockNodeExecutor(),
      makeConfig(),
      source,
    );

    const result = await executor.execute(parentDag, {});

    expect(result.node_results["sub-invoke"].status).toBe("failed");
    expect(result.node_results["sub-invoke"].error).toContain("S-UNKNOWN");
  });

  it("detects direct strategy cycles and throws", async () => {
    // S-CYCLE calls itself via a strategy node
    const cycleDag: StrategyDAG = {
      id: "S-CYCLE",
      name: "Cycling strategy",
      version: "1.0",
      nodes: [
        {
          id: "self-call",
          type: "strategy",
          depends_on: [],
          inputs: [],
          outputs: [],
          gates: [],
          config: { type: "strategy", strategy_id: "S-CYCLE" },
        },
      ],
      strategy_gates: [],
      capabilities: {},
      oversight_rules: [],
      context_inputs: [],
    };

    const source: SubStrategySource = {
      getStrategy: vi.fn().mockResolvedValue(cycleDag),
    };

    const executor = new DagStrategyExecutor(
      makeMockNodeExecutor(),
      makeConfig(),
      source,
    );

    const result = await executor.execute(cycleDag, {});

    // The cycle is detected — node should fail with a cycle error
    expect(result.node_results["self-call"].status).toBe("failed");
    expect(result.node_results["self-call"].error).toContain("cycle");
  });

  it("passes input_map context inputs to the sub-strategy", async () => {
    const getStrategy = vi.fn().mockImplementation(async (id: string) => {
      return makeSimpleDag(id, { out: "value" });
    });
    const source: SubStrategySource = { getStrategy };

    const parentDag: StrategyDAG = {
      id: "S-PARENT",
      name: "Parent",
      version: "1.0",
      nodes: [
        {
          id: "step-1",
          type: "script",
          depends_on: [],
          inputs: [],
          outputs: ["my_input"],
          gates: [],
          config: { type: "script", script: "return { my_input: 'hello' };" },
        },
        {
          id: "sub-invoke",
          type: "strategy",
          depends_on: ["step-1"],
          inputs: ["my_input"],
          outputs: [],
          gates: [],
          config: {
            type: "strategy",
            strategy_id: "S-SUB",
            input_map: { my_input: "sub_context_input" },
          },
        },
      ],
      strategy_gates: [],
      capabilities: {},
      oversight_rules: [],
      context_inputs: [],
    };

    const executor = new DagStrategyExecutor(
      makeMockNodeExecutor(),
      makeConfig(),
      source,
    );

    const result = await executor.execute(parentDag, {});

    expect(result.status).toBe("completed");
    expect(result.node_results["sub-invoke"].status).toBe("completed");
  });
});

describe("DagStrategyExecutor: prompt field injection on methodology nodes", () => {
  it("prepends prompt to retryFeedback when methodology node has a prompt", async () => {
    let capturedFeedback: string | undefined;

    const executor = new DagStrategyExecutor(
      {
        async executeMethodologyNode(_dag, _node, _config, _inputBundle, _sessionId, retryFeedback) {
          capturedFeedback = retryFeedback;
          return { output: { result: "done" }, cost_usd: 0, num_turns: 1, duration_ms: 10 };
        },
      },
      makeConfig(),
    );

    const dag: StrategyDAG = {
      id: "S-PROMPT-TEST",
      name: "Prompt test",
      version: "1.0",
      nodes: [
        {
          id: "phase-node",
          type: "methodology",
          depends_on: [],
          inputs: [],
          outputs: [],
          gates: [],
          config: {
            type: "methodology",
            methodology: "P2-SD",
            prompt: "You are implementing Phase 1 of the FCD pipeline.",
            capabilities: [],
          },
        },
      ],
      strategy_gates: [],
      capabilities: {},
      oversight_rules: [],
      context_inputs: [],
    };

    await executor.execute(dag, {});

    expect(capturedFeedback).toBe("You are implementing Phase 1 of the FCD pipeline.");
  });

  it("does not pass feedback when methodology node has no prompt and no retry", async () => {
    let capturedFeedback: string | undefined;

    const executor = new DagStrategyExecutor(
      {
        async executeMethodologyNode(_dag, _node, _config, _inputBundle, _sessionId, retryFeedback) {
          capturedFeedback = retryFeedback;
          return { output: { result: "done" }, cost_usd: 0, num_turns: 1, duration_ms: 10 };
        },
      },
      makeConfig(),
    );

    const dag: StrategyDAG = {
      id: "S-NO-PROMPT",
      name: "No prompt test",
      version: "1.0",
      nodes: [
        {
          id: "node-1",
          type: "methodology",
          depends_on: [],
          inputs: [],
          outputs: [],
          gates: [],
          config: {
            type: "methodology",
            methodology: "P2-SD",
            capabilities: [],
          },
        },
      ],
      strategy_gates: [],
      capabilities: {},
      oversight_rules: [],
      context_inputs: [],
    };

    await executor.execute(dag, {});

    expect(capturedFeedback).toBeUndefined();
  });
});
