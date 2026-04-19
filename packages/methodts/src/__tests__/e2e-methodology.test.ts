// SPDX-License-Identifier: Apache-2.0
/**
 * E2E Methodology Test — Full coalgebraic loop over a "task management" domain.
 *
 * Defines a small domain with 2 methods (pick_task, complete_task) and a 3-arm
 * methodology. Runs the full loop: pick -> complete -> pick -> complete -> terminate.
 * All steps are script-based for determinism.
 */

import { Effect } from "effect";
import { describe, it, expect } from "vitest";
import { check, TRUE, and, not } from "../predicate/predicate.js";
import { evaluate } from "../predicate/evaluate.js";
import type { DomainTheory } from "../domain/domain-theory.js";
import type { Role } from "../domain/role.js";
import type { Step } from "../method/step.js";
import type { Method } from "../method/method.js";
import type { Methodology, Arm } from "../methodology/methodology.js";
import { evaluateTransition } from "../methodology/transition.js";
import { runMethodology, runMethodologyToCompletion } from "../runtime/run-methodology.js";
import { MockAgentProvider } from "../provider/mock-provider.js";
import { AgentProvider } from "../provider/agent-provider.js";
import type { WorldState } from "../state/world-state.js";

// ── Domain Definition ──

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
    predicates: {
      has_open: hasOpen,
      all_done: allDone,
      has_current: hasCurrent,
      no_current: noCurrent,
    },
  },
  axioms: {},
};

// ── Role ──

const workerRole: Role<TaskState> = {
  id: "worker",
  description: "Worker that picks and completes tasks",
  observe: (s) => s,
  authorized: ["pick_step", "complete_step"],
  notAuthorized: [],
};

// ── Method 1: pick_task ──

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

const pickMethod: Method<TaskState> = {
  id: "M_PICK",
  name: "Pick Task",
  domain: D_TASKS,
  roles: [workerRole],
  dag: {
    steps: [pickStep],
    edges: [],
    initial: "pick_step",
    terminal: "pick_step",
  },
  objective: hasCurrent,
  measures: [],
};

// ── Method 2: complete_task ──

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

const completeMethod: Method<TaskState> = {
  id: "M_COMPLETE",
  name: "Complete Task",
  domain: D_TASKS,
  roles: [workerRole],
  dag: {
    steps: [completeStep],
    edges: [],
    initial: "complete_step",
    terminal: "complete_step",
  },
  objective: noCurrent,
  measures: [],
};

// ── Methodology: 3-arm transition function ──

const taskMethodology: Methodology<TaskState> = {
  id: "PHI_TASKS",
  name: "Task Management Methodology",
  domain: D_TASKS,
  arms: [
    {
      priority: 1,
      label: "pick",
      condition: and(hasOpen, noCurrent),
      selects: pickMethod,
      rationale: "Open tasks exist and no current task — pick one.",
    },
    {
      priority: 2,
      label: "complete",
      condition: hasCurrent,
      selects: completeMethod,
      rationale: "A task is in progress — complete it.",
    },
    {
      priority: 3,
      label: "terminate",
      condition: allDone,
      selects: null,
      rationale: "All tasks done — terminate.",
    },
  ],
  objective: allDone,
  terminationCertificate: {
    measure: (s) => s.tasks.filter((t) => t.status !== "done").length,
    decreases: "Each pick+complete cycle finishes one task, reducing the count of non-done tasks.",
  },
  safety: {
    maxLoops: 10,
    maxTokens: 1_000_000,
    maxCostUsd: 50,
    maxDurationMs: 60_000,
    maxDepth: 5,
  },
};

// ── Mock provider (required by type signature even for script-only runs) ──

const mockLayer = MockAgentProvider({
  responses: [],
  fallback: { raw: "{}", cost: { tokens: 0, usd: 0, duration_ms: 0 } },
});

// ── Tests ──

