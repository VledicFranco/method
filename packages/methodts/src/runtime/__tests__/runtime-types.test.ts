/**
 * Tests for runtime type modules: errors, events, suspension, accumulator, config.
 *
 * These are mostly type-level modules with a small amount of runtime code.
 * Tests verify construction of each union variant and the accumulator helpers.
 */

import { describe, it, expect } from "vitest";
import {
  initialAccumulator,
  recordMethod,
  type CompletedMethodRecord,
  type ExecutionAccumulatorState,
  type MethodologyResult,
  type MethodResult,
  type StepResult,
} from "../accumulator.js";
import type { RuntimeError } from "../errors.js";
import type { SuspensionReason, Resolution, SuspendedMethodology } from "../suspension.js";
import type { RuntimeEvent } from "../events.js";
import { defaultRuntimeConfig, type RuntimeConfig } from "../config.js";
import type { WorldState, StateTrace, Snapshot } from "../../state/world-state.js";

// ── Test helpers ──

type TestState = { count: number; done: boolean };

function makeWorldState(s: TestState): WorldState<TestState> {
  return { value: s, axiomStatus: { valid: true, violations: [] } };
}

function makeSnapshot(s: TestState, seq: number): Snapshot<TestState> {
  return {
    state: makeWorldState(s),
    sequence: seq,
    timestamp: new Date("2026-01-01T00:00:00Z"),
    delta: null,
    witnesses: [],
    metadata: {},
  };
}

function makeTrace(s: TestState): StateTrace<TestState> {
  const ws = makeWorldState(s);
  return { snapshots: [], initial: ws, current: ws };
}

// ── Accumulator ──

describe("ExecutionAccumulatorState", () => {
  describe("CompletedMethodRecord construction", () => {
    it("constructs a record with all required fields", () => {
      const record: CompletedMethodRecord = {
        methodId: "M1-DESIGN",
        objectiveMet: true,
        stepOutputSummaries: { "step-1": "Designed the API", "step-2": "Wrote tests" },
        cost: { tokens: 5000, usd: 0.15, duration_ms: 30000 },
      };

      expect(record.methodId).toBe("M1-DESIGN");
      expect(record.objectiveMet).toBe(true);
      expect(record.stepOutputSummaries["step-1"]).toBe("Designed the API");
      expect(record.cost.tokens).toBe(5000);
      expect(record.cost.usd).toBe(0.15);
      expect(record.cost.duration_ms).toBe(30000);
    });
  });

  describe("initialAccumulator", () => {
    it("returns a zero state with no completed methods", () => {
      const acc = initialAccumulator();

      expect(acc.loopCount).toBe(0);
      expect(acc.totalTokens).toBe(0);
      expect(acc.totalCostUsd).toBe(0);
      expect(acc.elapsedMs).toBe(0);
      expect(acc.suspensionCount).toBe(0);
      expect(acc.completedMethods).toEqual([]);
      expect(acc.startedAt).toBeInstanceOf(Date);
    });
  });

  describe("recordMethod", () => {
    it("increments loopCount, tokens, cost, and appends the method record", () => {
      const acc = initialAccumulator();
      const record: CompletedMethodRecord = {
        methodId: "M1-DESIGN",
        objectiveMet: true,
        stepOutputSummaries: { "step-1": "Done" },
        cost: { tokens: 3000, usd: 0.10, duration_ms: 20000 },
      };

      const updated = recordMethod(acc, record);

      expect(updated.loopCount).toBe(1);
      expect(updated.totalTokens).toBe(3000);
      expect(updated.totalCostUsd).toBeCloseTo(0.10);
      expect(updated.completedMethods).toHaveLength(1);
      expect(updated.completedMethods[0]).toBe(record);
    });

    it("accumulates across multiple records", () => {
      let acc = initialAccumulator();

      const r1: CompletedMethodRecord = {
        methodId: "M1",
        objectiveMet: true,
        stepOutputSummaries: {},
        cost: { tokens: 1000, usd: 0.05, duration_ms: 10000 },
      };
      const r2: CompletedMethodRecord = {
        methodId: "M2",
        objectiveMet: false,
        stepOutputSummaries: {},
        cost: { tokens: 2000, usd: 0.08, duration_ms: 15000 },
      };

      acc = recordMethod(acc, r1);
      acc = recordMethod(acc, r2);

      expect(acc.loopCount).toBe(2);
      expect(acc.totalTokens).toBe(3000);
      expect(acc.totalCostUsd).toBeCloseTo(0.13);
      expect(acc.completedMethods).toHaveLength(2);
      expect(acc.completedMethods[0].methodId).toBe("M1");
      expect(acc.completedMethods[1].methodId).toBe("M2");
    });

    it("does not mutate the original accumulator", () => {
      const acc = initialAccumulator();
      const record: CompletedMethodRecord = {
        methodId: "M1",
        objectiveMet: true,
        stepOutputSummaries: {},
        cost: { tokens: 500, usd: 0.01, duration_ms: 5000 },
      };

      const updated = recordMethod(acc, record);

      expect(acc.loopCount).toBe(0);
      expect(acc.completedMethods).toHaveLength(0);
      expect(updated.loopCount).toBe(1);
    });
  });
});

