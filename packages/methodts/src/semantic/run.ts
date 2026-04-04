/**
 * runSemantic — Execute a SemanticFn against an AgentProvider.
 *
 * Dispatches on the tagged union:
 *   - atomic:    Single LLM call or pure transform
 *   - pipeline:  Run first, feed output to second
 *   - parallel:  Run both concurrently, combine results
 *   - recursive: Unfold-fold — run this level, decompose from OUTPUT, recurse
 *   - invariant: Validate inherited invariants, then run inner
 *
 * @see F1-FTH §12.4 — Step execution and retry
 * @see advice/03-recursive-semantic-algorithms.md — Semantic vs algorithmic
 */

import { Effect } from "effect";
import type { SemanticFn, SemanticResult, SemanticError, AtomicFn } from "./fn.js";
import { algorithmic, semantic, allHold } from "./truth.js";
import type { Truth } from "./truth.js";
import { evaluate } from "../predicate/evaluate.js";
import type { Predicate } from "../predicate/predicate.js";
import { AgentProvider } from "../provider/agent-provider.js";
import { executeWithRetry } from "../gate/gate.js";

/** Configuration for semantic execution. */
export type RunSemanticConfig = {
  readonly maxRetries?: number;
  readonly onTruth?: (truth: Truth) => void;
  readonly onSpawn?: (name: string, input: unknown) => void;
};

/**
 * Execute a semantic function.
 *
 * Dispatches on the tag to the appropriate execution strategy.
 */
export function runSemantic<I, O>(
  fn: SemanticFn<I, O>,
  input: I,
  config?: RunSemanticConfig,
): Effect.Effect<SemanticResult<O>, SemanticError, AgentProvider> {
  switch (fn.tag) {
    case "atomic":
      return runAtomic(fn, input, config);
    case "pipeline":
      return runPipeline(fn, input, config);
    case "parallel":
      return runParallelFn(fn as any, input, config) as any;
    case "recursive":
      return runRecursive(fn, input, config);
    case "invariant":
      return runInvariant(fn, input, config);
  }
}

// ── Atomic execution (leaf — single LLM call or pure transform) ──

