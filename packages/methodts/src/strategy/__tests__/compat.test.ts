// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for strategy/compat.ts — fromStrategyDAG and compileToYaml.
 *
 * Validates the bridge between PRD 017 static strategy DAGs and
 * MethodTS adaptive strategy controllers.
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import yaml from "js-yaml";
import {
  fromStrategyDAG,
  compileToYaml,
  type StrategyDAG,
  type StrategyDAGNode,
} from "../compat.js";
import type { StrategyDecision } from "../controller.js";
import type { Methodology, SafetyBounds } from "../../methodology/methodology.js";
import type { MethodologyResult } from "../../runtime/accumulator.js";

// ── Test state ──

type TestState = { phase: number; done: boolean };

// ── Test fixtures ──

/** Minimal domain theory for test methodologies. */
const testDomain = {
  id: "D-TEST",
  signature: {
    sorts: [{ name: "Phase", description: "Build phase", cardinality: "finite" as const }],
    functionSymbols: [],
    predicates: {},
  },
  axioms: {},
};

/** Create a test methodology with a given ID and name. */
function makeMethodology(id: string, name: string): Methodology<TestState> {
  return {
    id,
    name,
    domain: testDomain,
    arms: [
      {
        priority: 1,
        label: "execute",
        condition: { tag: "val", value: true },
        selects: null,
        rationale: `Test arm for ${name}`,
      },
    ],
    objective: { tag: "check", label: "done", check: (s: TestState) => s.done },
    terminationCertificate: {
      measure: (s: TestState) => s.done ? 0 : 1,
      decreases: "Phase counter decreases toward completion.",
    },
    safety: {
      maxLoops: 5,
      maxTokens: 100_000,
      maxCostUsd: 10,
      maxDurationMs: 60_000,
      maxDepth: 3,
    },
  };
}

const methodA = makeMethodology("M-A", "Method A");
const methodB = makeMethodology("M-B", "Method B");
const methodC = makeMethodology("M-C", "Method C");

/** Shared safety bounds for test DAGs. */
const testSafety: SafetyBounds = {
  maxLoops: 10,
  maxTokens: 500_000,
  maxCostUsd: 50,
  maxDurationMs: 300_000,
  maxDepth: 5,
};

/** A minimal MethodologyResult for testing onComplete decisions. */
function makeResult(): MethodologyResult<TestState> {
  return {
    status: "completed",
    finalState: {
      value: { phase: 1, done: true },
      axiomStatus: { valid: true, violations: [] },
    },
    trace: {
      snapshots: [],
      initial: {
        value: { phase: 0, done: false },
        axiomStatus: { valid: true, violations: [] },
      },
      current: {
        value: { phase: 1, done: true },
        axiomStatus: { valid: true, violations: [] },
      },
    },
    accumulator: {
      loopCount: 1,
      totalTokens: 1000,
      totalCostUsd: 0.5,
      startedAt: new Date("2026-01-01T00:00:00Z"),
      elapsedMs: 5000,
      suspensionCount: 0,
      completedMethods: [],
    },
  };
}

/** Build a 2-node DAG: A → B (B depends on A). */
function makeTwoNodeDAG(): StrategyDAG<TestState> {
  return {
    id: "S-TWO",
    name: "Two-Node Strategy",
    nodes: [
      { id: "N-A", methodology: methodA, dependsOn: [] },
      { id: "N-B", methodology: methodB, dependsOn: ["N-A"] },
    ],
    gates: [],
    safety: testSafety,
  };
}

/** Build a 3-node DAG: A → B → C. */
function makeThreeNodeDAG(): StrategyDAG<TestState> {
  return {
    id: "S-THREE",
    name: "Three-Node Strategy",
    nodes: [
      { id: "N-A", methodology: methodA, dependsOn: [] },
      { id: "N-B", methodology: methodB, dependsOn: ["N-A"] },
      { id: "N-C", methodology: methodC, dependsOn: ["N-B"] },
    ],
    gates: [
      {
        id: "G-REVIEW",
        description: "Code review gate",
        predicate: { tag: "val", value: true },
        evaluate: () => Effect.succeed({ passed: true, witness: null, reason: "pass", duration_ms: 0 }),
        maxRetries: 0,
      },
    ],
    safety: testSafety,
  };
}

// ── fromStrategyDAG tests ──

