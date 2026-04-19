// SPDX-License-Identifier: Apache-2.0
/**
 * Experiment v2: Flat vs Recursive Explore — Validated Design
 *
 * Fixes from fcd-review:
 *   - LLM-as-judge scoring (replaces keyword matching)
 *   - Normalized answer surface area (root summary only + capped children)
 *   - 3 conditions: no-context baseline, flat, recursive
 *   - 8 diverse queries (factual, synthesis, negative, evaluative)
 *   - JSONL result persistence
 *   - Pre-registered hypothesis: recursive ≥20% better on ≥50% of queries
 *
 * @see experiments/exp-spl-explore/README.md
 */

import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { Prompt } from "../../prompt/prompt.js";
import { check } from "../../predicate/predicate.js";
import { semanticFn } from "../fn.js";
import { runSemantic } from "../run.js";
import { exploreLevel } from "../algorithms/explore.js";
import { judge, flattenExploreForJudging } from "../algorithms/judge.js";
import type { JudgeOutput } from "../algorithms/judge.js";
import { loadExploreInput, loadChildInputs, liveFsLoader } from "../algorithms/fs-loader.js";
import { SequenceProvider } from "../../testkit/provider/recording-provider.js";
import { AgentProvider } from "../../provider/agent-provider.js";
import { join } from "node:path";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";

// ── Query Set (8 queries, 4 categories) ──

type TestQuery = {
  query: string;
  category: "factual" | "synthesis" | "negative" | "evaluative";
  description: string;
  groundTruthPath: string;  // File to read as ground truth for judge
};

// Full query set — 8 queries, 4 categories
const ALL_QUERIES: TestQuery[] = [
  // Factual lookup
  {
    query: "What is the Prompt<A> type and what operations does it support?",
    category: "factual",
    description: "Find prompt algebra",
    groundTruthPath: "packages/methodts/src/prompt/prompt.ts",
  },
  {
    query: "What agent providers are available and how do they differ?",
    category: "factual",
    description: "Find agent providers",
    groundTruthPath: "packages/methodts/src/provider/agent-provider.ts",
  },
  // Synthesis
  {
    query: "How does the step execution system handle retries when postconditions fail?",
    category: "synthesis",
    description: "Synthesize retry mechanism",
    groundTruthPath: "packages/methodts/src/runtime/run-step.ts",
  },
  {
    query: "What is the relationship between Method, Step, and StepDAG types?",
    category: "synthesis",
    description: "Synthesize type relationships",
    groundTruthPath: "packages/methodts/src/method/method.ts",
  },
  // Negative
  {
    query: "How does the WebSocket-based streaming agent provider handle reconnection?",
    category: "negative",
    description: "Non-existent WebSocket provider",
    groundTruthPath: "packages/methodts/src/provider/agent-provider.ts",
  },
  {
    query: "What caching layer does the methodology runtime use to avoid redundant LLM calls?",
    category: "negative",
    description: "Non-existent caching layer",
    groundTruthPath: "packages/methodts/src/runtime/run-methodology.ts",
  },
  // Evaluative
  {
    query: "Is the Predicate<A> type system expressive enough for real-world methodology constraints, or does it have notable limitations?",
    category: "evaluative",
    description: "Evaluate predicate expressiveness",
    groundTruthPath: "packages/methodts/src/predicate/predicate.ts",
  },
  {
    query: "What are the trade-offs of using Effect for the step execution runtime vs plain async/await?",
    category: "evaluative",
    description: "Evaluate Effect trade-offs",
    groundTruthPath: "packages/methodts/src/runtime/run-step.ts",
  },
];

// Quick run: 1 per category (4 queries × 3 conditions + 12 judge = 24 LLM calls ≈ 4 min)
const QUERIES = ALL_QUERIES.filter((_, i) => i % 2 === 0);

// ── Conditions ──

// Condition A: No-context baseline
const noContextFn = semanticFn<{ query: string }, { answer: string }>({
  name: "no-context",
  prompt: new Prompt(({ query }) => `You are answering a question about a TypeScript project. You have NO access to the codebase. Answer based on what you can infer from the question itself. If you don't know, make your best guess based on common TypeScript patterns. Do NOT refuse to answer. Do NOT ask to read the codebase.

Question: ${query}

You MUST respond starting with "ANSWER:" followed by your best answer, under 300 words.

ANSWER:`),
  parse: (raw) => {
    // Try to find ANSWER: marker, but fall back to using the full response
    const m = raw.match(/ANSWER:\s*\n?([\s\S]*)/);
    const answer = m ? m[1].trim() : raw.trim();
    return answer.length > 0 ? { answer } : null;
  },
  post: [check("non-empty", (o: { answer: string }) => o.answer.length > 10)],
  maxRetries: 1,
});

