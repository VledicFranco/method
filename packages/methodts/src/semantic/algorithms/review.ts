/**
 * review — FCA-recursive port-priority review algorithm.
 *
 * Implements the fcd-review skill as an SPL program:
 *   Review in composition theorem order:
 *     1. Port correctness (multiplicative cost)
 *     2. Interface clarity (multiplicative cost)
 *     3. Architecture quality (additive cost)
 *
 *   Recurse into children that have findings. Don't waste time
 *   recursing into clean sub-components.
 *
 * @see fcd-review SKILL.md — Phase A (advisors), Phase B (synthesizers)
 * @see fca/advice/02-co-design-dynamics.md — Composition theorem
 */

import { Prompt } from "../../prompt/prompt.js";
import { check } from "../../predicate/predicate.js";
import { semanticFn } from "../fn.js";
import type { SemanticFn } from "../fn.js";
import { recurse } from "../compose.js";

// ── Types ──

export type FindingSeverity = "critical" | "high" | "medium" | "low";
export type FindingCategory = "port" | "interface" | "architecture" | "domain";

export type Finding = {
  readonly id: string;
  readonly severity: FindingSeverity;
  readonly category: FindingCategory;
  readonly description: string;
  readonly file?: string;
  readonly suggestion: string;
};

/** Input to the review function at each level. */
export type ReviewInput = {
  /** Path to the component being reviewed. */
  readonly path: string;
  /** FCA level. */
  readonly level: number;
  /** Source code or documentation to review at this level. */
  readonly content: string;
  /** Known port definitions relevant to this component. */
  readonly portContext: string;
  /** Children of this component (for recursion targeting). */
  readonly children: readonly string[];
};

/** Output from the review function at each level. */
export type ReviewOutput = {
  readonly path: string;
  readonly level: number;
  /** Findings sorted by FCD priority: port > interface > architecture > domain. */
  readonly findings: readonly Finding[];
  /** Children flagged for deeper review (only those with issues). */
  readonly flaggedChildren: readonly string[];
  /** Brief summary of the review at this level. */
  readonly summary: string;
  /** Child review results (populated by recursion). */
  readonly childReviews: readonly ReviewOutput[];
};

// ── Prompt ──

const reviewPrompt = new Prompt<ReviewInput>((input) => {
  const levelName = ["Function", "Module", "Domain", "Package", "Service", "System"][input.level] ?? `L${input.level}`;

  return `Review L${input.level} ${levelName} at ${input.path}

CONTENT:
${input.content.slice(0, 3000)}${input.content.length > 3000 ? "\n...(truncated)" : ""}

PORT CONTEXT:
${input.portContext || "(no known ports)"}

CHILDREN:
${input.children.length > 0 ? input.children.join(", ") : "(leaf)"}

REVIEW IN FCD PRIORITY ORDER:
1. PORTS (highest priority — multiplicative impact):
   - Cross-domain imports go through ports, not direct imports?
   - External deps accessed through ports?
   - Shared types from canonical package, not redefined locally?

2. INTERFACES (medium priority — multiplicative impact):
   - Public APIs clear and non-leaking?
   - Exported types well-defined?

3. ARCHITECTURE (lower priority — additive impact):
   - Internal structure clean?
   - Patterns consistent?

4. Flag children that need deeper review (ONLY if you see issues suggesting problems below).

FORMAT:

FINDINGS:
F-<N> | <severity: critical/high/medium/low> | <category: port/interface/architecture/domain> | <description> | <suggestion>

(or "FINDINGS: (none)" if no issues found)

FLAGGED_CHILDREN:
<child-name>: <reason to review deeper>

(or "FLAGGED_CHILDREN: (none)")

SUMMARY:
<1-2 sentence overall assessment>`;
});

// ── Parser ──

