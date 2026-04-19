// SPDX-License-Identifier: Apache-2.0
/**
 * explore — FCA-recursive codebase exploration.
 *
 * The simplest semantic algorithm: read a component's documentation at the
 * current level, summarize it, decide which children are relevant to the
 * query, and recurse into only those children.
 *
 * Complexity: O(d × b_relevant) where d = FCA depth (≤ 6), b = branching.
 * For targeted searches, b_relevant ≈ 1-2, making this effectively O(d).
 *
 * This is the first SPL program — proof that the SemanticFn abstraction
 * works for real FCA-recursive agent algorithms.
 *
 * @see fca/advice/03-recursive-semantic-algorithms.md — Algorithm family
 */

import { Prompt } from "../../prompt/prompt.js";
import { check } from "../../predicate/predicate.js";
import { semanticFn } from "../fn.js";
import type { SemanticFn } from "../fn.js";
import { recurse } from "../compose.js";

// ── Types ──

/** Input to the explore function at each level. */
export type ExploreInput = {
  /** The query — what we're looking for or trying to understand. */
  readonly query: string;
  /** Absolute path to the component at this level. */
  readonly path: string;
  /** FCA level (0-5). Used for base case detection and prompt adaptation. */
  readonly level: number;
  /** Content of the README or documentation at this level (pre-loaded). */
  readonly documentation: string;
  /** Children discovered at this level (paths to sub-components). */
  readonly children: readonly string[];
};

/** Output from the explore function at each level. */
export type ExploreOutput = {
  /** Path of the explored component. */
  readonly path: string;
  /** FCA level explored. */
  readonly level: number;
  /** Summary of what this level contains, relevant to the query. */
  readonly summary: string;
  /** Which children were selected for recursion (and why). */
  readonly selectedChildren: readonly { path: string; reason: string }[];
  /** Child exploration results (populated by recursion). */
  readonly childResults: readonly ExploreOutput[];
};

// ── Prompt ──

const explorePrompt = new Prompt<ExploreInput>((input) => {
  const childList = input.children.length > 0
    ? input.children.map((c) => `- ${c}`).join("\n")
    : "(leaf)";

  return `Explore L${input.level} ${levelName(input.level)} at ${input.path} for: ${input.query}

DOCS:
${input.documentation || "(none)"}

CHILDREN:
${childList}

Summarize (2-3 sentences, query-relevant). Select AT MOST 2 children most relevant to the query, using EXACT names from list. Be selective — skip children unlikely to help. Format:

SUMMARY:
<text>

SELECTED:
<exact-child-name>: <one-line reason>

Or SELECTED: (none) if no children are relevant.`;
});

// ── Parser ──

function parseExploreOutput(raw: string, input: ExploreInput): ExploreOutput | null {
  const summaryMatch = raw.match(/SUMMARY:\s*\n([\s\S]*?)(?=\nSELECTED:)/);
  const selectedMatch = raw.match(/SELECTED:\s*\n([\s\S]*?)$/);

  if (!summaryMatch) return null;

  const summary = summaryMatch[1].trim();
  const selectedBlock = selectedMatch?.[1]?.trim() ?? "";

  const selectedChildren: { path: string; reason: string }[] = [];
  if (selectedBlock && !selectedBlock.startsWith("(none")) {
    for (const line of selectedBlock.split("\n")) {
      const match = line.match(/^(.+?):\s*(.+)$/);
      if (match) {
        const childPath = match[1].trim();
        // Only include if it's actually one of the available children
        if (input.children.some((c) => c === childPath || c.endsWith(childPath) || childPath.endsWith(c))) {
          selectedChildren.push({ path: childPath, reason: match[2].trim() });
        }
      }
    }
  }

  return {
    path: input.path,
    level: input.level,
    summary,
    selectedChildren,
    childResults: [], // Populated by recursion
  };
}

// ── The Semantic Function ──

/** A single level of exploration — reads docs, summarizes, selects children. */
export const exploreLevel: SemanticFn<ExploreInput, ExploreOutput> = semanticFn({
  name: "explore-level",
  prompt: explorePrompt,
  parse: parseExploreOutput,
  pre: [
    check("path is non-empty", (i: ExploreInput) => i.path.length > 0),
    check("query is non-empty", (i: ExploreInput) => i.query.length > 0),
  ],
  post: [
    check("summary has substance (>50 chars)", (o: ExploreOutput) => o.summary.length > 50),
    check("each selected child has a reason", (o: ExploreOutput) =>
      o.selectedChildren.every((sc) => sc.path.length > 0 && sc.reason.length > 0),
    ),
  ],
  maxRetries: 1,
});

/**
 * The full recursive explore algorithm.
 *
 * The key change from v1: decompose receives the OUTPUT, not the input.
 * This means the LLM's `selectedChildren` drives what gets recursed into —
 * not the full list of filesystem children.
 *
 * Flow:
 *   1. Run exploreLevel(input) → output with selectedChildren
 *   2. decompose(output, input) → child inputs for ONLY selected children
 *   3. Recurse into selected children
 *   4. Recompose: attach child results to parent
 *
 * The `loadExploreInput` helper populates documentation and children from
 * the filesystem. You can pass a custom `childLoader` to populate children
 * during decomposition, or pre-populate them in the input.
 */
export const explore: SemanticFn<ExploreInput, ExploreOutput> = recurse(
  exploreLevel,
  // Decompose from OUTPUT: only recurse into LLM-selected children
  (output: ExploreOutput, input: ExploreInput) => {
    // The LLM selected specific children — resolve against available children
    const childInputs: ExploreInput[] = [];
    for (const selected of output.selectedChildren) {
      // Find the matching child from the input's children list
      const match = input.children.find((c) =>
        c === selected.path ||
        c.endsWith(selected.path) ||
        selected.path.endsWith(c) ||
        c.toLowerCase() === selected.path.toLowerCase(),
      );
      if (match) {
        childInputs.push({
          query: input.query,
          path: `${input.path}/${match}`,
          level: input.level - 1,
          documentation: "", // Caller should use fs-loader to populate
          children: [],      // Caller should use fs-loader to populate
        });
      }
    }
    return childInputs;
  },
  // Recompose: attach child results
  (own: ExploreOutput, childResults: ExploreOutput[]) => ({
    ...own,
    childResults,
  }),
  // Base case: leaf level or no children
  (input: ExploreInput) => input.level <= 0 || input.children.length === 0,
);

// ── Helpers ──

function levelName(level: number): string {
  const names: Record<number, string> = {
    0: "Function",
    1: "Module",
    2: "Domain",
    3: "Package",
    4: "Service",
    5: "System",
  };
  return names[level] ?? `L${level}`;
}
