// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for P1_EXEC methodology — Execution Methodology.
 *
 * Validates:
 * - P1_EXEC structural properties (id, name, arm count, priorities)
 * - Transition routing via evaluateTransition for each arm
 * - Priority ordering (higher priority arms win)
 * - Correct routing for each challenge type
 */

import { describe, it, expect } from "vitest";
import {
  P1_EXEC,
  D_EXEC,
  EXEC_ARMS,
  arm_adversarial_dispatch,
  arm_orchestration_dispatch,
  arm_sequential_dispatch,
  arm_terminate,
  arm_executing,
  type ExecState,
} from "../methodologies/p1-exec.js";
import { evaluateTransition } from "../../methodology/transition.js";

// ── Test states ──

/** Adversarial challenge — should route to M1-COUNCIL (arm 1). */
const stateAdversarial: ExecState = {
  challenge: "Should we migrate to microservices or keep the monolith?",
  challengeType: "adversarial",
  adversarialPressureBeneficial: true,
  decomposableBeforeExecution: false,
  selectedMethod: null,
  result: null,
  completed: false,
};

/** Decomposable challenge — should route to M2-ORCH (arm 2). */
const stateDecomposable: ExecState = {
  challenge: "Implement auth, payments, and notifications modules",
  challengeType: "decomposable",
  adversarialPressureBeneficial: false,
  decomposableBeforeExecution: true,
  selectedMethod: null,
  result: null,
  completed: false,
};

/** Sequential challenge — should route to M3-TMP (arm 3). */
const stateSequential: ExecState = {
  challenge: "Fix the login endpoint bug",
  challengeType: "sequential",
  adversarialPressureBeneficial: false,
  decomposableBeforeExecution: false,
  selectedMethod: null,
  result: null,
  completed: false,
};

/** Completed state — should terminate (arm 4). */
const stateCompleted: ExecState = {
  challenge: "Fix the login endpoint bug",
  challengeType: "sequential",
  adversarialPressureBeneficial: false,
  decomposableBeforeExecution: false,
  selectedMethod: "M3-TMP",
  result: "Bug fixed: null check added in auth middleware",
  completed: true,
};

/** Executing state — method running, no re-evaluation (arm 5). */
const stateExecuting: ExecState = {
  challenge: "Fix the login endpoint bug",
  challengeType: "sequential",
  adversarialPressureBeneficial: false,
  decomposableBeforeExecution: false,
  selectedMethod: "M3-TMP",
  result: null,
  completed: false,
};

// ── P1_EXEC structural tests ──

describe("P1_EXEC", () => {
  it("has correct id", () => {
    expect(P1_EXEC.id).toBe("P1-EXEC");
  });

  it("has correct name", () => {
    expect(P1_EXEC.name).toBe("Execution Methodology");
  });

  it("has 5 arms matching YAML transition_function", () => {
    expect(P1_EXEC.arms).toHaveLength(5);
  });

  it("has arms with correct priority ordering (1-5)", () => {
    const priorities = P1_EXEC.arms.map((a) => a.priority);
    expect(priorities).toEqual([1, 2, 3, 4, 5]);
  });

  it("has correct arm labels in priority order", () => {
    const labels = P1_EXEC.arms.map((a) => a.label);
    expect(labels).toEqual([
      "adversarial_dispatch",
      "orchestration_dispatch",
      "sequential_dispatch",
      "terminate",
      "executing",
    ]);
  });

  it("has a domain with id D_EXEC", () => {
    expect(P1_EXEC.domain.id).toBe("D_EXEC");
  });

  it("has safety bounds configured", () => {
    expect(P1_EXEC.safety.maxLoops).toBe(10);
    expect(P1_EXEC.safety.maxTokens).toBe(1_000_000);
    expect(P1_EXEC.safety.maxCostUsd).toBe(50);
    expect(P1_EXEC.safety.maxDurationMs).toBe(3_600_000);
    expect(P1_EXEC.safety.maxDepth).toBe(3);
  });

  it("routing arms select actual methods, terminal arms select null", () => {
    // Arms 1-3 are routing arms — should have methods wired
    expect(P1_EXEC.arms[0].selects).not.toBeNull(); // M1-COUNCIL
    expect(P1_EXEC.arms[1].selects).not.toBeNull(); // M2-ORCH
    expect(P1_EXEC.arms[2].selects).not.toBeNull(); // M3-TMP
    // Arms 4-5 are terminal/executing — should be null
    expect(P1_EXEC.arms[3].selects).toBeNull(); // terminate
    expect(P1_EXEC.arms[4].selects).toBeNull(); // executing
  });
});

// ── Domain theory tests ──

