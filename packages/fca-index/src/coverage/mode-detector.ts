// SPDX-License-Identifier: Apache-2.0
/**
 * mode-detector — pure function that maps coverage stats to an IndexMode.
 *
 * Logic is intentionally isolated so it can be tested without any I/O or
 * store dependency.  The engine delegates the mode decision to this module.
 */

import type { IndexMode } from '../ports/context-query.js';

/**
 * Determine whether a project's index is in discovery or production mode.
 *
 * @param weightedAverage  Weighted-average coverage score, range 0–1.
 * @param threshold        Configured coverage threshold, range 0–1.
 * @returns `'production'` when weightedAverage >= threshold, `'discovery'` otherwise.
 */
export function detectMode(weightedAverage: number, threshold: number): IndexMode {
  return weightedAverage >= threshold ? 'production' : 'discovery';
}
