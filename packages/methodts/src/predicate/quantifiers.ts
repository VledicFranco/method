// SPDX-License-Identifier: Apache-2.0
/**
 * Heterogeneous quantifiers — forall/exists over sub-types.
 *
 * The homogeneous quantifiers in predicate.ts require elements: (a: A) => A[]
 * and body: Predicate<A> — both the extraction and the body operate on the
 * same type A.
 *
 * These heterogeneous variants extract elements of type B from context A,
 * then evaluate a Predicate<B> over them. This is essential for domain
 * morphisms and cross-domain reasoning where the quantified variable
 * lives in a different type than the outer context.
 *
 * The returned predicates are standard Predicate<A> values (tag: "check")
 * and integrate seamlessly with the existing evaluation framework.
 */

import type { Predicate } from "./predicate.js";
import { evaluate } from "./evaluate.js";

/**
 * Heterogeneous universal quantifier — forall over a sub-type B extracted from A.
 *
 * Returns true when body holds for every element extracted from the context.
 * Vacuously true when extract returns an empty array.
 */
export function forallOver<A, B>(
  label: string,
  extract: (a: A) => B[],
  body: Predicate<B>,
): Predicate<A> {
  return {
    tag: "check",
    label: `FORALL_OVER(${label})`,
    check: (a: A) => extract(a).every((elem) => evaluate(body, elem)),
  };
}

/**
 * Heterogeneous existential quantifier — exists over a sub-type B extracted from A.
 *
 * Returns true when body holds for at least one element extracted from the context.
 * False when extract returns an empty array.
 */
export function existsOver<A, B>(
  label: string,
  extract: (a: A) => B[],
  body: Predicate<B>,
): Predicate<A> {
  return {
    tag: "check",
    label: `EXISTS_OVER(${label})`,
    check: (a: A) => extract(a).some((elem) => evaluate(body, elem)),
  };
}
