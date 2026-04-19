// SPDX-License-Identifier: Apache-2.0
/**
 * Constraint Utilities — pure functions for constraint violation detection.
 *
 * Promoted from modules/constraint-classifier.ts (PRD 044 Wave 0) to algebra/
 * because these functions are consumed by both the legacy cycle.ts path and
 * the new partitions/constraint/monitor.ts. Placing them in algebra/ (L2)
 * avoids an upward dependency from partitions/ (L2) to modules/ (L2-sibling).
 *
 * The classification function (classifyEntry) remains in modules/ — it is
 * Observer-level behavior, not pure algebra.
 */

// ── Types ────────────────────────────────────────────────────────

/** Constraint violation found by post-ACT check. */
export interface ConstraintViolation {
  /** Truncated constraint text. */
  constraint: string;
  /** What matched in actor output. */
  violation: string;
  /** The prohibition regex source. */
  pattern: string;
}

// ── Patterns ─────────────────────────────────────────────────────

/** Constraint detection patterns (Phase 0 — rule-based). */
export const CONSTRAINT_PATTERNS = [
  /\bmust\s+not\b/i,
  /\bshall\s+not\b/i,
  /\bdo\s+not\b/i,
  /\bnever\s+(?:import|use|call|trigger|modify|change|delete|remove|touch)\b/i,
  /\bcannot\b/i,
  /\bprohibited\b/i,
  /\bforbidden\b/i,
  /\bconstraint:/i,
  /\binvariant:/i,
];

// ── Prohibition Extraction ───────────────────────────────────────

/**
 * Extract prohibition predicates from constraint text.
 * Returns actionable regexes for post-Write matching.
 *
 * Phase 0: handles "must NOT import/use/trigger/call X" patterns.
 */
export function extractProhibitions(constraintContent: string): RegExp[] {
  const prohibitions: RegExp[] = [];
  const text = String(constraintContent);

  // "must NOT import/use/trigger/call X" -> /import.*X/i (or /X/i for trigger/call)
  const verbMatch = text.match(
    /must\s+(?:not|never)\s+(import|use|trigger|call)\s+(\w[\w\s]*?)(?:\s+(?:or|and)\b|\.|,|$)/i,
  );
  if (verbMatch) {
    const [, verb, target] = verbMatch;
    const trimmed = target.trim();
    if (verb.toLowerCase() === 'import') {
      prohibitions.push(new RegExp(`import.*${trimmed}`, 'i'));
    } else {
      prohibitions.push(new RegExp(trimmed, 'i'));
    }
  }

  // "must NOT trigger X" (alternate form)
  const triggerMatch = text.match(/must\s+not\s+trigger\s+(.+?)(?:\.|,|$)/i);
  if (triggerMatch && !verbMatch) {
    prohibitions.push(new RegExp(triggerMatch[1].trim(), 'i'));
  }

  return prohibitions;
}

// ── Violation Check ──────────────────────────────────────────────

/**
 * Check actor output against pinned workspace constraints.
 * Pure function — no workspace access needed, takes entries as input.
 * Returns violations found (empty array = no violations).
 */
export function checkConstraintViolations(
  pinnedConstraints: Array<{ content: unknown }>,
  actorOutput: string,
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];

  for (const entry of pinnedConstraints) {
    const constraintText = String(entry.content);
    const prohibitions = extractProhibitions(constraintText);

    for (const pattern of prohibitions) {
      const match = actorOutput.match(pattern);
      if (match) {
        violations.push({
          constraint: constraintText.slice(0, 200),
          violation: match[0].slice(0, 200),
          pattern: pattern.source,
        });
      }
    }
  }

  return violations;
}
