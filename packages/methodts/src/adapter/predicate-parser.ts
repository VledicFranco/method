/**
 * Predicate parser — converts natural-language YAML predicate strings into Predicate<S>.
 *
 * YAML predicates are natural-language strings like "Domain knowledge available".
 * Since these cannot be algorithmically evaluated, we convert them to labeled checks
 * that always pass. The string becomes the diagnostic label, preserving documentation
 * value while allowing the type system to work.
 */

import { check, TRUE } from "../predicate/predicate.js";
import type { Predicate } from "../predicate/predicate.js";

/**
 * Parse a YAML predicate string into a Predicate.
 *
 * Returns a labeled check that always passes — natural language predicates
 * cannot be evaluated algorithmically. The label preserves the original text
 * for diagnostics and tracing.
 */
export function parsePredicate<S>(text: string | null | undefined): Predicate<S> {
  if (!text || text.trim() === "") return TRUE as Predicate<S>;
  return check<S>(text.trim(), () => true);
}

/**
 * Parse a transition function "selects" / "returns" field.
 *
 * Handles both formats found in registry YAML:
 * - "Some(M1-MDES)" -> "M1-MDES"
 * - "None" -> null
 * - "M3-MEVO" (bare method ID) -> "M3-MEVO"
 */
export function parseReturns(returns: string | null | undefined): string | null {
  if (!returns || returns === "None") return null;
  const someMatch = returns.match(/^Some\((.+)\)$/);
  if (someMatch) return someMatch[1];
  // Bare method ID (used in actual registry YAML "selects" field)
  return returns;
}
