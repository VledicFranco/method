/**
 * tla/ — TLA+ compiler for formal methodology verification.
 *
 * compileMethodology(): converts Methodology<S> → TlaModule AST → .tla string.
 * TLA+ AST types: TlaModule, TlaAction, TlaFormula, TlaVariable.
 *
 * Output is for formal verification only (TLC model checker).
 * Execution path is runMethodology() in runtime/.
 */

export * from './ast.js';
export * from './compile.js';
