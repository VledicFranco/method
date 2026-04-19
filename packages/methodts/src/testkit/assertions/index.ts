// SPDX-License-Identifier: Apache-2.0
/**
 * testkit/assertions/ — Assertion functions for methodology tests.
 *
 * domain: assertions about DomainTheory validity.
 * method: assertions about Method execution (step outputs, gate results).
 * methodology: assertions about Methodology execution (arm transitions, completion).
 * predicate: assertions about Predicate evaluation results.
 * retraction: assertions about retraction behavior on failure.
 */

export * from './domain.js';
export * from './method.js';
export * from './methodology.js';
export * from './predicate.js';
export * from './retraction.js';
