/**
 * Domain theory builder — construct DomainTheory<S> with minimal boilerplate.
 */

import {
  type DomainTheory,
  type SortDecl,
  type FunctionDecl,
  type Predicate,
  check,
} from "../../index.js";

type DomainBuilderState<S> = {
  id: string;
  sorts: SortDecl[];
  functionSymbols: FunctionDecl[];
  predicates: Record<string, Predicate<S>>;
  axioms: Record<string, Predicate<S>>;
};

export type DomainBuilder<S> = {
  /** Add a sort declaration. */
  sort(name: string, cardinality: "finite" | "unbounded" | "singleton", description?: string): DomainBuilder<S>;
  /** Add a named predicate to the domain signature. */
  predicate(name: string, f: (s: S) => boolean): DomainBuilder<S>;
  /** Add a named predicate from an existing Predicate<S> value. */
  predicateFrom(name: string, pred: Predicate<S>): DomainBuilder<S>;
  /** Add a function symbol to the domain signature. */
  functionSymbol(name: string, inputSorts: string[], outputSort: string, totality?: "total" | "partial"): DomainBuilder<S>;
  /** Add a domain axiom (must hold for all valid states). */
  axiom(name: string, f: (s: S) => boolean): DomainBuilder<S>;
  /** Add an axiom from an existing Predicate<S> value. */
  axiomFrom(name: string, pred: Predicate<S>): DomainBuilder<S>;
  /** Build the DomainTheory. */
  build(): DomainTheory<S>;
};

/**
 * Create a fluent domain theory builder.
 *
 * @example
 * ```ts
 * const domain = domainBuilder<MyState>("D_MY")
 *   .sort("Item", "unbounded")
 *   .predicate("has_items", s => s.items.length > 0)
 *   .axiom("non_empty", s => s.items.length > 0)
 *   .build();
 * ```
 */
export function domainBuilder<S>(id: string): DomainBuilder<S> {
  const state: DomainBuilderState<S> = {
    id,
    sorts: [],
    functionSymbols: [],
    predicates: {},
    axioms: {},
  };

  const builder: DomainBuilder<S> = {
    sort(name, cardinality, description = "") {
      state.sorts.push({ name, description, cardinality });
      return builder;
    },
    predicate(name, f) {
      state.predicates[name] = check<S>(name, f);
      return builder;
    },
    predicateFrom(name, pred) {
      state.predicates[name] = pred;
      return builder;
    },
    functionSymbol(name, inputSorts, outputSort, totality = "total") {
      state.functionSymbols.push({ name, inputSorts, outputSort, totality });
      return builder;
    },
    axiom(name, f) {
      state.axioms[name] = check<S>(name, f);
      return builder;
    },
    axiomFrom(name, pred) {
      state.axioms[name] = pred;
      return builder;
    },
    build() {
      return {
        id: state.id,
        signature: {
          sorts: state.sorts,
          functionSymbols: state.functionSymbols,
          predicates: state.predicates,
        },
        axioms: state.axioms,
      };
    },
  };

  return builder;
}