// Condition B: Flat
const flatFn = semanticFn<{ query: string; context: string }, { answer: string }>({
  name: "flat",
  prompt: new Prompt(({ query, context }) => `Answer this question about a software project based on the context provided.

Question: ${query}

Context:
${context}

Be specific — name files, types, functions. If something doesn't exist in the context, say so.
Under 300 words.

ANSWER:
`),
  parse: (raw) => {
    const m = raw.match(/ANSWER:\s*\n?([\s\S]*)/);
    const answer = m ? m[1].trim() : raw.trim();
    return answer.length > 0 ? { answer } : null;
  },
  post: [check("non-empty", (o: { answer: string }) => o.answer.length > 10)],
  maxRetries: 1,
});

// Condition C: Recursive (uses exploreLevel + manual recursion + fs-loader)
async function runRecursive(
  query: string,
  rootPath: string,
  provider: Layer.Layer<AgentProvider>,
): Promise<{ answer: string; tokens: number; calls: number; ms: number }> {
  const fs = liveFsLoader();
  const rootInput = loadExploreInput(fs, query, rootPath, 2);

  // Level 1
  const root = await Effect.runPromise(
    runSemantic(exploreLevel, rootInput).pipe(Effect.provide(provider)),
  );
  let tokens = root.cost.tokens;
  let calls = 1;

  // Level 2: selected children only
  const childSummaries: string[] = [];
  if (root.data.selectedChildren.length > 0) {
    const resolved: string[] = [];
    for (const sel of root.data.selectedChildren) {
      const match = rootInput.children.find((c) =>
        c === sel.path || c.endsWith(sel.path) || sel.path.endsWith(c) ||
        c.toLowerCase() === sel.path.toLowerCase(),
      );
      if (match) resolved.push(match);
    }
    const childInputs = loadChildInputs(fs, query, resolved, rootPath, 2);
    const childResults = await Effect.runPromise(
      Effect.all(
        childInputs.map((ci) => runSemantic(exploreLevel, ci).pipe(Effect.provide(provider))),
        { concurrency: "unbounded" },
      ),
    );
    for (const cr of childResults) {
      tokens += cr.cost.tokens;
      calls += 1;
      childSummaries.push(cr.data.summary);
    }
  }

  // Normalize: flatten to single answer string for fair judging
  const answer = flattenExploreForJudging(root.data.summary, childSummaries);
  const ms = root.cost.duration_ms; // Approximate — parallel children overlap

  return { answer, tokens, calls, ms };
}

// ── Result types ──

type ConditionResult = {
  condition: string;
  query: string;
  category: string;
  answer: string;
  tokens: number;
  calls: number;
  ms: number;
  judge?: JudgeOutput;
};

type ExperimentRun = {
  timestamp: string;
  model: string;
  conditions: ConditionResult[];
};

// ── Result persistence ──

function persistResults(run: ExperimentRun): string {
  const dir = join(process.cwd(), "experiments/exp-spl-explore/results");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filename = `run-${run.timestamp.replace(/[:.]/g, "-")}.jsonl`;
  const path = join(dir, filename);
  const lines = run.conditions.map((c) => JSON.stringify(c));
  writeFileSync(path, lines.join("\n") + "\n");
  return path;
}

// ── Deterministic tests ──

describe("Experiment v2 — deterministic", () => {
  it("judge parses LLM evaluation correctly", async () => {
    const { layer } = SequenceProvider([{
      raw: "CORRECTNESS: 4\nCOMPLETENESS: 3\nPRECISION: 5\nRATIONALE: Accurate description of Prompt<A> with good precision, but missed the `when` and `section` methods.",
      cost: { tokens: 30, usd: 0.001, duration_ms: 50 },
    }]);

    const result = await Effect.runPromise(
      runSemantic(judge, {
        query: "What is Prompt<A>?",
        answer: "Prompt<A> is a pure function from context A to string with contramap and andThen.",
        groundTruth: "class Prompt<A> { andThen, contramap, map, when, section, indent }",
      }).pipe(Effect.provide(layer)),
    );

    expect(result.data.correctness).toBe(4);
    expect(result.data.completeness).toBe(3);
    expect(result.data.precision).toBe(5);
    expect(result.data.overall).toBeCloseTo(4 * 0.4 + 3 * 0.3 + 5 * 0.3, 2);
  });

  it("flattenExploreForJudging normalizes surface area", () => {
    const text = flattenExploreForJudging(
      "Root summary about the package.",
      ["Child 1 summary with details.", "Child 2 summary with details."],
    );
    expect(text).toContain("Root summary");
    expect(text).toContain("Supporting detail");
    expect(text).toContain("Child 1");
  });
});

// ── Real experiment ──

