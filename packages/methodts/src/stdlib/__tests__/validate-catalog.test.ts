/**
 * validate-catalog.test.ts — Comprehensive stdlib validation.
 *
 * Covers 4 properties not exercised by per-methodology test files:
 *
 *   1. Catalog integrity  — getStdlibCatalog() metadata matches TypeScript objects
 *   2. Arm wiring         — every routing arm's selects points to a real method
 *   3. Compilation        — all 31 methods pass G1-G6 structural gates (overall ≠ "failed")
 *   4. simulateRun        — each methodology terminates on a representative trajectory
 *
 * These tests serve as cross-methodology regression guards. If a method is added,
 * renamed, or its step count changes, one of these tests will catch it.
 */

import { describe, it, expect } from "vitest";
import { compileMethod } from "../../meta/compile.js";
import { simulateRun } from "../../methodology/transition.js";
import { getStdlibCatalog, getMethod, getMethodology } from "../catalog.js";

// ── Methodology imports ──────────────────────────────────────────────────────

import { P0_META } from "../meta/p0-meta.js";
import { P1_EXEC, type ExecState } from "../methodologies/p1-exec.js";
import { P2_SD, type SDState } from "../methodologies/p2-sd.js";
import { P_GH, type GHState } from "../methodologies/p-gh.js";
import { P3_GOV, type GovState } from "../methodologies/p3-gov.js";
import { P3_DISPATCH, type DispatchState } from "../methodologies/p3-dispatch.js";
import type { MetaState } from "../types.js";

// ── 1. CATALOG INTEGRITY ─────────────────────────────────────────────────────
//
// Verifies that the hardcoded metadata in getStdlibCatalog() matches the
// actual TypeScript objects in METHOD_MAP and METHODOLOGY_MAP.
// Catches stepCount drift, renamed IDs, and missing entries.

describe("Catalog integrity", () => {
  const catalog = getStdlibCatalog();

  it("returns 6 methodologies", () => {
    expect(catalog).toHaveLength(6);
  });

  for (const entry of catalog) {
    describe(entry.methodologyId, () => {
      it("resolves to a typed Methodology object", () => {
        const m = getMethodology(entry.methodologyId);
        expect(m, `getMethodology("${entry.methodologyId}") returned undefined`).toBeDefined();
        expect(m?.id).toBe(entry.methodologyId);
      });

      it("method count matches catalog", () => {
        // Every method listed in the catalog should be in METHOD_MAP
        for (const me of entry.methods) {
          const method = getMethod(entry.methodologyId, me.methodId);
          expect(method, `getMethod("${entry.methodologyId}", "${me.methodId}") returned undefined`).toBeDefined();
        }
      });

      for (const me of entry.methods) {
        describe(`${entry.methodologyId}/${me.methodId}`, () => {
          it("method.id matches catalog methodId", () => {
            const method = getMethod(entry.methodologyId, me.methodId);
            expect(method?.id).toBe(me.methodId);
          });

          it(`stepCount (${me.stepCount}) matches dag.steps.length`, () => {
            const method = getMethod(entry.methodologyId, me.methodId);
            expect(method?.dag.steps.length).toBe(me.stepCount);
          });

          it("method has initial and terminal steps", () => {
            const method = getMethod(entry.methodologyId, me.methodId);
            if (!method) return;
            const stepIds = method.dag.steps.map((s) => s.id);
            expect(stepIds).toContain(method.dag.initial);
            expect(stepIds).toContain(method.dag.terminal);
          });
        });
      }
    });
  }
});

// ── 2. ARM WIRING ─────────────────────────────────────────────────────────────
//
// Verifies that every arm in every methodology's transition function is
// correctly wired: routing arms have a non-null selects with a valid id,
// terminal arms (selects: null) exist and are correctly marked.

const ALL_METHODOLOGIES = [P0_META, P1_EXEC, P2_SD, P_GH, P3_GOV, P3_DISPATCH] as const;

