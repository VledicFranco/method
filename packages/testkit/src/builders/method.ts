/**
 * Method builder — construct Method<S> with fluent API.
 */

import {
  type Method,
  type DomainTheory,
  type Role,
  type Step,
  type StepDAG,
  type StepEdge,
  type Measure,
  type Predicate,
  TRUE,
} from "@method/methodts";

type MethodBuilderState<S> = {
  id: string;
  name: string;
  domain: DomainTheory<S> | null;
  roles: Role<S, unknown>[];
  steps: Step<S>[];
  edges: StepEdge[];
  objective: Predicate<S>;
  measures: Measure<S>[];
};

export type MethodBuilder<S> = {
  /** Set method name. */
  name(name: string): MethodBuilder<S>;
  /** Set domain theory. */
  domain(domain: DomainTheory<S>): MethodBuilder<S>;
  /** Add a role with an observe function. */
  role(id: string, observe: (s: S) => unknown, authorized?: string[]): MethodBuilder<S>;
  /** Set the step list (builds a linear DAG from the order). */
  steps(steps: Step<S>[]): MethodBuilder<S>;
  /** Add an explicit edge between steps (for non-linear DAGs). */
  edge(from: string, to: string): MethodBuilder<S>;
  /** Set the method objective predicate. */
  objective(pred: Predicate<S>): MethodBuilder<S>;
  /** Add a progress measure. */
  measure(id: string, name: string, compute: (s: S) => number, range: [number, number], terminal: number): MethodBuilder<S>;
  /** Build the Method. */
  build(): Method<S>;
};

/**
 * Create a fluent method builder.
 *
 * Steps are arranged into a linear DAG by default (sequential execution).
 * Use `.edge()` to override with explicit edges for non-linear DAGs.
 *
 * @example
 * ```ts
 * const method = methodBuilder<MyState>("M_TRIAGE")
 *   .name("Triage Incident")
 *   .domain(D_INCIDENT)
 *   .role("oncall", s => s)
 *   .steps([triageStep])
 *   .objective(isTriaged)
 *   .build();
 * ```
 */
export function methodBuilder<S>(id: string): MethodBuilder<S> {
  const state: MethodBuilderState<S> = {
    id,
    name: id,
    domain: null,
    roles: [],
    steps: [],
    edges: [],
    objective: TRUE as Predicate<S>,
    measures: [],
  };

  const builder: MethodBuilder<S> = {
    name(name) {
      state.name = name;
      return builder;
    },
    domain(domain) {
      state.domain = domain;
      return builder;
    },
    role(id, observe, authorized) {
      state.roles.push({
        id,
        description: id,
        observe,
        authorized: authorized ?? state.steps.map((s) => s.id),
        notAuthorized: [],
      });
      return builder;
    },
    steps(steps) {
      state.steps = steps;
      return builder;
    },
    edge(from, to) {
      state.edges.push({ from, to });
      return builder;
    },
    objective(pred) {
      state.objective = pred;
      return builder;
    },
    measure(id, name, compute, range, terminal) {
      state.measures.push({
        id,
        name,
        compute,
        range: range as readonly [number, number],
        terminal,
      });
      return builder;
    },
    build(): Method<S> {
      const domain = state.domain ?? emptyDomain<S>(state.id);
      const dag = buildDAG(state.steps, state.edges);

      // Auto-populate role authorized list if roles were added before steps
      const roles = state.roles.map((r) => ({
        ...r,
        authorized: r.authorized.length > 0 ? r.authorized : state.steps.map((s) => s.id),
      }));

      return {
        id: state.id,
        name: state.name,
        domain,
        roles,
        dag,
        objective: state.objective,
        measures: state.measures,
      };
    },
  };

  return builder;
}

function buildDAG<S>(steps: Step<S>[], explicitEdges: StepEdge[]): StepDAG<S> {
  if (steps.length === 0) {
    return { steps: [], edges: [], initial: "", terminal: "" };
  }

  // Use explicit edges if provided, otherwise build linear chain
  const edges = explicitEdges.length > 0
    ? explicitEdges
    : steps.slice(0, -1).map((s, i) => ({ from: s.id, to: steps[i + 1].id }));

  return {
    steps,
    edges,
    initial: steps[0].id,
    terminal: steps[steps.length - 1].id,
  };
}

function emptyDomain<S>(methodId: string): DomainTheory<S> {
  return {
    id: `D_${methodId}`,
    signature: { sorts: [], functionSymbols: [], predicates: {} },
    axioms: {},
  };
}