// ── Result types ──

describe("MethodologyResult", () => {
  it("constructs a completed result", () => {
    const result: MethodologyResult<TestState> = {
      status: "completed",
      finalState: makeWorldState({ count: 10, done: true }),
      trace: makeTrace({ count: 10, done: true }),
      accumulator: initialAccumulator(),
    };

    expect(result.status).toBe("completed");
    expect(result.finalState.value.done).toBe(true);
    expect(result.violation).toBeUndefined();
  });

  it("constructs a safety_violation result with violation details", () => {
    const result: MethodologyResult<TestState> = {
      status: "safety_violation",
      finalState: makeWorldState({ count: 5, done: false }),
      trace: makeTrace({ count: 5, done: false }),
      accumulator: initialAccumulator(),
      violation: { bound: "maxTokens", limit: 100000, actual: 150000 },
    };

    expect(result.status).toBe("safety_violation");
    expect(result.violation?.bound).toBe("maxTokens");
    expect(result.violation?.limit).toBe(100000);
    expect(result.violation?.actual).toBe(150000);
  });

  it("constructs a failed result", () => {
    const result: MethodologyResult<TestState> = {
      status: "failed",
      finalState: makeWorldState({ count: 3, done: false }),
      trace: makeTrace({ count: 3, done: false }),
      accumulator: initialAccumulator(),
    };

    expect(result.status).toBe("failed");
  });

  it("constructs an aborted result", () => {
    const result: MethodologyResult<TestState> = {
      status: "aborted",
      finalState: makeWorldState({ count: 0, done: false }),
      trace: makeTrace({ count: 0, done: false }),
      accumulator: initialAccumulator(),
    };

    expect(result.status).toBe("aborted");
  });
});

describe("MethodResult", () => {
  it("constructs a completed method result with step results", () => {
    const stepResult: StepResult<TestState> = {
      stepId: "step-1",
      status: "completed",
      before: makeSnapshot({ count: 0, done: false }, 0),
      after: makeSnapshot({ count: 1, done: false }, 1),
      cost: { tokens: 1000, usd: 0.03, duration_ms: 5000 },
      retries: 0,
      executionTag: "agent",
    };

    const result: MethodResult<TestState> = {
      status: "completed",
      finalState: makeWorldState({ count: 1, done: false }),
      stepResults: [stepResult],
      objectiveMet: true,
    };

    expect(result.status).toBe("completed");
    expect(result.stepResults).toHaveLength(1);
    expect(result.objectiveMet).toBe(true);
  });

  it("constructs an objective_not_met result", () => {
    const result: MethodResult<TestState> = {
      status: "objective_not_met",
      finalState: makeWorldState({ count: 1, done: false }),
      stepResults: [],
      objectiveMet: false,
    };

    expect(result.status).toBe("objective_not_met");
    expect(result.objectiveMet).toBe(false);
  });
});