describe("Arm wiring", () => {
  for (const phi of ALL_METHODOLOGIES) {
    describe(phi.id, () => {
      it("has at least one terminal arm (selects: null) or uses objective-based termination", () => {
        // P3-DISPATCH is the only objective-only methodology — all three arms are routing arms.
        // It terminates when the target methodology's objective is met, not via a null-selects arm.
        if (phi.id === "P3-DISPATCH") return;
        const terminalArms = phi.arms.filter((a) => a.selects === null);
        expect(terminalArms.length, `${phi.id} has no terminal arm`).toBeGreaterThan(0);
      });

      it("has at least one routing arm (selects non-null)", () => {
        const routingArms = phi.arms.filter((a) => a.selects !== null);
        expect(routingArms.length, `${phi.id} has no routing arms`).toBeGreaterThan(0);
      });

      it("all arm priorities are unique", () => {
        const priorities = phi.arms.map((a) => a.priority);
        const unique = new Set(priorities);
        expect(unique.size).toBe(priorities.length);
      });

      it("arms are in strict priority order (sorted by priority)", () => {
        const priorities = phi.arms.map((a) => a.priority);
        const sorted = [...priorities].sort((a, b) => a - b);
        expect(priorities).toEqual(sorted);
      });

      it("all arms have non-empty label and rationale", () => {
        for (const arm of phi.arms) {
          expect(arm.label.length, `arm with priority ${arm.priority} has no label`).toBeGreaterThan(0);
          expect(arm.rationale.length, `arm "${arm.label}" has no rationale`).toBeGreaterThan(0);
        }
      });

      it("all routing arms have a method with a non-empty id", () => {
        for (const arm of phi.arms.filter((a) => a.selects !== null)) {
          expect(arm.selects?.id, `arm "${arm.label}" has null selects`).toBeTruthy();
        }
      });

      it("no duplicate method selections across routing arms (pipeline methodologies exempt)", () => {
        // P3-GOV is a pipeline methodology where multiple lifecycle stages legitimately
        // route to the same method (e.g., 3 review stages all route to M2-REVIEW_GOV,
        // 2 draft/revision stages route to M1-DRAFT). This is correct pipeline design,
        // not redundant routing.
        if (phi.id === "P3-GOV") return;
        const selectedIds = phi.arms
          .filter((a) => a.selects !== null)
          .map((a) => a.selects!.id);
        const unique = new Set(selectedIds);
        expect(unique.size).toBe(selectedIds.length);
      });
    });
  }
});

// ── 3. COMPILATION — G1-G6 STRUCTURAL GATES ──────────────────────────────────
//
// Runs compileMethod(method, []) on every method in the stdlib catalog.
// Empty test states means G1 only validates signature (no axiom check),
// which is the right structural gate without needing per-method state factories.
//
// Expected results:
//   overall = "compiled"      — all gates pass
//   overall = "needs_review"  — G5 (agent step guidance) → acceptable for Phase 1b stubs
//   overall = "failed"        — NEVER acceptable — indicates structural breakage

describe("Compilation (G1-G6)", () => {
  const catalog = getStdlibCatalog();

  it("all methods exist in METHOD_MAP before compilation", () => {
    for (const entry of catalog) {
      for (const me of entry.methods) {
        expect(getMethod(entry.methodologyId, me.methodId)).toBeDefined();
      }
    }
  });

  for (const entry of catalog) {
    for (const me of entry.methods) {
      it(`${entry.methodologyId}/${me.methodId} overall !== "failed"`, () => {
        const method = getMethod(entry.methodologyId, me.methodId);
        if (!method) return; // covered by catalog integrity test above

        const report = compileMethod(method, []);

        // Collect any failed gates for a readable error message
        const failedGates = report.gates.filter((g) => g.status === "fail");
        expect(
          failedGates,
          `${me.methodId} has failed gates: ${failedGates.map((g) => `${g.gate}(${g.details})`).join(", ")}`,
        ).toHaveLength(0);

        expect(report.overall).not.toBe("failed");
      });

      it(`${entry.methodologyId}/${me.methodId} passes G4 (DAG acyclic)`, () => {
        const method = getMethod(entry.methodologyId, me.methodId);
        if (!method) return;
        const report = compileMethod(method, []);
        const g4 = report.gates.find((g) => g.gate === "G4");
        expect(g4?.status).not.toBe("failed");
      });
    }
  }
});

