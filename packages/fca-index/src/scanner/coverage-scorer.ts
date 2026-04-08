/**
 * CoverageScorer — Computes the coverage score for a scanned component.
 *
 * Score = (detected parts that are in requiredParts) / requiredParts.length
 * Clamped to [0, 1]. If requiredParts is empty, returns 1.0.
 */

import type { FcaPart } from '../ports/context-query.js';

export class CoverageScorer {
  /**
   * Compute coverage score.
   *
   * @param detectedParts - FCA parts found in the component
   * @param requiredParts - FCA parts required for full coverage
   * @returns number in [0, 1]
   */
  score(detectedParts: FcaPart[], requiredParts: FcaPart[]): number {
    if (requiredParts.length === 0) return 1.0;

    const detectedSet = new Set(detectedParts);
    const covered = requiredParts.filter(p => detectedSet.has(p)).length;

    return Math.min(1, Math.max(0, covered / requiredParts.length));
  }
}
