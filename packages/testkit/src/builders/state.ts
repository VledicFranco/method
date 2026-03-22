/**
 * WorldState helper — construct WorldState<S> values with minimal ceremony.
 */

import type { WorldState } from "@method/methodts";

/**
 * Create a WorldState<S> from a plain state value.
 * Axiom status defaults to valid.
 *
 * @example
 * ```ts
 * const state = worldState({ tasks: [], currentTask: null });
 * ```
 */
export function worldState<S>(value: S): WorldState<S> {
  return {
    value,
    axiomStatus: { valid: true, violations: [] },
  };
}

/**
 * Create a WorldState<S> with axiom violations.
 * Useful for testing axiom validation paths.
 */
export function worldStateWithViolations<S>(value: S, violations: string[]): WorldState<S> {
  return {
    value,
    axiomStatus: { valid: false, violations },
  };
}