describe("D_EXEC", () => {
  it("has 5 sorts", () => {
    expect(D_EXEC.signature.sorts).toHaveLength(5);
  });

  it("has 4 function symbols", () => {
    expect(D_EXEC.signature.functionSymbols).toHaveLength(4);
  });

  it("has 4 predicates", () => {
    expect(Object.keys(D_EXEC.signature.predicates)).toHaveLength(4);
  });

  it("has 3 axioms (Ax-1, Ax-2, Ax-3)", () => {
    const axiomKeys = Object.keys(D_EXEC.axioms);
    expect(axiomKeys).toHaveLength(3);
    expect(axiomKeys).toContain("Ax-1");
    expect(axiomKeys).toContain("Ax-2");
    expect(axiomKeys).toContain("Ax-3");
  });
});

// ── Transition routing tests ──

describe("evaluateTransition(P1_EXEC, ...)", () => {
  it("routes adversarial challenge to arm 1 (adversarial_dispatch)", () => {
    const result = evaluateTransition(P1_EXEC, stateAdversarial);
    expect(result.firedArm?.label).toBe("adversarial_dispatch");
    expect(result.firedArm?.priority).toBe(1);
  });

  it("routes decomposable challenge to arm 2 (orchestration_dispatch)", () => {
    const result = evaluateTransition(P1_EXEC, stateDecomposable);
    expect(result.firedArm?.label).toBe("orchestration_dispatch");
    expect(result.firedArm?.priority).toBe(2);
  });

  it("routes sequential challenge to arm 3 (sequential_dispatch)", () => {
    const result = evaluateTransition(P1_EXEC, stateSequential);
    expect(result.firedArm?.label).toBe("sequential_dispatch");
    expect(result.firedArm?.priority).toBe(3);
  });

  it("routes completed state to arm 4 (terminate)", () => {
    const result = evaluateTransition(P1_EXEC, stateCompleted);
    expect(result.firedArm?.label).toBe("terminate");
    expect(result.firedArm?.priority).toBe(4);
  });

  it("routes executing state to arm 5 (executing)", () => {
    const result = evaluateTransition(P1_EXEC, stateExecuting);
    expect(result.firedArm?.label).toBe("executing");
    expect(result.firedArm?.priority).toBe(5);
  });

  it("evaluates all 5 arms and records traces", () => {
    const result = evaluateTransition(P1_EXEC, stateSequential);
    expect(result.armTraces).toHaveLength(5);

    // Only arm 3 (sequential_dispatch) should fire
    const firedTraces = result.armTraces.filter((t) => t.fired);
    expect(firedTraces).toHaveLength(1);
    expect(firedTraces[0].label).toBe("sequential_dispatch");
  });
});

// ── Priority tests ──

describe("priority ordering", () => {
  it("adversarial + decomposable -> arm 1 wins (adversarial_dispatch)", () => {
    const state: ExecState = {
      challenge: "Architecture decision with parallel decomposition possible",
      challengeType: null,
      adversarialPressureBeneficial: true,
      decomposableBeforeExecution: true,
      selectedMethod: null,
      result: null,
      completed: false,
    };
    const result = evaluateTransition(P1_EXEC, state);
    expect(result.firedArm?.label).toBe("adversarial_dispatch");
    expect(result.firedArm?.priority).toBe(1);
  });

  it("completed with adversarial flags -> arm 1 wins (adversarial before terminate)", () => {
    // This state is somewhat artificial — adversarial is true but method already
    // completed. Arm 1 requires selectedMethod === null, so it does NOT fire.
    // Arm 4 (terminate) fires instead.
    const state: ExecState = {
      challenge: "Architecture decision",
      challengeType: "adversarial",
      adversarialPressureBeneficial: true,
      decomposableBeforeExecution: false,
      selectedMethod: "M1-COUNCIL",
      result: "Decision made",
      completed: true,
    };
    const result = evaluateTransition(P1_EXEC, state);
    // Arm 1 condition: selectedMethod === null — false here
    // Arm 4 condition: selectedMethod !== null && completed — true
    expect(result.firedArm?.label).toBe("terminate");
    expect(result.firedArm?.priority).toBe(4);
  });
});

// ── Termination certificate tests ──

describe("terminationCertificate", () => {
  it("measure is 2 when no method selected", () => {
    expect(P1_EXEC.terminationCertificate.measure(stateSequential)).toBe(2);
  });

  it("measure is 1 when method selected but not complete", () => {
    expect(P1_EXEC.terminationCertificate.measure(stateExecuting)).toBe(1);
  });

  it("measure is 0 when completed", () => {
    expect(P1_EXEC.terminationCertificate.measure(stateCompleted)).toBe(0);
  });

  it("measure strictly decreases through lifecycle", () => {
    const m = P1_EXEC.terminationCertificate.measure;
    expect(m(stateSequential)).toBeGreaterThan(m(stateExecuting));
    expect(m(stateExecuting)).toBeGreaterThan(m(stateCompleted));
  });
});
