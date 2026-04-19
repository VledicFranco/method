// SPDX-License-Identifier: Apache-2.0
/**
 * coverage/ — Coverage reporting domain.
 *
 * Computes FCA documentation coverage across all indexed components and
 * determines whether the project has graduated to production mode.
 *
 * CoverageEngine: implements CoverageReportPort — queries SQLite for coverage stats
 *   and per-component part presence, then formats into CoverageReport with:
 *   - overallScore: weighted average across all components
 *   - mode: 'discovery' | 'production' (based on threshold)
 *   - fullyDocumented / partiallyDocumented / undocumented counts
 *   - byPart: per-FCA-part presence rate across the whole project
 *   - components[]: per-component scores (verbose mode)
 *
 * ModeDetector: pure function — given coverage stats + threshold → 'discovery' | 'production'.
 */

export { CoverageEngine } from './coverage-engine.js';
export { detectMode } from './mode-detector.js';
