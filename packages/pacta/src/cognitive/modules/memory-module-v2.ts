/**
 * Memory Module v2 — FactCard-based retrieval and extraction for the cognitive loop.
 *
 * Replaces the legacy key-value memory module with a FactCard-aware module that
 * operates in three modes:
 *
 * 1. **Retrieval gate (before reasoning):** Reads the workspace snapshot, derives
 *    a search query from recent entries, retrieves matching FactCards from the
 *    MemoryPortV2, and writes them to the workspace as high-salience entries.
 *
 * 2. **Fact extraction (after reasoning):** Inspects the last action to extract
 *    OBSERVATION and HEURISTIC FactCards and stores them in long-term memory.
 *
 * 3. **Compaction handler:** Accepts evicted workspace entries and stores them
 *    as low-confidence OBSERVATION FactCards to avoid total information loss.
 *
 * Grounded in: ACT-R declarative memory with epistemic typing, SOAR chunking for
 * heuristic extraction, GWT workspace eviction as memory consolidation.
 */

import type {
  CognitiveModule,
  MemoryMonitoring,
  ControlDirective,
  StepResult,
  StepError,
  WorkspaceWritePort,
  WorkspaceEntry,
  ReadonlyWorkspaceSnapshot,
} from '../algebra/index.js';
import { moduleId } from '../algebra/index.js';
import type { MemoryPortV2, FactCard } from '../../ports/memory-port.js';

// ── Types ────────────────────────────────────────────────────────

/** Input to the memory v2 module. */
export interface MemoryV2Input {
  /** Workspace snapshot to derive retrieval context from. */
  snapshot: ReadonlyWorkspaceSnapshot;
  /** Last action taken by the reasoner-actor, if any. */
  lastAction?: { name: string; success: boolean; target?: string };
}

/** Output of the memory v2 module. */
export interface MemoryV2Output {
  /** FactCards retrieved from memory this step. */
  retrieved: FactCard[];
  /** FactCards stored to memory this step. */
  stored: FactCard[];
}

/** Memory v2 module internal state. */
export interface MemoryV2State {
  /** Total retrieval operations performed. */
  retrievalCount: number;
  /** Total cards stored to memory. */
  storedCount: number;
  /** Last query terms used for retrieval. */
  lastQueryTerms: string[];
}

/** Control directive for the memory v2 module. */
export interface MemoryV2Control extends ControlDirective {
  /** Whether the retrieval gate is enabled. */
  retrievalEnabled: boolean;
  /** Whether fact extraction is enabled. */
  extractionEnabled: boolean;
  /** Maximum cards to retrieve per step. */
  maxRetrievals: number;
}

/** Configuration for the memory v2 module factory. */
export interface MemoryV2Config {
  /** Custom module ID. Defaults to 'memory-v2'. */
  id?: string;
}

// ── Helpers ──────────────────────────────────────────────────────

/** Generate a unique card ID using timestamp + random suffix. */
function generateCardId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `fc-${ts}-${rand}`;
}

/**
 * Derive search query terms from the most recent workspace entries.
 *
 * Strategy:
 * - Take the last 2-3 entries from the snapshot
 * - Extract the first 200 characters of each entry's content
 * - Split into words, filter to words > 4 chars (remove noise)
 * - Count word frequency, return the top 10 most frequent as the query
 */
function deriveQueryTerms(snapshot: ReadonlyWorkspaceSnapshot): string[] {
  // Take the last 3 entries (or fewer if snapshot is smaller)
  const recentEntries = snapshot.slice(-3);

  // Extract text content from entries
  const texts: string[] = [];
  for (const entry of recentEntries) {
    const content = typeof entry.content === 'string'
      ? entry.content
      : JSON.stringify(entry.content);
    texts.push(content.slice(0, 200));
  }

  // Split into words, filter to > 4 chars
  const allWords = texts
    .join(' ')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 4);

  // Count frequency
  const freq = new Map<string, number>();
  for (const word of allWords) {
    freq.set(word, (freq.get(word) ?? 0) + 1);
  }

  // Sort by frequency descending, take top 10
  const sorted = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);

  return sorted;
}

/**
 * Compute a relevance score for retrieved FactCards.
 * Heuristic: average confidence of retrieved cards, weighted by count.
 */
function computeRelevance(cards: FactCard[]): number {
  if (cards.length === 0) return 0;
  const totalConfidence = cards.reduce((sum, c) => sum + c.confidence, 0);
  const avgConfidence = totalConfidence / cards.length;
  // Scale by retrieval count — more relevant results = higher score
  return Math.min(1, avgConfidence * (0.5 + cards.length * 0.15));
}

/**
 * Check if the workspace contains evidence of a successfully executed plan.
 * Looks for entries containing plan-like content followed by success indicators.
 */
function detectSuccessfulPlan(snapshot: ReadonlyWorkspaceSnapshot): string | null {
  let planContent: string | null = null;
  let hasSuccess = false;

  for (const entry of snapshot) {
    const content = typeof entry.content === 'string'
      ? entry.content
      : JSON.stringify(entry.content);
    const lower = content.toLowerCase();

    // Detect plan entries
    if (lower.includes('<plan>') || lower.includes('step 1') || lower.includes('plan:')) {
      planContent = content.slice(0, 200);
    }

    // Detect success indicators
    if (lower.includes('success') && !lower.includes('error') && !lower.includes('fail')) {
      hasSuccess = true;
    }
  }

  return planContent && hasSuccess ? planContent : null;
}

// ── Compaction Handler ───────────────────────────────────────────

/**
 * Handle workspace eviction by storing evicted content as a low-confidence
 * OBSERVATION FactCard. Call this from the engine's eviction callback.
 *
 * @param memory - The MemoryPortV2 to store the evicted content.
 * @param evictedContent - The content string of the evicted workspace entry.
 * @param moduleSource - The module ID to attribute the card to.
 */
