/**
 * Semantic Programming Language (SPL) — Core module.
 *
 * Typed semantic functions that compose like FP combinators, execute via
 * LLM agents, and return (data, truths) — distinguishing algorithmic
 * verification (confidence 1.0) from semantic judgment (confidence < 1.0).
 *
 * v2: Tagged union types + output-guided recursion (unfold-fold).
 *
 * @see fca/advice/03-recursive-semantic-algorithms.md
 */

// Core types (tagged union)
export {
  type SemanticFn, type AtomicFn, type PipelineFn, type ParallelFn, type RecursiveFn, type InvariantFn,
  type BaseFn, type SemanticResult, type SemanticError,
  semanticFn, pureFn,
} from "./fn.js";

// Truth tracking
export { type Truth, type VerificationMethod, algorithmic, semantic, sequentialConfidence, parallelConfidence, partition, allHold } from "./truth.js";

// Composition operators
export { pipe, parallel, recurse, withInvariants } from "./compose.js";

// Execution
export { runSemantic, type RunSemanticConfig } from "./run.js";
