// SPDX-License-Identifier: Apache-2.0
/**
 * TLA+ AST types — structural representation of TLA+ specifications.
 *
 * These types model enough of TLA+ to express methodology specifications:
 * modules, variables, predicates (Init/Next), invariants, and temporal properties.
 */

/** TLA+ module structure. */
export type TLAModule = {
  readonly name: string;
  readonly extends: readonly string[];
  readonly variables: readonly TLAVariable[];
  readonly constants: readonly string[];
  readonly definitions: readonly TLAPredicate[];
  readonly init: TLAPredicate;
  readonly next: TLAPredicate;
  readonly invariants: readonly TLAProperty[];
  readonly properties: readonly TLAProperty[];
};

/** A TLA+ state variable with an informal type annotation (rendered as comment). */
export type TLAVariable = {
  readonly name: string;
  readonly type: string;
};

/** A named TLA+ predicate (Init, Next, or helper). */
export type TLAPredicate = {
  readonly name: string;
  readonly body: string;
};

/** A named TLA+ property — either a state invariant or a temporal property. */
export type TLAProperty = {
  readonly name: string;
  readonly kind: "invariant" | "temporal";
  readonly body: string;
};
