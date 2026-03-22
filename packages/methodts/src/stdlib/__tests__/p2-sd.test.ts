/**
 * Tests for P2_SD — Software Delivery Methodology.
 *
 * Validates:
 * - P2_SD structural properties (id, name, arm count, priorities)
 * - Transition routing via evaluateTransition for each task type
 * - Priority ordering (higher priority arms win over lower)
 * - Terminal state routing (completed → terminate arm)
 * - At least 3 scenarios per SC7
 */

import { describe, it, expect } from "vitest";
import {
  P2_SD,
  D_Phi_SD,
  SD_ARMS,
  arm_section,
  arm_architecture,
  arm_plan,
  arm_orchestrated_implement,
  arm_implement,
  arm_review,
  arm_audit,
  arm_terminate,
  arm_executing,
} from "../methodologies/p2-sd.js";
import { evaluateTransition } from "../../methodology/transition.js";
import type { SDState } from "../methodologies/p2-sd.js";

// ── Helper: base state factory ──

function makeState(overrides: Partial<SDState> = {}): SDState {
  return {
    taskType: null,
    multiTaskScope: false,
    hasArchitectureDoc: false,
    hasPRD: false,
    phase: null,
    deliverableReady: false,
    completed: false,
    ...overrides,
  };
}

// ── P2_SD structural tests ──

