// SPDX-License-Identifier: Apache-2.0
/**
 * DomainTheory<S> — Typed representation of F1-FTH Definition 1.1.
 *
 * D = (Σ, Ax) where Σ = (S, Ω, Π) is a many-sorted signature.
 * S parameterizes the instantiated Σ-structure (Def 1.2).
 *
 * @see theory-mapping.md — maps to D = (Σ, Ax)
 */

import type { Predicate } from "../predicate/predicate.js";
import { evaluate } from "../predicate/evaluate.js";

/** A sort declaration — a named type in the domain. */
export type SortDecl = {
  readonly name: string;
  readonly description: string;
  readonly cardinality: "finite" | "unbounded" | "singleton";
};

/** A function symbol declaration — a typed operation in the domain. */
export type FunctionDecl = {
  readonly name: string;
  readonly inputSorts: string[];
  readonly outputSort: string;
  readonly totality: "total" | "partial";
  readonly description?: string;
};

/** The formal domain theory. S is the world state type (Σ-structure). */
export type DomainTheory<S> = {
  readonly id: string;
  readonly signature: {
    readonly sorts: readonly SortDecl[];
    readonly functionSymbols: readonly FunctionDecl[];
    readonly predicates: Readonly<Record<string, Predicate<S>>>;
  };
  readonly axioms: Readonly<Record<string, Predicate<S>>>;
};

/** Validate that all axioms hold for a given state. Mod(D) membership test (Def 1.3). */
export function validateAxioms<S>(
  domain: DomainTheory<S>,
  state: S,
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  for (const [name, axiom] of Object.entries(domain.axioms)) {
    if (!evaluate(axiom, state)) {
      violations.push(name);
    }
  }
  return { valid: violations.length === 0, violations };
}

/** Validate signature arity coherence: all sort references in functions/predicates exist. */
export function validateSignature<S>(domain: DomainTheory<S>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const sortNames = new Set(domain.signature.sorts.map((s) => s.name));

  for (const fn of domain.signature.functionSymbols) {
    for (const input of fn.inputSorts) {
      if (!sortNames.has(input)) {
        errors.push(`Function ${fn.name}: input sort "${input}" not declared`);
      }
    }
    if (!sortNames.has(fn.outputSort)) {
      errors.push(`Function ${fn.name}: output sort "${fn.outputSort}" not declared`);
    }
  }

  return { valid: errors.length === 0, errors };
}
