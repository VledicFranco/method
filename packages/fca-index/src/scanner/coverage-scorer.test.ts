// SPDX-License-Identifier: Apache-2.0
/**
 * CoverageScorer — unit tests.
 */

import { describe, it, expect } from 'vitest';
import { CoverageScorer } from './coverage-scorer.js';

describe('CoverageScorer', () => {
  const scorer = new CoverageScorer();

  it('returns 1.0 when all required parts are detected', () => {
    expect(scorer.score(['interface', 'documentation'], ['interface', 'documentation'])).toBe(1.0);
  });

  it('returns 0.5 when half the required parts are detected', () => {
    expect(scorer.score(['interface'], ['interface', 'documentation'])).toBe(0.5);
  });

  it('returns 0.0 when no required parts are detected', () => {
    expect(scorer.score([], ['interface', 'documentation'])).toBe(0.0);
  });

  it('returns 1.0 when requiredParts is empty', () => {
    expect(scorer.score([], [])).toBe(1.0);
  });

  it('ignores extra detected parts not in requiredParts', () => {
    expect(scorer.score(['interface', 'documentation', 'port', 'verification'], ['interface', 'documentation'])).toBe(1.0);
  });

  it('returns correct fractional score for partial coverage', () => {
    const result = scorer.score(['interface', 'port'], ['interface', 'documentation', 'port', 'verification']);
    expect(result).toBe(0.5);
  });

  it('clamps score to [0, 1]', () => {
    // Should never go below 0 or above 1
    const result = scorer.score(['interface', 'documentation', 'port'], ['interface', 'documentation']);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });

  it('handles single required part — found', () => {
    expect(scorer.score(['interface'], ['interface'])).toBe(1.0);
  });

  it('handles single required part — missing', () => {
    expect(scorer.score(['documentation'], ['interface'])).toBe(0.0);
  });
});
