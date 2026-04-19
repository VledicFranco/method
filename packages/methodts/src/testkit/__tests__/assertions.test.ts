// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for testkit assertions — predicates, domain, method, methodology, retraction.
 */

import { describe, it, expect } from "vitest";
import { check, and, not, evaluate, type Predicate } from "../../index.js";
import {
  domainBuilder,
  scriptStep,
  methodBuilder,
  methodologyBuilder,
  assertHolds,
  assertRejects,
  assertEquivalent,
  assertSignatureValid,
  assertAxiomsSatisfied,
  assertAxiomsHold,
  assertAxiomsViolated,
  assertCompiles,
  assertDAGAcyclic,
  assertRolesCovered,
  assertCoherent,
  assertRoutesTo,
  assertTerminates,
  assertRoutingTotal,
  assertRetracts,
} from "../index.js";

// ── Shared domain ──

type TaskState = {
  tasks: Array<{ id: string; status: "open" | "done" }>;
  current: string | null;
};

const hasOpen = check<TaskState>("has_open", (s) => s.tasks.some((t) => t.status === "open"));
const allDone = check<TaskState>("all_done", (s) => s.tasks.every((t) => t.status === "done"));
const hasCurrent = check<TaskState>("has_current", (s) => s.current !== null);
const noCurrent = check<TaskState>("no_current", (s) => s.current === null);

const STATES = {
  initial: { tasks: [{ id: "t1", status: "open" as const }], current: null },
  picked: { tasks: [{ id: "t1", status: "open" as const }], current: "t1" },
  done: { tasks: [{ id: "t1", status: "done" as const }], current: null },
};

// ── Predicate assertions ──