describe("fromStrategyDAG", () => {
  it("returns a controller with correct ID, name, and safety", () => {
    const dag = makeTwoNodeDAG();
    const ctrl = fromStrategyDAG(dag);

    expect(ctrl.id).toBe("S-TWO");
    expect(ctrl.name).toBe("Two-Node Strategy");
    expect(ctrl.safety).toEqual(testSafety);
  });

  it("sets initial methodology to the first node in topological order", () => {
    const dag = makeTwoNodeDAG();
    const ctrl = fromStrategyDAG(dag);

    // A has no deps, so it comes first
    expect(ctrl.methodology.id).toBe("M-A");
  });

  it("onComplete after first node returns switch_methodology to second node", () => {
    const dag = makeTwoNodeDAG();
    const ctrl = fromStrategyDAG(dag);
    const result = makeResult();

    const decision = Effect.runSync(ctrl.onComplete(result));
    expect(decision.tag).toBe("switch_methodology");
    if (decision.tag === "switch_methodology") {
      expect(decision.methodology.id).toBe("M-B");
    }
  });

  it("onComplete after last node returns done", () => {
    const dag = makeTwoNodeDAG();
    const ctrl = fromStrategyDAG(dag);
    const result = makeResult();

    // First completion: switch to B
    Effect.runSync(ctrl.onComplete(result));
    // Second completion: done
    const decision = Effect.runSync(ctrl.onComplete(result));
    expect(decision.tag).toBe("done");
    if (decision.tag === "done") {
      expect(decision.result).toBe(result);
    }
  });

  it("respects dependency order: B depends on A, so A runs first", () => {
    // Build DAG with nodes listed in reverse order (B before A)
    // to verify topological sort reorders them correctly
    const dag: StrategyDAG<TestState> = {
      id: "S-REVERSED",
      name: "Reversed Order Strategy",
      nodes: [
        { id: "N-B", methodology: methodB, dependsOn: ["N-A"] },
        { id: "N-A", methodology: methodA, dependsOn: [] },
      ],
      gates: [],
      safety: testSafety,
    };

    const ctrl = fromStrategyDAG(dag);

    // Despite B being listed first, A should be the initial methodology
    expect(ctrl.methodology.id).toBe("M-A");

    // First onComplete: switch to B
    const decision = Effect.runSync(ctrl.onComplete(makeResult()));
    expect(decision.tag).toBe("switch_methodology");
    if (decision.tag === "switch_methodology") {
      expect(decision.methodology.id).toBe("M-B");
    }
  });

  it("preserves gates from the DAG", () => {
    const dag = makeThreeNodeDAG();
    const ctrl = fromStrategyDAG(dag);

    expect(ctrl.gates).toHaveLength(1);
    expect(ctrl.gates[0].id).toBe("G-REVIEW");
  });

  it("advances through a 3-node DAG in correct order", () => {
    const dag = makeThreeNodeDAG();
    const ctrl = fromStrategyDAG(dag);
    const result = makeResult();

    expect(ctrl.methodology.id).toBe("M-A");

    const d1 = Effect.runSync(ctrl.onComplete(result));
    expect(d1.tag).toBe("switch_methodology");
    if (d1.tag === "switch_methodology") expect(d1.methodology.id).toBe("M-B");

    const d2 = Effect.runSync(ctrl.onComplete(result));
    expect(d2.tag).toBe("switch_methodology");
    if (d2.tag === "switch_methodology") expect(d2.methodology.id).toBe("M-C");

    const d3 = Effect.runSync(ctrl.onComplete(result));
    expect(d3.tag).toBe("done");
  });
});

// ── compileToYaml tests ──

