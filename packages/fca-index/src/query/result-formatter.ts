/**
 * ResultFormatter — Maps IndexEntry results to ComponentContext descriptors.
 *
 * Used by QueryEngine after retrieving ranked results from the store.
 * Handles the FcaLevel case convention: IndexEntry stores uppercase levels
 * (same as ContextQueryPort), but ResultFormatter normalises either way.
 *
 * Per-rank excerpt budget (PRD 053 SC-1, council 2026-04-12):
 *   The top-1 result gets up to ~500 chars per part (capped at 1800 total)
 *   so the consumer can usually act without reading source files. Other
 *   results stay at ~120 chars per part to keep the overall response small.
 *   Both bounds stay within the frozen ComponentPart.excerpt "~500 chars"
 *   contract — we are using more of the existing budget on top-1, not
 *   exceeding it.
 */

import type { ComponentContext, ComponentPart } from '../ports/context-query.js';
import type { FcaLevel } from '../ports/context-query.js';
import type { IndexEntry } from '../ports/internal/index-store.js';

/** Per-part excerpt cap on the top-1 result. */
export const TOP_RESULT_EXCERPT_PER_PART = 350;

/** Hard cap on total excerpt characters across all parts of the top-1 result. */
export const TOP_RESULT_TOTAL_BUDGET = 1400;

/** Per-part excerpt cap on non-top results (rank 1+). */
export const REST_RESULT_EXCERPT_PER_PART = 120;

export class ResultFormatter {
  /**
   * Map IndexEntry results (already ordered by relevance from the store)
   * to ComponentContext objects.
   *
   * relevanceScore: if scores array is provided, use scores[i].
   * Otherwise use positional normalisation: score = 1 - (index / Math.max(total, 1)).
   * If only 1 result: score = 1.0.
   *
   * Excerpts on each ComponentPart are trimmed per-rank: top-1 gets up to
   * TOP_RESULT_EXCERPT_PER_PART per part (TOP_RESULT_TOTAL_BUDGET total),
   * other ranks get REST_RESULT_EXCERPT_PER_PART per part.
   */
  format(entries: IndexEntry[], scores?: number[]): ComponentContext[] {
    return entries.map((entry, i) => {
      const rawLevel = entry.level as string;
      const level = (rawLevel.charAt(0).toUpperCase() + rawLevel.slice(1)) as FcaLevel;

      const relevanceScore =
        scores !== undefined
          ? scores[i]
          : 1 - i / Math.max(entries.length, 1);

      return {
        path: entry.path,
        level,
        parts: trimParts(entry.parts, i === 0),
        relevanceScore,
        coverageScore: entry.coverageScore,
      };
    });
  }
}

/**
 * Apply per-rank excerpt budgets to a component's parts.
 *
 * - isTop=true: each part keeps up to TOP_RESULT_EXCERPT_PER_PART chars,
 *   bounded by a running TOP_RESULT_TOTAL_BUDGET cap. Once the cap is
 *   exhausted, remaining parts have their excerpts stripped (set to undefined).
 * - isTop=false: each part keeps up to REST_RESULT_EXCERPT_PER_PART chars.
 *
 * Parts with undefined excerpts pass through unchanged. Parts ordering is
 * always preserved.
 */
function trimParts(parts: ComponentPart[], isTop: boolean): ComponentPart[] {
  if (!isTop) {
    return parts.map((p) =>
      p.excerpt === undefined
        ? p
        : { ...p, excerpt: p.excerpt.slice(0, REST_RESULT_EXCERPT_PER_PART) },
    );
  }

  let used = 0;
  return parts.map((p) => {
    if (p.excerpt === undefined) return p;

    const remaining = TOP_RESULT_TOTAL_BUDGET - used;
    if (remaining <= 0) {
      return { ...p, excerpt: undefined };
    }

    const limit = Math.min(TOP_RESULT_EXCERPT_PER_PART, remaining);
    const trimmed = p.excerpt.slice(0, limit);
    used += trimmed.length;
    return { ...p, excerpt: trimmed };
  });
}