describe.skipIf(!!process.env.CI)("Experiment v2 — real execution", () => {
  const getProvider = async () => {
    const { ClaudeHeadlessProvider } = await import("../../provider/claude-headless.js");
    return ClaudeHeadlessProvider({
      model: "haiku",
      maxBudgetUsd: 2.00,
      workdir: process.cwd(),
      timeoutMs: 120000,  // 2 min per call
    });
  };

  it("3-condition comparison with LLM-as-judge", async () => {
    const provider = await getProvider();
    const rootPath = join(process.cwd(), "packages/methodts/src");
    const fs = liveFsLoader();
    const results: ConditionResult[] = [];

    for (const q of QUERIES) {
      const groundTruth = fs.readFile(join(process.cwd(), q.groundTruthPath));

      // Helper: run a condition with error recovery
      async function tryCondition(
        name: string, run: () => Promise<{ answer: string; tokens: number; calls: number; ms: number }>,
      ): Promise<ConditionResult | null> {
        try {
          const r = await run();
          return {
            condition: name, query: q.description, category: q.category,
            answer: r.answer, tokens: r.tokens, calls: r.calls, ms: r.ms,
          };
        } catch (e: any) {
          console.log(`  [SKIP] ${name} × ${q.description}: ${e?.cause?.failure?._tag ?? e?.message ?? "unknown error"}`);
          return null;
        }
      }

      // Condition A: No-context baseline
      const noCtxResult = await tryCondition("no-context", async () => {
        const r = await Effect.runPromise(
          runSemantic(noContextFn, { query: q.query }).pipe(Effect.provide(provider)),
        );
        return { answer: r.data.answer, tokens: r.cost.tokens, calls: 1, ms: r.cost.duration_ms };
      });

      // Condition B: Flat
      const flatResult = await tryCondition("flat", async () => {
        const rootInput = loadExploreInput(fs, q.query, rootPath, 2);
        const flatCtx = `## ${rootPath}\n\n${rootInput.documentation}\n\nChildren: ${rootInput.children.join(", ")}`;
        const r = await Effect.runPromise(
          runSemantic(flatFn, { query: q.query, context: flatCtx }).pipe(Effect.provide(provider)),
        );
        return { answer: r.data.answer, tokens: r.cost.tokens, calls: 1, ms: r.cost.duration_ms };
      });

      // Condition C: Recursive
      const recResult = await tryCondition("recursive", () => runRecursive(q.query, rootPath, provider));

      // Judge all successful conditions
      for (const r of [noCtxResult, flatResult, recResult]) {
        if (!r) continue;
        try {
          const judgeResult = await Effect.runPromise(
            runSemantic(judge, { query: q.query, answer: r.answer, groundTruth }).pipe(Effect.provide(provider)),
          );
          r.judge = judgeResult.data;
        } catch {
          console.log(`  [SKIP] judge for ${r.condition} × ${q.description}: judge call failed`);
        }
      }

      for (const r of [noCtxResult, flatResult, recResult]) {
        if (r) results.push(r);
      }
    }

    // Persist
    const run: ExperimentRun = {
      timestamp: new Date().toISOString(),
      model: "haiku",
      conditions: results,
    };
    const resultPath = persistResults(run);

    // Report
    console.log("\n=== EXPERIMENT v2: 3-Condition Comparison ===\n");
    console.log("Query                          | Cond      | Overall | Correct | Complete | Precise | Tokens | Calls");
    console.log("-------------------------------|-----------|---------|---------|----------|---------|--------|------");
    for (const r of results) {
      const j = r.judge!;
      console.log(
        `${r.query.padEnd(31)}| ${r.condition.padEnd(10)}| ${j.overall.toFixed(1).padEnd(8)}| ${j.correctness}       | ${j.completeness}        | ${j.precision}       | ${String(r.tokens).padEnd(7)}| ${r.calls}`,
      );
    }

    // Aggregate by condition
    const conditions = ["no-context", "flat", "recursive"];
    console.log("\n--- Averages ---");
    for (const cond of conditions) {
      const condResults = results.filter((r) => r.condition === cond);
      const avgOverall = condResults.reduce((s, r) => s + r.judge!.overall, 0) / condResults.length;
      const avgTokens = condResults.reduce((s, r) => s + r.tokens, 0) / condResults.length;
      const totalTokens = condResults.reduce((s, r) => s + r.tokens, 0);
      console.log(`${cond.padEnd(12)}: overall=${avgOverall.toFixed(2)}  avg_tokens=${avgTokens.toFixed(0)}  total_tokens=${totalTokens}`);
    }

    // Hypothesis test: recursive ≥20% better than flat on ≥50% of queries
    let recursiveWins = 0;
    let comparablePairs = 0;
    for (const q of QUERIES) {
      const flatR = results.find((r) => r.condition === "flat" && r.query === q.description && r.judge);
      const recR = results.find((r) => r.condition === "recursive" && r.query === q.description && r.judge);
      if (flatR && recR) {
        comparablePairs++;
        if (recR.judge!.overall >= flatR.judge!.overall * 1.2) {
          recursiveWins++;
        }
      }
    }
    console.log(`\nH1 test: recursive ≥20% better on ${recursiveWins}/${comparablePairs} comparable queries (need ≥${Math.ceil(comparablePairs / 2)})`);
    console.log(`Results persisted to: ${resultPath}`);

    // Soft assertions — the experiment should produce SOME data
    expect(results.length).toBeGreaterThan(0);
    const judgedResults = results.filter((r) => r.judge);
    expect(judgedResults.length).toBeGreaterThan(0);
    console.log(`\n${judgedResults.length}/${results.length} results judged successfully.`);
  }, 900000); // 15 minutes
});
