/**
 * Reusable predicate library for common methodology patterns.
 *
 * Provides factory functions that produce typed Predicate<S> values
 * for frequent domain checks: equality, emptiness, thresholds, etc.
 * These compose with the core predicate combinators (and, or, not, implies).
 *
 * @see predicate/predicate.ts — core Predicate<A> ADT and constructors
 */

import { check } from "../predicate/predicate.js";
import type { Predicate } from "../predicate/predicate.js";

/** Reusable predicate library for common methodology patterns. */
export const predicates = {
  /** Check if a string field equals a specific value. */
  equals: <S>(label: string, field: (s: S) => string, value: string): Predicate<S> =>
    check(label, s => field(s) === value),

  /** Check if an array field is non-empty. */
  nonEmpty: <S>(label: string, field: (s: S) => readonly unknown[]): Predicate<S> =>
    check(label, s => field(s).length > 0),

  /** Check if an array field is empty. */
  isEmpty: <S>(label: string, field: (s: S) => readonly unknown[]): Predicate<S> =>
    check(label, s => field(s).length === 0),

  /** Check if a numeric field meets a threshold. */
  threshold: <S>(label: string, field: (s: S) => number, min: number): Predicate<S> =>
    check(label, s => field(s) >= min),

  /** Check if a boolean field is true. */
  isTrue: <S>(label: string, field: (s: S) => boolean): Predicate<S> =>
    check(label, field),

  /** Check if a string field is in a list. */
  oneOf: <S>(label: string, field: (s: S) => string, values: readonly string[]): Predicate<S> =>
    check(label, s => values.includes(field(s))),

  /** Check if array contains a specific value. */
  includes: <S>(label: string, field: (s: S) => readonly string[], value: string): Predicate<S> =>
    check(label, s => field(s).includes(value)),

  /** Check if all elements of one array are in another. */
  subsetOf: <S>(label: string, field: (s: S) => readonly string[], superset: (s: S) => readonly string[]): Predicate<S> =>
    check(label, s => field(s).every(item => superset(s).includes(item))),
};
