// SPDX-License-Identifier: Apache-2.0
/**
 * E2E Strategy Test — Strategy layer wrapping the task management methodology.
 *
 * Proves that automatedController + runStrategy correctly orchestrate
 * a full methodology run and produce a valid StrategyResult.
 */

import { Effect } from "effect";
import { describe, it, expect } from "vitest";
import { check, and } from "../predicate/predicate.js";
import type { DomainTheory } from "../domain/domain-theory.js";
import type { Role } from "../domain/role.js";
import type { Step } from "../method/step.js";
import type { Method } from "../method/method.js";
import type { Methodology } from "../methodology/methodology.js";
import { runStrategy } from "../strategy/run-strategy.js";
import { automatedController } from "../strategy/prebuilt.js";
import { MockAgentProvider } from "../provider/mock-provider.js";
import { scriptGate } from "../gate/runners/script-gate.js";
import type { WorldState } from "../state/world-state.js";

// ── Domain (same task management domain as methodology E2E) ──

type TaskState = {
  tasks: Array<{ id: string; status: "open" | "in_progress" | "done" }>;
  currentTask: string | null;
  completedCount: number;
};

const hasOpen = check<TaskState>("has_open", (s) =>
  s.tasks.some((t) => t.status === "open"),
);

const allDone = check<TaskState>("all_done", (s) =>
  s.tasks.every((t) => t.status === "done"),
);

const hasCurrent = check<TaskState>("has_current", (s) =>
  s.currentTask !== null,
);

const noCurrent = check<TaskState>("no_current", (s) =>
  s.currentTask === null,
);

const D_TASKS: DomainTheory<TaskState> = {
  id: "D_TASKS",
  signature: {
    sorts: [
      { name: "Task", description: "A work item", cardinality: "unbounded" },
      { name: "Status", description: "Task status", cardinality: "finite" },
    ],
    functionSymbols: [],
    predicates: { has_open: hasOpen, all_done: allDone, has_current: hasCurrent, no_current: noCurrent },
  },
  axioms: {},
};

const workerRole: Role<TaskState> = {
  id: "worker",
  description: "Worker that picks and completes tasks",
  observe: (s) => s,
  authorized: ["pick_step", "complete_step"],
  notAuthorized: [],
};

const pickStep: Step<TaskState> = {
  id: "pick_step",
  name: "Pick an open task",
  role: "worker",
  precondition: and(hasOpen, noCurrent),
  postcondition: hasCurrent,
  execution: {
    tag: "script",
    execute: (state) =>
      Effect.succeed({
        ...state,
        currentTask: state.tasks.find((t) => t.status === "open")!.id,
        tasks: state.tasks.map((t) =>
          t.status === "open" && state.currentTask === null && t.id === state.tasks.find((t2) => t2.status === "open")!.id
            ? { ...t, status: "in_progress" as const }
            : t,
        ),
      }),
  },
};

const completeStep: Step<TaskState> = {
  id: "complete_step",
  name: "Complete the current task",
  role: "worker",
  precondition: hasCurrent,
  postcondition: noCurrent,
  execution: {
    tag: "script",
    execute: (state) =>
      Effect.succeed({
        tasks: state.tasks.map((t) =>
          t.id === state.currentTask ? { ...t, status: "done" as const } : t,
        ),
        currentTask: null,
        completedCount: state.completedCount + 1,
      }),
  },
};

const pickMethod: Method<TaskState> = {
  id: "M_PICK",
  name: "Pick Task",
  domain: D_TASKS,
  roles: [workerRole],
  dag: { steps: [pickStep], edges: [], initial: "pick_step", terminal: "pick_step" },
  objective: hasCurrent,
  measures: [],
};

const completeMethod: Method<TaskState> = {
  id: "M_COMPLETE",
  name: "Complete Task",
  domain: D_TASKS,
  roles: [workerRole],
  dag: { steps: [completeStep], edges: [], initial: "complete_step", terminal: "complete_step" },
  objective: noCurrent,
  measures: [],
};

const taskMethodology: Methodology<TaskState> = {
  id: "PHI_TASKS",
  name: "Task Management Methodology",
  domain: D_TASKS,
  arms: [
    { priority: 1, label: "pick", condition: and(hasOpen, noCurrent), selects: pickMethod, rationale: "Pick an open task." },
    { priority: 2, label: "complete", condition: hasCurrent, selects: completeMethod, rationale: "Complete the current task." },
    { priority: 3, label: "terminate", condition: allDone, selects: null, rationale: "All done — terminate." },
  ],
  objective: allDone,
  terminationCertificate: {
    measure: (s) => s.tasks.filter((t) => t.status !== "done").length,
    decreases: "Each pick+complete cycle finishes one task.",
  },
  safety: { maxLoops: 10, maxTokens: 1_000_000, maxCostUsd: 50, maxDurationMs: 60_000, maxDepth: 5 },
};

// ── Mock provider ──

const mockLayer = MockAgentProvider({
  responses: [],
  fallback: { raw: "{}", cost: { tokens: 0, usd: 0, duration_ms: 0 } },
});

// ── Initial state ──

const initialState: WorldState<TaskState> = {
  value: {
    tasks: [
      { id: "task-1", status: "open" },
      { id: "task-2", status: "open" },
    ],
    currentTask: null,
    completedCount: 0,
  },
  axiomStatus: { valid: true, violations: [] },
};

// ── Tests ──

