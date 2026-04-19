// SPDX-License-Identifier: Apache-2.0
/**
 * Predicate<A> — First-order logic over TypeScript values.
 *
 * Tagged union ADT with constructors for all standard logical connectives.
 * This is the typed form of closed Σ-sentences from F1-FTH Definition 1.1.
 *
 * @see theory-mapping.md — maps to closed Σ-sentence in Ax
 */

/** A predicate over values of type A. */
export type Predicate<A> =
  | { readonly tag: "val"; readonly value: boolean }
  | { readonly tag: "check"; readonly label: string; readonly check: (a: A) => boolean }
  | { readonly tag: "and"; readonly left: Predicate<A>; readonly right: Predicate<A> }
  | { readonly tag: "or"; readonly left: Predicate<A>; readonly right: Predicate<A> }
  | { readonly tag: "not"; readonly inner: Predicate<A> }
  | { readonly tag: "implies"; readonly antecedent: Predicate<A>; readonly consequent: Predicate<A> }
  | { readonly tag: "forall"; readonly label: string; readonly elements: (a: A) => A[]; readonly body: Predicate<A> }
  | { readonly tag: "exists"; readonly label: string; readonly elements: (a: A) => A[]; readonly body: Predicate<A> };

// ── Constructors ──

/** Literal true. */
export const TRUE: Predicate<any> = { tag: "val", value: true };

/** Literal false. */
export const FALSE: Predicate<any> = { tag: "val", value: false };

/** A named runtime check. The label is for diagnostics. */
export function check<A>(label: string, f: (a: A) => boolean): Predicate<A> {
  return { tag: "check", label, check: f };
}

/** Logical conjunction. */
export function and<A>(...preds: Predicate<A>[]): Predicate<A> {
  if (preds.length === 0) return TRUE;
  return preds.reduce((acc, p) => ({ tag: "and" as const, left: acc, right: p }));
}

/** Logical disjunction. */
export function or<A>(...preds: Predicate<A>[]): Predicate<A> {
  if (preds.length === 0) return FALSE;
  return preds.reduce((acc, p) => ({ tag: "or" as const, left: acc, right: p }));
}

/** Logical negation. */
export function not<A>(inner: Predicate<A>): Predicate<A> {
  return { tag: "not", inner };
}

/** Material implication: if antecedent then consequent. */
export function implies<A>(antecedent: Predicate<A>, consequent: Predicate<A>): Predicate<A> {
  return { tag: "implies", antecedent, consequent };
}

/** Universal quantification over a sub-collection extracted from context. */
export function forall<A>(label: string, elements: (a: A) => A[], body: Predicate<A>): Predicate<A> {
  return { tag: "forall", label, elements, body };
}

/** Existential quantification over a sub-collection extracted from context. */
export function exists<A>(label: string, elements: (a: A) => A[], body: Predicate<A>): Predicate<A> {
  return { tag: "exists", label, elements, body };
}
