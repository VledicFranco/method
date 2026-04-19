// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for the Semantic Programming Language (SPL) core.
 *
 * Covers:
 * - Truth tracking (algorithmic vs semantic)
 * - SemanticFn construction and pure execution
 * - Composition operators (pipe, parallel, recurse)
 * - Runner with RecordingProvider
 * - The explore algorithm with deterministic replay
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { Prompt } from "../../prompt/prompt.js";
import { check } from "../../predicate/predicate.js";
import {
  semanticFn,
  pureFn,
  pipe,
  parallel,
  recurse,
  withInvariants,
  runSemantic,
  algorithmic,
  semantic,
  sequentialConfidence,
  parallelConfidence,
  partition,
  allHold,
} from "../index.js";
import { SequenceProvider } from "../../testkit/provider/recording-provider.js";

// ── Truth tests ──

describe("Truth", () => {
  it("algorithmic truths have confidence 1.0", () => {
    const t = algorithmic("test passed", true);
    expect(t.confidence).toBe(1.0);
    expect(t.method).toBe("algorithmic");
  });

  it("semantic truths have clamped confidence", () => {
    const t = semantic("looks good", true, 0.85);
    expect(t.confidence).toBe(0.85);
    expect(t.method).toBe("semantic");
  });

  it("semantic truths clamp confidence to [0, 1]", () => {
    expect(semantic("over", true, 1.5).confidence).toBe(1);
    expect(semantic("under", true, -0.5).confidence).toBe(0);
  });

  it("sequential confidence multiplies", () => {
    const truths = [
      algorithmic("a", true),
      semantic("b", true, 0.9),
      semantic("c", true, 0.8),
    ];
    expect(sequentialConfidence(truths)).toBeCloseTo(0.72, 2);
  });

  it("parallel confidence computes 1 - ∏(1-p)", () => {
    const truths = [
      semantic("a", true, 0.8),
      semantic("b", true, 0.8),
    ];
    expect(parallelConfidence(truths)).toBeCloseTo(0.96, 2);
  });

  it("partition separates by method", () => {
    const truths = [
      algorithmic("a", true),
      semantic("b", true, 0.9),
      algorithmic("c", false),
    ];
    const { algorithmic: alg, semantic: sem } = partition(truths);
    expect(alg).toHaveLength(2);
    expect(sem).toHaveLength(1);
  });

  it("allHold checks all truths", () => {
    expect(allHold([algorithmic("a", true), algorithmic("b", true)])).toBe(true);
    expect(allHold([algorithmic("a", true), algorithmic("b", false)])).toBe(false);
    expect(allHold([])).toBe(true);
  });
});

// ── SemanticFn construction ──

describe("SemanticFn", () => {
  it("constructs with semanticFn helper", () => {
    const fn = semanticFn({
      name: "test",
      prompt: new Prompt<string>((s) => `do ${s}`),
      parse: (raw) => raw.toUpperCase(),
    });
    expect(fn.name).toBe("test");
    expect(fn.pre).toHaveLength(0);
    expect(fn.post).toHaveLength(0);
    expect(fn.prompt.run("something")).toBe("do something");
  });

  it("constructs pure functions with pureFn", () => {
    const fn = pureFn("double", (n: number) => n * 2);
    expect(fn.name).toBe("double");
    expect(fn.prompt.run(5)).toBe("");
  });
});

// ── Pure execution (no LLM) ──

describe("runSemantic — pure functions", () => {
  // Pure functions don't need an AgentProvider
  const dummyProvider = SequenceProvider([]);

  it("executes pure functions without LLM call", async () => {
    const double = pureFn("double", (n: number) => n * 2, [
      check("result is positive", (n: number) => n > 0),
    ]);

    const result = await Effect.runPromise(
      runSemantic(double, 5).pipe(Effect.provide(dummyProvider.layer)),
    );

    expect(result.data).toBe(10);
    expect(result.status).toBe("complete");
    expect(result.cost.tokens).toBe(0);
    expect(result.truths.some((t) => t.label.includes("result is positive") && t.holds)).toBe(true);
  });

  it("fails on precondition violation", async () => {
    const positive = pureFn("identity", (n: number) => n);
    const guarded = semanticFn({
      ...positive,
      pre: [check("input is positive", (n: number) => n > 0)],
    });

    const result = await Effect.runPromise(
      runSemantic(guarded, -1).pipe(
        Effect.provide(dummyProvider.layer),
        Effect.either,
      ),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("PreconditionFailed");
    }
  });
});

// ── Agent execution with RecordingProvider ──

