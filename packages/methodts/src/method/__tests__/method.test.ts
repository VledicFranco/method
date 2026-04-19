// SPDX-License-Identifier: Apache-2.0
/**
 * Method<S> type construction tests.
 *
 * Validates the 5-tuple from F1-FTH Definition 6.1:
 * M = (D, Roles, Gamma, O, mu_vec)
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import type { Method } from "../method.js";
import type { StepDAG } from "../dag.js";
import type { DomainTheory } from "../../domain/domain-theory.js";
import type { Role } from "../../domain/role.js";
import type { Measure } from "../measure.js";
import { TRUE, check } from "../../predicate/predicate.js";

type ProjectState = {
  readonly phase: "init" | "dev" | "review" | "done";
  readonly coverage: number;
  readonly filesChanged: number;
};

describe("Method — 5-tuple construction (F1-FTH Def 6.1)", () => {
  it("constructs a Method with all fields: domain, roles, dag, objective, measures", () => {
    // D — Domain theory
    const domain: DomainTheory<ProjectState> = {
      id: "d-delivery",
      signature: {
        sorts: [
          { name: "Phase", description: "Delivery phase", cardinality: "finite" },
          { name: "Metric", description: "Numeric metric", cardinality: "unbounded" },
        ],
        functionSymbols: [
          {
            name: "currentPhase",
            inputSorts: [],
            outputSort: "Phase",
            totality: "total",
            description: "The current delivery phase",
          },
        ],
        predicates: {
          "in-dev": check<ProjectState>("in-dev", (s) => s.phase === "dev"),
          "has-coverage": check<ProjectState>("has-coverage", (s) => s.coverage > 80),
        },
      },
      axioms: {
        "coverage-non-negative": check<ProjectState>(
          "coverage >= 0",
          (s) => s.coverage >= 0,
        ),
      },
    };

    // Roles
    const devRole: Role<ProjectState, { phase: string; filesChanged: number }> = {
      id: "developer",
      description: "Implements features and fixes",
      observe: (s) => ({ phase: s.phase, filesChanged: s.filesChanged }),
      authorized: ["write_file", "run_tests"],
      notAuthorized: ["deploy"],
    };

    const reviewerRole: Role<ProjectState, { phase: string; coverage: number }> = {
      id: "reviewer",
      description: "Reviews code quality",
      observe: (s) => ({ phase: s.phase, coverage: s.coverage }),
      authorized: ["read_file", "comment"],
      notAuthorized: ["write_file", "deploy"],
    };

    // Gamma — Step DAG
    const dag: StepDAG<ProjectState> = {
      steps: [
        {
          id: "s-develop",
          name: "Develop",
          role: "developer",
          precondition: check<ProjectState>("in-init", (s) => s.phase === "init"),
          postcondition: check<ProjectState>("in-dev", (s) => s.phase === "dev"),
          execution: {
            tag: "script",
            execute: (s) => Effect.succeed({ ...s, phase: "dev" as const }),
          },
        },
        {
          id: "s-review",
          name: "Review",
          role: "reviewer",
          precondition: check<ProjectState>("in-dev", (s) => s.phase === "dev"),
          postcondition: check<ProjectState>("in-review", (s) => s.phase === "review"),
          execution: {
            tag: "script",
            execute: (s) => Effect.succeed({ ...s, phase: "review" as const }),
          },
        },
        {
          id: "s-complete",
          name: "Complete",
          role: "developer",
          precondition: check<ProjectState>("in-review", (s) => s.phase === "review"),
          postcondition: check<ProjectState>("done", (s) => s.phase === "done"),
          execution: {
            tag: "script",
            execute: (s) => Effect.succeed({ ...s, phase: "done" as const }),
          },
        },
      ],
      edges: [
        { from: "s-develop", to: "s-review" },
        { from: "s-review", to: "s-complete" },
      ],
      initial: "s-develop",
      terminal: "s-complete",
    };

    // O — Objective
    const objective = check<ProjectState>(
      "delivered",
      (s) => s.phase === "done" && s.coverage >= 80,
    );

    // mu_vec — Measures
    const measures: Measure<ProjectState>[] = [
      {
        id: "m-coverage",
        name: "Test Coverage",
        compute: (s) => s.coverage,
        range: [0, 100] as const,
        terminal: 80,
        order: {
          compare: (a, b) => a.coverage - b.coverage,
        },
      },
      {
        id: "m-phase-progress",
        name: "Phase Progress",
        compute: (s) => {
          const phaseOrder = { init: 0, dev: 1, review: 2, done: 3 };
          return phaseOrder[s.phase];
        },
        range: [0, 3] as const,
        terminal: 3,
      },
    ];

    // Assemble the method
    const method: Method<ProjectState> = {
      id: "m-delivery",
      name: "Software Delivery",
      domain,
      roles: [devRole, reviewerRole],
      dag,
      objective,
      measures,
    };

    // Verify all 5-tuple components
    expect(method.id).toBe("m-delivery");
    expect(method.name).toBe("Software Delivery");

    // D — domain
    expect(method.domain.id).toBe("d-delivery");
    expect(method.domain.signature.sorts).toHaveLength(2);
    expect(method.domain.signature.functionSymbols).toHaveLength(1);
    expect(Object.keys(method.domain.signature.predicates)).toHaveLength(2);
    expect(Object.keys(method.domain.axioms)).toHaveLength(1);

    // Roles
    expect(method.roles).toHaveLength(2);
    expect(method.roles[0].id).toBe("developer");
    expect(method.roles[1].id).toBe("reviewer");

    // Gamma — DAG
    expect(method.dag.steps).toHaveLength(3);
    expect(method.dag.edges).toHaveLength(2);
    expect(method.dag.initial).toBe("s-develop");
    expect(method.dag.terminal).toBe("s-complete");

    // O — Objective (check tag)
    expect(method.objective.tag).toBe("check");

    // mu_vec — Measures
    expect(method.measures).toHaveLength(2);
    expect(method.measures[0].id).toBe("m-coverage");
    expect(method.measures[1].id).toBe("m-phase-progress");
  });
});
