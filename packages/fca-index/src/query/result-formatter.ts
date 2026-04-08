/**
 * ResultFormatter — Maps IndexEntry results to ComponentContext descriptors.
 *
 * Used by QueryEngine after retrieving ranked results from the store.
 * Handles the FcaLevel case convention: IndexEntry stores uppercase levels
 * (same as ContextQueryPort), but ResultFormatter normalises either way.
 */

import type { ComponentContext } from '../ports/context-query.js';
import type { FcaLevel } from '../ports/context-query.js';
import type { IndexEntry } from '../ports/internal/index-store.js';

export class ResultFormatter {
  /**
   * Map IndexEntry results (already ordered by relevance from the store)
   * to ComponentContext objects.
   *
   * relevanceScore: if scores array is provided, use scores[i].
   * Otherwise use positional normalisation: score = 1 - (index / Math.max(total, 1)).
   * If only 1 result: score = 1.0.
   */
  format(entries: IndexEntry[], scores?: number[]): ComponentContext[] {
    return entries.map((entry, i) => {
      // Normalise level: ensure first character is uppercase (handles both 'l2' and 'L2')
      const rawLevel = entry.level as string;
      const level = (rawLevel.charAt(0).toUpperCase() + rawLevel.slice(1)) as FcaLevel;

      const relevanceScore =
        scores !== undefined
          ? scores[i]
          : 1 - i / Math.max(entries.length, 1);

      return {
        path: entry.path,
        level,
        parts: entry.parts,
        relevanceScore,
        coverageScore: entry.coverageScore,
      };
    });
  }
}