describe("runSemantic — agent execution", () => {
  it("executes semantic function with LLM", async () => {
    const greet = semanticFn<string, string>({
      name: "greet",
      prompt: new Prompt<string>((name) => `Say hello to ${name}`),
      parse: (raw) => raw.trim() || null,
      post: [check("non-empty greeting", (s: string) => s.length > 0)],
    });

    const { layer, recordings } = SequenceProvider([
      { raw: "Hello, World!", cost: { tokens: 10, usd: 0.001, duration_ms: 100 } },
    ]);

    const result = await Effect.runPromise(
      runSemantic(greet, "World").pipe(Effect.provide(layer)),
    );

    expect(result.data).toBe("Hello, World!");
    expect(result.status).toBe("complete");
    expect(result.cost.tokens).toBe(10);
    expect(recordings).toHaveLength(1);
    expect(recordings[0].commission.prompt).toContain("Say hello to World");
  });

  it("retries on parse failure", async () => {
    const fn = semanticFn<string, { value: number }>({
      name: "parse-number",
      prompt: new Prompt<string>((s) => `Extract number from: ${s}`),
      parse: (raw) => {
        const match = raw.match(/\d+/);
        return match ? { value: parseInt(match[0]) } : null;
      },
      maxRetries: 1,
    });

    const { layer, recordings } = SequenceProvider([
      { raw: "no number here", cost: { tokens: 5, usd: 0.001, duration_ms: 50 } },
      { raw: "the answer is 42", cost: { tokens: 5, usd: 0.001, duration_ms: 50 } },
    ]);

    const result = await Effect.runPromise(
      runSemantic(fn, "test").pipe(Effect.provide(layer)),
    );

    expect(result.data).toEqual({ value: 42 });
    expect(recordings).toHaveLength(2); // Retried once
  });
});

// ── Composition ──

describe("composition", () => {
  const dummyProvider = SequenceProvider([]);

  it("pipe composes sequential pure functions", async () => {
    const double = pureFn("double", (n: number) => n * 2);
    const toString = pureFn("toString", (n: number) => `value: ${n}`);
    const composed = pipe(double, toString);

    expect(composed.name).toBe("double | toString");

    // Pipeline execution runs both stages
    const result = await Effect.runPromise(
      runSemantic(composed, 5).pipe(Effect.provide(dummyProvider.layer)),
    );

    expect(result.data).toBe("value: 10");
  });

  it("parallel runs both branches", async () => {
    const double = pureFn("double", (n: number) => n * 2);
    const square = pureFn("square", (n: number) => n * n);
    const both = parallel(double, square);

    expect(both.name).toBe("double ∥ square");

    const result = await Effect.runPromise(
      runSemantic(both, 5).pipe(Effect.provide(dummyProvider.layer)),
    );

    expect(result.data).toEqual({ left: 10, right: 25 });
  });

  it("recurse terminates at base case (output-guided)", async () => {
    // Countdown: subtract 1 recursively until 0
    // decompose now receives (output, input) — output IS the number,
    // and we use it to decide what children to create
    const countdown = pureFn("countdown", (n: number) => n);
    const recursive = recurse(
      countdown,
      (output: number, input: number) => output > 0 ? [input - 1] : [],
      (own: number, children: number[]) => own + children.reduce((a, b) => a + b, 0),
      (n: number) => n <= 0,
    );

    const result = await Effect.runPromise(
      runSemantic(recursive, 3).pipe(Effect.provide(dummyProvider.layer)),
    );

    // 3 + (2 + (1 + (0))) = 6
    expect(result.data).toBe(6);
  });

  it("withInvariants adds inherited constraints", () => {
    const fn = pureFn("test", (n: number) => n);
    const guarded = withInvariants(fn, [
      check("positive", (n: number) => n > 0),
    ]);

    expect(guarded.invariants).toHaveLength(1);
  });
});

// ── Explore algorithm ──

describe("explore algorithm", () => {
  it("explores a component tree with LLM selection", async () => {
    const { exploreLevel } = await import("../algorithms/explore.js");

    const { layer, recordings } = SequenceProvider([
      {
        raw: `SUMMARY:
This is the root package containing auth and data domains.

SELECTED:
src/auth: Contains authentication logic relevant to the query
`,
        cost: { tokens: 50, usd: 0.005, duration_ms: 200 },
      },
    ]);

    const result = await Effect.runPromise(
      runSemantic(exploreLevel, {
        query: "how does authentication work?",
        path: "/packages/core",
        level: 3,
        documentation: "# Core Package\nContains auth and data domains.",
        children: ["src/auth", "src/data", "src/utils"],
      }).pipe(Effect.provide(layer)),
    );

    expect(result.data.summary).toContain("root package");
    expect(result.data.selectedChildren).toHaveLength(1);
    expect(result.data.selectedChildren[0].path).toBe("src/auth");
    expect(recordings).toHaveLength(1);
    expect(recordings[0].commission.prompt).toContain("how does authentication work?");
  });
});
