/**
 * Tests for DomainTheory validation — validateAxioms and validateSignature.
 *
 * Uses a small domain theory fixture with 3 sorts (Task, File, Status),
 * 2 function symbols, 3 predicates, and 3 axioms (F1-FTH Def 1.1 / 1.3).
 */
import { describe, it, expect } from "vitest";
import {
  type DomainTheory,
  type SortDecl,
  type FunctionDecl,
  validateAxioms,
  validateSignature,
} from "../../domain/domain-theory.js";
import { check, TRUE } from "../../predicate/predicate.js";

// ── Fixture: world state ──

type WorldState = {
  readonly tasks: readonly string[];
  readonly files: readonly string[];
  readonly status: "open" | "closed";
};

// ── Fixture: sorts ──

const sorts: readonly SortDecl[] = [
  { name: "Task", description: "A work item", cardinality: "unbounded" },
  { name: "File", description: "A project file", cardinality: "unbounded" },
  { name: "Status", description: "Project status flag", cardinality: "finite" },
];

// ── Fixture: function symbols ──

const functionSymbols: readonly FunctionDecl[] = [
  {
    name: "assignFile",
    inputSorts: ["Task", "File"],
    outputSort: "Task",
    totality: "total",
    description: "Assign a file to a task",
  },
  {
    name: "resolveTask",
    inputSorts: ["Task"],
    outputSort: "Status",
    totality: "partial",
    description: "Resolve a task, yielding its status",
  },
];

// ── Fixture: predicates ──

const predicates = {
  "has-tasks": check<WorldState>("has-tasks", (s) => s.tasks.length > 0),
  "has-files": check<WorldState>("has-files", (s) => s.files.length > 0),
  "is-open": check<WorldState>("is-open", (s) => s.status === "open"),
} as const;

// ── Fixture: axioms (all pass on a healthy state) ──

const axioms = {
  "Ax-TasksExist": check<WorldState>("tasks-exist", (s) => s.tasks.length > 0),
  "Ax-FilesExist": check<WorldState>("files-exist", (s) => s.files.length > 0),
  "Ax-OpenStatus": check<WorldState>("open-status", (s) => s.status === "open"),
} as const;

// ── Fixture: domain theory ──

function makeDomain(
  overrides?: Partial<Pick<DomainTheory<WorldState>, "axioms" | "signature">>,
): DomainTheory<WorldState> {
  return {
    id: "D-Test",
    signature: overrides?.signature ?? { sorts, functionSymbols, predicates },
    axioms: overrides?.axioms ?? axioms,
  };
}

// ── Healthy state (all axioms pass) ──

const healthyState: WorldState = {
  tasks: ["T-1", "T-2"],
  files: ["main.ts"],
  status: "open",
};

// ── Unhealthy state (no tasks, no files, closed) ──

const unhealthyState: WorldState = {
  tasks: [],
  files: [],
  status: "closed",
};

// ── Tests ──

describe("validateAxioms (Mod(D) membership — F1-FTH Def 1.3)", () => {
  it("returns valid with no violations when all axioms pass", () => {
    const result = validateAxioms(makeDomain(), healthyState);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("returns invalid with the failing axiom name when one axiom fails", () => {
    // State where only Ax-OpenStatus fails
    const partialState: WorldState = {
      tasks: ["T-1"],
      files: ["main.ts"],
      status: "closed",
    };
    const result = validateAxioms(makeDomain(), partialState);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Ax-OpenStatus"]);
  });

  it("lists all violation names when multiple axioms fail", () => {
    const result = validateAxioms(makeDomain(), unhealthyState);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(3);
    expect(result.violations).toContain("Ax-TasksExist");
    expect(result.violations).toContain("Ax-FilesExist");
    expect(result.violations).toContain("Ax-OpenStatus");
  });

  it("handles a domain with no axioms (vacuously valid)", () => {
    const emptyAxiomDomain = makeDomain({ axioms: {} });
    const result = validateAxioms(emptyAxiomDomain, unhealthyState);
    expect(result).toEqual({ valid: true, violations: [] });
  });
});

describe("validateSignature (sort reference coherence — F1-FTH Def 1.1)", () => {
  it("returns valid when all sort references in functions exist", () => {
    const result = validateSignature(makeDomain());
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("reports error when a function references a non-existent input sort", () => {
    const badFn: FunctionDecl = {
      name: "badInput",
      inputSorts: ["Task", "Ghost"],
      outputSort: "Status",
      totality: "total",
    };
    const domain = makeDomain({
      signature: { sorts, functionSymbols: [badFn], predicates },
    });
    const result = validateSignature(domain);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toBe('Function badInput: input sort "Ghost" not declared');
  });

  it("reports error when a function references a non-existent output sort", () => {
    const badFn: FunctionDecl = {
      name: "badOutput",
      inputSorts: ["Task"],
      outputSort: "Phantom",
      totality: "partial",
    };
    const domain = makeDomain({
      signature: { sorts, functionSymbols: [badFn], predicates },
    });
    const result = validateSignature(domain);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toBe('Function badOutput: output sort "Phantom" not declared');
  });

  it("accumulates multiple errors across functions", () => {
    const badFn1: FunctionDecl = {
      name: "fn1",
      inputSorts: ["Missing1"],
      outputSort: "Task",
      totality: "total",
    };
    const badFn2: FunctionDecl = {
      name: "fn2",
      inputSorts: ["File"],
      outputSort: "Missing2",
      totality: "total",
    };
    const domain = makeDomain({
      signature: { sorts, functionSymbols: [badFn1, badFn2], predicates },
    });
    const result = validateSignature(domain);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain("fn1");
    expect(result.errors[0]).toContain("Missing1");
    expect(result.errors[1]).toContain("fn2");
    expect(result.errors[1]).toContain("Missing2");
  });

  it("handles a domain with no function symbols (vacuously valid)", () => {
    const domain = makeDomain({
      signature: { sorts, functionSymbols: [], predicates },
    });
    const result = validateSignature(domain);
    expect(result).toEqual({ valid: true, errors: [] });
  });
});
