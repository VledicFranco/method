// SPDX-License-Identifier: Apache-2.0
/**
 * meta/ — Higher-order methodology operations.
 *
 * compile(): methodology → canonical registry representation.
 * compose(): two methodologies → composite (sequential or parallel).
 * derive(): base methodology → specialized variant.
 * evolve(): methodology + delta → new version.
 * instantiate(): methodology template + domain params → concrete methodology.
 * refinement(): checks if A refines B.
 * coherence(): composition consistency + non-contradiction checker.
 * project-card: reads/writes .method/project-card.yaml.
 * promotion: draft → registry (compilation gate check).
 */

export * from './compile.js';
export * from './compose.js';
export * from './derive.js';
export * from './evolve.js';
export * from './instantiate.js';
export * from './refinement.js';
export * from './coherence.js';
export * from './project-card.js';
export * from './promotion.js';
