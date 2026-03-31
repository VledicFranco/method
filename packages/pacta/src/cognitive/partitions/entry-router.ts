/**
 * Entry Router — routes workspace entries to the correct partition.
 *
 * PRD 044 C-2: Implements the EntryRouter interface. Classification is
 * injected via constructor to avoid cross-domain imports from modules/.
 * Falls back to a built-in rule-based classifier using CONSTRAINT_PATTERNS
 * from algebra/constraint-utils.ts.
 *
 * D3 rule: entries from actor/reasoner-actor sources always route to
 * 'operational' — tool results are never classified.
 */

import type { EntryRouter, PartitionId } from '../algebra/partition-types.js';
import type { ModuleId } from '../algebra/module.js';
import { CONSTRAINT_PATTERNS } from '../algebra/constraint-utils.js';

// ── Configuration ─────────────────────────────────────────────────

export interface EntryRouterConfig {
  /** Classifier function — injected to avoid cross-domain import. */
  classify?: (content: string) => { contentType: string };
}

// ── Built-in Goal Patterns ────────────────────────────────────────

/**
 * Narrow goal patterns — same set as modules/constraint-classifier.ts
 * but duplicated here to avoid cross-domain import.
 */
const GOAL_PATTERNS = [
  /\b(your\s+task)\b/i,
  /\b(objective|goal|deliverable)\b/i,
];

// ── Built-in Classifier ───────────────────────────────────────────

function builtInClassify(text: string): { contentType: string } {
  // Constraint patterns first (higher priority).
  for (const pattern of CONSTRAINT_PATTERNS) {
    if (pattern.test(text)) {
      return { contentType: 'constraint' };
    }
  }

  // Goal patterns.
  for (const pattern of GOAL_PATTERNS) {
    if (pattern.test(text)) {
      return { contentType: 'goal' };
    }
  }

  return { contentType: 'operational' };
}

// ── Actor Source Detection ─────────────────────────────────────────

/** Module IDs containing these strings are treated as actor sources (D3 rule). */
const ACTOR_SOURCE_PATTERNS = ['actor', 'reasoner-actor'];

function isActorSource(source: ModuleId): boolean {
  const id = String(source).toLowerCase();
  return ACTOR_SOURCE_PATTERNS.some((pattern) => id.includes(pattern));
}

// ── Content Type → Partition Mapping ──────────────────────────────

function contentTypeToPartition(contentType: string): PartitionId {
  switch (contentType) {
    case 'constraint':
      return 'constraint';
    case 'goal':
      return 'task';
    default:
      return 'operational';
  }
}

// ── Entry Router Implementation ───────────────────────────────────

export class DefaultEntryRouter implements EntryRouter {
  private readonly classify: (content: string) => { contentType: string };

  constructor(config?: EntryRouterConfig) {
    this.classify = config?.classify ?? builtInClassify;
  }

  route(content: unknown, source: ModuleId): PartitionId {
    // D3 rule: actor sources always route to operational.
    if (isActorSource(source)) {
      return 'operational';
    }

    // Stringify content for classification.
    const text = typeof content === 'string' ? content : String(content);
    const result = this.classify(text);

    return contentTypeToPartition(result.contentType);
  }
}
