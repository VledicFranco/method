/**
 * Tests for DomainMorphism — structure-preserving maps between domain theories.
 *
 * F1-FTH Def 1.4: h: D_1 -> D_2 preserving sort membership,
 * function interpretation, and axiom satisfaction.
 */
import { describe, it, expect } from "vitest";
import type { DomainTheory } from "../../domain/domain-theory.js";
import {
  type DomainMorphism,
  composeMorphisms,
  verifyMorphism,
  verifySortMapping,
} from "../../domain/morphism.js";
import { check } from "../../predicate/predicate.js";

// ── Fixture types ──

type TaskState = {
  readonly tasks: readonly string[];
  readonly status: "open" | "closed";
};

type IssueState = {
  readonly issues: readonly string[];
  readonly resolved: boolean;
};

type TicketState = {
  readonly tickets: readonly string[];
  readonly done: boolean;
};

// ── Fixture domains ──

const taskDomain: DomainTheory<TaskState> = {
  id: "D-Task",
  signature: {
    sorts: [
      { name: "Task", description: "A work item", cardinality: "unbounded" },
      { name: "Status", description: "Lifecycle status", cardinality: "finite" },
    ],
    functionSymbols: [],
    predicates: {
      "has-tasks": check<TaskState>("has-tasks", (s) => s.tasks.length > 0),
    },
  },
  axioms: {
    "Ax-TasksExist": check<TaskState>("tasks-exist", (s) => s.tasks.length > 0),
    "Ax-Open": check<TaskState>("is-open", (s) => s.status === "open"),
  },
};

const issueDomain: DomainTheory<IssueState> = {
  id: "D-Issue",
  signature: {
    sorts: [
      { name: "Issue", description: "A tracked issue", cardinality: "unbounded" },
      { name: "Resolution", description: "Resolution flag", cardinality: "finite" },
    ],
    functionSymbols: [],
    predicates: {
      "has-issues": check<IssueState>("has-issues", (s) => s.issues.length > 0),
    },
  },
  axioms: {
    "Ax-IssuesExist": check<IssueState>("issues-exist", (s) => s.issues.length > 0),
    "Ax-Unresolved": check<IssueState>("unresolved", (s) => !s.resolved),
  },
};

const ticketDomain: DomainTheory<TicketState> = {
  id: "D-Ticket",
  signature: {
    sorts: [
      { name: "Ticket", description: "A support ticket", cardinality: "unbounded" },
      { name: "Completion", description: "Done flag", cardinality: "finite" },
    ],
    functionSymbols: [],
    predicates: {
      "has-tickets": check<TicketState>("has-tickets", (s) => s.tickets.length > 0),
    },
  },
  axioms: {
    "Ax-TicketsExist": check<TicketState>("tickets-exist", (s) => s.tickets.length > 0),
    "Ax-NotDone": check<TicketState>("not-done", (s) => !s.done),
  },
};

// ── Fixture morphisms ──

const taskToIssue: DomainMorphism<TaskState, IssueState> = {
  id: "h-task-issue",
  source: taskDomain,
  target: issueDomain,
  mapState: (s) => ({
    issues: [...s.tasks],
    resolved: s.status === "closed",
  }),
  mapSort: new Map([
    ["Task", "Issue"],
    ["Status", "Resolution"],
  ]),
};

const issueToTicket: DomainMorphism<IssueState, TicketState> = {
  id: "h-issue-ticket",
  source: issueDomain,
  target: ticketDomain,
  mapState: (s) => ({
    tickets: [...s.issues],
    done: s.resolved,
  }),
  mapSort: new Map([
    ["Issue", "Ticket"],
    ["Resolution", "Completion"],
  ]),
};

// ── Tests: construction ──

describe("DomainMorphism construction", () => {
  it("has all required fields", () => {
    expect(taskToIssue.id).toBe("h-task-issue");
    expect(taskToIssue.source).toBe(taskDomain);
    expect(taskToIssue.target).toBe(issueDomain);
    expect(typeof taskToIssue.mapState).toBe("function");
    expect(taskToIssue.mapSort).toBeInstanceOf(Map);
    expect(taskToIssue.mapSort.size).toBe(2);
  });
});

// ── Tests: composeMorphisms ──