describe("StepResult", () => {
  it("constructs a completed step result with agent execution", () => {
    const result: StepResult<TestState> = {
      stepId: "step-design",
      status: "completed",
      before: makeSnapshot({ count: 0, done: false }, 0),
      after: makeSnapshot({ count: 1, done: false }, 1),
      cost: { tokens: 2000, usd: 0.06, duration_ms: 10000 },
      retries: 0,
      executionTag: "agent",
    };

    expect(result.stepId).toBe("step-design");
    expect(result.status).toBe("completed");
    expect(result.executionTag).toBe("agent");
    expect(result.retries).toBe(0);
  });

  it("constructs a step result with script execution and retries", () => {
    const result: StepResult<TestState> = {
      stepId: "step-validate",
      status: "postcondition_failed",
      before: makeSnapshot({ count: 1, done: false }, 1),
      after: makeSnapshot({ count: 1, done: false }, 2),
      cost: { tokens: 0, usd: 0, duration_ms: 500 },
      retries: 2,
      executionTag: "script",
    };

    expect(result.status).toBe("postcondition_failed");
    expect(result.executionTag).toBe("script");
    expect(result.retries).toBe(2);
  });

  it("constructs a gate_failed step result", () => {
    const result: StepResult<TestState> = {
      stepId: "step-review",
      status: "gate_failed",
      before: makeSnapshot({ count: 0, done: false }, 0),
      after: makeSnapshot({ count: 0, done: false }, 1),
      cost: { tokens: 500, usd: 0.01, duration_ms: 2000 },
      retries: 0,
      executionTag: "agent",
    };

    expect(result.status).toBe("gate_failed");
  });

  it("constructs an error step result", () => {
    const result: StepResult<TestState> = {
      stepId: "step-deploy",
      status: "error",
      before: makeSnapshot({ count: 5, done: false }, 5),
      after: makeSnapshot({ count: 5, done: false }, 5),
      cost: { tokens: 100, usd: 0.003, duration_ms: 1000 },
      retries: 3,
      executionTag: "script",
    };

    expect(result.status).toBe("error");
    expect(result.retries).toBe(3);
  });
});

// ── Errors ──

describe("RuntimeError", () => {
  it("constructs PreconditionError", () => {
    const err: RuntimeError = {
      _tag: "PreconditionError",
      stepId: "step-1",
      message: "State not ready for design",
    };
    expect(err._tag).toBe("PreconditionError");
    expect(err.stepId).toBe("step-1");
  });

  it("constructs PostconditionError", () => {
    const err: RuntimeError = {
      _tag: "PostconditionError",
      stepId: "step-2",
      message: "Design output missing required fields",
      retryable: true,
    };
    expect(err._tag).toBe("PostconditionError");
    if (err._tag === "PostconditionError") {
      expect(err.retryable).toBe(true);
    }
  });

  it("constructs GateFailure", () => {
    const err: RuntimeError = {
      _tag: "GateFailure",
      gateId: "gate-quality",
      stepId: "step-3",
      message: "Quality gate failed",
      feedback: "Missing test coverage for edge cases",
    };
    expect(err._tag).toBe("GateFailure");
    if (err._tag === "GateFailure") {
      expect(err.feedback).toBe("Missing test coverage for edge cases");
    }
  });

  it("constructs ParseFailure", () => {
    const err: RuntimeError = {
      _tag: "ParseFailure",
      stepId: "step-4",
      message: "Could not parse agent output as JSON",
      raw: "not json at all",
    };
    expect(err._tag).toBe("ParseFailure");
    if (err._tag === "ParseFailure") {
      expect(err.raw).toBe("not json at all");
    }
  });

  it("constructs AgentFailure", () => {
    const err: RuntimeError = {
      _tag: "AgentFailure",
      stepId: "step-5",
      message: "Agent timed out after 60s",
      cause: new Error("timeout"),
    };
    expect(err._tag).toBe("AgentFailure");
    if (err._tag === "AgentFailure") {
      expect(err.cause).toBeInstanceOf(Error);
    }
  });

  it("constructs AxiomViolation", () => {
    const err: RuntimeError = {
      _tag: "AxiomViolation",
      violations: ["AX1: count must be non-negative", "AX3: done implies count > 0"],
      stepId: "step-6",
    };
    expect(err._tag).toBe("AxiomViolation");
    if (err._tag === "AxiomViolation") {
      expect(err.violations).toHaveLength(2);
    }
  });

  it("constructs SafetyViolation", () => {
    const err: RuntimeError = {
      _tag: "SafetyViolation",
      bound: "maxTokens",
      limit: 100000,
      actual: 150000,
    };
    expect(err._tag).toBe("SafetyViolation");
    if (err._tag === "SafetyViolation") {
      expect(err.actual).toBeGreaterThan(err.limit);
    }
  });
});

