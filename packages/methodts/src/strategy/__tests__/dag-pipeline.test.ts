// SPDX-License-Identifier: Apache-2.0
/**
 * WS-2: Strategy DAG Pipeline Tests
 *
 * Tests the unified strategy DAG modules using real YAML fixtures (DR-09).
 * Covers: parsing, validation, topological sort, gate evaluation, artifact
 * store, retro generation, StdlibStrategySource, and DagStrategyExecutor.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

import { parseStrategyYaml, validateStrategyDAG, topologicalSort } from "../dag-parser.js";
import { evaluateGateExpression, evaluateGate, buildRetryFeedback } from "../dag-gates.js";
import { InMemoryArtifactStore, createArtifactStore } from "../dag-artifact-store.js";
import { generateRetro, computeCriticalPath, retroToYaml } from "../dag-retro.js";
import { DagStrategyExecutor, type DagNodeExecutor } from "../dag-executor.js";
import { StdlibStrategySource } from "../stdlib-strategy-source.js";
import type {
  StrategyDAG,
  DagGateConfig,
  DagGateContext,
  StrategyNode,
  MethodologyNodeConfig,
  StrategyExecutionResult,
  NodeResult,
} from "../dag-types.js";

// ── Load real YAML fixtures (DR-09) ────────────────────────────

const FIXTURES_DIR = join(__dirname, "../../../../../.method/strategies");

function loadFixture(filename: string): string {
  return readFileSync(join(FIXTURES_DIR, filename), "utf-8");
}

// ── Parser Tests ────────────────────────────────────────────────

describe("dag-parser: parseStrategyYaml", () => {
  it("parses smoke-test.yaml into a valid StrategyDAG", () => {
    const dag = parseStrategyYaml(loadFixture("smoke-test.yaml"));

    expect(dag.id).toBe("S-SMOKE-001");
    expect(dag.name).toBe("AG-045 Smoke Test");
    expect(dag.version).toBe("1.0");
    expect(dag.nodes).toHaveLength(2);
    expect(dag.strategy_gates).toHaveLength(1);
    expect(dag.oversight_rules).toHaveLength(2);
    expect(dag.context_inputs).toHaveLength(1);
  });

  it("parses strategy-designer.yaml into a valid StrategyDAG", () => {
    const dag = parseStrategyYaml(loadFixture("strategy-designer.yaml"));

    expect(dag.id).toBe("S-STRATEGY-DESIGNER");
    expect(dag.nodes).toHaveLength(4);
    expect(dag.strategy_gates).toHaveLength(1);
  });

  it("parses core-test-watch.yaml into a valid StrategyDAG", () => {
    const dag = parseStrategyYaml(loadFixture("core-test-watch.yaml"));

    expect(dag.id).toBe("S-CORE-TEST-WATCH");
    expect(dag.nodes).toHaveLength(2);
    expect(dag.oversight_rules).toHaveLength(2);
  });

  it("parses perf-test-file-watch.yaml into a valid StrategyDAG", () => {
    const dag = parseStrategyYaml(loadFixture("perf-test-file-watch.yaml"));

    expect(dag.id).toBe("S-PERF-FILE-WATCH");
    expect(dag.nodes).toHaveLength(1);
    expect(dag.nodes[0].type).toBe("script");
  });

  it("preserves methodology node config", () => {
    const dag = parseStrategyYaml(loadFixture("smoke-test.yaml"));
    const summarizeNode = dag.nodes.find((n) => n.id === "summarize")!;

    expect(summarizeNode.config.type).toBe("methodology");
    const config = summarizeNode.config as MethodologyNodeConfig;
    expect(config.methodology).toBe("P2-SD");
    expect(config.method_hint).toBe("M3-TMP");
    expect(config.capabilities).toEqual(["read_only"]);
  });

  it("preserves script node config", () => {
    const dag = parseStrategyYaml(loadFixture("smoke-test.yaml"));
    const extractNode = dag.nodes.find((n) => n.id === "extract")!;

    expect(extractNode.config.type).toBe("script");
    expect(extractNode.type).toBe("script");
  });

  it("applies gate defaults when not specified", () => {
    const dag = parseStrategyYaml(loadFixture("smoke-test.yaml"));
    const summarizeNode = dag.nodes.find((n) => n.id === "summarize")!;

    expect(summarizeNode.gates).toHaveLength(1);
    expect(summarizeNode.gates[0].max_retries).toBe(1); // explicitly set in yaml
    expect(summarizeNode.gates[0].timeout_ms).toBe(5000); // default
  });

  it("parses depends_on correctly", () => {
    const dag = parseStrategyYaml(loadFixture("smoke-test.yaml"));
    const extractNode = dag.nodes.find((n) => n.id === "extract")!;

    expect(extractNode.depends_on).toEqual(["summarize"]);
  });

  it("parses capabilities map", () => {
    const dag = parseStrategyYaml(loadFixture("smoke-test.yaml"));

    expect(dag.capabilities).toHaveProperty("read_only");
    expect(dag.capabilities["read_only"]).toEqual(["Read", "Glob", "Grep"]);
  });

  it("parses context inputs with defaults", () => {
    const dag = parseStrategyYaml(loadFixture("smoke-test.yaml"));

    expect(dag.context_inputs).toHaveLength(1);
    expect(dag.context_inputs[0].name).toBe("project_name");
    expect(dag.context_inputs[0].type).toBe("string");
    expect(dag.context_inputs[0].default).toBe("pv-method");
  });
});

// ── Validation Tests ────────────────────────────────────────────

describe("dag-parser: validateStrategyDAG", () => {
  it("validates all real fixtures as valid", () => {
    const files = [
      "smoke-test.yaml",
      "strategy-designer.yaml",
      "core-test-watch.yaml",
      "perf-test-file-watch.yaml",
    ];

    for (const file of files) {
      const dag = parseStrategyYaml(loadFixture(file));
      const result = validateStrategyDAG(dag);
      expect(result.valid, `${file} should be valid but got errors: ${result.errors.join(", ")}`).toBe(true);
    }
  });

  it("detects duplicate node IDs", () => {
    const dag: StrategyDAG = {
      id: "test",
      name: "test",
      version: "1.0",
      nodes: [
        { id: "a", type: "script", depends_on: [], inputs: [], outputs: [], gates: [], config: { type: "script", script: "return {};" } },
        { id: "a", type: "script", depends_on: [], inputs: [], outputs: [], gates: [], config: { type: "script", script: "return {};" } },
      ],
      strategy_gates: [],
      capabilities: {},
      oversight_rules: [],
      context_inputs: [],
    };

    const result = validateStrategyDAG(dag);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Duplicate node ID"))).toBe(true);
  });

  it("detects unknown dependency references", () => {
    const dag: StrategyDAG = {
      id: "test",
      name: "test",
      version: "1.0",
      nodes: [
        { id: "a", type: "script", depends_on: ["nonexistent"], inputs: [], outputs: [], gates: [], config: { type: "script", script: "return {};" } },
      ],
      strategy_gates: [],
      capabilities: {},
      oversight_rules: [],
      context_inputs: [],
    };

    const result = validateStrategyDAG(dag);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("unknown node"))).toBe(true);
  });

  it("detects cycles", () => {
    const dag: StrategyDAG = {
      id: "test",
      name: "test",
      version: "1.0",
      nodes: [
        { id: "a", type: "script", depends_on: ["b"], inputs: [], outputs: [], gates: [], config: { type: "script", script: "return {};" } },
        { id: "b", type: "script", depends_on: ["a"], inputs: [], outputs: [], gates: [], config: { type: "script", script: "return {};" } },
      ],
      strategy_gates: [],
      capabilities: {},
      oversight_rules: [],
      context_inputs: [],
    };

    const result = validateStrategyDAG(dag);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Cyclic dependency"))).toBe(true);
  });

  it("detects invalid gate expressions", () => {
    const dag: StrategyDAG = {
      id: "test",
      name: "test",
      version: "1.0",
      nodes: [
        {
          id: "a",
          type: "script",
          depends_on: [],
          inputs: [],
          outputs: [],
          gates: [{ type: "algorithmic", check: "invalid(((", max_retries: 0, timeout_ms: 5000 }],
          config: { type: "script", script: "return {};" },
        },
      ],
      strategy_gates: [],
      capabilities: {},
      oversight_rules: [],
      context_inputs: [],
    };

    const result = validateStrategyDAG(dag);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("invalid check expression"))).toBe(true);
  });
});

// ── Topological Sort Tests ──────────────────────────────────────

describe("dag-parser: topologicalSort", () => {
  it("sorts smoke-test DAG into correct levels", () => {
    const dag = parseStrategyYaml(loadFixture("smoke-test.yaml"));
    const levels = topologicalSort(dag);

    expect(levels).toHaveLength(2);
    expect(levels[0]).toEqual(["summarize"]);
    expect(levels[1]).toEqual(["extract"]);
  });

  it("sorts strategy-designer DAG into correct levels", () => {
    const dag = parseStrategyYaml(loadFixture("strategy-designer.yaml"));
    const levels = topologicalSort(dag);

    // analyze -> design -> validate -> install
    expect(levels).toHaveLength(4);
    expect(levels[0]).toEqual(["analyze"]);
    expect(levels[1]).toEqual(["design"]);
    expect(levels[2]).toEqual(["validate"]);
    expect(levels[3]).toEqual(["install"]);
  });

  it("groups parallel-able nodes into same level", () => {
    const dag: StrategyDAG = {
      id: "test",
      name: "test",
      version: "1.0",
      nodes: [
        { id: "a", type: "script", depends_on: [], inputs: [], outputs: [], gates: [], config: { type: "script", script: "return {};" } },
        { id: "b", type: "script", depends_on: [], inputs: [], outputs: [], gates: [], config: { type: "script", script: "return {};" } },
        { id: "c", type: "script", depends_on: ["a", "b"], inputs: [], outputs: [], gates: [], config: { type: "script", script: "return {};" } },
      ],
      strategy_gates: [],
      capabilities: {},
      oversight_rules: [],
      context_inputs: [],
    };

    const levels = topologicalSort(dag);
    expect(levels).toHaveLength(2);
    expect(levels[0].sort()).toEqual(["a", "b"]);
    expect(levels[1]).toEqual(["c"]);
  });
});

// ── Gate Evaluation Tests ───────────────────────────────────────

describe("dag-gates: evaluateGateExpression", () => {
  it("passes on simple truthy expression", async () => {
    const ctx: DagGateContext = {
      output: { tests_passed: true },
      artifacts: {},
      execution_metadata: { num_turns: 1, cost_usd: 0.1, tool_call_count: 0, duration_ms: 100 },
    };

    const result = await evaluateGateExpression("output.tests_passed === true", ctx);
    expect(result.passed).toBe(true);
  });

  it("fails on falsy expression", async () => {
    const ctx: DagGateContext = {
      output: { tests_passed: false },
      artifacts: {},
      execution_metadata: { num_turns: 1, cost_usd: 0.1, tool_call_count: 0, duration_ms: 100 },
    };

    const result = await evaluateGateExpression("output.tests_passed === true", ctx);
    expect(result.passed).toBe(false);
  });

  it("evaluates artifact expressions from real fixtures", async () => {
    const ctx: DagGateContext = {
      output: {},
      artifacts: { report: { smoke_test: "PASSED" } },
      execution_metadata: { num_turns: 0, cost_usd: 0, tool_call_count: 0, duration_ms: 0 },
    };

    // This is the actual gate expression from smoke-test.yaml
    const result = await evaluateGateExpression(
      "artifacts.report && artifacts.report.smoke_test === 'PASSED'",
      ctx,
    );
    expect(result.passed).toBe(true);
  });

  it("handles expression errors gracefully", async () => {
    const ctx: DagGateContext = {
      output: {},
      artifacts: {},
      execution_metadata: { num_turns: 0, cost_usd: 0, tool_call_count: 0, duration_ms: 0 },
    };

    const result = await evaluateGateExpression("undeclaredVariable.foo", ctx);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("Expression error");
  });
});

describe("dag-gates: evaluateGate", () => {
  it("evaluates algorithmic gate", async () => {
    const gate: DagGateConfig = {
      type: "algorithmic",
      check: "output.result !== undefined",
      max_retries: 0,
      timeout_ms: 5000,
    };

    const ctx: DagGateContext = {
      output: { result: "hello" },
      artifacts: {},
      execution_metadata: { num_turns: 1, cost_usd: 0.1, tool_call_count: 0, duration_ms: 100 },
    };

    const result = await evaluateGate(gate, "test:gate[0]", ctx);
    expect(result.passed).toBe(true);
    expect(result.gate_id).toBe("test:gate[0]");
    expect(result.type).toBe("algorithmic");
  });

  it("human_approval gate always returns not passed", async () => {
    const gate: DagGateConfig = {
      type: "human_approval",
      check: "true",
      max_retries: 0,
      timeout_ms: 5000,
    };

    const ctx: DagGateContext = {
      output: {},
      artifacts: {},
      execution_metadata: { num_turns: 0, cost_usd: 0, tool_call_count: 0, duration_ms: 0 },
    };

    const result = await evaluateGate(gate, "test:human", ctx);
    expect(result.passed).toBe(false);
    expect(result.type).toBe("human_approval");
  });
});

describe("dag-gates: buildRetryFeedback", () => {
  it("produces retry feedback with correct format", () => {
    const gate: DagGateConfig = {
      type: "algorithmic",
      check: "output.tests_passed === true",
      max_retries: 3,
      timeout_ms: 5000,
    };

    const result = {
      gate_id: "test:gate[0]",
      type: "algorithmic" as const,
      passed: false,
      reason: "Expression evaluated to falsy",
      feedback: "Gate check failed",
    };

    const feedback = buildRetryFeedback(gate, result, 1, 3);
    expect(feedback).toContain("GATE FAILURE");
    expect(feedback).toContain("Retry 1/3");
    expect(feedback).toContain("output.tests_passed === true");
  });
});

// ── Artifact Store Tests ────────────────────────────────────────

describe("dag-artifact-store: InMemoryArtifactStore", () => {
  it("creates versioned artifacts", () => {
    const store = createArtifactStore();

    const v1 = store.put("plan", { steps: ["a"] }, "node-1");
    expect(v1.version).toBe(1);
    expect(v1.artifact_id).toBe("plan");
    expect(v1.producer_node_id).toBe("node-1");

    const v2 = store.put("plan", { steps: ["a", "b"] }, "node-2");
    expect(v2.version).toBe(2);
  });

  it("get returns latest version", () => {
    const store = createArtifactStore();
    store.put("plan", "v1", "node-1");
    store.put("plan", "v2", "node-2");

    const latest = store.get("plan");
    expect(latest).not.toBeNull();
    expect(latest!.content).toBe("v2");
    expect(latest!.version).toBe(2);
  });

  it("getVersion returns specific version", () => {
    const store = createArtifactStore();
    store.put("plan", "v1", "node-1");
    store.put("plan", "v2", "node-2");

    const v1 = store.getVersion("plan", 1);
    expect(v1).not.toBeNull();
    expect(v1!.content).toBe("v1");
  });

  it("snapshot returns frozen bundle of latest versions", () => {
    const store = createArtifactStore();
    store.put("plan", "v1", "node-1");
    store.put("plan", "v2", "node-2");
    store.put("code", "impl", "node-3");

    const snapshot = store.snapshot();
    expect(Object.keys(snapshot).sort()).toEqual(["code", "plan"]);
    expect(snapshot["plan"].content).toBe("v2");
    expect(snapshot["code"].content).toBe("impl");
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("history returns all versions in order", () => {
    const store = createArtifactStore();
    store.put("plan", "v1", "node-1");
    store.put("plan", "v2", "node-2");

    const history = store.history("plan");
    expect(history).toHaveLength(2);
    expect(history[0].content).toBe("v1");
    expect(history[1].content).toBe("v2");
  });

  it("get returns null for non-existent artifact", () => {
    const store = createArtifactStore();
    expect(store.get("nonexistent")).toBeNull();
  });
});

// ── StdlibStrategySource Tests ──────────────────────────────────

describe("StdlibStrategySource", () => {
  it("add and load round-trips a DAG", async () => {
    const source = new StdlibStrategySource();
    const dag = parseStrategyYaml(loadFixture("smoke-test.yaml"));

    source.add(dag);

    const loaded = await source.load("S-SMOKE-001");
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe("S-SMOKE-001");
    expect(loaded!.name).toBe("AG-045 Smoke Test");
  });

  it("addFromYaml parses and registers", async () => {
    const source = new StdlibStrategySource();
    const dag = source.addFromYaml(loadFixture("smoke-test.yaml"));

    expect(dag.id).toBe("S-SMOKE-001");

    const loaded = await source.load("S-SMOKE-001");
    expect(loaded).not.toBeNull();
  });

  it("list returns all registered strategies", async () => {
    const source = new StdlibStrategySource();
    source.addFromYaml(loadFixture("smoke-test.yaml"));
    source.addFromYaml(loadFixture("strategy-designer.yaml"));

    const list = await source.list();
    expect(list).toHaveLength(2);
    expect(list.map((s) => s.id).sort()).toEqual(["S-SMOKE-001", "S-STRATEGY-DESIGNER"]);
  });

  it("load returns null for unknown ID", async () => {
    const source = new StdlibStrategySource();
    const loaded = await source.load("NONEXISTENT");
    expect(loaded).toBeNull();
  });

  it("parse delegates to parseStrategyYaml", () => {
    const source = new StdlibStrategySource();
    const dag = source.parse(loadFixture("smoke-test.yaml"));
    expect(dag.id).toBe("S-SMOKE-001");
  });

  it("validate delegates to validateStrategyDAG", () => {
    const source = new StdlibStrategySource();
    const dag = source.parse(loadFixture("smoke-test.yaml"));
    const result = source.validate(dag);
    expect(result.valid).toBe(true);
  });

  it("is substitutable — test source with mock strategy", async () => {
    const source = new StdlibStrategySource();
    source.add({
      id: "S-MOCK",
      name: "Mock Strategy",
      version: "1.0",
      nodes: [
        {
          id: "mock-node",
          type: "script",
          depends_on: [],
          inputs: [],
          outputs: ["result"],
          gates: [],
          config: { type: "script", script: "return { mock: true };" },
        },
      ],
      strategy_gates: [],
      capabilities: {},
      oversight_rules: [],
      context_inputs: [],
    });

    const loaded = await source.load("S-MOCK");
    expect(loaded).not.toBeNull();
    expect(loaded!.nodes[0].id).toBe("mock-node");
  });

  it("remove removes a strategy", async () => {
    const source = new StdlibStrategySource();
    source.addFromYaml(loadFixture("smoke-test.yaml"));

    expect(source.remove("S-SMOKE-001")).toBe(true);
    expect(await source.load("S-SMOKE-001")).toBeNull();
    expect(source.remove("S-SMOKE-001")).toBe(false);
  });

  it("clear removes all strategies", async () => {
    const source = new StdlibStrategySource();
    source.addFromYaml(loadFixture("smoke-test.yaml"));
    source.addFromYaml(loadFixture("strategy-designer.yaml"));

    source.clear();
    const list = await source.list();
    expect(list).toHaveLength(0);
  });
});

// ── DagStrategyExecutor Tests ───────────────────────────────────

describe("DagStrategyExecutor", () => {
  /** Mock DagNodeExecutor that returns configurable outputs. */
  function makeMockNodeExecutor(
    outputs: Record<string, Record<string, unknown>>,
  ): DagNodeExecutor {
    return {
      async executeMethodologyNode(dag, node, config, inputBundle, sessionId, retryFeedback) {
        const output = outputs[node.id] ?? { result: "default" };
        return {
          output,
          cost_usd: 0.05,
          num_turns: 1,
          duration_ms: 100,
        };
      },
    };
  }

  it("executes a script-only DAG without node executor", async () => {
    const dag = parseStrategyYaml(loadFixture("perf-test-file-watch.yaml"));

    // Even though we provide a mock, script nodes don't use the executor
    const executor = new DagStrategyExecutor(
      makeMockNodeExecutor({}),
      { maxParallel: 3, defaultGateRetries: 3, defaultTimeoutMs: 600000, retroDir: ".method/retros" },
    );

    const result = await executor.execute(dag, {
      trigger_event: { changed_files: ["a.txt", "b.txt"], debounced_count: 2 },
    });

    expect(result.status).toBe("completed");
    expect(result.node_results["count_files"]).toBeDefined();
    expect(result.node_results["count_files"].status).toBe("completed");
    expect((result.node_results["count_files"].output as any).file_count).toBe(2);
  });

  it("executes a mixed DAG with methodology + script nodes", async () => {
    const dag = parseStrategyYaml(loadFixture("smoke-test.yaml"));

    const executor = new DagStrategyExecutor(
      makeMockNodeExecutor({
        summarize: { result: "This is a summary of the project that has enough characters" },
      }),
      { maxParallel: 3, defaultGateRetries: 3, defaultTimeoutMs: 600000, retroDir: ".method/retros" },
    );

    const result = await executor.execute(dag, { project_name: "pv-method" });

    expect(result.status).toBe("completed");
    expect(result.node_results["summarize"].status).toBe("completed");
    expect(result.node_results["extract"].status).toBe("completed");
    // Check the script node output
    expect((result.node_results["extract"].output as any).smoke_test).toBe("PASSED");
  });

  it("provides execution state snapshot during execution", async () => {
    const dag = parseStrategyYaml(loadFixture("perf-test-file-watch.yaml"));

    const executor = new DagStrategyExecutor(
      makeMockNodeExecutor({}),
      { maxParallel: 3, defaultGateRetries: 3, defaultTimeoutMs: 600000, retroDir: ".method/retros" },
    );

    // Before execution, state is null
    expect(executor.getState()).toBeNull();

    await executor.execute(dag, { trigger_event: {} });

    // After execution, state should be available
    const state = executor.getState();
    expect(state).not.toBeNull();
    expect(state!.strategy_id).toBe("S-PERF-FILE-WATCH");
  });
});

