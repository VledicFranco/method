// SPDX-License-Identifier: Apache-2.0
/**
 * Predicate evaluation engine with diagnostic traces.
 *
 * @see F1-FTH §1 — Mod(D) membership testing via axiom evaluation
 */

import type { Predicate } from "./predicate.js";

/** Diagnostic trace from predicate evaluation. */
export type EvalTrace = {
  readonly label: string;
  readonly result: boolean;
  readonly children: readonly EvalTrace[];
};

/** Evaluate a predicate against a concrete value. Pure. */
export function evaluate<A>(pred: Predicate<A>, value: A): boolean {
  switch (pred.tag) {
    case "val": return pred.value;
    case "check": return pred.check(value);
    case "and": return evaluate(pred.left, value) && evaluate(pred.right, value);
    case "or": return evaluate(pred.left, value) || evaluate(pred.right, value);
    case "not": return !evaluate(pred.inner, value);
    case "implies": return !evaluate(pred.antecedent, value) || evaluate(pred.consequent, value);
    case "forall": return pred.elements(value).every((elem) => evaluate(pred.body, elem));
    case "exists": return pred.elements(value).some((elem) => evaluate(pred.body, elem));
  }
}

/** Evaluate with full diagnostic trace showing which sub-predicates contributed. */
export function evaluateWithTrace<A>(pred: Predicate<A>, value: A): EvalTrace {
  switch (pred.tag) {
    case "val":
      return { label: `literal(${pred.value})`, result: pred.value, children: [] };
    case "check":
      return { label: pred.label, result: pred.check(value), children: [] };
    case "and": {
      const l = evaluateWithTrace(pred.left, value);
      const r = evaluateWithTrace(pred.right, value);
      return { label: "AND", result: l.result && r.result, children: [l, r] };
    }
    case "or": {
      const l = evaluateWithTrace(pred.left, value);
      const r = evaluateWithTrace(pred.right, value);
      return { label: "OR", result: l.result || r.result, children: [l, r] };
    }
    case "not": {
      const inner = evaluateWithTrace(pred.inner, value);
      return { label: "NOT", result: !inner.result, children: [inner] };
    }
    case "implies": {
      const ant = evaluateWithTrace(pred.antecedent, value);
      const con = evaluateWithTrace(pred.consequent, value);
      return { label: "IMPLIES", result: !ant.result || con.result, children: [ant, con] };
    }
    case "forall": {
      const children = pred.elements(value).map((e) => evaluateWithTrace(pred.body, e));
      return { label: `FORALL(${pred.label})`, result: children.every((c) => c.result), children };
    }
    case "exists": {
      const children = pred.elements(value).map((e) => evaluateWithTrace(pred.body, e));
      return { label: `EXISTS(${pred.label})`, result: children.some((c) => c.result), children };
    }
  }
}