describe("predicate assertions", () => {
  it("assertHolds passes for true predicates", () => {
    assertHolds(hasOpen, STATES.initial);
    assertHolds(hasCurrent, STATES.picked);
    assertHolds(allDone, STATES.done);
  });

  it("assertHolds throws with trace for false predicates", () => {
    expect(() => assertHolds(hasOpen, STATES.done)).toThrow("has_open");
    expect(() => assertHolds(hasCurrent, STATES.initial)).toThrow("has_current");
  });

  it("assertRejects passes for false predicates", () => {
    assertRejects(hasOpen, STATES.done);
    assertRejects(hasCurrent, STATES.initial);
  });

  it("assertRejects throws for true predicates", () => {
    expect(() => assertRejects(hasOpen, STATES.initial)).toThrow("reject");
  });

  it("assertEquivalent passes for equivalent predicates", () => {
    const pred1 = and(hasOpen, noCurrent);
    const pred2 = check<TaskState>("manual_check", (s) =>
      s.tasks.some((t) => t.status === "open") && s.current === null,
    );
    assertEquivalent(pred1, pred2, Object.values(STATES));
  });

  it("assertEquivalent throws for non-equivalent predicates", () => {
    expect(() =>
      assertEquivalent(hasOpen, allDone, Object.values(STATES)),
    ).toThrow("not equivalent");
  });

  it("error message includes trace tree", () => {
    const compound = and(hasOpen, noCurrent);
    try {
      assertHolds(compound, STATES.done);
      expect.fail("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("AND");
      expect(msg).toContain("FAILED");
    }
  });
});

// ── Domain assertions ──

describe("domain assertions", () => {
  const domain = domainBuilder<TaskState>("D_TASKS")
    .sort("Task", "unbounded")
    .predicate("has_open", (s) => s.tasks.some((t) => t.status === "open"))
    .axiom("tasks_exist", (s) => s.tasks.length > 0)
    .build();

  it("assertSignatureValid passes for valid domain", () => {
    assertSignatureValid(domain);
  });

  it("assertAxiomsSatisfied passes when at least one state satisfies", () => {
    assertAxiomsSatisfied(domain, [STATES.initial, STATES.done]);
  });

  it("assertAxiomsHold passes for valid state", () => {
    assertAxiomsHold(domain, STATES.initial);
  });

  it("assertAxiomsHold throws for invalid state", () => {
    const emptyState = { tasks: [] as TaskState["tasks"], current: null };
    expect(() => assertAxiomsHold(domain, emptyState)).toThrow("tasks_exist");
  });

  it("assertAxiomsViolated passes for correctly violated state", () => {
    const emptyState = { tasks: [] as TaskState["tasks"], current: null };
    assertAxiomsViolated(domain, emptyState, ["tasks_exist"]);
  });

  it("assertAxiomsViolated throws when state is actually valid", () => {
    expect(() => assertAxiomsViolated(domain, STATES.initial, ["tasks_exist"])).toThrow("all axioms passed");
  });
});

// ── Method assertions ──

describe("method assertions", () => {
  const domain = domainBuilder<TaskState>("D_TASKS")
    .sort("Task", "unbounded")
    .build();

  const pickStep = scriptStep<TaskState>("pick", {
    role: "worker",
    pre: and(hasOpen, noCurrent),
    post: hasCurrent,
    execute: (s) => ({ ...s, current: s.tasks.find((t) => t.status === "open")!.id }),
  });

  const method = methodBuilder<TaskState>("M_PICK")
    .domain(domain)
    .role("worker", (s) => s)
    .steps([pickStep])
    .objective(hasCurrent)
    .build();

  it("assertCompiles passes for valid method", () => {
    const report = assertCompiles(method, Object.values(STATES));
    expect(report.overall).not.toBe("failed");
  });

  it("assertDAGAcyclic passes for valid DAG", () => {
    assertDAGAcyclic(method);
  });

  it("assertRolesCovered passes when all roles defined", () => {
    assertRolesCovered(method);
  });

  it("assertRolesCovered throws for missing roles", () => {
    const broken = methodBuilder<TaskState>("M_BROKEN")
      .steps([pickStep])  // step has role "worker" but no roles defined
      .build();

    expect(() => assertRolesCovered(broken)).toThrow("worker");
  });
});

// ── Methodology assertions ──

describe("methodology assertions", () => {
  const domain = domainBuilder<TaskState>("D_TASKS").build();

  const pickStep = scriptStep<TaskState>("pick", {
    role: "worker",
    pre: and(hasOpen, noCurrent),
    post: hasCurrent,
    execute: (s) => ({ ...s, current: s.tasks.find((t) => t.status === "open")!.id }),
  });

  const completeStep = scriptStep<TaskState>("complete", {
    role: "worker",
    pre: hasCurrent,
    post: noCurrent,
    execute: (s) => ({
      tasks: s.tasks.map((t) => t.id === s.current ? { ...t, status: "done" as const } : t),
      current: null,
    }),
  });

  const pickMethod = methodBuilder<TaskState>("M_PICK")
    .domain(domain)
    .role("worker", (s) => s)
    .steps([pickStep])
    .objective(hasCurrent)
    .build();

  const completeMethod = methodBuilder<TaskState>("M_COMPLETE")
    .domain(domain)
    .role("worker", (s) => s)
    .steps([completeStep])
    .objective(noCurrent)
    .build();

  const methodology = methodologyBuilder<TaskState>("PHI_TASKS")
    .domain(domain)
    .arm(1, "pick", and(hasOpen, noCurrent), pickMethod)
    .arm(2, "complete", hasCurrent, completeMethod)
    .arm(3, "terminate", allDone, null)
    .objective(allDone)
    .terminationMeasure(
      (s) => s.tasks.filter((t) => t.status !== "done").length,
      "Non-done tasks decrease each cycle.",
    )
    .build();

  const allStates = Object.values(STATES);

  it("assertCoherent passes for coherent methodology", () => {
    assertCoherent(methodology, allStates);
  });

  it("assertRoutesTo verifies correct routing", () => {
    assertRoutesTo(methodology, STATES.initial, "pick");
    assertRoutesTo(methodology, STATES.picked, "complete");
    assertRoutesTo(methodology, STATES.done, "terminate");
  });

  it("assertRoutesTo with null verifies termination", () => {
    assertRoutesTo(methodology, STATES.done, null);
  });

  it("assertRoutesTo throws on wrong arm", () => {
    expect(() => assertRoutesTo(methodology, STATES.initial, "complete")).toThrow("pick");
  });

  it("assertRoutesTo throws when expecting termination but arm fires", () => {
    expect(() => assertRoutesTo(methodology, STATES.initial, null)).toThrow("pick");
  });

  it("assertTerminates passes for valid trajectory", () => {
    assertTerminates(methodology, [STATES.initial, STATES.done]);
  });

  it("assertRoutingTotal passes when all states fire an arm", () => {
    assertRoutingTotal(methodology, allStates);
  });
});

// ── Retraction assertions ──

describe("retraction assertions", () => {
  type Child = { current: string | null };

  const retraction = {
    id: "RP-PICK",
    embed: (parent: TaskState): Child => ({ current: parent.current }),
    project: (child: Child): TaskState => ({
      tasks: [{ id: "t1", status: "open" }],
      current: child.current,
    }),
  };

  it("assertRetracts passes with custom comparison on touched dimensions", () => {
    assertRetracts(retraction, Object.values(STATES), (a, b) => a.current === b.current);
  });

  it("assertRetracts throws when round-trip fails", () => {
    const broken = {
      id: "RP-BROKEN",
      embed: (parent: TaskState): Child => ({ current: parent.current }),
      project: (_child: Child): TaskState => ({
        tasks: [],  // always returns empty tasks — breaks round-trip
        current: null,
      }),
    };

    expect(() =>
      assertRetracts(broken, [STATES.initial]),
    ).toThrow("project(embed(s))");
  });
});