// ── Retro Generator Tests ───────────────────────────────────────

describe("dag-retro: generateRetro", () => {
  it("generates a retro from a completed execution", () => {
    const dag = parseStrategyYaml(loadFixture("smoke-test.yaml"));

    const result: StrategyExecutionResult = {
      strategy_id: "S-SMOKE-001",
      status: "completed",
      node_results: {
        summarize: {
          node_id: "summarize",
          status: "completed",
          output: { result: "summary" },
          cost_usd: 0.05,
          duration_ms: 1000,
          num_turns: 1,
          gate_results: [],
          retries: 0,
        },
        extract: {
          node_id: "extract",
          status: "completed",
          output: { smoke_test: "PASSED" },
          cost_usd: 0,
          duration_ms: 5,
          num_turns: 0,
          gate_results: [],
          retries: 0,
        },
      },
      artifacts: {
        summary: {
          artifact_id: "summary",
          version: 1,
          content: "summary",
          producer_node_id: "summarize",
          timestamp: "2026-01-01T00:00:00Z",
        },
        report: {
          artifact_id: "report",
          version: 1,
          content: { smoke_test: "PASSED" },
          producer_node_id: "extract",
          timestamp: "2026-01-01T00:00:01Z",
        },
      },
      gate_results: [],
      cost_usd: 0.05,
      started_at: "2026-01-01T00:00:00Z",
      completed_at: "2026-01-01T00:00:02Z",
      duration_ms: 2000,
      oversight_events: [],
    };

    const retro = generateRetro(dag, result);

    expect(retro.retro.strategy_id).toBe("S-SMOKE-001");
    expect(retro.retro.generated_by).toBe("strategy-executor");
    expect(retro.retro.execution_summary.nodes_total).toBe(2);
    expect(retro.retro.execution_summary.nodes_completed).toBe(2);
    expect(retro.retro.execution_summary.nodes_failed).toBe(0);
    expect(retro.retro.cost.total_usd).toBe(0.05);
    expect(retro.retro.artifacts_produced).toHaveLength(2);
  });

  it("retroToYaml produces parseable YAML", () => {
    const retro = {
      retro: {
        strategy_id: "S-TEST",
        generated_by: "strategy-executor" as const,
        generated_at: "2026-01-01T00:00:00Z",
        timing: {
          started_at: "2026-01-01T00:00:00Z",
          completed_at: "2026-01-01T00:00:01Z",
          duration_minutes: 0.02,
          critical_path: ["a"],
        },
        execution_summary: { nodes_total: 1, nodes_completed: 1, nodes_failed: 0, speedup_ratio: 1 },
        cost: { total_usd: 0.05, per_node: [{ node: "a", cost_usd: 0.05 }] },
        gates: { total: 0, passed: 0, failed_then_passed: 0, failed_final: 0, retries: [] },
        oversight_events: [],
        artifacts_produced: [],
      },
    };

    const yamlStr = retroToYaml(retro);
    expect(typeof yamlStr).toBe("string");
    expect(yamlStr).toContain("strategy_id");
  });
});

describe("dag-retro: computeCriticalPath", () => {
  it("computes critical path through a linear DAG", () => {
    const dag = parseStrategyYaml(loadFixture("smoke-test.yaml"));

    const nodeResults: Record<string, NodeResult> = {
      summarize: {
        node_id: "summarize",
        status: "completed",
        output: {},
        cost_usd: 0,
        duration_ms: 1000,
        num_turns: 0,
        gate_results: [],
        retries: 0,
      },
      extract: {
        node_id: "extract",
        status: "completed",
        output: {},
        cost_usd: 0,
        duration_ms: 5,
        num_turns: 0,
        gate_results: [],
        retries: 0,
      },
    };

    const path = computeCriticalPath(dag, nodeResults);
    expect(path).toEqual(["summarize", "extract"]);
  });

  it("returns empty for empty DAG", () => {
    const dag: StrategyDAG = {
      id: "empty",
      name: "empty",
      version: "1.0",
      nodes: [],
      strategy_gates: [],
      capabilities: {},
      oversight_rules: [],
      context_inputs: [],
    };

    const path = computeCriticalPath(dag, {});
    expect(path).toEqual([]);
  });
});
