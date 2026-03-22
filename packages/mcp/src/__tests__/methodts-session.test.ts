/**
 * methodts-session adapter tests
 *
 * Covers the full surface of packages/mcp/src/methodts-session.ts:
 *   - createMethodTSSession / createMethodTSSessionManager — session lifecycle
 *   - listMethodologiesTS — real registry scanning
 *   - getRoutingTS — routing info extraction
 *   - startMethodologySessionTS — methodology initialization
 *   - routeMethodologyTS — transition function evaluation
 *   - selectMethodologyTS — method selection + load
 *   - loadMethodInSessionTS — method load within methodology session
 *   - transitionMethodologyTS — method completion + re-route
 *   - validateStepOutputTS — output validation + postcondition check
 *
 * Uses real registry YAML fixtures per DR-09.
 *
 * NOTE: P0-META uses `selects:` in its transition_function arms, while the
 * adapter's getRoutingTS reads `returns:` (the P2-SD schema). Tests that
 * require routing use P2-SD. This schema mismatch is documented in the
 * "getRoutingTS > P0-META arm schema incompatibility" test.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "path";
import {
  createMethodTSSession,
  createMethodTSSessionManager,
  listMethodologiesTS,
  getRoutingTS,
  startMethodologySessionTS,
  routeMethodologyTS,
  selectMethodologyTS,
  loadMethodInSessionTS,
  transitionMethodologyTS,
  validateStepOutputTS,
} from "../methodts-session.js";

// Registry path resolved from repo root (works from any cwd)
const REGISTRY = resolve(import.meta.dirname, "..", "..", "..", "..", "registry");

// ── createMethodTSSession: initial state ─────────────────────

describe("createMethodTSSession", () => {
  it("isLoaded() returns false before load", () => {
    const session = createMethodTSSession();
    assert.equal(session.isLoaded(), false);
  });

  it("current() throws before load", () => {
    const session = createMethodTSSession();
    assert.throws(() => session.current(), /No methodology loaded/);
  });

  it("advance() throws before load", () => {
    const session = createMethodTSSession();
    assert.throws(() => session.advance(), /No methodology loaded/);
  });

  it("status() throws before load", () => {
    const session = createMethodTSSession();
    assert.throws(() => session.status(), /No methodology loaded/);
  });

  it("context() throws before load", () => {
    const session = createMethodTSSession();
    assert.throws(() => session.context(), /No methodology loaded/);
  });

  it("getStepOutputs() returns empty array before load", () => {
    const session = createMethodTSSession();
    assert.deepEqual(session.getStepOutputs(), []);
  });

  it("getMethodName() returns null before load", () => {
    const session = createMethodTSSession();
    assert.equal(session.getMethodName(), null);
  });

  it("getObjective() returns null before load", () => {
    const session = createMethodTSSession();
    assert.equal(session.getObjective(), null);
  });
});

// ── listMethodologiesTS: real registry ───────────────────────

describe("listMethodologiesTS", () => {
  it("returns array with known methodologies (P0-META, P1-EXEC, P2-SD)", () => {
    const list = listMethodologiesTS(REGISTRY);
    assert.ok(Array.isArray(list), "Expected an array");
    assert.ok(list.length >= 3, `Expected at least 3 methodologies, got ${list.length}`);

    const ids = list.map((m) => m.methodologyId);
    assert.ok(ids.includes("P0-META"), "Expected P0-META in list");
    assert.ok(ids.includes("P1-EXEC"), "Expected P1-EXEC in list");
    assert.ok(ids.includes("P2-SD"), "Expected P2-SD in list");
  });

  it("each entry has methodologyId, name, and methods array", () => {
    const list = listMethodologiesTS(REGISTRY);
    for (const entry of list) {
      assert.ok(typeof entry.methodologyId === "string", "methodologyId should be a string");
      assert.ok(typeof entry.name === "string", "name should be a string");
      assert.ok(Array.isArray(entry.methods), "methods should be an array");
    }
  });

  it("P0-META has methods including M1-MDES", () => {
    const list = listMethodologiesTS(REGISTRY);
    const p0 = list.find((m) => m.methodologyId === "P0-META");
    assert.ok(p0, "P0-META not found");
    assert.ok(p0.methods.length > 0, "P0-META should have methods");

    const methodIds = p0.methods.map((m) => m.methodId);
    assert.ok(methodIds.includes("M1-MDES"), "P0-META should include M1-MDES");
  });

  it("P2-SD has methods including M1-IMPL", () => {
    const list = listMethodologiesTS(REGISTRY);
    const p2 = list.find((m) => m.methodologyId === "P2-SD");
    assert.ok(p2, "P2-SD not found");

    const methodIds = p2.methods.map((m) => m.methodId);
    assert.ok(methodIds.includes("M1-IMPL"), "P2-SD should include M1-IMPL");
  });

  it("methods have stepCount > 0", () => {
    const list = listMethodologiesTS(REGISTRY);
    const withSteps = list.flatMap((m) => m.methods).filter((m) => m.stepCount > 0);
    assert.ok(withSteps.length > 0, "Expected at least one method with stepCount > 0");
  });

  it("returns array for path with no methodology directories", () => {
    const list = listMethodologiesTS(resolve(REGISTRY, "..", "theory"));
    assert.ok(Array.isArray(list));
  });

  it("throws for completely non-existent path", () => {
    assert.throws(() => listMethodologiesTS("/non/existent/path/12345"));
  });
});

// ── getRoutingTS ─────────────────────────────────────────────

describe("getRoutingTS", () => {
  it("returns routing info for P2-SD", () => {
    const routing = getRoutingTS(REGISTRY, "P2-SD");
    assert.equal(routing.methodologyId, "P2-SD");
    assert.ok(typeof routing.name === "string");
    assert.ok(Array.isArray(routing.predicates));
    assert.ok(Array.isArray(routing.arms));
    assert.ok(routing.arms.length > 0, "P2-SD should have routing arms");
  });

  it("arms have priority, label, condition, selects, and rationale", () => {
    const routing = getRoutingTS(REGISTRY, "P2-SD");
    for (const arm of routing.arms) {
      assert.ok(typeof arm.priority === "number", "arm.priority should be a number");
      assert.ok(typeof arm.label === "string", "arm.label should be a string");
      assert.ok(typeof arm.condition === "string", "arm.condition should be a string");
      assert.ok(
        arm.selects === null || typeof arm.selects === "string",
        "arm.selects should be string or null",
      );
      assert.ok(
        arm.rationale === null || typeof arm.rationale === "string",
        "arm.rationale should be string or null",
      );
    }
  });

  it("predicates have name and description fields", () => {
    const routing = getRoutingTS(REGISTRY, "P2-SD");
    for (const pred of routing.predicates) {
      assert.ok(typeof pred.name === "string", "predicate.name should be a string");
      assert.ok(
        pred.description === null || typeof pred.description === "string",
        "predicate.description should be string or null",
      );
    }
  });

  it("arms are parseable — P2-SD uses returns: Some(...)/None format", () => {
    const routing = getRoutingTS(REGISTRY, "P2-SD");
    // At least some arms should select a method (Some(...))
    const selecting = routing.arms.filter((a) => a.selects !== null);
    assert.ok(selecting.length > 0, "At least one arm should select a method");
    // At least one arm should terminate (None -> selects: null)
    const terminating = routing.arms.filter((a) => a.selects === null);
    assert.ok(terminating.length > 0, "At least one arm should be a terminate arm");
  });

  it("P0-META arm schema incompatibility — uses selects: instead of returns:", () => {
    // P0-META's YAML uses `selects:` in transition_function arms, not `returns:`.
    // The adapter's getRoutingTS reads arm["returns"] which is undefined for P0-META,
    // causing parseReturns to throw. This documents the known schema mismatch.
    assert.throws(
      () => getRoutingTS(REGISTRY, "P0-META"),
      /Cannot read properties of undefined/,
    );
  });

  it("throws for non-existent methodology", () => {
    assert.throws(
      () => getRoutingTS(REGISTRY, "DOES-NOT-EXIST"),
      /not found/,
    );
  });
});

// ── startMethodologySessionTS ────────────────────────────────

describe("startMethodologySessionTS", () => {
  it("returns session and result for P2-SD", () => {
    const { session, result } = startMethodologySessionTS(
      REGISTRY,
      "P2-SD",
      null,
      "test-session-001",
    );

    // session state
    assert.equal(session.methodologyId, "P2-SD");
    assert.equal(session.status, "initialized");
    assert.equal(session.currentMethodId, null);
    assert.deepEqual(session.completedMethods, []);
    assert.equal(session.globalObjectiveStatus, "in_progress");
    assert.equal(session.id, "test-session-001");

    // result shape
    assert.equal(result.methodologySessionId, "test-session-001");
    assert.equal(result.methodology.id, "P2-SD");
    assert.ok(typeof result.methodology.name === "string");
    assert.ok(typeof result.methodology.methodCount === "number");
    assert.ok(result.methodology.methodCount > 0, "Should have at least one method");
    assert.ok(typeof result.transitionFunction.armCount === "number");
    assert.ok(result.transitionFunction.armCount > 0, "Should have routing arms");
    assert.ok(typeof result.transitionFunction.predicateCount === "number");
    assert.equal(result.status, "initialized");
    assert.ok(typeof result.message === "string");
  });

  it("includes challenge when provided", () => {
    const { session } = startMethodologySessionTS(
      REGISTRY,
      "P2-SD",
      "Build a new feature",
      "test-session-002",
    );
    assert.equal(session.challenge, "Build a new feature");
  });

  it("challenge is null when not provided", () => {
    const { session } = startMethodologySessionTS(
      REGISTRY,
      "P2-SD",
      null,
      "test-session-002b",
    );
    assert.equal(session.challenge, null);
  });

  it("result contains routing info in session state", () => {
    const { session } = startMethodologySessionTS(
      REGISTRY,
      "P2-SD",
      null,
      "test-session-002c",
    );
    assert.ok(session.routingInfo, "Session should contain routingInfo");
    assert.ok(Array.isArray(session.routingInfo.arms));
    assert.ok(Array.isArray(session.routingInfo.predicates));
  });

  it("throws for non-existent methodology", () => {
    assert.throws(
      () => startMethodologySessionTS(REGISTRY, "DOES-NOT-EXIST", null, "test-session-003"),
      /not found/,
    );
  });
});

// ── Session load + current + advance cycle ───────────────────

describe("session load + current + advance cycle", () => {
  it("load M1-MDES from P0-META then walk steps", () => {
    const session = createMethodTSSession();

    // selectMethodologyTS loads the method into the session (bypasses routing)
    const selectResult = selectMethodologyTS(
      REGISTRY,
      "P0-META",
      "M1-MDES",
      session,
      "test-session-010",
    );

    assert.ok(selectResult.selectedMethod.stepCount > 0, "M1-MDES should have steps");

    // isLoaded should be true after select
    assert.equal(session.isLoaded(), true);

    // current() should return first step
    const first = session.current();
    assert.equal(first.stepIndex, 0);
    assert.ok(typeof first.step.id === "string");
    assert.ok(typeof first.step.name === "string");
    assert.equal(first.methodologyId, "P0-META");

    // advance through all steps
    const totalSteps = first.totalSteps;
    let advanceCount = 0;
    while (advanceCount < totalSteps - 1) {
      const result = session.advance();
      advanceCount++;
      assert.ok(typeof result.previousStep.id === "string");
      assert.ok(typeof result.previousStep.name === "string");
      // nextStep is null when we reach the terminal step
      if (advanceCount < totalSteps - 1) {
        assert.ok(result.nextStep !== null, "nextStep should exist before terminal step");
      }
    }

    // After advancing to the last step, further advance should throw
    assert.throws(() => session.advance(), /Already at terminal step/);
  });

  it("load M1-IMPL from P2-SD and verify step traversal", () => {
    const session = createMethodTSSession();

    const selectResult = selectMethodologyTS(
      REGISTRY,
      "P2-SD",
      "M1-IMPL",
      session,
      "test-session-011",
    );

    assert.ok(selectResult.selectedMethod.stepCount > 0, "M1-IMPL should have steps");
    assert.equal(session.isLoaded(), true);

    const first = session.current();
    assert.equal(first.stepIndex, 0);
    assert.equal(first.methodologyId, "P2-SD");

    // Verify step has expected fields
    assert.ok(typeof first.step.id === "string");
    assert.ok(typeof first.step.name === "string");
    assert.ok(first.step.role === null || typeof first.step.role === "string");
    assert.ok(first.step.precondition === null || typeof first.step.precondition === "string");
    assert.ok(first.step.postcondition === null || typeof first.step.postcondition === "string");
    assert.ok(first.step.guidance === null || typeof first.step.guidance === "string");
    assert.ok(first.step.outputSchema === null || typeof first.step.outputSchema === "object");
  });
});

// ── selectMethodologyTS ──────────────────────────────────────

describe("selectMethodologyTS", () => {
  it("select M1-MDES in P0-META returns result and loads session", () => {
    const session = createMethodTSSession();

    const result = selectMethodologyTS(
      REGISTRY,
      "P0-META",
      "M1-MDES",
      session,
      "test-session-020",
    );

    assert.equal(result.methodologySessionId, "test-session-020");
    assert.ok(typeof result.selectedMethod.methodId === "string");
    assert.ok(typeof result.selectedMethod.name === "string");
    assert.ok(result.selectedMethod.stepCount > 0);
    assert.ok(typeof result.selectedMethod.firstStep.id === "string");
    assert.ok(typeof result.selectedMethod.firstStep.name === "string");
    assert.ok(typeof result.message === "string");

    // Session should be loaded
    assert.equal(session.isLoaded(), true);
    assert.ok(session.getMethodName() !== null);
  });

  it("select M1-IMPL in P2-SD returns result with correct methodology", () => {
    const session = createMethodTSSession();

    const result = selectMethodologyTS(
      REGISTRY,
      "P2-SD",
      "M1-IMPL",
      session,
      "test-session-021",
    );

    assert.equal(result.methodologySessionId, "test-session-021");
    assert.equal(session.isLoaded(), true);
    // current() should return P2-SD as methodology
    const current = session.current();
    assert.equal(current.methodologyId, "P2-SD");
  });

  it("throws for non-existent methodology", () => {
    const session = createMethodTSSession();
    assert.throws(
      () => selectMethodologyTS(REGISTRY, "DOES-NOT-EXIST", "M1-MDES", session, "s1"),
      /not found/,
    );
  });

  it("throws for non-existent method in valid methodology", () => {
    const session = createMethodTSSession();
    assert.throws(
      () => selectMethodologyTS(REGISTRY, "P0-META", "M99-FAKE", session, "s1"),
      /not in methodology/,
    );
  });
});

// ── loadMethodInSessionTS ────────────────────────────────────

describe("loadMethodInSessionTS", () => {
  it("loads a method into a methodology session", () => {
    const { session: methSession } = startMethodologySessionTS(
      REGISTRY,
      "P2-SD",
      null,
      "test-session-030",
    );
    const stepSession = createMethodTSSession();

    const result = loadMethodInSessionTS(
      REGISTRY,
      methSession,
      "M1-IMPL",
      stepSession,
      "test-session-030",
    );

    assert.equal(result.methodologySessionId, "test-session-030");
    assert.ok(typeof result.method.id === "string");
    assert.ok(typeof result.method.name === "string");
    assert.ok(result.method.stepCount > 0);
    assert.ok(typeof result.method.firstStep.id === "string");
    assert.ok(typeof result.method.firstStep.name === "string");
    assert.ok(typeof result.message === "string");

    // Methodology session state should be updated
    assert.equal(methSession.status, "executing");
    assert.equal(methSession.currentMethodId, "M1-IMPL");

    // Step session should be loaded
    assert.equal(stepSession.isLoaded(), true);
  });

  it("sets prior method outputs from completed methods", () => {
    const { session: methSession } = startMethodologySessionTS(
      REGISTRY,
      "P2-SD",
      null,
      "test-session-031",
    );

    // Simulate a completed method
    methSession.completedMethods.push({
      methodId: "M-FAKE-PREV",
      completedAt: new Date().toISOString(),
      stepOutputs: [{ stepId: "s1", outputSummary: "did something" }],
      completionSummary: "method done",
    });
    methSession.status = "transitioning";

    const stepSession = createMethodTSSession();
    const result = loadMethodInSessionTS(
      REGISTRY,
      methSession,
      "M1-IMPL",
      stepSession,
      "test-session-031",
    );

    assert.equal(result.priorMethodOutputs.length, 1);
    assert.equal(result.priorMethodOutputs[0].methodId, "M-FAKE-PREV");
    assert.equal(result.methodologyProgress.methodsCompleted, 1);
  });

  it("throws when methodology session status is 'executing'", () => {
    const { session: methSession } = startMethodologySessionTS(
      REGISTRY,
      "P2-SD",
      null,
      "test-session-032",
    );
    const stepSession = createMethodTSSession();

    // Load once to set status to "executing"
    loadMethodInSessionTS(REGISTRY, methSession, "M1-IMPL", stepSession, "test-session-032");
    assert.equal(methSession.status, "executing");

    // Loading again while executing should throw
    assert.throws(
      () => loadMethodInSessionTS(REGISTRY, methSession, "M1-IMPL", stepSession, "test-session-032"),
      /Cannot load method when session status is 'executing'/,
    );
  });

  it("throws for non-existent method", () => {
    const { session: methSession } = startMethodologySessionTS(
      REGISTRY,
      "P2-SD",
      null,
      "test-session-033",
    );
    const stepSession = createMethodTSSession();

    assert.throws(
      () => loadMethodInSessionTS(REGISTRY, methSession, "M99-FAKE", stepSession, "test-session-033"),
      /not in methodology/,
    );
  });

  it("throws when status is 'completed'", () => {
    const { session: methSession } = startMethodologySessionTS(
      REGISTRY,
      "P2-SD",
      null,
      "test-session-034",
    );
    methSession.status = "completed";
    const stepSession = createMethodTSSession();

    assert.throws(
      () => loadMethodInSessionTS(REGISTRY, methSession, "M1-IMPL", stepSession, "test-session-034"),
      /Cannot load method when session status is 'completed'/,
    );
  });
});

// ── validateStepOutputTS ─────────────────────────────────────

describe("validateStepOutputTS", () => {
  it("records output and returns validation result", () => {
    const session = createMethodTSSession();
    selectMethodologyTS(REGISTRY, "P0-META", "M1-MDES", session, "test-session-040");

    const currentStep = session.current();
    const stepId = currentStep.step.id;

    const result = validateStepOutputTS(session, stepId, {
      summary: "Designed the methodology structure",
      artifacts: ["design-doc.md"],
    });

    assert.ok(typeof result.valid === "boolean");
    assert.ok(typeof result.postconditionMet === "boolean");
    assert.ok(Array.isArray(result.findings));
    assert.ok(
      ["advance", "retry", "escalate"].includes(result.recommendation),
      `Unexpected recommendation: ${result.recommendation}`,
    );

    // Output should be recorded
    const outputs = session.getStepOutputs();
    assert.ok(outputs.length > 0, "Expected at least one recorded output");
    assert.equal(outputs[0].stepId, stepId);
  });

  it("always records output even when validation fails", () => {
    const session = createMethodTSSession();
    selectMethodologyTS(REGISTRY, "P2-SD", "M1-IMPL", session, "test-session-042");

    const currentStep = session.current();
    const stepId = currentStep.step.id;

    // Pass an empty output — may trigger findings but output should still be recorded
    validateStepOutputTS(session, stepId, {});

    const outputs = session.getStepOutputs();
    assert.equal(outputs.length, 1);
    assert.equal(outputs[0].stepId, stepId);
  });

  it("throws on step_id mismatch", () => {
    const session = createMethodTSSession();
    selectMethodologyTS(REGISTRY, "P0-META", "M1-MDES", session, "test-session-041");

    assert.throws(
      () => validateStepOutputTS(session, "WRONG-STEP-ID", { data: "test" }),
      /step_id mismatch/,
    );
  });
});

// ── routeMethodologyTS ───────────────────────────────────────

describe("routeMethodologyTS", () => {
  it("routes an initialized P2-SD session", () => {
    const { session: methSession } = startMethodologySessionTS(
      REGISTRY,
      "P2-SD",
      null,
      "test-session-050",
    );

    const result = routeMethodologyTS(REGISTRY, methSession);

    assert.equal(result.methodologyId, "P2-SD");
    assert.ok(Array.isArray(result.evaluatedPredicates));
    assert.ok(typeof result.message === "string");
    assert.ok(Array.isArray(result.priorMethodsCompleted));
    if (result.selectedArm) {
      assert.ok(typeof result.selectedArm.priority === "number");
      assert.ok(typeof result.selectedArm.label === "string");
      assert.ok(typeof result.selectedArm.condition === "string");
    }
  });

  it("uses provided challenge predicates", () => {
    const { session: methSession } = startMethodologySessionTS(
      REGISTRY,
      "P2-SD",
      "Build feature X",
      "test-session-051",
    );

    const result = routeMethodologyTS(REGISTRY, methSession, {
      is_new_feature: true,
    });

    assert.ok(Array.isArray(result.evaluatedPredicates));
    assert.ok(typeof result.message === "string");
  });

  it("includes structural predicates (is_method_selected, method_completed)", () => {
    const { session: methSession } = startMethodologySessionTS(
      REGISTRY,
      "P2-SD",
      null,
      "test-session-052",
    );

    const result = routeMethodologyTS(REGISTRY, methSession);

    const predNames = result.evaluatedPredicates.map((p) => p.name);
    assert.ok(
      predNames.includes("is_method_selected"),
      "Expected structural predicate is_method_selected",
    );
    assert.ok(
      predNames.includes("method_completed"),
      "Expected structural predicate method_completed",
    );

    // For an initialized session, is_method_selected should be false
    const methodSelected = result.evaluatedPredicates.find(
      (p) => p.name === "is_method_selected",
    );
    assert.equal(methodSelected?.value, false);

    // For an initialized session, method_completed should be false
    const methodCompleted = result.evaluatedPredicates.find(
      (p) => p.name === "method_completed",
    );
    assert.equal(methodCompleted?.value, false);
  });

  it("priorMethodsCompleted is empty for fresh session", () => {
    const { session: methSession } = startMethodologySessionTS(
      REGISTRY,
      "P2-SD",
      null,
      "test-session-053",
    );

    const result = routeMethodologyTS(REGISTRY, methSession);
    assert.deepEqual(result.priorMethodsCompleted, []);
  });
});

// ── transitionMethodologyTS ──────────────────────────────────

describe("transitionMethodologyTS", () => {
  it("transitions after completing a method in P2-SD", () => {
    // 1. Start methodology session
    const { session: methSession } = startMethodologySessionTS(
      REGISTRY,
      "P2-SD",
      null,
      "test-session-060",
    );

    // 2. Load a method to set status to "executing"
    const stepSession = createMethodTSSession();
    loadMethodInSessionTS(REGISTRY, methSession, "M1-IMPL", stepSession, "test-session-060");
    assert.equal(methSession.status, "executing");

    // 3. Transition (completes the method and re-routes)
    const result = transitionMethodologyTS(
      REGISTRY,
      methSession,
      stepSession,
      "M1-IMPL completed successfully",
    );

    assert.ok(typeof result.completedMethod.id === "string");
    assert.ok(typeof result.completedMethod.name === "string");
    assert.ok(typeof result.completedMethod.stepCount === "number");
    assert.ok(typeof result.completedMethod.outputsRecorded === "number");
    assert.ok(result.methodologyProgress.methodsCompleted >= 1);
    assert.ok(typeof result.methodologyProgress.globalObjectiveStatus === "string");
    assert.ok(typeof result.message === "string");

    // nextMethod is either an object (more methods to do) or null (complete)
    if (result.nextMethod) {
      assert.ok(typeof result.nextMethod.id === "string");
      assert.ok(typeof result.nextMethod.name === "string");
      assert.ok(typeof result.nextMethod.stepCount === "number");
      assert.ok(typeof result.nextMethod.description === "string");
      assert.ok(typeof result.nextMethod.routingRationale === "string");
    }

    // Session state should be updated
    assert.ok(
      (methSession.status as string) === "transitioning" || (methSession.status as string) === "completed",
      `Expected transitioning or completed, got ${methSession.status}`,
    );
    assert.equal(methSession.completedMethods.length, 1);
    assert.equal(methSession.completedMethods[0].methodId, "M1-IMPL");
    assert.ok(typeof methSession.completedMethods[0].completedAt === "string");
    assert.equal(methSession.completedMethods[0].completionSummary, "M1-IMPL completed successfully");
  });

  it("throws when session is not in executing status", () => {
    const { session: methSession } = startMethodologySessionTS(
      REGISTRY,
      "P2-SD",
      null,
      "test-session-061",
    );
    const stepSession = createMethodTSSession();

    // Session is "initialized", not "executing"
    assert.throws(
      () => transitionMethodologyTS(REGISTRY, methSession, stepSession, "summary"),
      /Cannot transition/,
    );
  });

  it("records step outputs in the completed method record", () => {
    const { session: methSession } = startMethodologySessionTS(
      REGISTRY,
      "P2-SD",
      null,
      "test-session-062",
    );

    const stepSession = createMethodTSSession();
    loadMethodInSessionTS(REGISTRY, methSession, "M1-IMPL", stepSession, "test-session-062");

    // Record some step output before transition
    const currentStep = stepSession.current();
    stepSession.recordStepOutput(currentStep.step.id, { artifact: "output.ts" });

    const result = transitionMethodologyTS(
      REGISTRY,
      methSession,
      stepSession,
      "done",
    );

    assert.equal(result.completedMethod.outputsRecorded, 1);
    assert.equal(methSession.completedMethods[0].stepOutputs.length, 1);
    assert.equal(methSession.completedMethods[0].stepOutputs[0].stepId, currentStep.step.id);
  });
});

// ── Session manager: getOrCreate ─────────────────────────────

describe("createMethodTSSessionManager", () => {
  it("same ID returns same session", () => {
    const manager = createMethodTSSessionManager();
    const s1 = manager.getOrCreate("session-A");
    const s2 = manager.getOrCreate("session-A");
    assert.equal(s1, s2, "Same ID should return the same session instance");
  });

  it("different ID returns different session", () => {
    const manager = createMethodTSSessionManager();
    const s1 = manager.getOrCreate("session-A");
    const s2 = manager.getOrCreate("session-B");
    assert.notEqual(s1, s2, "Different IDs should return different sessions");
  });

  it("get() returns undefined for non-existent session", () => {
    const manager = createMethodTSSessionManager();
    assert.equal(manager.get("nonexistent"), undefined);
  });

  it("get() returns session after getOrCreate()", () => {
    const manager = createMethodTSSessionManager();
    const created = manager.getOrCreate("session-C");
    const got = manager.get("session-C");
    assert.equal(created, got);
  });

  it("each managed session is independent", () => {
    const manager = createMethodTSSessionManager();
    const s1 = manager.getOrCreate("session-D");
    const s2 = manager.getOrCreate("session-E");

    // Load a method into s1, s2 should still be unloaded
    selectMethodologyTS(REGISTRY, "P0-META", "M1-MDES", s1, "s-D");
    assert.equal(s1.isLoaded(), true);
    assert.equal(s2.isLoaded(), false);
  });
});

// ── Session context and prior outputs ────────────────────────

describe("session context and prior outputs", () => {
  it("context() returns methodology and method info after load", () => {
    const session = createMethodTSSession();
    selectMethodologyTS(REGISTRY, "P0-META", "M1-MDES", session, "test-session-070");

    const ctx = session.context();
    assert.ok(typeof ctx.methodology.id === "string");
    assert.ok(typeof ctx.methodology.name === "string");
    assert.ok(typeof ctx.methodology.progress === "string");
    assert.ok(typeof ctx.method.id === "string");
    assert.ok(typeof ctx.method.name === "string");
    assert.ok(typeof ctx.step.id === "string");
    assert.equal(ctx.stepIndex, 0);
    assert.ok(ctx.totalSteps > 0);
    assert.ok(Array.isArray(ctx.priorStepOutputs));
    assert.ok(Array.isArray(ctx.priorMethodOutputs));
  });

  it("prior step outputs appear in context after recording and advancing", () => {
    const session = createMethodTSSession();
    selectMethodologyTS(REGISTRY, "P0-META", "M1-MDES", session, "test-session-071");

    const firstStep = session.current();
    session.recordStepOutput(firstStep.step.id, { result: "done" });

    // Only appears in context for *prior* steps (i.e., after advancing)
    if (firstStep.totalSteps > 1) {
      session.advance();
      const ctx = session.context();
      assert.ok(ctx.priorStepOutputs.length > 0, "Expected prior step outputs after advance");
      assert.equal(ctx.priorStepOutputs[0].stepId, firstStep.step.id);
    }
  });

  it("setPriorMethodOutputs() populates context", () => {
    const session = createMethodTSSession();
    selectMethodologyTS(REGISTRY, "P0-META", "M1-MDES", session, "test-session-072");

    session.setPriorMethodOutputs([
      {
        methodId: "M-PREV",
        stepOutputs: [{ stepId: "s1", summary: "output from previous method" }],
      },
    ]);

    const ctx = session.context();
    assert.equal(ctx.priorMethodOutputs.length, 1);
    assert.equal(ctx.priorMethodOutputs[0].methodId, "M-PREV");
  });

  it("progress string format is 'N / M'", () => {
    const session = createMethodTSSession();
    selectMethodologyTS(REGISTRY, "P0-META", "M1-MDES", session, "test-session-073");

    const ctx = session.context();
    assert.match(ctx.methodology.progress, /^\d+ \/ \d+$/);
  });
});

// ── Session status ───────────────────────────────────────────

describe("session status()", () => {
  it("returns correct status after load", () => {
    const session = createMethodTSSession();
    selectMethodologyTS(REGISTRY, "P0-META", "M1-MDES", session, "test-session-080");

    const status = session.status();
    assert.equal(status.methodologyId, "P0-META");
    assert.ok(typeof status.methodId === "string");
    assert.ok(typeof status.currentStepId === "string");
    assert.ok(typeof status.currentStepName === "string");
    assert.equal(status.stepIndex, 0);
    assert.ok(status.totalSteps > 0);
  });

  it("status stepIndex advances when session advances", () => {
    const session = createMethodTSSession();
    selectMethodologyTS(REGISTRY, "P0-META", "M1-MDES", session, "test-session-081");

    assert.equal(session.status().stepIndex, 0);

    if (session.status().totalSteps > 1) {
      session.advance();
      assert.equal(session.status().stepIndex, 1);
    }
  });
});

// ── End-to-end: start -> route -> load -> validate -> transition ──

describe("end-to-end methodology lifecycle", () => {
  it("runs start -> load -> validate -> transition for P2-SD", () => {
    // 1. Start
    const { session: methSession } = startMethodologySessionTS(
      REGISTRY,
      "P2-SD",
      null,
      "e2e-session-001",
    );
    assert.equal(methSession.status, "initialized");

    // 2. Route to get the first method
    const routeResult = routeMethodologyTS(REGISTRY, methSession);
    // We need a method to load — either from route or pick one known to exist
    const methodIdToLoad = routeResult.selectedMethod?.id ?? "M1-IMPL";

    // 3. Load
    const stepSession = createMethodTSSession();
    loadMethodInSessionTS(REGISTRY, methSession, methodIdToLoad, stepSession, "e2e-session-001");
    assert.equal(methSession.status, "executing");
    assert.equal(stepSession.isLoaded(), true);

    // 4. Validate the first step
    const firstStep = stepSession.current();
    const valResult = validateStepOutputTS(stepSession, firstStep.step.id, {
      summary: "Step completed",
    });
    assert.ok(typeof valResult.valid === "boolean");

    // 5. Transition
    const transResult = transitionMethodologyTS(
      REGISTRY,
      methSession,
      stepSession,
      "Method completed via e2e test",
    );
    assert.ok(transResult.methodologyProgress.methodsCompleted >= 1);
    assert.ok(typeof transResult.message === "string");
  });
});
