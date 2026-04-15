/**
 * Percentile computation utilities for cost/duration estimation.
 */

/**
 * Compute the p-th percentile from a sorted array of numbers.
 * Uses linear interpolation between adjacent values.
 *
 * @param sorted - Pre-sorted array (ascending). Must not be empty.
 * @param p - Percentile in [0, 100].
 */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new Error('percentile: empty array');
  if (sorted.length === 1) return sorted[0];

  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);

  if (lower === upper) return sorted[lower];

  const frac = idx - lower;
  return sorted[lower] * (1 - frac) + sorted[upper] * frac;
}

/** Compute p50 and p90 from an unsorted array. */
export function computeBands(values: readonly number[]): { p50: number; p90: number } {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
  };
}