export async function handleEviction(
  memory: MemoryPortV2,
  evictedContent: string,
  moduleSource?: string,
): Promise<FactCard> {
  const now = Date.now();
  const card: FactCard = {
    id: generateCardId(),
    content: evictedContent.slice(0, 500),
    type: 'OBSERVATION',
    source: { module: moduleSource ?? 'memory-v2' },
    tags: ['evicted', 'workspace-compaction'],
    created: now,
    updated: now,
    confidence: 0.4,
    links: [],
  };

  await memory.storeCard(card);
  return card;
}

// ── Factory ──────────────────────────────────────────────────────

/**
 * Create a Memory v2 cognitive module.
 *
 * Operates in two phases per step:
 * - Retrieval: query memory for relevant FactCards, inject into workspace
 * - Extraction: derive new FactCards from the last action's outcome
 *
 * @param memory - MemoryPortV2 implementation for FactCard storage and retrieval.
 * @param writePort - Workspace write port for emitting retrieved knowledge.
 * @param config - Optional configuration.
 */
export function createMemoryModuleV2(
  memory: MemoryPortV2,
  writePort: WorkspaceWritePort,
  config?: MemoryV2Config,
): CognitiveModule<MemoryV2Input, MemoryV2Output, MemoryV2State, MemoryMonitoring, MemoryV2Control> {
  const id = moduleId(config?.id ?? 'memory-v2');

  return {
    id,

    initialState(): MemoryV2State {
      return {
        retrievalCount: 0,
        storedCount: 0,
        lastQueryTerms: [],
      };
    },

    async step(
      input: MemoryV2Input,
      state: MemoryV2State,
      control: MemoryV2Control,
    ): Promise<StepResult<MemoryV2Output, MemoryV2State, MemoryMonitoring>> {
      try {
        const retrieved: FactCard[] = [];
        const stored: FactCard[] = [];
        let queryTerms: string[] = [];

        // ── Phase 1: Retrieval Gate ──────────────────────────────

        if (control.retrievalEnabled && input.snapshot.length > 0) {
          queryTerms = deriveQueryTerms(input.snapshot);

          if (queryTerms.length > 0) {
            const query = queryTerms.join(' ');
            const cards = await memory.searchCards(query, {
              limit: Math.min(control.maxRetrievals, 3),
              minConfidence: 0.3,
            });

            for (const card of cards) {
              retrieved.push(card);

              // Write retrieved FactCard to workspace as high-salience entry
              const wsEntry: WorkspaceEntry = {
                source: id,
                content: `[MEMORY: ${card.type}] ${card.content} (confidence: ${card.confidence})`,
                salience: 0.8,
                timestamp: Date.now(),
              };
              writePort.write(wsEntry);
            }
          }
        }

        // ── Phase 2: Fact Extraction ─────────────────────────────

        if (control.extractionEnabled && input.lastAction) {
          const { name: actionName, success, target } = input.lastAction;

          // Extract OBSERVATION from Write/Edit actions
          if (
            (actionName === 'Write' || actionName === 'Edit') &&
            success
          ) {
            // Derive content from the most recent workspace entry (tool result)
            const lastEntry = input.snapshot.length > 0
              ? input.snapshot[input.snapshot.length - 1]
              : null;
            const resultContent = lastEntry
              ? (typeof lastEntry.content === 'string'
                  ? lastEntry.content.slice(0, 200)
                  : JSON.stringify(lastEntry.content).slice(0, 200))
              : 'no result captured';

            const observationContent = `[${actionName}] ${target ?? 'unknown'}: ${resultContent}`;

            const now = Date.now();
            const observationCard: FactCard = {
              id: generateCardId(),
              content: observationContent,
              type: 'OBSERVATION',
              source: { module: id },
              tags: target ? [target] : [],
              created: now,
              updated: now,
              confidence: 0.7,
              links: [],
            };

            await memory.storeCard(observationCard);
            stored.push(observationCard);
          }

          // Extract HEURISTIC from successfully executed plans
          if (success) {
            const planStrategy = detectSuccessfulPlan(input.snapshot);
            if (planStrategy) {
              const now = Date.now();
              const heuristicCard: FactCard = {
                id: generateCardId(),
                content: planStrategy,
                type: 'HEURISTIC',
                source: { module: id },
                tags: ['strategy', 'successful-plan'],
                created: now,
                updated: now,
                confidence: 0.6,
                links: [],
              };

              await memory.storeCard(heuristicCard);
              stored.push(heuristicCard);
            }
          }
        }

        // ── Compute monitoring signal ────────────────────────────

        const relevanceScore = computeRelevance(retrieved);

        const newState: MemoryV2State = {
          retrievalCount: state.retrievalCount + retrieved.length,
          storedCount: state.storedCount + stored.length,
          lastQueryTerms: queryTerms,
        };

        const monitoring: MemoryMonitoring = {
          type: 'memory',
          source: id,
          timestamp: Date.now(),
          retrievalCount: retrieved.length,
          relevanceScore,
        };

        return {
          output: { retrieved, stored },
          state: newState,
          monitoring,
        };
      } catch (err: unknown) {
        const error: StepError = {
          message: err instanceof Error ? err.message : String(err),
          recoverable: true,
          moduleId: id,
          phase: 'memory-v2',
        };

        const monitoring: MemoryMonitoring = {
          type: 'memory',
          source: id,
          timestamp: Date.now(),
          retrievalCount: 0,
          relevanceScore: 0,
        };

        return {
          output: { retrieved: [], stored: [] },
          state,
          monitoring,
          error,
        };
      }
    },
  };
}
