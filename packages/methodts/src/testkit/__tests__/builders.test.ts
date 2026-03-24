/**
 * Tests for testkit builders — domain, step, method, methodology.
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { check, and, not, evaluate } from "../../index.js";
import {
  domainBuilder,
  scriptStep,
  methodBuilder,
  methodologyBuilder,
  worldState,
  worldStateWithViolations,
} from "../index.js";

// ── Test domain ──

type ItemState = {
  items: string[];
  current: string | null;
  processed: number;
};

const hasItems = check<ItemState>("has_items", (s) => s.items.length > 0);
const hasCurrent = check<ItemState>("has_current", (s) => s.current !== null);
const noCurrent = check<ItemState>("no_current", (s) => s.current === null);
const allProcessed = check<ItemState>("all_processed", (s) =>
  s.items.length === 0 && s.current === null,
);

// ── domainBuilder ──

describe("domainBuilder", () => {
  it("builds a domain with sorts, predicates, and axioms", () => {
    const domain = domainBuilder<ItemState>("D_ITEMS")
      .sort("Item", "unbounded", "A work item")
      .sort("Status", "finite")
      .predicate("has_items", (s) => s.items.length > 0)
      .axiom("processed_non_negative", (s) => s.processed >= 0)
      .build();

    expect(domain.id).toBe("D_ITEMS");
    expect(domain.signature.sorts).toHaveLength(2);
    expect(domain.signature.sorts[0].name).toBe("Item");
    expect(domain.signature.sorts[0].cardinality).toBe("unbounded");
    expect(Object.keys(domain.signature.predicates)).toContain("has_items");
    expect(Object.keys(domain.axioms)).toContain("processed_non_negative");
  });

  it("predicates evaluate correctly", () => {
    const domain = domainBuilder<ItemState>("D_ITEMS")
      .predicate("has_items", (s) => s.items.length > 0)
      .build();

    const pred = domain.signature.predicates["has_items"];
    expect(evaluate(pred, { items: ["a"], current: null, processed: 0 })).toBe(true);
    expect(evaluate(pred, { items: [], current: null, processed: 0 })).toBe(false);
  });

  it("axioms evaluate correctly", () => {
    const domain = domainBuilder<ItemState>("D_ITEMS")
      .axiom("non_negative", (s) => s.processed >= 0)
      .build();

    const axiom = domain.axioms["non_negative"];
    expect(evaluate(axiom, { items: [], current: null, processed: 5 })).toBe(true);
    expect(evaluate(axiom, { items: [], current: null, processed: -1 })).toBe(false);
  });

  it("supports predicateFrom for existing Predicate values", () => {
    const domain = domainBuilder<ItemState>("D_ITEMS")
      .predicateFrom("has_items", hasItems)
      .build();

    expect(domain.signature.predicates["has_items"]).toBe(hasItems);
  });

  it("supports function symbols", () => {
    const domain = domainBuilder<ItemState>("D_ITEMS")
      .functionSymbol("count", ["Item"], "number")
      .build();

    expect(domain.signature.functionSymbols).toHaveLength(1);
    expect(domain.signature.functionSymbols[0].name).toBe("count");
    expect(domain.signature.functionSymbols[0].totality).toBe("total");
  });
});

// ── scriptStep ──

describe("scriptStep", () => {
  it("builds a step with defaults", () => {
    const step = scriptStep<ItemState>("pick", {
      execute: (s) => ({ ...s, current: s.items[0] }),
    });

    expect(step.id).toBe("pick");
    expect(step.name).toBe("pick");
    expect(step.role).toBe("default");
    expect(step.execution.tag).toBe("script");
  });

  it("builds a step with all options", () => {
    const step = scriptStep<ItemState>("pick", {
      role: "worker",
      pre: and(hasItems, noCurrent),
      post: hasCurrent,
      execute: (s) => ({ ...s, current: s.items[0] }),
      tools: ["pick_tool"],
    });

    expect(step.role).toBe("worker");
    expect(evaluate(step.precondition, { items: ["a"], current: null, processed: 0 })).toBe(true);
    expect(evaluate(step.postcondition, { items: ["a"], current: "a", processed: 0 })).toBe(true);
    expect(step.tools).toEqual(["pick_tool"]);
  });

  it("execution transforms state correctly", async () => {
    const step = scriptStep<ItemState>("pick", {
      execute: (s) => ({ ...s, current: s.items[0] }),
    });

    const exec = step.execution;
    if (exec.tag !== "script") throw new Error("Expected script");
    const result = await Effect.runPromise(
      exec.execute({ items: ["a", "b"], current: null, processed: 0 }) as Effect.Effect<ItemState, unknown, never>,
    );
    expect(result.current).toBe("a");
  });
});

// ── methodBuilder ──

describe("methodBuilder", () => {
  const pickStep = scriptStep<ItemState>("pick", {
    role: "worker",
    pre: and(hasItems, noCurrent),
    post: hasCurrent,
    execute: (s) => ({ ...s, current: s.items[0] }),
  });

  it("builds a method with linear DAG", () => {
    const completeStep = scriptStep<ItemState>("complete", {
      role: "worker",
      pre: hasCurrent,
      post: noCurrent,
      execute: (s) => ({
        items: s.items.filter((i) => i !== s.current),
        current: null,
        processed: s.processed + 1,
      }),
    });

    const method = methodBuilder<ItemState>("M_PROCESS")
      .name("Process Items")
      .role("worker", (s) => s)
      .steps([pickStep, completeStep])
      .objective(noCurrent)
      .build();

    expect(method.id).toBe("M_PROCESS");
    expect(method.name).toBe("Process Items");
    expect(method.dag.steps).toHaveLength(2);
    expect(method.dag.edges).toHaveLength(1);
    expect(method.dag.edges[0]).toEqual({ from: "pick", to: "complete" });
    expect(method.dag.initial).toBe("pick");
    expect(method.dag.terminal).toBe("complete");
  });

  it("builds a single-step method with no edges", () => {
    const method = methodBuilder<ItemState>("M_PICK")
      .role("worker", (s) => s)
      .steps([pickStep])
      .objective(hasCurrent)
      .build();

    expect(method.dag.steps).toHaveLength(1);
    expect(method.dag.edges).toHaveLength(0);
    expect(method.dag.initial).toBe("pick");
    expect(method.dag.terminal).toBe("pick");
  });

  it("auto-generates domain when none provided", () => {
    const method = methodBuilder<ItemState>("M_PICK")
      .steps([pickStep])
      .build();

    expect(method.domain.id).toBe("D_M_PICK");
  });

  it("supports explicit edges for non-linear DAGs", () => {
    const stepA = scriptStep<ItemState>("a", { execute: (s) => s });
    const stepB = scriptStep<ItemState>("b", { execute: (s) => s });
    const stepC = scriptStep<ItemState>("c", { execute: (s) => s });

    const method = methodBuilder<ItemState>("M_DAG")
      .steps([stepA, stepB, stepC])
      .edge("a", "b")
      .edge("a", "c")
      .build();

    expect(method.dag.edges).toHaveLength(2);
    expect(method.dag.edges).toContainEqual({ from: "a", to: "b" });
    expect(method.dag.edges).toContainEqual({ from: "a", to: "c" });
  });
});

// ── methodologyBuilder ──

describe("methodologyBuilder", () => {
  const domain = domainBuilder<ItemState>("D_ITEMS")
    .sort("Item", "unbounded")
    .predicate("has_items", (s) => s.items.length > 0)
    .build();

  const pickMethod = methodBuilder<ItemState>("M_PICK")
    .domain(domain)
    .role("worker", (s) => s)
    .steps([scriptStep<ItemState>("pick", {
      role: "worker",
      pre: and(hasItems, noCurrent),
      post: hasCurrent,
      execute: (s) => ({ ...s, current: s.items[0] }),
    })])
    .objective(hasCurrent)
    .build();

  it("builds a methodology with arms", () => {
    const methodology = methodologyBuilder<ItemState>("PHI_ITEMS")
      .name("Item Processing")
      .domain(domain)
      .arm(1, "pick", and(hasItems, noCurrent), pickMethod)
      .arm(2, "terminate", allProcessed, null)
      .objective(allProcessed)
      .terminationMeasure((s) => s.items.length, "Items decrease each cycle.")
      .build();

    expect(methodology.id).toBe("PHI_ITEMS");
    expect(methodology.name).toBe("Item Processing");
    expect(methodology.arms).toHaveLength(2);
    expect(methodology.arms[0].label).toBe("pick");
    expect(methodology.arms[0].selects).toBe(pickMethod);
    expect(methodology.arms[1].label).toBe("terminate");
    expect(methodology.arms[1].selects).toBeNull();
    expect(methodology.terminationCertificate.measure({ items: ["a"], current: null, processed: 0 })).toBe(1);
  });

  it("uses default safety bounds", () => {
    const methodology = methodologyBuilder<ItemState>("PHI_ITEMS")
      .arm(1, "terminate", allProcessed, null)
      .build();

    expect(methodology.safety.maxLoops).toBe(20);
    expect(methodology.safety.maxTokens).toBe(1_000_000);
  });

  it("overrides safety bounds", () => {
    const methodology = methodologyBuilder<ItemState>("PHI_ITEMS")
      .arm(1, "terminate", allProcessed, null)
      .safety({ maxLoops: 5 })
      .build();

    expect(methodology.safety.maxLoops).toBe(5);
    expect(methodology.safety.maxTokens).toBe(1_000_000); // unchanged
  });
});

// ── worldState ──

describe("worldState", () => {
  it("creates valid WorldState", () => {
    const ws = worldState({ items: ["a"], current: null, processed: 0 });
    expect(ws.value.items).toEqual(["a"]);
    expect(ws.axiomStatus.valid).toBe(true);
    expect(ws.axiomStatus.violations).toEqual([]);
  });

  it("creates WorldState with violations", () => {
    const ws = worldStateWithViolations({ items: [], current: null, processed: -1 }, ["non_negative"]);
    expect(ws.axiomStatus.valid).toBe(false);
    expect(ws.axiomStatus.violations).toEqual(["non_negative"]);
  });
});
