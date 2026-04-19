// SPDX-License-Identifier: Apache-2.0
/**
 * Method instantiation — apply a ProjectCard to a method or methodology.
 *
 * Instantiation binds an abstract method to a concrete project context by:
 * - Enriching role descriptions with project-specific notes
 * - Validating that the card references only roles defined in the method
 *
 * Pure functions — no Effect dependency.
 */

import type { Method } from "../method/method.js";
import type { Methodology } from "../methodology/methodology.js";
import type { ProjectCard } from "./project-card.js";

/** Result of validating a project card against a method. */
export type CardCompatibilityResult = {
  readonly valid: boolean;
  readonly errors: readonly string[];
};

/**
 * Validate that a project card is compatible with a method.
 * Checks that all role notes reference roles that exist in the method.
 */
export function validateCardCompatibility<S>(
  card: ProjectCard,
  method: Method<S>,
): CardCompatibilityResult {
  const errors: string[] = [];
  for (const roleId of Object.keys(card.roleNotes)) {
    if (!method.roles.some((r) => r.id === roleId)) {
      errors.push(`Role note references non-existent role: ${roleId}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Instantiate a method with a project card.
 * Enriches role descriptions with project-specific notes from the card.
 *
 * @param method  The abstract method to instantiate
 * @param card    The project card providing context bindings
 * @returns A new method with enriched role descriptions
 */
export function instantiate<S>(method: Method<S>, card: ProjectCard): Method<S> {
  const enrichedRoles = method.roles.map((role) => ({
    ...role,
    description: card.roleNotes[role.id]
      ? `${role.description}\n\nProject note: ${card.roleNotes[role.id]}`
      : role.description,
  }));
  return { ...method, roles: enrichedRoles };
}

/**
 * Instantiate all methods within a methodology's arms.
 * Each arm that selects a method gets that method enriched with project card notes.
 */
export function instantiateMethodology<S>(
  methodology: Methodology<S>,
  card: ProjectCard,
): Methodology<S> {
  const enrichedArms = methodology.arms.map((arm) => ({
    ...arm,
    selects: arm.selects ? instantiate(arm.selects, card) : null,
  }));
  return { ...methodology, arms: enrichedArms };
}