describe("E2E Methodology — Task Management", () => {
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

  describe("evaluateTransition routing", () => {
    it("routes to pick_task when open tasks exist and no current task", () => {
      const result = evaluateTransition(taskMethodology, initialState.value);
      expect(result.firedArm).not.toBeNull();
      expect(result.firedArm!.label).toBe("pick");
      expect(result.selectedMethod).not.toBeNull();
      expect(result.selectedMethod!.id).toBe("M_PICK");
    });

    it("routes to complete_task when a current task exists", () => {
      const stateWithCurrent: TaskState = {
        tasks: [
          { id: "task-1", status: "in_progress" },
          { id: "task-2", status: "open" },
        ],
        currentTask: "task-1",
        completedCount: 0,
      };
      const result = evaluateTransition(taskMethodology, stateWithCurrent);
      expect(result.firedArm).not.toBeNull();
      expect(result.firedArm!.label).toBe("complete");
      expect(result.selectedMethod).not.toBeNull();
      expect(result.selectedMethod!.id).toBe("M_COMPLETE");
    });

    it("routes to terminate when all tasks are done", () => {
      const allDoneState: TaskState = {
        tasks: [
          { id: "task-1", status: "done" },
          { id: "task-2", status: "done" },
        ],
        currentTask: null,
        completedCount: 2,
      };
      const result = evaluateTransition(taskMethodology, allDoneState);
      expect(result.firedArm).not.toBeNull();
      expect(result.firedArm!.label).toBe("terminate");
      expect(result.selectedMethod).toBeNull();
    });

    it("generates arm traces for all arms", () => {
      const result = evaluateTransition(taskMethodology, initialState.value);
      expect(result.armTraces).toHaveLength(3);
      // First arm fires (pick), others do not
      expect(result.armTraces[0].label).toBe("pick");
      expect(result.armTraces[0].fired).toBe(true);
      expect(result.armTraces[1].label).toBe("complete");
      expect(result.armTraces[1].fired).toBe(false);
      expect(result.armTraces[2].label).toBe("terminate");
      expect(result.armTraces[2].fired).toBe(false);
    });
  });

  describe("full methodology run", () => {
    it("runs 2 tasks to completion: pick -> complete -> pick -> complete -> terminate", async () => {
      const effect = runMethodology(taskMethodology, initialState).pipe(
        Effect.provide(mockLayer),
      );

      const result = await Effect.runPromise(effect);

      // Methodology completed
      expect(result.status).toBe("completed");

      // 4 loops: pick, complete, pick, complete
      expect(result.accumulator.loopCount).toBe(4);

      // Final state: all done
      const finalValue = result.finalState.value;
      expect(finalValue.tasks.every((t) => t.status === "done")).toBe(true);
      expect(finalValue.completedCount).toBe(2);
      expect(finalValue.currentTask).toBeNull();
    });

    it("accumulator tracks completed methods in order", async () => {
      const effect = runMethodology(taskMethodology, initialState).pipe(
        Effect.provide(mockLayer),
      );

      const result = await Effect.runPromise(effect);

      const methods = result.accumulator.completedMethods;
      expect(methods).toHaveLength(4);
      expect(methods[0].methodId).toBe("M_PICK");
      expect(methods[1].methodId).toBe("M_COMPLETE");
      expect(methods[2].methodId).toBe("M_PICK");
      expect(methods[3].methodId).toBe("M_COMPLETE");
    });

    it("all completed methods report objective met", async () => {
      const effect = runMethodology(taskMethodology, initialState).pipe(
        Effect.provide(mockLayer),
      );

      const result = await Effect.runPromise(effect);

      for (const method of result.accumulator.completedMethods) {
        expect(method.objectiveMet).toBe(true);
      }
    });
  });

  describe("runMethodologyToCompletion convenience wrapper", () => {
    it("produces the same result as runMethodology", async () => {
      const effect = runMethodologyToCompletion(taskMethodology, initialState).pipe(
        Effect.provide(mockLayer),
      );

      const result = await Effect.runPromise(effect);

      expect(result.status).toBe("completed");
      expect(result.accumulator.loopCount).toBe(4);
      expect(result.finalState.value.completedCount).toBe(2);
    });
  });

  describe("termination certificate", () => {
    it("measure strictly decreases through the execution", async () => {
      const measure = taskMethodology.terminationCertificate.measure;

      // Initial: 2 non-done tasks
      expect(measure(initialState.value)).toBe(2);

      // After pick: still 2 non-done (in_progress is not done)
      const afterPick: TaskState = {
        tasks: [
          { id: "task-1", status: "in_progress" },
          { id: "task-2", status: "open" },
        ],
        currentTask: "task-1",
        completedCount: 0,
      };
      expect(measure(afterPick)).toBe(2);

      // After complete: 1 non-done
      const afterComplete: TaskState = {
        tasks: [
          { id: "task-1", status: "done" },
          { id: "task-2", status: "open" },
        ],
        currentTask: null,
        completedCount: 1,
      };
      expect(measure(afterComplete)).toBe(1);

      // After both done: 0
      const afterAllDone: TaskState = {
        tasks: [
          { id: "task-1", status: "done" },
          { id: "task-2", status: "done" },
        ],
        currentTask: null,
        completedCount: 2,
      };
      expect(measure(afterAllDone)).toBe(0);
    });
  });

  describe("safety bounds enforcement", () => {
    it("triggers safety violation when maxLoops is too low", async () => {
      const tightMethodology: Methodology<TaskState> = {
        ...taskMethodology,
        safety: {
          ...taskMethodology.safety,
          maxLoops: 2, // Only allow 2 loops — not enough for 2 tasks
        },
      };

      const effect = runMethodology(tightMethodology, initialState).pipe(
        Effect.provide(mockLayer),
      );

      const result = await Effect.runPromise(effect);
      expect(result.status).toBe("safety_violation");
      expect(result.accumulator.loopCount).toBe(2);
    });
  });

  describe("edge case: empty task list", () => {
    it("terminates immediately when all tasks are already done", async () => {
      const emptyState: WorldState<TaskState> = {
        value: {
          tasks: [],
          currentTask: null,
          completedCount: 0,
        },
        axiomStatus: { valid: true, violations: [] },
      };

      const effect = runMethodology(taskMethodology, emptyState).pipe(
        Effect.provide(mockLayer),
      );

      const result = await Effect.runPromise(effect);

      // Empty list: every() returns true for an empty array, so allDone fires
      // But first arm (pick) checks hasOpen AND noCurrent — hasOpen is false for empty list
      // Second arm (complete) checks hasCurrent — null, so false
      // Third arm (terminate) checks allDone — true for empty array
      expect(result.status).toBe("completed");
      expect(result.accumulator.loopCount).toBe(0);
    });
  });

  describe("edge case: single task", () => {
    it("runs 1 task to completion: pick -> complete -> terminate", async () => {
      const singleTaskState: WorldState<TaskState> = {
        value: {
          tasks: [{ id: "task-1", status: "open" }],
          currentTask: null,
          completedCount: 0,
        },
        axiomStatus: { valid: true, violations: [] },
      };

      const effect = runMethodology(taskMethodology, singleTaskState).pipe(
        Effect.provide(mockLayer),
      );

      const result = await Effect.runPromise(effect);

      expect(result.status).toBe("completed");
      expect(result.accumulator.loopCount).toBe(2); // pick + complete
      expect(result.finalState.value.completedCount).toBe(1);
      expect(result.finalState.value.tasks[0].status).toBe("done");
    });
  });
});
