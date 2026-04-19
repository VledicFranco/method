// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for asMethodology — wrapping a single Method as a trivial Methodology.
 *
 * F1-FTH Definition 7.1: Methodology<S> = (D_Phi, delta_Phi, O_Phi)
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { asMethodology } from "../methodology.js";
import { TRUE, check } from "../../predicate/predicate.js";
import type { Method } from "../../method/method.js";
import type { DomainTheory } from "../../domain/domain-theory.js";
import type { StepDAG } from "../../method/dag.js";

type TestState = { phase: number; done: boolean };

const testDomain: DomainTheory<TestState> = {
  id: "test-domain",
  signature: { sorts: [], functionSymbols: [], predicates: {} },
  axioms: {},
};

const testStep = {
  id: "step-1",
  name: "Step One",
  role: "agent",
  precondition: TRUE,
  postcondition: TRUE,
  execution: { tag: "script" as const, execute: (s: TestState) => Effect.succeed(s) },
};

const testDag: StepDAG<TestState> = {
  steps: [testStep],
  edges: [],
  initial: "step-1",
  terminal: "step-1",
};

const objective = check<TestState>("is-done", (s) => s.done);

const testMethod: Method<TestState> = {
  id: "M-TEST",
  name: "Test Method",
  domain: testDomain,
  roles: [],
  dag: testDag,
  objective,
  measures: [],
};

describe("asMethodology", () => {
  it("wraps a Method into a Methodology with id prefixed 'auto-'", () => {
    const meth = asMethodology(testMethod);
    expect(meth.id).toBe("auto-M-TEST");
  });

  it("preserves the method name as methodology name", () => {
    const meth = asMethodology(testMethod);
    expect(meth.name).toBe("Test Method");
  });

  it("creates exactly 2 arms: terminate (priority 1) and execute (priority 2)", () => {
    const meth = asMethodology(testMethod);
    expect(meth.arms).toHaveLength(2);

    const [term, exec] = meth.arms;

    expect(term.label).toBe("terminate");
    expect(term.priority).toBe(1);
    expect(term.condition).toBe(objective);
    expect(term.selects).toBeNull();

    expect(exec.label).toBe("execute");
    expect(exec.priority).toBe(2);
    expect(exec.condition).toEqual({ tag: "val", value: true });
    expect(exec.selects).toBe(testMethod);
  });

  it("uses the method objective as methodology objective", () => {
    const meth = asMethodology(testMethod);
    expect(meth.objective).toBe(objective);
  });

  it("provides default safety bounds", () => {
    const meth = asMethodology(testMethod);
    expect(meth.safety).toEqual({
      maxLoops: 2,
      maxTokens: 1_000_000,
      maxCostUsd: 50,
      maxDurationMs: 3_600_000,
      maxDepth: 3,
    });
  });

  it("provides a termination certificate with constant measure", () => {
    const meth = asMethodology(testMethod);
    expect(meth.terminationCertificate.measure({ phase: 1, done: false })).toBe(1);
    expect(meth.terminationCertificate.decreases).toContain("Single method");
  });

  it("uses the method domain as methodology domain", () => {
    const meth = asMethodology(testMethod);
    expect(meth.domain).toBe(testDomain);
  });
});
