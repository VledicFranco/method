// SPDX-License-Identifier: Apache-2.0
/**
 * SemanticFn<I, O> — Typed semantic function.
 *
 * A semantic function is the fundamental unit of the Semantic Programming
 * Language (SPL). It bundles a prompt template, output parser, gates, and
 * invariants into a single typed, composable value.
 *
 * SemanticFn is a tagged union with 5 variants:
 *   - atomic:    Single LLM call (or pure transform)
 *   - pipeline:  Sequential composition (A→B then B→C)
 *   - parallel:  Independent branches (A→B and A→C)
 *   - recursive: FCA tree unfold-fold (output-guided decomposition)
 *   - withInvariants: Adds inherited constraints
 *
 * @see F1-FTH Definition 4.1 — σ = (pre, post, guidance, tools)
 * @see advice/03-recursive-semantic-algorithms.md — SPL formalization
 */

import type { Predicate } from "../predicate/predicate.js";
import { Prompt } from "../prompt/prompt.js";
import type { Truth } from "./truth.js";

// ── The tagged union ──

export type SemanticFn<I, O> =
  | AtomicFn<I, O>
  | PipelineFn<I, any, O>
  | ParallelFn<I, any, any>
  | RecursiveFn<I, O>
  | InvariantFn<I, O>;

/** Base fields shared by all variants. */
export type BaseFn<I, O> = {
  readonly name: string;
  readonly pre: readonly Predicate<I>[];
  readonly post: readonly Predicate<O>[];
  readonly invariants: readonly Predicate<I>[];
  readonly maxRetries?: number;
};

/** Atomic: single LLM call or pure transform. The leaf of the composition tree. */
export type AtomicFn<I, O> = BaseFn<I, O> & {
  readonly tag: "atomic";
  readonly prompt: Prompt<I>;
  readonly parse: (raw: string, input: I) => O | null;
};

/** Pipeline: f then g. */
export type PipelineFn<A, B, C> = BaseFn<A, C> & {
  readonly tag: "pipeline";
  readonly first: SemanticFn<A, B>;
  readonly second: SemanticFn<B, C>;
};

/** Parallel: f and g independently. */
export type ParallelFn<A, B, C> = BaseFn<A, { left: B; right: C }> & {
  readonly tag: "parallel";
  readonly left: SemanticFn<A, B>;
  readonly right: SemanticFn<A, C>;
};

/**
 * Recursive: unfold-fold over the FCA tree.
 *
 * The key innovation: decompose receives the OUTPUT of the current level,
 * not the input. This enables LLM-guided recursion — the agent at level N
 * decides what to recurse into based on what it discovered.
 *
 * Flow:
 *   1. Run fn(input) → output         (execute this level)
 *   2. decompose(output, input) → [...child inputs]  (LLM output guides decomposition)
 *   3. For each child: recurse(fn, child)  (recursive calls)
 *   4. recompose(output, childOutputs) → final output
 *
 * The (output, input) pair in decompose gives access to both:
 *   - output: what the LLM discovered (selectedChildren, subComponents, etc.)
 *   - input: the original context (path, level, etc. needed to build child inputs)
 */
export type RecursiveFn<I, O> = BaseFn<I, O> & {
  readonly tag: "recursive";
  readonly fn: SemanticFn<I, O>;
  /** Decompose AFTER running fn — receives output + original input. */
  readonly decompose: (output: O, input: I) => I[];
  /** Recompose own output with child outputs. */
  readonly recompose: (own: O, children: O[]) => O;
  /** When true, skip decomposition — just run fn directly. */
  readonly baseCase: (input: I) => boolean;
};

/** Adds inherited invariants (the accumulator threading down). */
export type InvariantFn<I, O> = BaseFn<I, O> & {
  readonly tag: "invariant";
  readonly inner: SemanticFn<I, O>;
  readonly inherited: readonly Predicate<I>[];
};

// ── Result type ──

/** What a semantic function returns: data + truths + status. */
export type SemanticResult<O> = {
  readonly data: O;
  readonly truths: readonly Truth[];
  readonly status: "complete" | "needs_revision" | "blocked";
  readonly cost: {
    readonly tokens: number;
    readonly usd: number;
    readonly duration_ms: number;
  };
};

// ── Error type ──

export type SemanticError =
  | { readonly _tag: "PreconditionFailed"; readonly fn: string; readonly label: string }
  | { readonly _tag: "PostconditionFailed"; readonly fn: string; readonly label: string; readonly retries: number }
  | { readonly _tag: "ParseFailed"; readonly fn: string; readonly raw: string; readonly retries: number }
  | { readonly _tag: "InvariantViolated"; readonly fn: string; readonly label: string }
  | { readonly _tag: "AgentFailed"; readonly fn: string; readonly message: string; readonly cause?: unknown };

// ── Constructors ──

/** Create an atomic semantic function. */
export function semanticFn<I, O>(config: {
  name: string;
  prompt: Prompt<I>;
  parse: (raw: string, input: I) => O | null;
  pre?: readonly Predicate<I>[];
  post?: readonly Predicate<O>[];
  invariants?: readonly Predicate<I>[];
  maxRetries?: number;
}): AtomicFn<I, O> {
  return {
    tag: "atomic",
    name: config.name,
    prompt: config.prompt,
    parse: config.parse,
    pre: config.pre ?? [],
    post: config.post ?? [],
    invariants: config.invariants ?? [],
    maxRetries: config.maxRetries,
  };
}

/**
 * Create a pure (algorithmic) semantic function — no LLM, just a transform.
 */
export function pureFn<I, O>(
  name: string,
  transform: (input: I) => O,
  post?: readonly Predicate<O>[],
): AtomicFn<I, O> {
  return {
    tag: "atomic",
    name,
    prompt: new Prompt<I>(() => ""),
    parse: (_raw, input) => transform(input),
    pre: [],
    post: post ?? [],
    invariants: [],
  };
}
