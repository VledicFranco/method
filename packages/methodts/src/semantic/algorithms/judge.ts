/**
 * judge — LLM-as-judge scoring for experiment evaluation.
 *
 * Replaces keyword matching with a separate LLM call that grades
 * an answer on three dimensions:
 *   1. Correctness — are the claims factually accurate?
 *   2. Completeness — does it address all parts of the question?
 *   3. Precision — does it avoid hallucinated or irrelevant claims?
 *
 * The judge is itself a SemanticFn, so it participates in the same
 * truth tracking and gate infrastructure as the algorithms it evaluates.
 *
 * @see F-EXP-1, F-EXP-5 — Replaces keyword matching
 */

import { Prompt } from "../../prompt/prompt.js";
import { check } from "../../predicate/predicate.js";
import { semanticFn } from "../fn.js";
import type { AtomicFn } from "../fn.js";

// ── Types ──

/** Input to the judge. */
export type JudgeInput = {
  /** The original query. */
  readonly query: string;
  /** The answer to evaluate. */
  readonly answer: string;
  /** Ground truth context — source code or documentation the answer should be based on. */
  readonly groundTruth: string;
};

/** Output from the judge. */
export type JudgeOutput = {
  /** Correctness: are claims factually accurate? 0-5 */
  readonly correctness: number;
  /** Completeness: does it address all parts of the question? 0-5 */
  readonly completeness: number;
  /** Precision: no hallucinated or irrelevant claims? 0-5 */
  readonly precision: number;
  /** Overall score: weighted average (correctness 40%, completeness 30%, precision 30%) */
  readonly overall: number;
  /** Brief rationale for the scores. */
  readonly rationale: string;
};

// ── Prompt ──

const judgePrompt = new Prompt<JudgeInput>((input) => `
You are an expert evaluator grading the quality of an answer about a software codebase.

QUERY: ${input.query}

ANSWER TO EVALUATE:
${input.answer}

GROUND TRUTH (actual source code/docs — use this as the reference):
${input.groundTruth.slice(0, 3000)}${input.groundTruth.length > 3000 ? "\n...(truncated)" : ""}

Grade the answer on three dimensions, each 0-5:

1. CORRECTNESS (0-5): Are the claims factually accurate compared to the ground truth?
   0 = completely wrong, 3 = mostly correct with some errors, 5 = perfectly accurate

2. COMPLETENESS (0-5): Does the answer address all parts of the question?
   0 = misses everything, 3 = covers main points, 5 = comprehensive

3. PRECISION (0-5): Does the answer avoid hallucinated or irrelevant claims?
   0 = full of hallucinations, 3 = some unsupported claims, 5 = every claim is supported

FORMAT (exact):
CORRECTNESS: <0-5>
COMPLETENESS: <0-5>
PRECISION: <0-5>
RATIONALE: <1-2 sentences explaining the scores>
`.trim());

// ── Parser ──

function parseJudgeOutput(raw: string): JudgeOutput | null {
  const correctnessMatch = raw.match(/CORRECTNESS:\s*(\d)/);
  const completenessMatch = raw.match(/COMPLETENESS:\s*(\d)/);
  const precisionMatch = raw.match(/PRECISION:\s*(\d)/);
  const rationaleMatch = raw.match(/RATIONALE:\s*([\s\S]*?)$/);

  if (!correctnessMatch || !completenessMatch || !precisionMatch) return null;

  const correctness = Math.min(5, Math.max(0, parseInt(correctnessMatch[1])));
  const completeness = Math.min(5, Math.max(0, parseInt(completenessMatch[1])));
  const precision = Math.min(5, Math.max(0, parseInt(precisionMatch[1])));
  const overall = correctness * 0.4 + completeness * 0.3 + precision * 0.3;
  const rationale = rationaleMatch?.[1]?.trim() ?? "";

  return { correctness, completeness, precision, overall, rationale };
}

// ── The Semantic Function ──

export const judge: AtomicFn<JudgeInput, JudgeOutput> = semanticFn({
  name: "judge",
  prompt: judgePrompt,
  parse: (raw) => parseJudgeOutput(raw),
  pre: [
    check("query is non-empty", (i: JudgeInput) => i.query.length > 0),
    check("answer is non-empty", (i: JudgeInput) => i.answer.length > 0),
  ],
  post: [
    check("scores in range", (o: JudgeOutput) =>
      o.correctness >= 0 && o.correctness <= 5 &&
      o.completeness >= 0 && o.completeness <= 5 &&
      o.precision >= 0 && o.precision <= 5,
    ),
  ],
  maxRetries: 1,
});

// ── Utility: extract text for judging ──

/** Extract a single text string from an ExploreOutput tree for judge evaluation. */
export function flattenExploreForJudging(summary: string, childSummaries: string[]): string {
  // Only use the root summary — don't concatenate all children.
  // This normalizes surface area between flat and recursive conditions.
  // Child summaries are appended as "supporting detail" but capped.
  const parts = [summary];
  if (childSummaries.length > 0) {
    parts.push("\nSupporting detail from sub-components:");
    for (const cs of childSummaries.slice(0, 3)) {
      parts.push(`- ${cs.slice(0, 200)}`);
    }
  }
  return parts.join("\n");
}
