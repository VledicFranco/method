// SPDX-License-Identifier: Apache-2.0
/**
 * methodology/ — Top-level formal execution unit (F1-FTH).
 *
 * Methodology<S>: finite-state machine over world state S — arms, safety bounds, terminal conditions.
 * Arm<S>: methodology branch with method, transition predicates.
 * SafetyBounds: hard limits (max steps, time, cost).
 * TerminationCertificate<S>: proof of valid terminal state.
 * asMethodology(): lifts Method<S> into a single-arm Methodology<S>.
 * Safety, transition, and retraction support modules.
 */

export * from './methodology.js';
export * from './transition.js';
export * from './safety.js';
export * from './retraction.js';