describe("E2E Strategy — automatedController", () => {
  it("runs the methodology to completion and produces a valid StrategyResult", async () => {
    const controller = automatedController(taskMethodology, []);
    const effect = runStrategy(controller, initialState).pipe(
      Effect.provide(mockLayer),
    );

    const result = await Effect.runPromise(effect);

    expect(result.status).toBe("completed");
    expect(result.totalLoops).toBe(1); // One methodology run was sufficient
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0].status).toBe("completed");
    expect(result.finalState.value.completedCount).toBe(2);
    expect(result.finalState.value.tasks.every((t) => t.status === "done")).toBe(true);
  });

  it("StrategyResult.runs[0] matches a standalone methodology run", async () => {
    const controller = automatedController(taskMethodology, []);
    const effect = runStrategy(controller, initialState).pipe(
      Effect.provide(mockLayer),
    );

    const result = await Effect.runPromise(effect);

    const methodologyResult = result.runs[0];
    expect(methodologyResult.status).toBe("completed");
    expect(methodologyResult.accumulator.loopCount).toBe(4); // pick, complete, pick, complete
    expect(methodologyResult.accumulator.completedMethods).toHaveLength(4);
  });

  it("tracks zero cost for script-only execution", async () => {
    const controller = automatedController(taskMethodology, []);
    const effect = runStrategy(controller, initialState).pipe(
      Effect.provide(mockLayer),
    );

    const result = await Effect.runPromise(effect);

    expect(result.totalCostUsd).toBe(0);
    expect(result.runs[0].accumulator.totalCostUsd).toBe(0);
    expect(result.runs[0].accumulator.totalTokens).toBe(0);
  });

  describe("with strategy-level gates", () => {
    it("evaluates gates after methodology run", async () => {
      const allTasksDoneGate = scriptGate<TaskState>(
        "gate_all_done",
        "Verify all tasks are done",
        allDone,
      );

      const controller = automatedController(taskMethodology, [allTasksDoneGate]);
      const effect = runStrategy(controller, initialState).pipe(
        Effect.provide(mockLayer),
      );

      const result = await Effect.runPromise(effect);

      expect(result.status).toBe("completed");
      expect(result.gateResults).toHaveLength(1);
      expect(result.gateResults[0].passed).toBe(true);
    });

    it("gate failure does not prevent completion when methodology succeeds", async () => {
      // A gate that always fails — checks for a condition that's false
      const impossibleGate = scriptGate<TaskState>(
        "gate_impossible",
        "Check impossible condition",
        check<TaskState>("impossible", (_s) => false),
      );

      const controller = automatedController(taskMethodology, [impossibleGate]);
      const effect = runStrategy(controller, initialState).pipe(
        Effect.provide(mockLayer),
      );

      const result = await Effect.runPromise(effect);

      // automatedController's onComplete checks methodology status, not gate results
      expect(result.status).toBe("completed");
      expect(result.gateResults).toHaveLength(1);
      expect(result.gateResults[0].passed).toBe(false);
    });
  });

  describe("strategy safety bounds", () => {
    it("respects strategy-level maxLoops", async () => {
      // Use a methodology that never terminates (no terminate arm)
      const infiniteMethodology: Methodology<TaskState> = {
        ...taskMethodology,
        arms: [
          // Only pick arm, no complete or terminate — methodology runs pick once then terminates
          // because no other arm fires after pick. But the methodology result will be "completed"
          // since the loop ends. We need something that doesn't actually complete...
          {
            priority: 1,
            label: "noop",
            condition: check<TaskState>("always", () => true),
            selects: pickMethod,
            rationale: "Always picks",
          },
        ],
        // Methodology safety allows many loops, but the methodology will complete
        // after M_PICK's objective is met and then re-enter with hasCurrent=true
        // which makes `always` fire again... but M_PICK then fails postcondition.
        // Actually let's make a methodology whose completion is "failed" so the
        // automated controller retries.
        objective: check<TaskState>("never", () => false), // Objective never met
        safety: { maxLoops: 10, maxTokens: 1_000_000, maxCostUsd: 50, maxDurationMs: 60_000, maxDepth: 5 },
      };

      const controller = automatedController(infiniteMethodology, [], {
        maxLoops: 2,
      });
      const effect = runStrategy(controller, initialState).pipe(
        Effect.provide(mockLayer),
      );

      const result = await Effect.runPromise(effect);

      expect(result.status).toBe("safety_violation");
      expect(result.totalLoops).toBe(2);
    });
  });

  describe("empty task list — immediate completion", () => {
    it("completes with zero methodology loops on empty tasks", async () => {
      const emptyState: WorldState<TaskState> = {
        value: { tasks: [], currentTask: null, completedCount: 0 },
        axiomStatus: { valid: true, violations: [] },
      };

      const controller = automatedController(taskMethodology, []);
      const effect = runStrategy(controller, initialState).pipe(
        Effect.provide(mockLayer),
      );

      // Even with the regular initial state, strategy still completes in 1 run
      const result = await Effect.runPromise(effect);
      expect(result.status).toBe("completed");
      expect(result.totalLoops).toBe(1);

      // Now test with empty state — methodology terminates at 0 loops
      const emptyEffect = runStrategy(
        automatedController(taskMethodology, []),
        emptyState,
      ).pipe(Effect.provide(mockLayer));

      const emptyResult = await Effect.runPromise(emptyEffect);
      expect(emptyResult.status).toBe("completed");
      expect(emptyResult.totalLoops).toBe(1); // Strategy ran methodology once
      expect(emptyResult.runs[0].accumulator.loopCount).toBe(0); // Methodology did 0 loops
    });
  });
});
