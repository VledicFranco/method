# predicate/ — Predicate Algebra

Typed logical predicate system for expressing preconditions, postconditions, and transition guards over world state.

## Components

| Component | Description |
|-----------|-------------|
| `Predicate<A>` | Discriminated union — `val` (literal), `check` (function), `and`, `or`, `not`, `implies`, `forall`, `exists` |
| `check()` | Creates a labeled predicate from a boolean function `(a: A) => boolean` |
| `and()` / `or()` / `not()` | Boolean combinators |
| `implies()` | Logical implication |
| `forall()` / `exists()` | Quantifiers over collections derived from the world state |
| `TRUE` / `FALSE` | Constant predicates |
| `evaluate.ts` | Evaluates a `Predicate<A>` against a value — returns `{ passed, evidence }` |
| `quantifiers.ts` | Extended quantifier helpers for complex domain reasoning |

## Design

Predicates are pure data (no side effects). The `evaluate()` function in `evaluate.ts` applies them, returning structured evidence for why a check passed or failed. This evidence surfaces in gate failure reports and methodology retros.

The predicate algebra is also used by the gate system: `Gate<S>` implementations often use predicates internally to compose complex conditions from simpler labeled checks.