function runAtomic<I, O>(
  fn: AtomicFn<I, O>,
  input: I,
  config?: RunSemanticConfig,
): Effect.Effect<SemanticResult<O>, SemanticError, AgentProvider> {
  return Effect.gen(function* () {
    const truths: Truth[] = [];
    const report = (t: Truth) => { truths.push(t); config?.onTruth?.(t); };

    // 1. Validate invariants
    for (const inv of fn.invariants) {
      const holds = evaluate(inv, input);
      const label = labelOf(inv);
      report(algorithmic(`invariant: ${label}`, holds));
      if (!holds) {
        return yield* Effect.fail<SemanticError>({
          _tag: "InvariantViolated", fn: fn.name, label,
        });
      }
    }

    // 2. Validate preconditions
    for (const pre of fn.pre) {
      const holds = evaluate(pre, input);
      const label = labelOf(pre);
      report(algorithmic(`pre: ${label}`, holds));
      if (!holds) {
        return yield* Effect.fail<SemanticError>({
          _tag: "PreconditionFailed", fn: fn.name, label,
        });
      }
    }

    // 3. Check if pure function (empty prompt)
    const promptText = fn.prompt.run(input);
    if (!promptText) {
      const output = fn.parse("", input);
      if (output === null) {
        return yield* Effect.fail<SemanticError>({
          _tag: "ParseFailed", fn: fn.name, raw: "", retries: 0,
        });
      }
      for (const post of fn.post) {
        report(algorithmic(`post: ${labelOf(post)}`, evaluate(post, output)));
      }
      return {
        data: output,
        truths,
        status: allHold(truths) ? "complete" as const : "needs_revision" as const,
        cost: { tokens: 0, usd: 0, duration_ms: 0 },
      };
    }

    // 4. Execute via AgentProvider with unified gate-check-retry
    const provider = yield* AgentProvider;
    const maxRetries = fn.maxRetries ?? config?.maxRetries ?? 2;

    type ExecOutput = { parsed: O | null; raw: string; cost: { tokens: number; usd: number; duration_ms: number } };

    const retryResult = yield* Effect.catchTag(
      executeWithRetry({
        name: fn.name,
        execute: (inp: I, attempt: number, feedback?: string) =>
          Effect.gen(function* () {
            const retryNote = feedback
              ? `\n\n---\n[Retry ${attempt}/${maxRetries}: ${feedback}]`
              : "";
            const agentResult = yield* Effect.mapError(
              provider.execute({ prompt: promptText + retryNote }),
              (err): SemanticError => ({
                _tag: "AgentFailed", fn: fn.name, message: err._tag, cause: err,
              }),
            );
            return {
              parsed: fn.parse(agentResult.raw, inp),
              raw: agentResult.raw,
              cost: agentResult.cost,
            } as ExecOutput;
          }),
        check: (result: ExecOutput) => {
          if (result.parsed === null) {
            return { passed: false, failures: ["parse failed"] };
          }
          const failures: string[] = [];
          for (const post of fn.post) {
            if (!evaluate(post, result.parsed)) {
              failures.push(labelOf(post));
            }
          }
          return { passed: failures.length === 0, failures };
        },
        buildFeedback: (_result: ExecOutput, _failures: string[]) =>
          `previous output failed validation. Fix the issues and try again.`,
        maxRetries,
        input,
      }),
      "RetryExhausted",
      (err) => {
        const last = err.lastOutput as ExecOutput | undefined;
        if (last?.parsed != null) {
          // Postconditions failed but parse succeeded — return with degraded confidence
          return Effect.succeed({
            data: last,
            attempts: err.attempts,
            confidence: Math.max(0.5, 0.90 - (err.attempts - 1) * 0.10),
          });
        }
        // Parse truly failed on all attempts
        return Effect.fail<SemanticError>({
          _tag: "ParseFailed", fn: fn.name, raw: last?.raw ?? "", retries: maxRetries,
        });
      },
    );

    // 5. Report postcondition truths
    const { parsed, cost } = retryResult.data;
    if (parsed === null) {
      return yield* Effect.fail<SemanticError>({
        _tag: "ParseFailed", fn: fn.name, raw: retryResult.data.raw, retries: maxRetries,
      });
    }

    for (const post of fn.post) {
      report(algorithmic(`post: ${labelOf(post)}`, evaluate(post, parsed)));
    }
    report(semantic(`${fn.name}: agent produced valid output`, true, retryResult.confidence));

    return {
      data: parsed,
      truths,
      status: allHold(truths) ? "complete" as const : "needs_revision" as const,
      cost: { tokens: cost.tokens, usd: cost.usd, duration_ms: cost.duration_ms },
    };
  });
}

// ── Pipeline execution ──

function runPipeline<A, B, C>(
  fn: { first: SemanticFn<A, B>; second: SemanticFn<B, C> } & { tag: "pipeline"; name: string },
  input: A,
  config?: RunSemanticConfig,
): Effect.Effect<SemanticResult<C>, SemanticError, AgentProvider> {
  return Effect.gen(function* () {
    const resultF = yield* runSemantic(fn.first, input, config);
    if (resultF.status === "blocked") return resultF as unknown as SemanticResult<C>;

    const resultG = yield* runSemantic(fn.second, resultF.data, config);

    return {
      data: resultG.data,
      truths: [...resultF.truths, ...resultG.truths],
      status: resultG.status,
      cost: {
        tokens: resultF.cost.tokens + resultG.cost.tokens,
        usd: resultF.cost.usd + resultG.cost.usd,
        duration_ms: resultF.cost.duration_ms + resultG.cost.duration_ms,
      },
    };
  });
}

// ── Parallel execution ──

function runParallelFn<A, B, C>(
  fn: { left: SemanticFn<A, B>; right: SemanticFn<A, C> } & { tag: "parallel"; name: string },
  input: A,
  config?: RunSemanticConfig,
): Effect.Effect<SemanticResult<{ left: B; right: C }>, SemanticError, AgentProvider> {
  return Effect.gen(function* () {
    const [resultF, resultG] = yield* Effect.all([
      runSemantic(fn.left, input, config),
      runSemantic(fn.right, input, config),
    ], { concurrency: 2 });

    const worstStatus = resultF.status === "blocked" || resultG.status === "blocked"
      ? "blocked" as const
      : resultF.status === "needs_revision" || resultG.status === "needs_revision"
        ? "needs_revision" as const
        : "complete" as const;

    return {
      data: { left: resultF.data, right: resultG.data },
      truths: [...resultF.truths, ...resultG.truths],
      status: worstStatus,
      cost: {
        tokens: resultF.cost.tokens + resultG.cost.tokens,
        usd: resultF.cost.usd + resultG.cost.usd,
        duration_ms: Math.max(resultF.cost.duration_ms, resultG.cost.duration_ms),
      },
    };
  });
}

