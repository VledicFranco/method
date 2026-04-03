/**
 * Composition operators for SemanticFn.
 *
 * Three operators mirror the three composition patterns in FCA:
 *   - pipe:     Sequential (A→B then B→C = A→C)
 *   - parallel: Independent branches (A→B and A→C = A→{B,C})
 *   - recurse:  FCA-level unfold-fold (output-guided decomposition)
 *
 * @see F1-FTH §F.005-MCOM — Method composition (sequential)
 * @see advice/03-recursive-semantic-algorithms.md — Recursion scheme
 */

import type { Predicate } from "../predicate/predicate.js";
import type {
  SemanticFn, PipelineFn, ParallelFn, RecursiveFn, InvariantFn,
} from "./fn.js";

// ── Sequential composition ──

/**
 * Pipe: f then g.
 * f: A → B, g: B → C  ⟹  pipe(f, g): A → C
 */
export function pipe<A, B, C>(
  f: SemanticFn<A, B>,
  g: SemanticFn<B, C>,
): PipelineFn<A, B, C> {
  return {
    tag: "pipeline",
    name: `${f.name} | ${g.name}`,
    first: f,
    second: g,
    pre: f.pre,
    post: g.post as readonly Predicate<C>[],
    invariants: f.invariants,
  };
}

// ── Parallel composition ──

/**
 * Parallel: run f and g independently on the same input.
 * f: A → B, g: A → C  ⟹  parallel(f, g): A → { left: B, right: C }
 */
export function parallel<A, B, C>(
  f: SemanticFn<A, B>,
  g: SemanticFn<A, C>,
): ParallelFn<A, B, C> {
  return {
    tag: "parallel",
    name: `${f.name} ∥ ${g.name}`,
    left: f,
    right: g,
    pre: [...f.pre, ...g.pre] as readonly Predicate<A>[],
    post: [] as any,  // Parallel output type is {left, right} — post checked per-branch
    invariants: f.invariants,
  };
}

// ── Recursive composition (unfold-fold) ──

/**
 * Recurse: unfold-fold over the FCA tree.
 *
 * The key change from v1: decompose receives (output, input), not just input.
 * This enables the LLM's output to guide the recursion — what the agent at
 * level N discovers determines what children to recurse into.
 *
 * @param fn        The function to apply at each level
 * @param decompose (output, input) → child inputs. The OUTPUT guides decomposition.
 * @param recompose Merge own output + child outputs into final output
 * @param baseCase  When true, run fn directly without recursion
 */
export function recurse<I, O>(
  fn: SemanticFn<I, O>,
  decompose: (output: O, input: I) => I[],
  recompose: (own: O, children: O[]) => O,
  baseCase: (input: I) => boolean,
): RecursiveFn<I, O> {
  return {
    tag: "recursive",
    name: `recurse(${fn.name})`,
    fn,
    decompose,
    recompose,
    baseCase,
    pre: fn.pre,
    post: fn.post as readonly Predicate<O>[],
    invariants: fn.invariants,
    maxRetries: fn.maxRetries,
  };
}

// ── Invariant threading ──

/**
 * Thread inherited invariants into a semantic function.
 */
export function withInvariants<I, O>(
  fn: SemanticFn<I, O>,
  inherited: readonly Predicate<I>[],
): InvariantFn<I, O> {
  return {
    tag: "invariant",
    name: fn.name,
    inner: fn,
    inherited,
    pre: fn.pre,
    post: fn.post as readonly Predicate<O>[],
    invariants: [...fn.invariants, ...inherited],
  };
}