// ── Suspension ──

describe("SuspensionReason", () => {
  it("constructs gate_review", () => {
    const reason: SuspensionReason<TestState> = {
      tag: "gate_review",
      gateId: "gate-quality",
      passed: false,
      stepId: "step-1",
    };
    expect(reason.tag).toBe("gate_review");
  });

  it("constructs checklist_review", () => {
    const reason: SuspensionReason<TestState> = {
      tag: "checklist_review",
      lowConfidence: ["item-3", "item-7"],
    };
    expect(reason.tag).toBe("checklist_review");
    if (reason.tag === "checklist_review") {
      expect(reason.lowConfidence).toHaveLength(2);
    }
  });

  it("constructs error", () => {
    const reason: SuspensionReason<TestState> = {
      tag: "error",
      error: { _tag: "PreconditionError", stepId: "step-1", message: "Not ready" },
      stepId: "step-1",
    };
    expect(reason.tag).toBe("error");
  });

  it("constructs safety_warning", () => {
    const reason: SuspensionReason<TestState> = {
      tag: "safety_warning",
      bound: "maxTokens",
      usage: 90000,
      limit: 100000,
    };
    expect(reason.tag).toBe("safety_warning");
  });

  it("constructs scheduled_halt", () => {
    const reason: SuspensionReason<TestState> = {
      tag: "scheduled_halt",
      trigger: "mid-method-checkpoint",
    };
    expect(reason.tag).toBe("scheduled_halt");
  });

  it("constructs checkpoint", () => {
    const reason: SuspensionReason<TestState> = {
      tag: "checkpoint",
      stepId: "step-3",
    };
    expect(reason.tag).toBe("checkpoint");
  });

  it("constructs human_decision", () => {
    const reason: SuspensionReason<TestState> = {
      tag: "human_decision",
      question: "Which deployment target?",
      options: ["staging", "production"],
    };
    expect(reason.tag).toBe("human_decision");
    if (reason.tag === "human_decision") {
      expect(reason.options).toHaveLength(2);
    }
  });

  it("constructs method_boundary", () => {
    const reason: SuspensionReason<TestState> = {
      tag: "method_boundary",
      completedMethod: "M1-DESIGN",
      nextArm: "M2-IMPLEMENT",
    };
    expect(reason.tag).toBe("method_boundary");
  });

  it("constructs methodology_complete", () => {
    const reason: SuspensionReason<TestState> = {
      tag: "methodology_complete",
    };
    expect(reason.tag).toBe("methodology_complete");
  });
});

describe("Resolution", () => {
  it("constructs continue", () => {
    const res: Resolution<TestState> = { tag: "continue" };
    expect(res.tag).toBe("continue");
  });

  it("constructs provide_value", () => {
    const res: Resolution<TestState> = {
      tag: "provide_value",
      value: { count: 42 },
    };
    expect(res.tag).toBe("provide_value");
    if (res.tag === "provide_value") {
      expect(res.value.count).toBe(42);
    }
  });

  it("constructs rerun_step", () => {
    const res: Resolution<TestState> = { tag: "rerun_step" };
    expect(res.tag).toBe("rerun_step");
  });

  it("constructs rerun_step_with", () => {
    const res: Resolution<TestState> = {
      tag: "rerun_step_with",
      state: { count: 0, done: false },
    };
    expect(res.tag).toBe("rerun_step_with");
    if (res.tag === "rerun_step_with") {
      expect(res.state.count).toBe(0);
    }
  });

  it("constructs skip_step", () => {
    const res: Resolution<TestState> = { tag: "skip_step" };
    expect(res.tag).toBe("skip_step");
  });

  it("constructs abort", () => {
    const res: Resolution<TestState> = {
      tag: "abort",
      reason: "User cancelled the methodology",
    };
    expect(res.tag).toBe("abort");
    if (res.tag === "abort") {
      expect(res.reason).toBe("User cancelled the methodology");
    }
  });
});

// ── Config ──