describe("compileToYaml", () => {
  it("produces a valid YAML string", () => {
    const dag = makeTwoNodeDAG();
    const output = compileToYaml(dag);

    // Should be parseable without errors
    const parsed = yaml.load(output);
    expect(parsed).toBeDefined();
    expect(typeof output).toBe("string");
  });

  it("round-trips: dump then load preserves structure", () => {
    const dag = makeTwoNodeDAG();
    const output = compileToYaml(dag);
    const parsed = yaml.load(output) as Record<string, unknown>;

    expect(parsed.id).toBe("S-TWO");
    expect(parsed.name).toBe("Two-Node Strategy");
    expect(parsed.nodes).toHaveLength(2);
  });

  it("maps node dependencies correctly", () => {
    const dag = makeTwoNodeDAG();
    const output = compileToYaml(dag);
    const parsed = yaml.load(output) as {
      nodes: Array<{ id: string; methodology_id: string; depends_on: string[] }>;
    };

    const nodeA = parsed.nodes.find((n) => n.id === "N-A")!;
    const nodeB = parsed.nodes.find((n) => n.id === "N-B")!;

    expect(nodeA.depends_on).toEqual([]);
    expect(nodeB.depends_on).toEqual(["N-A"]);
  });

  it("references methodologies by ID, not inlined", () => {
    const dag = makeTwoNodeDAG();
    const output = compileToYaml(dag);
    const parsed = yaml.load(output) as {
      nodes: Array<{ methodology_id: string }>;
    };

    expect(parsed.nodes[0].methodology_id).toBe("M-A");
    expect(parsed.nodes[1].methodology_id).toBe("M-B");
  });

  it("maps safety bounds to snake_case including max_depth", () => {
    const dag = makeTwoNodeDAG();
    const output = compileToYaml(dag);
    const parsed = yaml.load(output) as {
      safety: { max_loops: number; max_tokens: number; max_cost_usd: number; max_duration_ms: number; max_depth: number };
    };

    expect(parsed.safety.max_loops).toBe(10);
    expect(parsed.safety.max_tokens).toBe(500_000);
    expect(parsed.safety.max_cost_usd).toBe(50);
    expect(parsed.safety.max_duration_ms).toBe(300_000);
    expect(parsed.safety.max_depth).toBe(5);
  });

  it("includes gates with id and description", () => {
    const dag = makeThreeNodeDAG();
    const output = compileToYaml(dag);
    const parsed = yaml.load(output) as {
      gates: Array<{ id: string; description: string }>;
    };

    expect(parsed.gates).toHaveLength(1);
    expect(parsed.gates[0].id).toBe("G-REVIEW");
    expect(parsed.gates[0].description).toBe("Code review gate");
  });
});

// ── Type construction tests ──

describe("StrategyDAG type construction", () => {
  it("accepts a well-formed DAG with all required fields", () => {
    const dag: StrategyDAG<TestState> = {
      id: "S-BASIC",
      name: "Basic Strategy",
      nodes: [{ id: "N-ONLY", methodology: methodA, dependsOn: [] }],
      gates: [],
      safety: testSafety,
    };

    // Type-level test: if this compiles, the type is correct
    expect(dag.id).toBe("S-BASIC");
    expect(dag.nodes).toHaveLength(1);
    expect(dag.gates).toHaveLength(0);
  });

  it("single-node DAG produces a controller that immediately returns done", () => {
    const dag: StrategyDAG<TestState> = {
      id: "S-SINGLE",
      name: "Single Node",
      nodes: [{ id: "N-ONLY", methodology: methodA, dependsOn: [] }],
      gates: [],
      safety: testSafety,
    };

    const ctrl = fromStrategyDAG(dag);
    expect(ctrl.methodology.id).toBe("M-A");

    const decision = Effect.runSync(ctrl.onComplete(makeResult()));
    expect(decision.tag).toBe("done");
  });
});

// ── Error handling tests ──

describe("fromStrategyDAG error handling", () => {
  it("throws on empty DAG (no nodes)", () => {
    const dag: StrategyDAG<TestState> = {
      id: "S-EMPTY",
      name: "Empty Strategy",
      nodes: [],
      gates: [],
      safety: testSafety,
    };

    expect(() => fromStrategyDAG(dag)).toThrow("StrategyDAG must have at least one node");
  });

  it("throws on cycle: A → B → A", () => {
    const dag: StrategyDAG<TestState> = {
      id: "S-CYCLE",
      name: "Cyclic Strategy",
      nodes: [
        { id: "N-A", methodology: methodA, dependsOn: ["N-B"] },
        { id: "N-B", methodology: methodB, dependsOn: ["N-A"] },
      ],
      gates: [],
      safety: testSafety,
    };

    expect(() => fromStrategyDAG(dag)).toThrow(/Cycle detected/);
  });

  it("throws on cycle: A → B → C → A", () => {
    const dag: StrategyDAG<TestState> = {
      id: "S-CYCLE-3",
      name: "Three-Node Cycle",
      nodes: [
        { id: "N-A", methodology: methodA, dependsOn: ["N-C"] },
        { id: "N-B", methodology: methodB, dependsOn: ["N-A"] },
        { id: "N-C", methodology: methodC, dependsOn: ["N-B"] },
      ],
      gates: [],
      safety: testSafety,
    };

    expect(() => fromStrategyDAG(dag)).toThrow(/Cycle detected/);
  });

  it("throws on unknown dependency ID", () => {
    const dag: StrategyDAG<TestState> = {
      id: "S-UNKNOWN-DEP",
      name: "Unknown Dep Strategy",
      nodes: [
        { id: "N-A", methodology: methodA, dependsOn: ["N-NONEXISTENT"] },
      ],
      gates: [],
      safety: testSafety,
    };

    expect(() => fromStrategyDAG(dag)).toThrow(
      'StrategyDAG node "N-A" depends on unknown node "N-NONEXISTENT"',
    );
  });
});
