// SPDX-License-Identifier: Apache-2.0
/**
 * Tool<S> — Hoare-typed agent capability.
 *
 * F1-FTH Definition 3.1: tau = (pre_tau, post_tau, description)
 * A tool has a precondition (when it can be used) and a postcondition
 * (what it guarantees after use). Tools are the authorized capabilities
 * available to roles within a step.
 *
 * @see F1-FTH Definition 3.1 — Hoare-typed tools
 */

import type { Predicate } from "../predicate/predicate.js";
import { evaluate } from "../predicate/evaluate.js";

/**
 * A Hoare-typed tool definition.
 *
 * The precondition specifies when the tool may be invoked (what must
 * hold in the state before use). The postcondition specifies what
 * the tool guarantees after successful execution.
 *
 * Category classifies the tool's side-effect profile:
 * - read: observes state without modification
 * - write: modifies state (files, data)
 * - execute: runs external processes (builds, tests, deploys)
 * - communicate: sends/receives messages (prompts, notifications)
 */
export type Tool<S> = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly precondition: Predicate<S>;
  readonly postcondition: Predicate<S>;
  readonly category: "read" | "write" | "execute" | "communicate";
};

/**
 * Verify that a tool's precondition is satisfied in the current state.
 * Pure check — does not execute the tool.
 */
export function canUseTool<S>(tool: Tool<S>, state: S): boolean {
  return evaluate(tool.precondition, state);
}

/**
 * Build a tool set from an array of tools, keyed by ID.
 */
export function buildToolSet<S>(tools: readonly Tool<S>[]): ReadonlyMap<string, Tool<S>> {
  return new Map(tools.map(t => [t.id, t]));
}

/**
 * Filter tools available to a role based on role's authorized list.
 * A tool is included if its ID is in the authorized list AND not in the notAuthorized list.
 */
export function authorizedTools<S>(
  tools: ReadonlyMap<string, Tool<S>>,
  authorized: readonly string[],
  notAuthorized: readonly string[],
): Tool<S>[] {
  return [...tools.values()].filter(
    t => authorized.includes(t.id) && !notAuthorized.includes(t.id),
  );
}