describe("P2_SD", () => {
  it("has correct id", () => {
    expect(P2_SD.id).toBe("P2-SD");
  });

  it("has correct name", () => {
    expect(P2_SD.name).toBe("Software Delivery Methodology");
  });

  it("has 9 arms (7 routing + terminate + executing)", () => {
    expect(P2_SD.arms).toHaveLength(9);
  });

  it("has arms with priorities 1-9", () => {
    const priorities = P2_SD.arms.map((a) => a.priority);
    expect(priorities).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("has correct arm labels in priority order", () => {
    const labels = P2_SD.arms.map((a) => a.label);
    expect(labels).toEqual([
      "section",
      "architecture",
      "plan",
      "orchestrated_implement",
      "implement",
      "review",
      "audit",
      "terminate",
      "executing",
    ]);
  });

  it("has a domain with id D_Phi_SD", () => {
    expect(P2_SD.domain.id).toBe("D_Phi_SD");
  });

  it("has safety bounds configured", () => {
    expect(P2_SD.safety.maxLoops).toBe(20);
    expect(P2_SD.safety.maxTokens).toBe(1_000_000);
    expect(P2_SD.safety.maxCostUsd).toBe(50);
    expect(P2_SD.safety.maxDurationMs).toBe(3_600_000);
    expect(P2_SD.safety.maxDepth).toBe(3);
  });

  it("has a termination certificate", () => {
    expect(P2_SD.terminationCertificate.measure).toBeTypeOf("function");
    expect(P2_SD.terminationCertificate.decreases).toBeTruthy();
  });

  it("termination measure returns 1 for non-completed, 0 for completed", () => {
    expect(P2_SD.terminationCertificate.measure(makeState())).toBe(1);
    expect(P2_SD.terminationCertificate.measure(makeState({ completed: true, taskType: "review" }))).toBe(0);
  });
});

// ── D_Phi_SD domain theory tests ──

describe("D_Phi_SD", () => {
  it("has 5 sorts", () => {
    expect(D_Phi_SD.signature.sorts).toHaveLength(5);
  });

  it("has 4 function symbols", () => {
    expect(D_Phi_SD.signature.functionSymbols).toHaveLength(4);
  });

  it("has predicates for each task type and routing state", () => {
    const predicateNames = Object.keys(D_Phi_SD.signature.predicates);
    expect(predicateNames).toContain("is_prd_section");
    expect(predicateNames).toContain("is_architecture");
    expect(predicateNames).toContain("is_planning");
    expect(predicateNames).toContain("is_implementation");
    expect(predicateNames).toContain("is_parallel_impl");
    expect(predicateNames).toContain("is_review");
    expect(predicateNames).toContain("is_audit");
    expect(predicateNames).toContain("multi_task_scope");
    expect(predicateNames).toContain("is_method_selected");
    expect(predicateNames).toContain("method_completed");
  });

  it("has axioms for core invariants", () => {
    const axiomNames = Object.keys(D_Phi_SD.axioms);
    expect(axiomNames).toContain("Ax-1_task_type_uniqueness");
    expect(axiomNames).toContain("Ax-4_selection_before_completion");
    expect(axiomNames).toContain("Ax-5_single_dispatch");
  });
});

// ── SD_ARMS export tests ──

describe("SD_ARMS", () => {
  it("exports all 9 arms", () => {
    expect(SD_ARMS).toHaveLength(9);
  });

  it("all arms have non-empty rationale", () => {
    for (const arm of SD_ARMS) {
      expect(arm.rationale).toBeTruthy();
    }
  });

  it("routing arms select actual methods, terminal arms select null", () => {
    // Arms 1-7 are routing arms — should have methods wired
    for (let i = 0; i < 7; i++) {
      expect(SD_ARMS[i].selects).not.toBeNull();
    }
    // Arms 8-9 are terminal/executing
    expect(SD_ARMS[7].selects).toBeNull();
    expect(SD_ARMS[8].selects).toBeNull();
  });
});

// ── Transition routing tests ──

describe("evaluateTransition(P2_SD, ...)", () => {
  // ── Arm 1: section (prd_section) ──

  it("arm 1 fires: section when taskType is prd_section", () => {
    const result = evaluateTransition(P2_SD, makeState({ taskType: "prd_section" }));
    expect(result.firedArm?.label).toBe("section");
    expect(result.firedArm?.priority).toBe(1);
  });

  it("arm 1 fires: section with hasPRD true", () => {
    const result = evaluateTransition(P2_SD, makeState({ taskType: "prd_section", hasPRD: true }));
    expect(result.firedArm?.label).toBe("section");
  });

  it("arm 1 does not fire: section when completed", () => {
    const result = evaluateTransition(P2_SD, makeState({ taskType: "prd_section", completed: true }));
    expect(result.firedArm?.label).not.toBe("section");
  });

  // ── Arm 2: architecture ──

  it("arm 2 fires: architecture when taskType is architecture", () => {
    const result = evaluateTransition(P2_SD, makeState({ taskType: "architecture" }));
    expect(result.firedArm?.label).toBe("architecture");
    expect(result.firedArm?.priority).toBe(2);
  });

  it("arm 2 fires: architecture with hasArchitectureDoc false", () => {
    const result = evaluateTransition(P2_SD, makeState({ taskType: "architecture", hasArchitectureDoc: false }));
    expect(result.firedArm?.label).toBe("architecture");
  });

  it("arm 2 does not fire: architecture when completed", () => {
    const result = evaluateTransition(P2_SD, makeState({ taskType: "architecture", completed: true }));
    expect(result.firedArm?.label).not.toBe("architecture");
  });

  // ── Arm 3: plan ──

  it("arm 3 fires: plan when taskType is planning", () => {
    const result = evaluateTransition(P2_SD, makeState({ taskType: "planning" }));
    expect(result.firedArm?.label).toBe("plan");
    expect(result.firedArm?.priority).toBe(3);
  });

  it("arm 3 fires: plan with hasPRD and hasArchitectureDoc", () => {
    const result = evaluateTransition(P2_SD, makeState({
      taskType: "planning",
      hasPRD: true,
      hasArchitectureDoc: true,
    }));
    expect(result.firedArm?.label).toBe("plan");
  });

  it("arm 3 does not fire: plan when completed", () => {
    const result = evaluateTransition(P2_SD, makeState({ taskType: "planning", completed: true }));
    expect(result.firedArm?.label).not.toBe("plan");
  });

  // ── Arm 4: orchestrated_implement (parallel_impl) ──

  it("arm 4 fires: orchestrated_implement when taskType is parallel_impl", () => {
    const result = evaluateTransition(P2_SD, makeState({ taskType: "parallel_impl", multiTaskScope: true }));
    expect(result.firedArm?.label).toBe("orchestrated_implement");
    expect(result.firedArm?.priority).toBe(4);
  });

  it("arm 4 fires: orchestrated_implement with deliverableReady", () => {
    const result = evaluateTransition(P2_SD, makeState({
      taskType: "parallel_impl",
      multiTaskScope: true,
      deliverableReady: true,
    }));
    expect(result.firedArm?.label).toBe("orchestrated_implement");
  });

  it("arm 4 does not fire: orchestrated_implement when completed", () => {
    const result = evaluateTransition(P2_SD, makeState({
      taskType: "parallel_impl",
      multiTaskScope: true,
      completed: true,
    }));
    expect(result.firedArm?.label).not.toBe("orchestrated_implement");
  });

  // ── Arm 5: implement (single implementation) ──

  it("arm 5 fires: implement when taskType is implementation", () => {
    const result = evaluateTransition(P2_SD, makeState({ taskType: "implementation" }));
    expect(result.firedArm?.label).toBe("implement");
    expect(result.firedArm?.priority).toBe(5);
  });

  it("arm 5 fires: implement with phase set", () => {
    const result = evaluateTransition(P2_SD, makeState({
      taskType: "implementation",
      phase: "phase-1",
    }));
    expect(result.firedArm?.label).toBe("implement");
  });

  it("arm 5 does not fire: implement when completed", () => {
    const result = evaluateTransition(P2_SD, makeState({ taskType: "implementation", completed: true }));
    expect(result.firedArm?.label).not.toBe("implement");
  });

  // ── Arm 6: review ──

  it("arm 6 fires: review when taskType is review", () => {
    const result = evaluateTransition(P2_SD, makeState({ taskType: "review" }));
    expect(result.firedArm?.label).toBe("review");
    expect(result.firedArm?.priority).toBe(6);
  });

  it("arm 6 fires: review with deliverableReady", () => {
    const result = evaluateTransition(P2_SD, makeState({
      taskType: "review",
      deliverableReady: true,
    }));
    expect(result.firedArm?.label).toBe("review");
  });

  it("arm 6 does not fire: review when completed", () => {
    const result = evaluateTransition(P2_SD, makeState({ taskType: "review", completed: true }));
    expect(result.firedArm?.label).not.toBe("review");
  });

  // ── Arm 7: audit ──

  it("arm 7 fires: audit when taskType is audit", () => {
    const result = evaluateTransition(P2_SD, makeState({ taskType: "audit" }));
    expect(result.firedArm?.label).toBe("audit");
    expect(result.firedArm?.priority).toBe(7);
  });

  it("arm 7 fires: audit with phase set", () => {
    const result = evaluateTransition(P2_SD, makeState({
      taskType: "audit",
      phase: "phase-3",
    }));
    expect(result.firedArm?.label).toBe("audit");
  });

  it("arm 7 does not fire: audit when completed", () => {
    const result = evaluateTransition(P2_SD, makeState({ taskType: "audit", completed: true }));
    expect(result.firedArm?.label).not.toBe("audit");
  });

  // ── Arm 8: terminate ──

  it("arm 8 fires: terminate when completed", () => {
    const result = evaluateTransition(P2_SD, makeState({ taskType: "review", completed: true }));
    expect(result.firedArm?.label).toBe("terminate");
    expect(result.firedArm?.priority).toBe(8);
  });

  it("arm 8 fires: terminate when completed regardless of task type", () => {
    const taskTypes = ["prd_section", "architecture", "planning", "implementation", "parallel_impl", "review", "audit"] as const;
    for (const taskType of taskTypes) {
      const result = evaluateTransition(P2_SD, makeState({ taskType, completed: true }));
      expect(result.firedArm?.label).toBe("terminate");
    }
  });

  it("arm 8 does not fire: terminate when not completed", () => {
    const result = evaluateTransition(P2_SD, makeState({ taskType: "implementation" }));
    expect(result.firedArm?.label).not.toBe("terminate");
  });

  // ── Arm 9: executing ──

  // Note: arm 9 (executing) cannot fire independently in this encoding because
  // arms 1-7 will always match first for non-completed states with a taskType.
  // arm_executing is a catch-all that would only be meaningful if the arm
  // conditions 1-7 were narrower (e.g., checking additional prerequisites).
  // In the current encoding, it serves as a safety net — structurally present
  // per the YAML spec but shadowed by higher-priority arms.

  it("arm 9 does not fire when arms 1-7 match first", () => {
    const result = evaluateTransition(P2_SD, makeState({ taskType: "implementation" }));
    // arm 5 (implement) fires, not arm 9
    expect(result.firedArm?.label).toBe("implement");
    // But arm 9 is present and evaluated
    const executingTrace = result.armTraces.find((t) => t.label === "executing");
    expect(executingTrace).toBeDefined();
  });

  // ── Null taskType: no arm fires for routing ──

  it("no routing arm fires when taskType is null (only executing has_task_type fails)", () => {
    const result = evaluateTransition(P2_SD, makeState({ taskType: null }));
    // No routing arm matches (taskType is null), terminate doesn't match (not completed),
    // executing doesn't match (taskType is null)
    expect(result.firedArm).toBeNull();
    expect(result.selectedMethod).toBeNull();
  });

  // ── Priority ordering tests ──

  it("priority: all task types route correctly when not completed", () => {
    const routing: Array<[SDState["taskType"], string]> = [
      ["prd_section", "section"],
      ["architecture", "architecture"],
      ["planning", "plan"],
      ["parallel_impl", "orchestrated_implement"],
      ["implementation", "implement"],
      ["review", "review"],
      ["audit", "audit"],
    ];

    for (const [taskType, expectedLabel] of routing) {
      const result = evaluateTransition(P2_SD, makeState({ taskType }));
      expect(result.firedArm?.label).toBe(expectedLabel);
    }
  });

  it("priority: completed state always routes to terminate regardless of taskType", () => {
    const taskTypes = ["prd_section", "architecture", "planning", "implementation", "parallel_impl", "review", "audit"] as const;
    for (const taskType of taskTypes) {
      const result = evaluateTransition(P2_SD, makeState({ taskType, completed: true }));
      expect(result.firedArm?.label).toBe("terminate");
    }
  });

  // ── Trace completeness ──

  it("evaluates all 9 arms and records traces", () => {
    const result = evaluateTransition(P2_SD, makeState({ taskType: "implementation" }));
    expect(result.armTraces).toHaveLength(9);

    const firedTraces = result.armTraces.filter((t) => t.fired);
    expect(firedTraces).toHaveLength(1);
    expect(firedTraces[0].label).toBe("implement");
  });

  it("terminate state records all 9 traces", () => {
    const result = evaluateTransition(P2_SD, makeState({ taskType: "review", completed: true }));
    expect(result.armTraces).toHaveLength(9);

    const firedTraces = result.armTraces.filter((t) => t.fired);
    expect(firedTraces).toHaveLength(1);
    expect(firedTraces[0].label).toBe("terminate");
  });
});
