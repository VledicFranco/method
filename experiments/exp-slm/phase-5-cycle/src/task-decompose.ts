/**
 * Task Decomposition — splits task descriptions into typed entries for partition routing.
 *
 * RFC 003 Problem: when a task description contains BOTH goal content ("add a v2 handler")
 * AND constraint content ("must NOT trigger notifications"), the DefaultEntryRouter routes
 * the ENTIRE description to the constraint partition (first-match wins). This means the
 * goal part ends up in the constraint partition, not the task partition — even though it
 * should be in both places.
 *
 * Solution: decompose the description at the sentence level, prefix each sentence with
 * its type keyword, and write each as a separate entry. The DefaultEntryRouter then routes
 * each entry to the correct partition:
 *   - "CONSTRAINT: ..." → constraint partition (matches /\bconstraint:/i)
 *   - "GOAL: ..." → task partition (matches /\b(goal)\b/i)
 *   - plain context → operational partition
 *
 * This ensures the reasoner sees: goals in task partition, constraints in constraint partition,
 * and background context in operational partition — rather than everything lumped together.
 */

import { CONSTRAINT_PATTERNS } from '../../../../packages/pacta/src/cognitive/algebra/constraint-utils.js';
import { moduleId } from '../../../../packages/pacta/src/cognitive/algebra/index.js';
import type { WorkspaceEntry } from '../../../../packages/pacta/src/cognitive/algebra/workspace-types.js';

// ── Goal Patterns ──────────────────────────────────────────────

const GOAL_PATTERNS = [
  /\b(your\s+task)\b/i,
  /\b(objective|goal|deliverable|requirement)\b/i,
  /\b(implement|create|add|refactor|migrate|fix|extract|update|write|remove|export|preserve|ensure)\b/i,
  // Positive "must / shall / should" requirements (distinct from prohibitions which use CONSTRAINT_PATTERNS)
  /\bmust\s+(?:be|include|contain|export|preserve|remain|have|return)\b/i,
  /\bshall\s+(?:be|include|contain|export|preserve|remain|have|return)\b/i,
  /\b(must\s+be\s+preserved|must\s+remain|must\s+include|must\s+export)\b/i,
];

// ── Types ──────────────────────────────────────────────────────

export interface DecomposedTask {
  constraints: WorkspaceEntry[];
  goals: WorkspaceEntry[];
  context: WorkspaceEntry[];
}

// ── Implementation ─────────────────────────────────────────────

/**
 * Decompose a task description into typed workspace entries.
 *
 * Splits by newlines first, then by sentence boundaries within long lines.
 * Returns entries with content prefixed to force correct partition routing:
 *   - constraint sentences: "CONSTRAINT: <text>"
 *   - goal sentences: "GOAL: <text>"
 *   - context: plain text (routes to operational)
 *
 * The prefixes match DefaultEntryRouter classification patterns:
 *   "CONSTRAINT:" → /\bconstraint:/i → constraint partition
 *   "GOAL:" → /\b(goal)\b/i → task partition
 */
export function decomposeTaskToEntries(description: string): DecomposedTask {
  // Split into candidate segments (lines and sentence-level chunks)
  const rawSegments = description
    .split(/\n+/)
    .flatMap(line => splitIntoSentences(line))
    .map(s => s.trim())
    .filter(s => s.length > 8);

  const constraints: WorkspaceEntry[] = [];
  const goals: WorkspaceEntry[] = [];
  const context: WorkspaceEntry[] = [];

  const now = Date.now();
  const source = moduleId('observer');

  for (const segment of rawSegments) {
    const isConstraint = CONSTRAINT_PATTERNS.some(p => p.test(segment));
    const isGoal = !isConstraint && GOAL_PATTERNS.some(p => p.test(segment));

    if (isConstraint) {
      // Prefix with CONSTRAINT: so router sends to constraint partition
      constraints.push({
        source,
        content: `CONSTRAINT: ${segment}`,
        salience: 1.0,
        timestamp: now,
      } as WorkspaceEntry);
    } else if (isGoal) {
      // Prefix with GOAL: so router sends to task partition
      goals.push({
        source,
        content: `GOAL: ${segment}`,
        salience: 0.9,
        timestamp: now,
      } as WorkspaceEntry);
    } else if (segment.length > 15) {
      // Context — routes to operational partition
      context.push({
        source,
        content: segment,
        salience: 0.5,
        timestamp: now,
      } as WorkspaceEntry);
    }
  }

  // Fallback: ensure at least one goal entry exists
  if (goals.length === 0) {
    // Take first 2 context items and promote to goals
    const promoted = context.splice(0, Math.min(2, context.length));
    for (const entry of promoted) {
      goals.push({
        ...entry,
        content: `GOAL: ${entry.content}`,
        salience: 0.9,
      });
    }
  }

  // If still no goals, create a summary goal from the full description
  if (goals.length === 0) {
    goals.push({
      source,
      content: `GOAL: Complete the task as described.`,
      salience: 0.9,
      timestamp: now,
    } as WorkspaceEntry);
  }

  return { constraints, goals, context };
}

// ── Helpers ────────────────────────────────────────────────────

/** Split a line into sentences at . ! ? boundaries. */
function splitIntoSentences(line: string): string[] {
  if (line.length < 80) return [line];

  // Split at sentence-ending punctuation followed by a space or end
  const parts = line.split(/(?<=[.!?])\s+/);
  return parts.length > 1 ? parts : [line];
}

// ── Summary ────────────────────────────────────────────────────

/** Log decomposition stats for debugging. */
export function logDecomposition(decomposed: DecomposedTask): void {
  console.log(
    `    [task-decompose] ${decomposed.constraints.length} constraints, ` +
    `${decomposed.goals.length} goals, ${decomposed.context.length} context entries`
  );
  for (const c of decomposed.constraints) {
    console.log(`      C: ${String(c.content).slice(0, 80)}`);
  }
  for (const g of decomposed.goals) {
    console.log(`      G: ${String(g.content).slice(0, 80)}`);
  }
}
