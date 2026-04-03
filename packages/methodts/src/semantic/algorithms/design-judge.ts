/**
 * design-judge — LLM-as-judge for design artifact quality.
 *
 * Evaluates generated designs on 4 dimensions specific to FCD:
 *   1. Decomposition (35%) — are the sub-components the right ones?
 *   2. Port Quality (30%) — are interfaces typed, minimal, well-named?
 *   3. Documentation (20%) — clear, accurate, useful for a new developer?
 *   4. Surface-First (15%) — ports defined before implementation details?
 *
 * The judge receives:
 *   - The generated design artifacts (ports, readme, sub-components)
 *   - A reference design (ground truth from existing code)
 *   - The original requirement
 *
 * Unlike the generic `judge.ts` (correctness/completeness/precision), this
 * judge is specialized for evaluating design decisions through the FCD lens.
 *
 * @see fcd-design SKILL.md — sigma_3 (surfaces) is the primary deliverable
 * @see fca/advice/02-co-design-dynamics.md — composition theorem
 */

import { Prompt } from "../../prompt/prompt.js";
import { check } from "../../predicate/predicate.js";
import { semanticFn } from "../fn.js";
import type { AtomicFn } from "../fn.js";

// ── Types ──

export type DesignJudgeInput = {
  /** The original requirement that was designed for. */
  readonly requirement: string;
  /** The generated design artifacts — concatenated or structured text. */
  readonly generatedDesign: string;
  /** The reference design (ground truth) — from existing code. */
  readonly referenceDesign: string;
  /** Generated port interface code (if any). */
  readonly generatedPorts: string;
  /** Reference port interfaces (from existing code). */
  readonly referencePorts: string;
};

export type DesignJudgeOutput = {
  /** Are the sub-components the right ones? 0-5 */
  readonly decomposition: number;
  /** Are interfaces typed, minimal, well-named? 0-5 */
  readonly portQuality: number;
  /** Clear, accurate, useful documentation? 0-5 */
  readonly documentation: number;
  /** Ports defined before implementation details? 0-5 */
  readonly surfaceFirst: number;
  /** Weighted overall: decomposition 35%, portQuality 30%, documentation 20%, surfaceFirst 15% */
  readonly overall: number;
  /** Brief rationale for the scores. */
  readonly rationale: string;
};

// ── Prompt ──

const designJudgePrompt = new Prompt<DesignJudgeInput>((input) => `
You are an expert evaluator judging the quality of a software component design.
The design methodology is FCD (Fractal Co-Design) — surfaces (ports) are the primary deliverable, architecture follows from frozen ports.

REQUIREMENT: ${input.requirement}

GENERATED DESIGN:
${input.generatedDesign.slice(0, 3000)}${input.generatedDesign.length > 3000 ? "\n...(truncated)" : ""}

GENERATED PORT INTERFACES:
${input.generatedPorts || "(none generated)"}

REFERENCE DESIGN (ground truth):
${input.referenceDesign.slice(0, 3000)}${input.referenceDesign.length > 3000 ? "\n...(truncated)" : ""}

REFERENCE PORT INTERFACES:
${input.referencePorts || "(none in reference)"}

Grade the design on 4 dimensions, each 0-5:

1. DECOMPOSITION (0-5): Are the sub-components the right ones?
   Compare against the reference. Did the design identify the same components?
   0 = completely wrong decomposition, 3 = most components identified, 5 = matches reference

2. PORT_QUALITY (0-5): Are the port interfaces typed, minimal, and well-named?
   0 = no ports or all \`any\`, 3 = typed but over/under-engineered, 5 = minimal and precise

3. DOCUMENTATION (0-5): Is the documentation clear and accurate?
   0 = missing or wrong, 3 = present but vague, 5 = a new developer could understand the component

4. SURFACE_FIRST (0-5): Were ports/surfaces defined as the primary deliverable?
   0 = architecture-first (surfaces derived from impl), 3 = mixed, 5 = ports clearly drive architecture

FORMAT (exact):
DECOMPOSITION: <0-5>
PORT_QUALITY: <0-5>
DOCUMENTATION: <0-5>
SURFACE_FIRST: <0-5>
RATIONALE: <2-3 sentences>
`.trim());

// ── Parser ──

function parseDesignJudgeOutput(raw: string): DesignJudgeOutput | null {
  const decomp = raw.match(/DECOMPOSITION:\s*(\d)/);
  const port = raw.match(/PORT_QUALITY:\s*(\d)/);
  const doc = raw.match(/DOCUMENTATION:\s*(\d)/);
  const surface = raw.match(/SURFACE_FIRST:\s*(\d)/);
  const rationale = raw.match(/RATIONALE:\s*([\s\S]*?)$/);

  if (!decomp || !port || !doc || !surface) return null;

  const decomposition = clamp(parseInt(decomp[1]));
  const portQuality = clamp(parseInt(port[1]));
  const documentation = clamp(parseInt(doc[1]));
  const surfaceFirst = clamp(parseInt(surface[1]));
  const overall = decomposition * 0.35 + portQuality * 0.30 + documentation * 0.20 + surfaceFirst * 0.15;

  return {
    decomposition,
    portQuality,
    documentation,
    surfaceFirst,
    overall,
    rationale: rationale?.[1]?.trim() ?? "",
  };
}

function clamp(n: number): number {
  return Math.min(5, Math.max(0, n));
}

// ── The Semantic Function ──

export const designJudge: AtomicFn<DesignJudgeInput, DesignJudgeOutput> = semanticFn({
  name: "design-judge",
  prompt: designJudgePrompt,
  parse: (raw) => parseDesignJudgeOutput(raw),
  pre: [
    check("requirement non-empty", (i: DesignJudgeInput) => i.requirement.length > 0),
    check("generated design non-empty", (i: DesignJudgeInput) => i.generatedDesign.length > 0),
  ],
  post: [
    check("scores in range", (o: DesignJudgeOutput) =>
      o.decomposition >= 0 && o.decomposition <= 5 &&
      o.portQuality >= 0 && o.portQuality <= 5 &&
      o.documentation >= 0 && o.documentation <= 5 &&
      o.surfaceFirst >= 0 && o.surfaceFirst <= 5,
    ),
  ],
  maxRetries: 1,
});

// ── Composite scoring ──

/**
 * Compute composite design score: 50% algorithmic gates + 50% judge score.
 */
export function computeDesignScore(gatePassRate: number, judgeOutput: DesignJudgeOutput): number {
  return 0.50 * gatePassRate + 0.50 * (judgeOutput.overall / 5.0);
}

/**
 * Compute composite implementation score: 85% algorithmic gates + 15% judge score.
 */
export function computeImplementScore(gatePassRate: number, judgeOverall: number): number {
  return 0.85 * gatePassRate + 0.15 * (judgeOverall / 5.0);
}