describe("RuntimeConfig", () => {
  it("defaultRuntimeConfig has expected defaults", () => {
    expect(defaultRuntimeConfig.eventBusCapacity).toBe(1000);
    expect(defaultRuntimeConfig.maxRetries).toBe(3);
    expect(defaultRuntimeConfig.suspensionDefault).toBe("on_failure");
  });

  it("allows constructing custom configs", () => {
    const config: RuntimeConfig = {
      eventBusCapacity: 500,
      maxRetries: 5,
      suspensionDefault: "always",
    };

    expect(config.eventBusCapacity).toBe(500);
    expect(config.maxRetries).toBe(5);
    expect(config.suspensionDefault).toBe("always");
  });
});

// ── Events ──

describe("RuntimeEvent", () => {
  it("constructs methodology_started", () => {
    const event: RuntimeEvent<TestState> = {
      type: "methodology_started",
      methodologyId: "PHI-SD",
      initialState: makeWorldState({ count: 0, done: false }),
      timestamp: new Date("2026-01-01T00:00:00Z"),
    };

    expect(event.type).toBe("methodology_started");
    if (event.type === "methodology_started") {
      expect(event.methodologyId).toBe("PHI-SD");
      expect(event.initialState.value.count).toBe(0);
    }
  });

  it("constructs step_completed with cost", () => {
    const event: RuntimeEvent<TestState> = {
      type: "step_completed",
      stepId: "step-design",
      cost: { tokens: 5000, usd: 0.15, duration_ms: 30000 },
      timestamp: new Date("2026-01-01T00:05:00Z"),
    };

    expect(event.type).toBe("step_completed");
    if (event.type === "step_completed") {
      expect(event.cost.tokens).toBe(5000);
      expect(event.cost.usd).toBe(0.15);
    }
  });

  it("constructs safety_warning", () => {
    const event: RuntimeEvent<TestState> = {
      type: "safety_warning",
      bound: "maxTokens",
      usage: 90000,
      limit: 100000,
      timestamp: new Date("2026-01-01T00:10:00Z"),
    };

    expect(event.type).toBe("safety_warning");
    if (event.type === "safety_warning") {
      expect(event.usage).toBeLessThan(event.limit);
    }
  });

  it("constructs methodology_completed", () => {
    const event: RuntimeEvent<TestState> = {
      type: "methodology_completed",
      status: "completed",
      timestamp: new Date("2026-01-01T01:00:00Z"),
    };

    expect(event.type).toBe("methodology_completed");
    if (event.type === "methodology_completed") {
      expect(event.status).toBe("completed");
    }
  });

  it("constructs custom event with arbitrary payload", () => {
    const event: RuntimeEvent<TestState> = {
      type: "custom",
      name: "debug_snapshot",
      payload: { debugInfo: "testing custom events", extra: [1, 2, 3] },
      timestamp: new Date("2026-01-01T00:30:00Z"),
    };

    expect(event.type).toBe("custom");
    if (event.type === "custom") {
      expect(event.name).toBe("debug_snapshot");
    }
  });

  it("constructs insight_produced", () => {
    const event: RuntimeEvent<TestState> = {
      type: "insight_produced",
      key: "design-decision",
      stepId: "step-design",
      preview: "Chose event sourcing for state management",
      timestamp: new Date("2026-01-01T00:15:00Z"),
    };

    expect(event.type).toBe("insight_produced");
    if (event.type === "insight_produced") {
      expect(event.key).toBe("design-decision");
    }
  });
});

// ── SuspendedMethodology (integration) ──

describe("SuspendedMethodology", () => {
  it("captures full suspended state for resumption", () => {
    const suspended: SuspendedMethodology<TestState> = {
      reason: { tag: "gate_review", gateId: "gate-quality", passed: false, stepId: "step-review" },
      state: makeWorldState({ count: 3, done: false }),
      trace: makeTrace({ count: 3, done: false }),
      accumulator: initialAccumulator(),
      insightStore: { "prior-insight": "The system needs caching" },
      position: {
        methodologyId: "PHI-SD",
        methodId: "M2-IMPLEMENT",
        stepId: "step-review",
        stepIndex: 2,
        retryCount: 0,
      },
    };

    expect(suspended.reason.tag).toBe("gate_review");
    expect(suspended.state.value.count).toBe(3);
    expect(suspended.insightStore["prior-insight"]).toBe("The system needs caching");
    expect(suspended.position.methodologyId).toBe("PHI-SD");
    expect(suspended.position.stepIndex).toBe(2);
  });
});
