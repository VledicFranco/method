// SPDX-License-Identifier: Apache-2.0
/**
 * Method composition — compose two methods, merge domain theories, compose step DAGs.
 *
 * These operations support the methodology algebra:
 * 1. mergeDomainTheories — union two domain theories, detecting conflicts
 * 2. composeDAGs — sequential composition of step DAGs (A ; B)
 * 3. compose — full method composition: merge domains, compose DAGs, union roles, conjunct objectives
 *
 * Pure functions — no Effect dependency.
 */

import type { Method } from "../method/method.js";
import type { DomainTheory, SortDecl, FunctionDecl } from "../domain/domain-theory.js";
import type { StepDAG, StepEdge } from "../method/dag.js";
import type { Role } from "../domain/role.js";
import type { Predicate } from "../predicate/predicate.js";
import { and } from "../predicate/predicate.js";

/**
 * Merge two domain theories into one.
 * Sorts, function symbols, predicates, and axioms are unioned.
 * Conflicting names (same name, different definition) produce an error.
 */
export function mergeDomainTheories<S>(
  a: DomainTheory<S>,
  b: DomainTheory<S>,
): { merged: DomainTheory<S>; conflicts: string[] } {
  const conflicts: string[] = [];

  // Merge sorts (union by name)
  const sortMap = new Map<string, SortDecl>();
  for (const s of a.signature.sorts) sortMap.set(s.name, s);
  for (const s of b.signature.sorts) {
    if (sortMap.has(s.name)) {
      // Same name — check compatibility
      const existing = sortMap.get(s.name)!;
      if (existing.cardinality !== s.cardinality) conflicts.push(`Sort conflict: ${s.name}`);
    } else {
      sortMap.set(s.name, s);
    }
  }

  // Merge function symbols
  const fnMap = new Map<string, FunctionDecl>();
  for (const f of a.signature.functionSymbols) fnMap.set(f.name, f);
  for (const f of b.signature.functionSymbols) {
    if (fnMap.has(f.name)) {
      conflicts.push(`Function conflict: ${f.name}`);
    } else {
      fnMap.set(f.name, f);
    }
  }

  // Merge predicates
  const predicates: Record<string, Predicate<S>> = { ...a.signature.predicates };
  for (const [name, pred] of Object.entries(b.signature.predicates)) {
    if (name in predicates) conflicts.push(`Predicate conflict: ${name}`);
    else predicates[name] = pred;
  }

  // Merge axioms
  const axioms: Record<string, Predicate<S>> = { ...a.axioms };
  for (const [name, ax] of Object.entries(b.axioms)) {
    if (name in axioms) conflicts.push(`Axiom conflict: ${name}`);
    else axioms[name] = ax;
  }

  return {
    merged: {
      id: `${a.id}+${b.id}`,
      signature: {
        sorts: [...sortMap.values()],
        functionSymbols: [...fnMap.values()],
        predicates,
      },
      axioms,
    },
    conflicts,
  };
}

/**
 * Compose two step DAGs sequentially.
 * The terminal step of DAG A connects to the initial step of DAG B.
 */
export function composeDAGs<S>(a: StepDAG<S>, b: StepDAG<S>): StepDAG<S> {
  const bridgeEdge: StepEdge = { from: a.terminal, to: b.initial };
  return {
    steps: [...a.steps, ...b.steps],
    edges: [...a.edges, bridgeEdge, ...b.edges],
    initial: a.initial,
    terminal: b.terminal,
  };
}

/**
 * Compose two methods sequentially.
 * Merges domains, composes DAGs, unions roles, conjuncts objectives.
 */
export function compose<S>(a: Method<S>, b: Method<S>): { method: Method<S>; conflicts: string[] } {
  const { merged: domain, conflicts } = mergeDomainTheories(a.domain, b.domain);
  const dag = composeDAGs(a.dag, b.dag);

  // Union roles (deduplicate by id)
  const roleMap = new Map<string, Role<S, unknown>>();
  for (const r of a.roles) roleMap.set(r.id, r);
  for (const r of b.roles) roleMap.set(r.id, r); // b wins on conflict

  return {
    method: {
      id: `${a.id}+${b.id}`,
      name: `${a.name} + ${b.name}`,
      domain,
      roles: [...roleMap.values()],
      dag,
      objective: and(a.objective, b.objective),
      measures: [...a.measures, ...b.measures],
    },
    conflicts,
  };
}
