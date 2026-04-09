/**
 * domain/ — Domain theory types and validators (F1-FTH).
 *
 * DomainTheory<S>: ontological layer — sorts, function declarations, axioms.
 * validateAxioms(): checks axiom predicates against a world state.
 * validateSignature(): validates function declaration well-formedness.
 * Morphism: structure-preserving maps between domain theories.
 * Role: named capability assigned to agents in a domain.
 */

export type { SortDecl, FunctionDecl, DomainTheory } from './domain-theory.js';
export { validateAxioms, validateSignature } from './domain-theory.js';
export * from './morphism.js';
export * from './role.js';
