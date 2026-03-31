/**
 * Constraint Classifier — entry classification and constraint detection.
 *
 * Classification (classifyEntry) is Observer-level behavior and lives here.
 * Violation detection (checkConstraintViolations, extractProhibitions) is
 * pure algebra promoted to algebra/constraint-utils.ts (PRD 044 Wave 0)
 * and re-exported here for backward compatibility.
 *
 * Grounded in: PRD 043 Phase 2, rule-based keyword classification (D2).
 * Only applied to task input, never tool results (D3).
 */

// ── Re-exports from algebra/constraint-utils.ts (PRD 044) ──────

export {
  extractProhibitions,
  checkConstraintViolations,
  CONSTRAINT_PATTERNS,
} from '../algebra/constraint-utils.js';

export type { ConstraintViolation } from '../algebra/constraint-utils.js';

// ── Types (local — classification is module-level behavior) ─────

/** Content type for workspace entries. */
export type EntryContentType = 'constraint' | 'goal' | 'operational';

/** Result of classifying entry content. */
export interface ClassificationResult {
  contentType: EntryContentType;
  pinned: boolean;
  matchedPatterns: string[];
}

// ── Patterns (re-imported for local use in classifyEntry) ───────

import { CONSTRAINT_PATTERNS as _CONSTRAINT_PATTERNS } from '../algebra/constraint-utils.js';

/**
 * Narrow goal patterns — intentionally tight to avoid false positives
 * on tool results containing source code. The classifier only runs on
 * task input anyway (D3), but narrow patterns provide defense-in-depth.
 */
const GOAL_PATTERNS = [
  /\b(your\s+task)\b/i,
  /\b(objective|goal|deliverable)\b/i,
];

// ── Classification ───────────────────────────────────────────────

/**
 * Classify task input content. Only call on Observer input (user/task prompts),
 * NOT on tool results. Tool results always classify as 'operational'.
 *
 * Priority: constraint > goal > operational.
 * Constraint wins over goal intentionally — safety-critical case.
 */
export function classifyEntry(content: string): ClassificationResult {
  const text = typeof content === 'string' ? content : String(content);
  const matchedPatterns: string[] = [];

  // Constraint patterns first (higher priority)
  for (const pattern of _CONSTRAINT_PATTERNS) {
    if (pattern.test(text)) {
      matchedPatterns.push(pattern.source);
      return { contentType: 'constraint', pinned: true, matchedPatterns };
    }
  }

  // Goal patterns
  for (const pattern of GOAL_PATTERNS) {
    if (pattern.test(text)) {
      return { contentType: 'goal', pinned: false, matchedPatterns: [] };
    }
  }

  return { contentType: 'operational', pinned: false, matchedPatterns: [] };
}
