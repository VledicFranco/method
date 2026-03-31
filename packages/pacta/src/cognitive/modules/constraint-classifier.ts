/**
 * Constraint Classifier — pure functions for classifying workspace entries
 * and detecting constraint violations.
 *
 * Extracts the constraint detection logic from the Observer into a standalone
 * module with additional capabilities: content-type classification,
 * prohibition extraction, and post-ACT violation checking.
 *
 * Grounded in: PRD 043 Phase 2, rule-based keyword classification (D2).
 * Only applied to task input, never tool results (D3).
 */

// ── Types ────────────────────────────────────────────────────────

/** Content type for workspace entries. */
export type EntryContentType = 'constraint' | 'goal' | 'operational';

/** Result of classifying entry content. */
export interface ClassificationResult {
  contentType: EntryContentType;
  pinned: boolean;
  matchedPatterns: string[];
}

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
  for (const pattern of CONSTRAINT_PATTERNS) {
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

// ── Prohibition Extraction ───────────────────────────────────────

/**
 * Extract prohibition predicates from constraint text.
 * Returns actionable regexes for post-Write matching.
 *
 * Phase 0: handles "must NOT import/use/trigger/call X" patterns.
 * R-13 diagnostics track: (a) how many constraints have extractable predicates,
 * (b) how many violations are caught. These are separate metrics.
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
