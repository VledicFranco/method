import { describe, it, expect } from "vitest";
import { evaluate } from "../../predicate/evaluate.js";
import { predicates } from "../predicates.js";
import { D_META } from "../meta/d-meta.js";
import { validateSignature, validateAxioms } from "../../domain/domain-theory.js";
import type { MetaState } from "../types.js";

// ── Test helpers ──

type SimpleState = {
  name: string;
  items: string[];
  count: number;
  active: boolean;
};

const mkSimple = (overrides: Partial<SimpleState> = {}): SimpleState => ({
  name: "default",
  items: [],
  count: 0,
  active: false,
  ...overrides,
});

const mkMetaState = (overrides: Partial<MetaState> = {}): MetaState => ({
  targetRegistry: ["M1", "M2", "M3"],
  compiledMethods: ["M1", "M2"],
  highGapMethods: ["M1"],
  needsInstantiation: ["M2"],
  composablePairs: [["M1", "M2"]],
  informalPractices: ["code-review"],
  selfConsistentMethods: ["M1"],
  ...overrides,
});

// ── predicates.equals ──

describe("predicates.equals", () => {
  it("returns true when field matches value", () => {
    const pred = predicates.equals<SimpleState>("name_check", s => s.name, "hello");
    expect(evaluate(pred, mkSimple({ name: "hello" }))).toBe(true);
  });

  it("returns false when field does not match value", () => {
    const pred = predicates.equals<SimpleState>("name_check", s => s.name, "hello");
    expect(evaluate(pred, mkSimple({ name: "world" }))).toBe(false);
  });
});

// ── predicates.nonEmpty ──

describe("predicates.nonEmpty", () => {
  it("returns true for non-empty array", () => {
    const pred = predicates.nonEmpty<SimpleState>("has_items", s => s.items);
    expect(evaluate(pred, mkSimple({ items: ["a"] }))).toBe(true);
  });

  it("returns false for empty array", () => {
    const pred = predicates.nonEmpty<SimpleState>("has_items", s => s.items);
    expect(evaluate(pred, mkSimple({ items: [] }))).toBe(false);
  });
});

// ── predicates.isEmpty ──

describe("predicates.isEmpty", () => {
  it("returns true for empty array", () => {
    const pred = predicates.isEmpty<SimpleState>("no_items", s => s.items);
    expect(evaluate(pred, mkSimple({ items: [] }))).toBe(true);
  });

  it("returns false for non-empty array", () => {
    const pred = predicates.isEmpty<SimpleState>("no_items", s => s.items);
    expect(evaluate(pred, mkSimple({ items: ["a"] }))).toBe(false);
  });
});

// ── predicates.threshold ──

describe("predicates.threshold", () => {
  it("returns true when value meets threshold", () => {
    const pred = predicates.threshold<SimpleState>("count_min", s => s.count, 5);
    expect(evaluate(pred, mkSimple({ count: 5 }))).toBe(true);
    expect(evaluate(pred, mkSimple({ count: 10 }))).toBe(true);
  });

  it("returns false when value is below threshold", () => {
    const pred = predicates.threshold<SimpleState>("count_min", s => s.count, 5);
    expect(evaluate(pred, mkSimple({ count: 4 }))).toBe(false);
  });
});

// ── predicates.isTrue ──

describe("predicates.isTrue", () => {
  it("returns true when field is true", () => {
    const pred = predicates.isTrue<SimpleState>("is_active", s => s.active);
    expect(evaluate(pred, mkSimple({ active: true }))).toBe(true);
  });

  it("returns false when field is false", () => {
    const pred = predicates.isTrue<SimpleState>("is_active", s => s.active);
    expect(evaluate(pred, mkSimple({ active: false }))).toBe(false);
  });
});

// ── predicates.oneOf ──

describe("predicates.oneOf", () => {
  it("returns true when value is in the list", () => {
    const pred = predicates.oneOf<SimpleState>("name_in_list", s => s.name, ["alpha", "beta", "gamma"]);
    expect(evaluate(pred, mkSimple({ name: "beta" }))).toBe(true);
  });

  it("returns false when value is not in the list", () => {
    const pred = predicates.oneOf<SimpleState>("name_in_list", s => s.name, ["alpha", "beta", "gamma"]);
    expect(evaluate(pred, mkSimple({ name: "delta" }))).toBe(false);
  });
});

// ── predicates.includes ──

describe("predicates.includes", () => {
  it("returns true when element is present", () => {
    const pred = predicates.includes<SimpleState>("has_item", s => s.items, "x");
    expect(evaluate(pred, mkSimple({ items: ["x", "y"] }))).toBe(true);
  });

  it("returns false when element is absent", () => {
    const pred = predicates.includes<SimpleState>("has_item", s => s.items, "z");
    expect(evaluate(pred, mkSimple({ items: ["x", "y"] }))).toBe(false);
  });
});

// ── predicates.subsetOf ──

describe("predicates.subsetOf", () => {
  it("returns true when all elements are present in superset", () => {
    const pred = predicates.subsetOf<SimpleState>("items_subset", s => s.items, () => ["a", "b", "c"]);
    expect(evaluate(pred, mkSimple({ items: ["a", "b"] }))).toBe(true);
  });

  it("returns false when some elements are missing from superset", () => {
    const pred = predicates.subsetOf<SimpleState>("items_subset", s => s.items, () => ["a", "b"]);
    expect(evaluate(pred, mkSimple({ items: ["a", "c"] }))).toBe(false);
  });
});

// ── D_META domain theory ──

describe("D_META", () => {
  it("validateSignature passes", () => {
    const result = validateSignature(D_META);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("validateAxioms passes on valid MetaState", () => {
    const state = mkMetaState();
    const result = validateAxioms(D_META, state);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("Ax-1 fails when targetRegistry is empty", () => {
    const state = mkMetaState({ targetRegistry: [] });
    const result = validateAxioms(D_META, state);
    expect(result.valid).toBe(false);
    expect(result.violations).toContain("Ax-1");
  });

  it("Ax-3 fails when gap method not in compiledMethods", () => {
    const state = mkMetaState({
      compiledMethods: ["M1"],
      highGapMethods: ["M1", "M99"],
    });
    const result = validateAxioms(D_META, state);
    expect(result.valid).toBe(false);
    expect(result.violations).toContain("Ax-3");
  });
});
