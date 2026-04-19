// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for heterogeneous quantifiers — forallOver / existsOver.
 *
 * These quantifiers extract elements of type B from context A, then
 * evaluate a Predicate<B> over them. They return standard Predicate<A>
 * values that work with the existing evaluation framework.
 */
import { describe, it, expect } from "vitest";
import { forallOver, existsOver } from "../../predicate/quantifiers.js";
import { check, TRUE } from "../../predicate/predicate.js";
import { evaluate } from "../../predicate/evaluate.js";

// ── Fixture types ──

type Item = {
  readonly value: number;
};

type Container = {
  readonly items: readonly Item[];
};

// ── Shared predicates and extractors ──

const positiveValue = check<Item>("positive-value", (b) => b.value > 0);
const extractItems = (a: Container): Item[] => [...a.items];

// ── forallOver ──

describe("forallOver", () => {
  it("returns true when all elements satisfy body", () => {
    const container: Container = {
      items: [{ value: 1 }, { value: 5 }, { value: 10 }],
    };
    const pred = forallOver<Container, Item>("all-positive", extractItems, positiveValue);
    expect(evaluate(pred, container)).toBe(true);
  });

  it("returns false when one element fails body", () => {
    const container: Container = {
      items: [{ value: 1 }, { value: -3 }, { value: 10 }],
    };
    const pred = forallOver<Container, Item>("all-positive", extractItems, positiveValue);
    expect(evaluate(pred, container)).toBe(false);
  });

  it("returns true for empty extraction (vacuously true)", () => {
    const container: Container = { items: [] };
    const pred = forallOver<Container, Item>("all-positive", extractItems, positiveValue);
    expect(evaluate(pred, container)).toBe(true);
  });

  it("has tag 'check' and correct label", () => {
    const pred = forallOver<Container, Item>("my-quant", extractItems, positiveValue);
    expect(pred.tag).toBe("check");
    if (pred.tag === "check") {
      expect(pred.label).toBe("FORALL_OVER(my-quant)");
    }
  });
});

// ── existsOver ──

describe("existsOver", () => {
  it("returns true when one element satisfies body", () => {
    const container: Container = {
      items: [{ value: -5 }, { value: -1 }, { value: 3 }],
    };
    const pred = existsOver<Container, Item>("any-positive", extractItems, positiveValue);
    expect(evaluate(pred, container)).toBe(true);
  });

  it("returns false when no elements satisfy body", () => {
    const container: Container = {
      items: [{ value: -5 }, { value: -1 }, { value: 0 }],
    };
    const pred = existsOver<Container, Item>("any-positive", extractItems, positiveValue);
    expect(evaluate(pred, container)).toBe(false);
  });

  it("returns false for empty extraction", () => {
    const container: Container = { items: [] };
    const pred = existsOver<Container, Item>("any-positive", extractItems, positiveValue);
    expect(evaluate(pred, container)).toBe(false);
  });

  it("has tag 'check' and correct label", () => {
    const pred = existsOver<Container, Item>("my-quant", extractItems, positiveValue);
    expect(pred.tag).toBe("check");
    if (pred.tag === "check") {
      expect(pred.label).toBe("EXISTS_OVER(my-quant)");
    }
  });
});

// ── Heterogeneous type scenario ──

describe("heterogeneous type scenario", () => {
  type Project = {
    readonly name: string;
    readonly members: readonly { readonly role: string; readonly active: boolean }[];
  };

  type Member = {
    readonly role: string;
    readonly active: boolean;
  };

  const extractMembers = (p: Project): Member[] => [...p.members];
  const isActive = check<Member>("is-active", (m) => m.active);
  const isEngineer = check<Member>("is-engineer", (m) => m.role === "engineer");

  it("forallOver: all members active", () => {
    const project: Project = {
      name: "Alpha",
      members: [
        { role: "engineer", active: true },
        { role: "designer", active: true },
      ],
    };
    const pred = forallOver<Project, Member>("all-active", extractMembers, isActive);
    expect(evaluate(pred, project)).toBe(true);
  });

  it("forallOver: not all members active", () => {
    const project: Project = {
      name: "Beta",
      members: [
        { role: "engineer", active: true },
        { role: "designer", active: false },
      ],
    };
    const pred = forallOver<Project, Member>("all-active", extractMembers, isActive);
    expect(evaluate(pred, project)).toBe(false);
  });

  it("existsOver: at least one engineer", () => {
    const project: Project = {
      name: "Gamma",
      members: [
        { role: "engineer", active: true },
        { role: "designer", active: true },
      ],
    };
    const pred = existsOver<Project, Member>("has-engineer", extractMembers, isEngineer);
    expect(evaluate(pred, project)).toBe(true);
  });

  it("existsOver: no engineers", () => {
    const project: Project = {
      name: "Delta",
      members: [
        { role: "designer", active: true },
        { role: "pm", active: true },
      ],
    };
    const pred = existsOver<Project, Member>("has-engineer", extractMembers, isEngineer);
    expect(evaluate(pred, project)).toBe(false);
  });
});
