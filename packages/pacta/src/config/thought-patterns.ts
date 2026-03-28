/**
 * Thought Patterns — reusable cognitive templates for common task types (PRD 032, P5).
 *
 * Each pattern encodes a proven multi-step strategy. Stored as PROCEDURE-typed FactCards
 * in the memory module. Retrieved when the task matches the pattern's trigger condition.
 *
 * Grounded in: SOAR chunking, ACT-R production compilation, Dreyfus expert intuition.
 */

import type { ThoughtPattern, FactCard, MemoryPortV2 } from '../ports/memory-port.js';

// ── Built-In Patterns ─────────────────────────────────────────

export const PATTERN_DEBUG_TRACE: ThoughtPattern = {
  name: 'debug-trace',
  trigger: 'test failure, unexpected behavior, or bug fix task',
  steps: [
    'Read the failing test or error description to understand expected vs actual behavior',
    'Trace the call chain backward from the failure point — the bug is usually NOT in the function the test calls directly',
    'Identify the first point where actual behavior diverges from expected',
    'Fix at the divergence point (the root cause), not at the symptom',
    'Verify the fix by re-reading the test expectations',
  ],
  exitCondition: 'Root cause identified and fixed at the divergence point, not at the symptom',
};

export const PATTERN_SAFE_DELETION: ThoughtPattern = {
  name: 'safe-deletion',
  trigger: 'removing code, deleting files, cleaning up dead code',
  steps: [
    'Before removing ANY code, search for the identifier as a literal string in ALL files',
    'Search for dynamic references: require() with string concatenation, import() with variables, bracket notation access, reflection/metaprogramming patterns',
    'Check configuration files, scripts, and documentation for references',
    'Check for string-based module loading (plugin systems, dynamic dispatch)',
    'If ANY reference is found or if ambiguity exists, do NOT delete — report the finding instead',
  ],
  exitCondition: 'All reference types checked. Delete only if zero references found across all search methods.',
};

export const PATTERN_REFACTORING: ThoughtPattern = {
  name: 'refactoring',
  trigger: 'restructuring code, breaking dependencies, extracting modules, migrating interfaces',
  steps: [
    'Read ALL files involved to build a complete dependency map before making any changes',
    'Identify the minimal interface/contract that consumers actually depend on',
    'Extract the shared interface or module FIRST, before modifying any consumers',
    'Update consumers one at a time, verifying each change preserves the contract',
    'After all consumers updated, verify no circular dependencies remain',
  ],
  exitCondition: 'All consumers updated, no circular dependencies, all interfaces preserved',
};

// ── Helpers ────────────────────────────────────────────────────

/** Get all built-in thought patterns. */
export function getBuiltInPatterns(): ThoughtPattern[] {
  return [PATTERN_DEBUG_TRACE, PATTERN_SAFE_DELETION, PATTERN_REFACTORING];
}

/** Convert a ThoughtPattern to a PROCEDURE-typed FactCard for memory storage. */
export function patternToFactCard(pattern: ThoughtPattern): FactCard {
  return {
    id: `pattern-${pattern.name}`,
    content: `[PROCEDURE: ${pattern.name}]\nTrigger: ${pattern.trigger}\nSteps:\n${pattern.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\nExit: ${pattern.exitCondition}`,
    type: 'PROCEDURE',
    source: { module: 'thought-patterns' },
    tags: ['procedure', pattern.name, ...pattern.trigger.split(/[,\s]+/).filter(w => w.length > 4)],
    embedding: undefined,
    created: Date.now(),
    updated: Date.now(),
    confidence: 1.0,  // built-in patterns have max confidence
    links: [],
  };
}

/** Seed all built-in patterns into memory. Idempotent — skips if pattern already exists. */
export async function seedPatterns(memory: MemoryPortV2): Promise<number> {
  let seeded = 0;
  for (const pattern of getBuiltInPatterns()) {
    const existing = await memory.retrieveCard(`pattern-${pattern.name}`);
    if (!existing) {
      await memory.storeCard(patternToFactCard(pattern));
      seeded++;
    }
  }
  return seeded;
}

/** Format a ThoughtPattern as a high-salience workspace injection string. */
export function formatPatternForWorkspace(pattern: ThoughtPattern): string {
  return [
    `📋 THOUGHT PATTERN: ${pattern.name}`,
    `Trigger: ${pattern.trigger}`,
    `Steps:`,
    ...pattern.steps.map((s, i) => `  ${i + 1}. ${s}`),
    `Exit when: ${pattern.exitCondition}`,
  ].join('\n');
}