// ── Recursive execution (unfold-fold) ──

function runRecursive<I, O>(
  fn: {
    tag: "recursive";
    name: string;
    fn: SemanticFn<I, O>;
    decompose: (output: O, input: I) => I[];
    recompose: (own: O, children: O[]) => O;
    baseCase: (input: I) => boolean;
  },
  input: I,
  config?: RunSemanticConfig,
): Effect.Effect<SemanticResult<O>, SemanticError, AgentProvider> {
  return Effect.gen(function* () {
    // Base case: run fn directly, no recursion
    if (fn.baseCase(input)) {
      config?.onSpawn?.(`${fn.fn.name} [base]`, input);
      return yield* runSemantic(fn.fn, input, config);
    }

    // 1. Execute this level
    config?.onSpawn?.(`${fn.fn.name} [level]`, input);
    const ownResult = yield* runSemantic(fn.fn, input, config);
    if (ownResult.status === "blocked") return ownResult;

    // 2. Decompose from OUTPUT (the key change!)
    // The LLM's output guides what children to recurse into.
    const childInputs = fn.decompose(ownResult.data, input);
    if (childInputs.length === 0) return ownResult;

    // 3. Recurse into children (concurrently)
    config?.onSpawn?.(`${fn.name} [${childInputs.length} children]`, null);
    const childResults = yield* Effect.all(
      childInputs.map((childInput) =>
        // Re-apply the recursive wrapper so children also recurse
        runRecursive(fn, childInput, config),
      ),
      { concurrency: "unbounded" },
    );

    // 4. Recompose
    const recomposed = fn.recompose(ownResult.data, childResults.map((r) => r.data));

    // Aggregate
    const allTruths = [
      ...ownResult.truths,
      ...childResults.flatMap((r) => r.truths),
    ];
    const totalCost = childResults.reduce(
      (acc, r) => ({
        tokens: acc.tokens + r.cost.tokens,
        usd: acc.usd + r.cost.usd,
        duration_ms: Math.max(acc.duration_ms, r.cost.duration_ms),
      }),
      ownResult.cost,
    );
    const worstStatus = [ownResult, ...childResults].some((r) => r.status === "blocked")
      ? "blocked" as const
      : [ownResult, ...childResults].some((r) => r.status === "needs_revision")
        ? "needs_revision" as const
        : "complete" as const;

    return { data: recomposed, truths: allTruths, status: worstStatus, cost: totalCost };
  });
}

// ── Invariant execution ──

function runInvariant<I, O>(
  fn: { tag: "invariant"; inner: SemanticFn<I, O>; inherited: readonly Predicate<I>[] } & { name: string; invariants: readonly Predicate<I>[] },
  input: I,
  config?: RunSemanticConfig,
): Effect.Effect<SemanticResult<O>, SemanticError, AgentProvider> {
  return Effect.gen(function* () {
    // Validate inherited invariants first
    for (const inv of fn.inherited) {
      const holds = evaluate(inv, input);
      if (!holds) {
        return yield* Effect.fail<SemanticError>({
          _tag: "InvariantViolated", fn: fn.name, label: labelOf(inv),
        });
      }
    }
    return yield* runSemantic(fn.inner, input, config);
  });
}

// ── Helpers ──

function labelOf<A>(pred: Predicate<A>): string {
  switch (pred.tag) {
    case "val": return `literal(${pred.value})`;
    case "check": return pred.label;
    case "and": return `${labelOf(pred.left)} ∧ ${labelOf(pred.right)}`;
    case "or": return `${labelOf(pred.left)} ∨ ${labelOf(pred.right)}`;
    case "not": return `¬(${labelOf(pred.inner)})`;
    case "implies": return `${labelOf(pred.antecedent)} ⇒ ${labelOf(pred.consequent)}`;
    case "forall": return `∀ ${pred.label}`;
    case "exists": return `∃ ${pred.label}`;
  }
}