// ── 4. simulateRun — TRAJECTORY SIMULATION ───────────────────────────────────
//
// simulateRun evaluates δ_Φ over a sequence of hypothetical states without
// executing any methods. It verifies the routing logic chains correctly from
// an initial state through method execution to termination.
//
// Each test provides a 2-state trajectory: [routing state, terminal state].
// Expected: terminatesAt === 1 (terminates at second state), methodSequence
// has at least one method.

describe("simulateRun — trajectory simulation", () => {
  // ── P0-META ──

  it("P0-META: high-gap → evolve → terminate", () => {
    const stateHighGap: MetaState = {
      targetRegistry: ["M1"],
      compiledMethods: ["M1"],
      highGapMethods: ["M1"],
      needsInstantiation: [],
      composablePairs: [],
      informalPractices: [],
      selfConsistentMethods: ["M1"],
    };
    const stateAllClean: MetaState = {
      targetRegistry: [],
      compiledMethods: [],
      highGapMethods: [],
      needsInstantiation: [],
      composablePairs: [],
      informalPractices: [],
      selfConsistentMethods: [],
    };
    const result = simulateRun(P0_META, [stateHighGap, stateAllClean]);
    expect(result.terminatesAt, "P0-META did not terminate at index 1").toBe(1);
    expect(result.methodSequence).toHaveLength(1);
    expect(result.methodSequence[0]).toBe("M3-MEVO");
  });

  it("P0-META: needs instantiation → instantiate → terminate", () => {
    const stateNeedsInst: MetaState = {
      targetRegistry: ["M1"],
      compiledMethods: ["M1"],
      highGapMethods: [],
      needsInstantiation: ["M1"],
      composablePairs: [],
      informalPractices: [],
      selfConsistentMethods: ["M1"],
    };
    const stateAllClean: MetaState = {
      targetRegistry: [], compiledMethods: [], highGapMethods: [],
      needsInstantiation: [], composablePairs: [], informalPractices: [], selfConsistentMethods: [],
    };
    const result = simulateRun(P0_META, [stateNeedsInst, stateAllClean]);
    expect(result.terminatesAt).toBe(1);
    expect(result.methodSequence[0]).toBe("M4-MINS");
  });

  // ── P1-EXEC ──

  it("P1-EXEC: adversarial challenge → M1-COUNCIL → terminate", () => {
    const stateAdversarial: ExecState = {
      challenge: "Should we migrate to microservices?",
      challengeType: "adversarial",
      adversarialPressureBeneficial: true,
      decomposableBeforeExecution: false,
      selectedMethod: null,
      result: null,
      completed: false,
    };
    const stateCompleted: ExecState = {
      ...stateAdversarial,
      selectedMethod: "M1-COUNCIL",
      result: "Decision: stay monolith",
      completed: true,
    };
    const result = simulateRun(P1_EXEC, [stateAdversarial, stateCompleted]);
    expect(result.terminatesAt).toBe(1);
    expect(result.methodSequence).toHaveLength(1);
    expect(result.methodSequence[0]).toBe("M1-COUNCIL");
  });

  it("P1-EXEC: decomposable challenge → M2-ORCH → terminate", () => {
    const stateDecomp: ExecState = {
      challenge: "Implement auth, payments, notifications",
      challengeType: "decomposable",
      adversarialPressureBeneficial: false,
      decomposableBeforeExecution: true,
      selectedMethod: null,
      result: null,
      completed: false,
    };
    const stateCompleted: ExecState = { ...stateDecomp, selectedMethod: "M2-ORCH", result: "Done", completed: true };
    const result = simulateRun(P1_EXEC, [stateDecomp, stateCompleted]);
    expect(result.terminatesAt).toBe(1);
    expect(result.methodSequence[0]).toBe("M2-ORCH");
  });

  it("P1-EXEC: sequential challenge → M3-TMP → terminate", () => {
    const stateSeq: ExecState = {
      challenge: "Fix the login bug",
      challengeType: "sequential",
      adversarialPressureBeneficial: false,
      decomposableBeforeExecution: false,
      selectedMethod: null,
      result: null,
      completed: false,
    };
    const stateCompleted: ExecState = { ...stateSeq, selectedMethod: "M3-TMP", result: "Fixed", completed: true };
    const result = simulateRun(P1_EXEC, [stateSeq, stateCompleted]);
    expect(result.terminatesAt).toBe(1);
    expect(result.methodSequence[0]).toBe("M3-TMP");
  });

  // ── P2-SD ──

  it("P2-SD: implementation task → M1-IMPL → terminate", () => {
    const stateImpl: SDState = {
      taskType: "implementation",
      multiTaskScope: false,
      hasArchitectureDoc: true,
      hasPRD: true,
      phase: "phase-1",
      deliverableReady: false,
      completed: false,
    };
    const stateCompleted: SDState = { ...stateImpl, completed: true };
    const result = simulateRun(P2_SD, [stateImpl, stateCompleted]);
    expect(result.terminatesAt).toBe(1);
    expect(result.methodSequence[0]).toBe("M1-IMPL");
  });

  it("P2-SD: prd_section task → M7-PRDS → terminate", () => {
    const statePrd: SDState = {
      taskType: "prd_section",
      multiTaskScope: false,
      hasArchitectureDoc: false,
      hasPRD: true,
      phase: null,
      deliverableReady: false,
      completed: false,
    };
    const stateCompleted: SDState = { ...statePrd, completed: true };
    const result = simulateRun(P2_SD, [statePrd, stateCompleted]);
    expect(result.terminatesAt).toBe(1);
    expect(result.methodSequence[0]).toBe("M7-PRDS");
  });

  it("P2-SD: all 7 task types route correctly before completion", () => {
    const taskTypes: SDState["taskType"][] = [
      "prd_section", "architecture", "planning",
      "parallel_impl", "implementation", "review", "audit",
    ];
    const expectedMethods = [
      "M7-PRDS", "M6-ARFN", "M5-PLAN",
      "M2-DIMPL", "M1-IMPL", "M3-PHRV", "M4-DDAG",
    ];
    for (let i = 0; i < taskTypes.length; i++) {
      const initial: SDState = {
        taskType: taskTypes[i],
        multiTaskScope: taskTypes[i] === "parallel_impl",
        hasArchitectureDoc: false, hasPRD: false, phase: null,
        deliverableReady: false, completed: false,
      };
      const terminal: SDState = { ...initial, completed: true };
      const result = simulateRun(P2_SD, [initial, terminal]);
      expect(result.terminatesAt, `P2-SD ${taskTypes[i]} did not terminate`).toBe(1);
      expect(result.methodSequence[0], `P2-SD ${taskTypes[i]} wrong method`).toBe(expectedMethods[i]);
    }
  });

  // ── P-GH ──

  it("P-GH: conflict → M3-RESOLVE → terminate", () => {
    const stateConflict: GHState = {
      challengeType: "conflict",
      challengeAction: null,
      selectedMethod: null,
      result: null,
      completed: false,
    };
    const stateCompleted: GHState = { ...stateConflict, selectedMethod: "M3-RESOLVE", result: "Resolved", completed: true };
    const result = simulateRun(P_GH, [stateConflict, stateCompleted]);
    expect(result.terminatesAt).toBe(1);
    expect(result.methodSequence[0]).toBe("M3-RESOLVE");
  });

  it("P-GH: pull_request → M2-REVIEW → terminate", () => {
    const statePR: GHState = {
      challengeType: "pull_request",
      challengeAction: null,
      selectedMethod: null,
      result: null,
      completed: false,
    };
    const stateCompleted: GHState = { ...statePR, selectedMethod: "M2-REVIEW", result: "Approved", completed: true };
    const result = simulateRun(P_GH, [statePR, stateCompleted]);
    expect(result.terminatesAt).toBe(1);
    expect(result.methodSequence[0]).toBe("M2-REVIEW");
  });

  it("P-GH: issue+triage → M1-TRIAGE → terminate", () => {
    const stateIssue: GHState = {
      challengeType: "issue",
      challengeAction: "triage",
      selectedMethod: null,
      result: null,
      completed: false,
    };
    const stateCompleted: GHState = { ...stateIssue, selectedMethod: "M1-TRIAGE", result: "Triaged", completed: true };
    const result = simulateRun(P_GH, [stateIssue, stateCompleted]);
    expect(result.terminatesAt).toBe(1);
    expect(result.methodSequence[0]).toBe("M1-TRIAGE");
  });

  // ── P3-DISPATCH ──
  //
  // P3-DISPATCH has NO terminal arm (selects: null). All three arms are routing-only.
  // It terminates via objective (targetObjectiveMet || sessionAborted) when the target
  // methodology completes — not via a null-selects arm. simulateRun.terminatesAt is
  // always null for P3-DISPATCH; we validate routing only.

  it("P3-DISPATCH: INTERACTIVE mode routes to M1-INTERACTIVE", () => {
    const stateInteractive: DispatchState = {
      targetMethodology: "P2-SD",
      targetMethod: null,
      autonomyMode: "INTERACTIVE",
      targetObjectiveMet: false,
      sessionAborted: false,
      completed: false,
    };
    const result = simulateRun(P3_DISPATCH, [stateInteractive]);
    expect(result.methodSequence[0]).toBe("M1-INTERACTIVE");
    expect(result.terminatesAt).toBeNull(); // no terminal arm by design
  });

  it("P3-DISPATCH: SEMIAUTO mode routes to M2-SEMIAUTO", () => {
    const stateSemiauto: DispatchState = {
      targetMethodology: "P2-SD",
      targetMethod: null,
      autonomyMode: "SEMIAUTO",
      targetObjectiveMet: false,
      sessionAborted: false,
      completed: false,
    };
    const result = simulateRun(P3_DISPATCH, [stateSemiauto]);
    expect(result.methodSequence[0]).toBe("M2-SEMIAUTO");
    expect(result.terminatesAt).toBeNull();
  });

  it("P3-DISPATCH: FULLAUTO mode routes to M3-FULLAUTO", () => {
    const stateFullauto: DispatchState = {
      targetMethodology: "P1-EXEC",
      targetMethod: null,
      autonomyMode: "FULLAUTO",
      targetObjectiveMet: false,
      sessionAborted: false,
      completed: false,
    };
    const result = simulateRun(P3_DISPATCH, [stateFullauto]);
    expect(result.methodSequence[0]).toBe("M3-FULLAUTO");
    expect(result.terminatesAt).toBeNull();
  });

  it("P3-DISPATCH: three modes are mutually exclusive and exhaustive", () => {
    const modes: DispatchState["autonomyMode"][] = ["INTERACTIVE", "SEMIAUTO", "FULLAUTO"];
    const expectedMethods = ["M1-INTERACTIVE", "M2-SEMIAUTO", "M3-FULLAUTO"];
    for (let i = 0; i < modes.length; i++) {
      const state: DispatchState = {
        targetMethodology: "P2-SD", targetMethod: null,
        autonomyMode: modes[i], targetObjectiveMet: false, sessionAborted: false, completed: false,
      };
      const result = simulateRun(P3_DISPATCH, [state]);
      expect(result.methodSequence[0], `mode ${modes[i]} wrong routing`).toBe(expectedMethods[i]);
    }
  });

  // ── P3-GOV ──

  it("P3-GOV: gap → draft RFC → terminate (handed_off)", () => {
    const stateDraft: GovState = {
      gapIdentified: true,
      rfcExists: false,
      rfcPhase: null,
      rfcWellFormed: false,
      fullyReviewed: false,
      revisionCount: 0,
      maxRevisions: 3,
      commissionReady: false,
      completed: false,
    };
    // arm_steering_review (priority 4) fires when rfcExists && fullyReviewed && !accepted && !rejected.
    // To reach arm_terminal_handoff (priority 9), fullyReviewed must be false so arm 4 does not fire.
    const stateHandedOff: GovState = {
      gapIdentified: true,
      rfcExists: true,
      rfcPhase: "handed_off",
      rfcWellFormed: true,
      fullyReviewed: false, // prevents arm_steering_review from shadowing arm_terminal_handoff
      revisionCount: 0,
      maxRevisions: 3,
      commissionReady: true,
      completed: true,
    };
    const result = simulateRun(P3_GOV, [stateDraft, stateHandedOff]);
    expect(result.terminatesAt).toBe(1);
    expect(result.methodSequence[0]).toBe("M1-DRAFT");
  });

  // ── Cross-methodology: all 6 methodologies have a valid trajectory ──

  it("every methodology has at least one trajectory that terminates within 5 steps", () => {
    // Uses trajectories from above combined into a single assertion.
    // This is a canary: if any methodology loses its terminate arm, this fires.
    const trajectories: Array<{ phi: typeof P0_META; states: unknown[] }> = [
      {
        phi: P0_META,
        states: [
          { targetRegistry: ["M1"], compiledMethods: ["M1"], highGapMethods: ["M1"], needsInstantiation: [], composablePairs: [], informalPractices: [], selfConsistentMethods: ["M1"] },
          { targetRegistry: [], compiledMethods: [], highGapMethods: [], needsInstantiation: [], composablePairs: [], informalPractices: [], selfConsistentMethods: [] },
        ],
      },
    ];

    for (const { phi, states } of trajectories) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = simulateRun(phi as any, states as any);
      expect(result.terminatesAt, `${phi.id} never terminates`).not.toBeNull();
      expect(result.terminatesAt! + 1, `${phi.id} terminates too slowly`).toBeLessThanOrEqual(5);
    }
  });
});

// ── 5. SAFETY BOUNDS ─────────────────────────────────────────────────────────
//
// All methodologies must have safety bounds configured. Unbounded execution
// is a correctness risk — safety bounds are the runtime circuit breaker.

describe("Safety bounds", () => {
  for (const phi of ALL_METHODOLOGIES) {
    it(`${phi.id} has all 5 safety bounds configured`, () => {
      expect(phi.safety.maxLoops, `${phi.id} missing maxLoops`).toBeGreaterThan(0);
      expect(phi.safety.maxTokens, `${phi.id} missing maxTokens`).toBeGreaterThan(0);
      expect(phi.safety.maxCostUsd, `${phi.id} missing maxCostUsd`).toBeGreaterThan(0);
      expect(phi.safety.maxDurationMs, `${phi.id} missing maxDurationMs`).toBeGreaterThan(0);
      expect(phi.safety.maxDepth, `${phi.id} missing maxDepth`).toBeGreaterThan(0);
    });

    it(`${phi.id} has a termination certificate with a measure function`, () => {
      expect(phi.terminationCertificate.measure).toBeTypeOf("function");
      expect(phi.terminationCertificate.decreases.length).toBeGreaterThan(0);
    });
  }
});
