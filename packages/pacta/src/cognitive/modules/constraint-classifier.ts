/**
 * Constraint Classifier — entry classification and constraint detection.
 *
 * Classification (classifyEntry) is Observer-level behavior and lives here.
 * Violation detection (checkConstraintViolations, extractProhibitions) is
 * pure algebra promoted to algebra/constraint-utils.ts (PRD 044 Wave 0)
 * and re-exported here for backward compatibility.
 *
 * ## Cognitive Science Grounding
 *
 * **Primary analog: Supervisory Attentional System (SAS, Norman & Shallice, 1986)
 * — inhibitory control and constraint enforcement.**
 *
 * - **SAS (Norman & Shallice, 1986):** The SAS intervenes when routine
 *   (contention scheduling) behavior would violate task constraints. It
 *   biases processing toward constraint-compliant actions. Our Constraint
 *   Classifier identifies constraint-bearing inputs ("must not", "never",
 *   "always") and pins them in the workspace, ensuring they persist through
 *   eviction — functionally similar to the SAS maintaining inhibitory control
 *   over the action system.
 *
 * - **Inhibitory Control (Aron et al., 2004):** The right inferior frontal
 *   gyrus (rIFG) implements response inhibition — stopping actions that
 *   violate task rules. Our constraint violation checker (extractProhibitions +
 *   checkConstraintViolations) is the rule-based version: it extracts "do not"
 *   rules and checks the Actor's output against them.
 *
 * - **Prospective Memory (Einstein & McDaniel, 2005):** Constraint entries
 *   that are "pinned" in the workspace serve as prospective memory cues —
 *   persistent reminders of rules that must be respected throughout execution.
 *
 * **What this module captures:**
 * - Content classification: constraint/goal/operational via keyword patterns
 * - Constraint pinning: prohibitions persist through workspace eviction
 * - Violation detection: post-action check against extracted prohibitions
 *
 * **What this module does NOT capture (known gaps):**
 * - Semantic understanding: classification is keyword-based, not semantic.
 *   "Avoid the notifications service" won't match if phrased differently.
 * - Constraint satisfaction detection: knows when constraints are *violated*
 *   but not when they're *satisfied*. This is half of goal-state monitoring
 *   (see RFC 004).
 * - Goal classification is keyword-based and conservative — may miss implicit
 *   goals or misclassify operational content as goals.
 *
 * **References:**
 * - Norman, D. A., & Shallice, T. (1986). Attention to action: Willed and automatic
 *   control of behavior. In R. J. Davidson et al. (Eds.), Consciousness and Self-Regulation.
 * - Aron, A. R., Robbins, T. W., & Poldrack, R. A. (2004). Inhibition and the right
 *   inferior frontal cortex. Trends in Cognitive Sciences, 8(4), 170-177.
 * - Einstein, G. O., & McDaniel, M. A. (2005). Prospective memory: Multiple retrieval
 *   processes. Current Directions in Psychological Science, 14(6), 286-290.
 *
 * @see docs/prds/043-cognitive-constraint-enforcement.md
 * @see docs/rfcs/004-goal-state-monitoring.md — constraint satisfaction as part of goal evaluation
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