describe("composeMorphisms", () => {
  it("produces A->C with composed state mapping", () => {
    const composed = composeMorphisms(taskToIssue, issueToTicket);
    expect(composed.source).toBe(taskDomain);
    expect(composed.target).toBe(ticketDomain);

    const taskState: TaskState = { tasks: ["T-1", "T-2"], status: "open" };
    const result = composed.mapState(taskState);
    expect(result).toEqual({ tickets: ["T-1", "T-2"], done: false });
  });

  it("composes sort maps correctly (A->B->C)", () => {
    const composed = composeMorphisms(taskToIssue, issueToTicket);
    expect(composed.mapSort.get("Task")).toBe("Ticket");
    expect(composed.mapSort.get("Status")).toBe("Completion");
    expect(composed.mapSort.size).toBe(2);
  });

  it("generates a composed id", () => {
    const composed = composeMorphisms(taskToIssue, issueToTicket);
    expect(composed.id).toBe("h-issue-ticket.h-task-issue");
  });

  it("drops sorts with broken chains in composition", () => {
    // Create a morphism where h2 doesn't map one of h1's target sorts
    const partialIssueToTicket: DomainMorphism<IssueState, TicketState> = {
      ...issueToTicket,
      id: "h-partial",
      mapSort: new Map([["Issue", "Ticket"]]), // Missing Resolution -> Completion
    };
    const composed = composeMorphisms(taskToIssue, partialIssueToTicket);
    // Task->Issue->Ticket is present, but Status->Resolution->? is broken
    expect(composed.mapSort.get("Task")).toBe("Ticket");
    expect(composed.mapSort.has("Status")).toBe(false);
    expect(composed.mapSort.size).toBe(1);
  });
});

// ── Tests: verifyMorphism ──

describe("verifyMorphism", () => {
  it("returns valid when morphism preserves axioms", () => {
    // Task state where source axioms pass, and mapped state satisfies target axioms
    const validStates: TaskState[] = [
      { tasks: ["T-1"], status: "open" },
      { tasks: ["T-1", "T-2"], status: "open" },
    ];
    const result = verifyMorphism(taskToIssue, validStates);
    expect(result).toEqual({ valid: true, counterexample: null });
  });

  it("returns counterexample when morphism breaks target axioms", () => {
    // Create a broken morphism that maps open tasks to resolved issues
    const brokenMorphism: DomainMorphism<TaskState, IssueState> = {
      id: "h-broken",
      source: taskDomain,
      target: issueDomain,
      mapState: (s) => ({
        issues: [...s.tasks],
        resolved: true, // Always resolved — breaks Ax-Unresolved
      }),
      mapSort: taskToIssue.mapSort,
    };
    const testStates: TaskState[] = [
      { tasks: ["T-1"], status: "open" }, // source-valid
    ];
    const result = verifyMorphism(brokenMorphism, testStates);
    expect(result.valid).toBe(false);
    expect(result.counterexample).toEqual({ tasks: ["T-1"], status: "open" });
  });

  it("skips source-invalid states (only tests preservation for Mod(D_1))", () => {
    // State that fails source axioms — should not trigger a violation
    const invalidSourceStates: TaskState[] = [
      { tasks: [], status: "closed" }, // fails Ax-TasksExist and Ax-Open
    ];
    const result = verifyMorphism(taskToIssue, invalidSourceStates);
    expect(result).toEqual({ valid: true, counterexample: null });
  });

  it("returns valid for empty test states", () => {
    const result = verifyMorphism(taskToIssue, []);
    expect(result).toEqual({ valid: true, counterexample: null });
  });
});

// ── Tests: verifySortMapping ──

describe("verifySortMapping", () => {
  it("returns valid when all source sorts are mapped", () => {
    const result = verifySortMapping(taskToIssue);
    expect(result).toEqual({ valid: true, unmapped: [] });
  });

  it("reports unmapped sorts", () => {
    const partialMorphism: DomainMorphism<TaskState, IssueState> = {
      ...taskToIssue,
      id: "h-partial-sorts",
      mapSort: new Map([["Task", "Issue"]]), // Missing Status -> Resolution
    };
    const result = verifySortMapping(partialMorphism);
    expect(result.valid).toBe(false);
    expect(result.unmapped).toEqual(["Status"]);
  });

  it("reports multiple unmapped sorts", () => {
    const emptyMorphism: DomainMorphism<TaskState, IssueState> = {
      ...taskToIssue,
      id: "h-empty-sorts",
      mapSort: new Map(), // No mappings at all
    };
    const result = verifySortMapping(emptyMorphism);
    expect(result.valid).toBe(false);
    expect(result.unmapped).toHaveLength(2);
    expect(result.unmapped).toContain("Task");
    expect(result.unmapped).toContain("Status");
  });
});
