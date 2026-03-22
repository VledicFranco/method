/**
 * Role<S, V> — Typed representation of F1-FTH Definition 2.1.
 *
 * ρ = (π_ρ, α_ρ) where π_ρ is the observation projection and α_ρ is
 * the authorized transitions function.
 *
 * @see theory-mapping.md — maps to ρ = (π_ρ, α_ρ)
 */

import type { Predicate } from "../predicate/predicate.js";
import { Prompt } from "../prompt/prompt.js";

/** A role definition. V is the observable sub-state type. */
export type Role<S, V = S> = {
  readonly id: string;
  readonly description: string;
  /** Observation projection: what the role can see. π_ρ : S → V */
  readonly observe: (state: S) => V;
  /** State-dependent authority (Def 2.1 α_ρ). Optional — Phase 1 approximates with string list. */
  readonly authorizedTransitions?: (state: S) => Predicate<S>;
  /** Simplified: step/tool ID allowlist. */
  readonly authorized: readonly string[];
  /** Simplified: explicit prohibitions. */
  readonly notAuthorized: readonly string[];
};

/**
 * Restrict a prompt to what a role can observe (epistemic scoping via contramap).
 *
 * @example
 * const reviewerPrompt = scopeToRole(reviewerRole, fullPrompt)
 * // reviewerPrompt only sees what the reviewer role can observe
 */
export function scopeToRole<S, V>(role: Role<S, V>, prompt: Prompt<V>): Prompt<S> {
  return prompt.contramap(role.observe);
}