function parseReviewOutput(raw: string, input: ReviewInput): ReviewOutput | null {
  // Parse findings
  const findings: Finding[] = [];
  const findingsMatch = raw.match(/FINDINGS:\s*\n([\s\S]*?)(?=\nFLAGGED_CHILDREN:)/);
  if (findingsMatch && !findingsMatch[1].includes("(none)")) {
    const lines = findingsMatch[1].trim().split("\n");
    for (const line of lines) {
      const match = line.match(/^F-(\d+)\s*\|\s*(\w+)\s*\|\s*(\w+)\s*\|\s*(.+?)\s*\|\s*(.+)$/);
      if (match) {
        findings.push({
          id: `F-${match[1]}`,
          severity: match[2].trim() as FindingSeverity,
          category: match[3].trim() as FindingCategory,
          description: match[4].trim(),
          suggestion: match[5].trim(),
        });
      }
    }
  }

  // Parse flagged children
  const flaggedChildren: string[] = [];
  const flaggedMatch = raw.match(/FLAGGED_CHILDREN:\s*\n([\s\S]*?)(?=\nSUMMARY:)/);
  if (flaggedMatch && !flaggedMatch[1].includes("(none)")) {
    const lines = flaggedMatch[1].trim().split("\n");
    for (const line of lines) {
      const match = line.match(/^(\S+):/);
      if (match) {
        flaggedChildren.push(match[1].trim());
      }
    }
  }

  // Parse summary
  const summaryMatch = raw.match(/SUMMARY:\s*\n([\s\S]*?)$/);
  const summary = summaryMatch ? summaryMatch[1].trim() : "";

  if (!summary) return null;

  // Sort findings by FCD priority: port > interface > architecture > domain
  const priorityOrder: Record<string, number> = { port: 0, interface: 1, architecture: 2, domain: 3 };
  const sorted = [...findings].sort((a, b) =>
    (priorityOrder[a.category] ?? 4) - (priorityOrder[b.category] ?? 4),
  );

  // Escalate port findings: medium → high (composition theorem)
  const escalated = sorted.map((f) => {
    if (f.category === "port" && f.severity === "medium") {
      return { ...f, severity: "high" as FindingSeverity };
    }
    return f;
  });

  return {
    path: input.path,
    level: input.level,
    findings: escalated,
    flaggedChildren,
    summary,
    childReviews: [],
  };
}

// ── The Semantic Function ──

/** Review a single level with FCD priority ordering. */
export const reviewLevel: SemanticFn<ReviewInput, ReviewOutput> = semanticFn({
  name: "review-level",
  prompt: reviewPrompt,
  parse: parseReviewOutput,
  pre: [
    check("content is non-empty", (i: ReviewInput) => i.content.length > 0),
  ],
  post: [
    check("summary produced", (o: ReviewOutput) => o.summary.length > 0),
  ],
  maxRetries: 1,
});

/**
 * The full recursive review algorithm.
 *
 * With output-guided decomposition: the LLM's `flaggedChildren` drives
 * which children to recurse into. Only children with suspected issues
 * are reviewed deeper — O(d × b_flagged) where b_flagged << b_total.
 *
 * This is the most efficient recursive algorithm because reviews are
 * naturally selective — clean code doesn't get recursed into.
 */
export const review: SemanticFn<ReviewInput, ReviewOutput> = recurse(
  reviewLevel,
  // Decompose from OUTPUT: only recurse into LLM-flagged children
  (output: ReviewOutput, input: ReviewInput) => {
    // Only recurse into children the LLM flagged as needing deeper review
    return output.flaggedChildren
      .filter((flagged) => input.children.some((c) =>
        c === flagged || c.endsWith(flagged) || flagged.endsWith(c),
      ))
      .map((flagged) => ({
        path: `${input.path}/${flagged}`,
        level: input.level - 1,
        content: "", // To be populated by caller/loader
        portContext: input.portContext,
        children: [],
      }));
  },
  // Recompose: attach child reviews
  (own: ReviewOutput, children: ReviewOutput[]) => ({
    ...own,
    childReviews: children,
  }),
  // Base case
  (input: ReviewInput) => input.level <= 0 || input.children.length === 0,
);
