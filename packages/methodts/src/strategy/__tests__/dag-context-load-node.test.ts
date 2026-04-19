// SPDX-License-Identifier: Apache-2.0
/**
 * dag-context-load-node.test.ts
 *
 * Tests for context-load node execution in DagStrategyExecutor.
 * Validates the ContextLoadExecutor port contract (co-designed 2026-04-09,
 * record: .method/sessions/fcd-surface-context-load-executor/record.md).
 *
 * Covers:
 * - Successful context-load: components stored under output_key
 * - Missing ContextLoadExecutor: node fails with clear error
 * - Missing projectRoot: node fails with clear error
 * - Downstream node receives RetrievedComponent[] via inputs
 * - Underlying executor error propagates and fails the node
 */

import { describe, it, expect, vi } from "vitest";
import {
  DagStrategyExecutor,
  type DagNodeExecutor,
  type ContextLoadExecutor,
  type ContextLoadResult,
  type RetrievedComponent,
} from "../dag-executor.js";
import type { StrategyDAG } from "../dag-types.js";

// ── Helpers ─────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<{ projectRoot: string }>) {
  return {
    maxParallel: 3,
    defaultGateRetries: 0,
    defaultTimeoutMs: 30000,
    retroDir: ".method/retros",
    projectRoot: overrides?.projectRoot,
  };
}

function makeMockNodeExecutor(
  capture?: { inputBundle?: Record<string, unknown> },
): DagNodeExecutor {
  return {
    async executeMethodologyNode(_dag, _node, _config, inputBundle) {
      if (capture) capture.inputBundle = inputBundle;
      return {
        output: { result: "ok" },
        cost_usd: 0.01,
        num_turns: 1,
        duration_ms: 10,
      };
    },
  };
}

function makeComponent(path: string, score: number): RetrievedComponent {
  return {
    path,
    level: "L2",
    docText: `[port]\nexport interface ${path}Port { ... }`,
    coverageScore: 0.8,
    score,
  };
}

function makeDagWithContextLoad(opts: {
  outputKey: string;
  withConsumer?: boolean;
}): StrategyDAG {
  const nodes: StrategyDAG["nodes"] = [
    {
      id: "load-ctx",
      type: "context-load",
      depends_on: [],
      inputs: [],
      outputs: [opts.outputKey],
      gates: [],
      config: {
        type: "context-load",
        query: "strategy executor port",
        topK: 3,
        output_key: opts.outputKey,
      },
    },
  ];

  if (opts.withConsumer) {
    nodes.push({
      id: "consume-ctx",
      type: "methodology",
      depends_on: ["load-ctx"],
      inputs: [opts.outputKey],
      outputs: [],
      gates: [],
      config: {
        type: "methodology",
        methodology: "P2-SD",
        capabilities: [],
      },
    });
  }

  return {
    id: "S-CTX",
    name: "Context load test",
    version: "1.0",
    nodes,
    strategy_gates: [],
    capabilities: {},
    oversight_rules: [],
    context_inputs: [],
  };
}

// ── Tests ───────────────────────────────────────────────────────

describe("DagStrategyExecutor: context-load node execution", () => {
  it("stores retrieved components under output_key in ArtifactStore", async () => {
    const components = [
      makeComponent("packages/bridge/src/domains/strategies", 0.92),
      makeComponent("packages/methodts/src/strategy", 0.88),
    ];
    const mockExecutor: ContextLoadExecutor = {
      executeContextLoad: vi.fn().mockResolvedValue({
        components,
        queryTime: 42,
        mode: "production",
      } satisfies ContextLoadResult),
    };

    const dag = makeDagWithContextLoad({ outputKey: "strategy_ctx" });
    const executor = new DagStrategyExecutor(
      makeMockNodeExecutor(),
      makeConfig({ projectRoot: "/fake/root" }),
      null,
      null,
      mockExecutor,
    );

    const result = await executor.execute(dag, {});

    expect(result.status).toBe("completed");
    expect(result.node_results["load-ctx"].status).toBe("completed");
    expect(result.node_results["load-ctx"].cost_usd).toBe(0);
    expect(result.node_results["load-ctx"].num_turns).toBe(0);

    const stored = result.artifacts["strategy_ctx"];
    expect(stored).toBeDefined();
    expect(stored.content).toEqual(components);
    expect(stored.producer_node_id).toBe("load-ctx");

    expect(mockExecutor.executeContextLoad).toHaveBeenCalledWith(
      expect.objectContaining({ query: "strategy executor port", topK: 3, output_key: "strategy_ctx" }),
      "/fake/root",
    );
  });

  it("passes retrieved components to downstream methodology node via inputs", async () => {
    const components = [makeComponent("packages/x", 0.9)];
    const mockExecutor: ContextLoadExecutor = {
      executeContextLoad: vi.fn().mockResolvedValue({
        components,
        queryTime: 10,
        mode: "production",
      }),
    };
    const capture: { inputBundle?: Record<string, unknown> } = {};

    const dag = makeDagWithContextLoad({
      outputKey: "ctx_components",
      withConsumer: true,
    });
    const executor = new DagStrategyExecutor(
      makeMockNodeExecutor(capture),
      makeConfig({ projectRoot: "/fake/root" }),
      null,
      null,
      mockExecutor,
    );

    const result = await executor.execute(dag, {});

    expect(result.status).toBe("completed");
    expect(capture.inputBundle).toBeDefined();
    expect(capture.inputBundle!["ctx_components"]).toEqual(components);
  });

  it("fails the node with clear error when ContextLoadExecutor is not injected", async () => {
    const dag = makeDagWithContextLoad({ outputKey: "ctx" });
    const executor = new DagStrategyExecutor(
      makeMockNodeExecutor(),
      makeConfig({ projectRoot: "/fake/root" }),
      null,
      null,
      null, // no ContextLoadExecutor
    );

    const result = await executor.execute(dag, {});

    expect(result.node_results["load-ctx"].status).toBe("failed");
    expect(result.node_results["load-ctx"].error).toContain("ContextLoadExecutor");
  });

  it("fails the node when projectRoot is not configured", async () => {
    const mockExecutor: ContextLoadExecutor = {
      executeContextLoad: vi.fn(),
    };
    const dag = makeDagWithContextLoad({ outputKey: "ctx" });
    const executor = new DagStrategyExecutor(
      makeMockNodeExecutor(),
      makeConfig(), // no projectRoot
      null,
      null,
      mockExecutor,
    );

    const result = await executor.execute(dag, {});

    expect(result.node_results["load-ctx"].status).toBe("failed");
    expect(result.node_results["load-ctx"].error).toContain("projectRoot");
    expect(mockExecutor.executeContextLoad).not.toHaveBeenCalled();
  });

  it("propagates ContextLoadError from the executor and fails the node", async () => {
    const mockExecutor: ContextLoadExecutor = {
      executeContextLoad: vi.fn().mockRejectedValue(
        Object.assign(new Error("no index found"), { code: "INDEX_NOT_FOUND" }),
      ),
    };
    const dag = makeDagWithContextLoad({ outputKey: "ctx" });
    const executor = new DagStrategyExecutor(
      makeMockNodeExecutor(),
      makeConfig({ projectRoot: "/fake/root" }),
      null,
      null,
      mockExecutor,
    );

    const result = await executor.execute(dag, {});

    expect(result.node_results["load-ctx"].status).toBe("failed");
    expect(result.node_results["load-ctx"].error).toContain("no index found");
  });
});
