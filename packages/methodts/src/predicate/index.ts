/**
 * predicate/ — Typed logical predicate algebra.
 *
 * Predicate<A>: discriminated union (val, check, and, or, not, implies, forall, exists).
 * Constructors: check(), and(), or(), not(), implies(), forall(), exists(), TRUE, FALSE.
 * evaluate(): applies a Predicate<A> to a value — returns { passed, evidence }.
 * quantifiers.ts: extended quantifier helpers for domain reasoning.
 */

export * from './predicate.js';
export * from './evaluate.js';
export * from './quantifiers.js';
