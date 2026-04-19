// SPDX-License-Identifier: Apache-2.0
/**
 * Wanderer — background creative association module (PRD 032, P7).
 *
 * Runs BETWEEN task executions (not during cycles). Reviews all stored
 * FactCards and generates cross-domain connections using a cheap LLM call.
 * Produces HEURISTIC cards with moderate confidence (0.5) since connections
 * are speculative until validated by future tasks.
 *
 * Design: fire-and-forget semantics. If the LLM call fails or JSON parsing
 * fails, returns empty connections — never corrupts state, never throws.
 *
 * Grounded in: Default Mode Network research (Raichle 2001, Buckner 2008),
 * incubation effect (Sio & Ormerod 2009).
 * PRD 032, Pattern P7, Commission C-8.
 */

import type {
  CognitiveModule,
  MonitoringSignal,
  ControlDirective,
  StepResult,
  StepError,
  ModuleId,
} from '../algebra/index.js';
import { moduleId } from '../algebra/index.js';
import type { ProviderAdapter } from '../algebra/provider-adapter.js';
import type { MemoryPortV2, FactCard } from '../../ports/memory-port.js';

// ── Types ──────────────────────────────────────────────────────────

/** Input: all stored fact cards from memory. */
export interface WandererInput {
  allCards: FactCard[];
}

/** Output: new HEURISTIC cards with cross-domain insights. */
export interface WandererOutput {
  connections: FactCard[];
}

/** State: wandering session and connection counters. */
export interface WandererState {
  wanderingCount: number;
  connectionsGenerated: number;
}

/** Monitoring signal for the wanderer module. */
export interface WandererMonitoring extends MonitoringSignal {
  type: 'wanderer';
  cardsReviewed: number;
  connectionsFound: number;
}

/** Configuration for the Wanderer module. */
export interface WandererConfig {
  /** Module ID override. Default: 'wanderer'. */
  id?: string;
  /** Maximum connections per wandering session. Default: 3. */
  maxConnections?: number;
  /** Maximum cards to sample for review. Default: 10. */
  maxSample?: number;
  /** Minimum cards required to attempt wandering. Default: 3. */
  minCards?: number;
}

// ── Internal Types ─────────────────────────────────────────────────

/** Shape of a single connection parsed from LLM JSON output. */
interface ParsedConnection {
  insight: string;
  connects: string[];
  tags: string[];
}

// ── Sampling ──────────────────────────────────────────────────────

/**
 * Sample up to `maxSample` diverse cards from the pool, preferring
 * different tags and types for maximum cross-domain coverage.
 *
 * Strategy: bucket cards by type, then round-robin across buckets.
 * Within each bucket, prefer cards with unique tag sets.
 */
function sampleDiverseCards(cards: FactCard[], maxSample: number): FactCard[] {
  if (cards.length <= maxSample) return [...cards];

  // Bucket by epistemic type
  const buckets = new Map<string, FactCard[]>();
  for (const card of cards) {
    const bucket = buckets.get(card.type) ?? [];
    bucket.push(card);
    buckets.set(card.type, bucket);
  }

  // Shuffle within each bucket for variety
  for (const bucket of buckets.values()) {
    shuffleInPlace(bucket);
  }

  // Round-robin across type buckets
  const sampled: FactCard[] = [];
  const seenTagSets = new Set<string>();
  const bucketIterators = [...buckets.values()].map((b) => ({ items: b, index: 0 }));

  while (sampled.length < maxSample && bucketIterators.some((b) => b.index < b.items.length)) {
    for (const iter of bucketIterators) {
      if (sampled.length >= maxSample) break;
      if (iter.index >= iter.items.length) continue;

      const card = iter.items[iter.index]!;
      iter.index++;

      // Prefer cards with novel tag combinations
      const tagKey = [...card.tags].sort().join(',');
      if (seenTagSets.has(tagKey) && iter.index < iter.items.length) {
        // Try the next card in this bucket for more diversity
        const alt = iter.items[iter.index];
        if (alt) {
          const altTagKey = [...alt.tags].sort().join(',');
          if (!seenTagSets.has(altTagKey)) {
            iter.index++;
            seenTagSets.add(altTagKey);
            sampled.push(alt);
            continue;
          }
        }
      }

      seenTagSets.add(tagKey);
      sampled.push(card);
    }
  }

  return sampled;
}

/** Fisher-Yates in-place shuffle. */
function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

// ── Prompt ─────────────────────────────────────────────────────────

function formatCardForPrompt(card: FactCard): string {
  const tagsStr = card.tags.length > 0 ? ` (tags: ${card.tags.join(', ')})` : '';
  return `- [${card.type}] (id: ${card.id}) ${card.content}${tagsStr}`;
}

function buildWanderingPrompt(cards: FactCard[]): string {
  const formatted = cards.map(formatCardForPrompt).join('\n');

  return `You are reviewing knowledge cards from different tasks. Look for unexpected connections, patterns, or transferable insights between them.

Cards:
${formatted}

Generate 0-3 insights that connect ideas across different cards.
Respond with JSON: [{"insight": "...", "connects": ["card-id-1", "card-id-2"], "tags": [...]}]
Only generate insights that are genuinely novel — not obvious restatements.
If no interesting connections exist, respond with [].`;
}

// ── JSON Parsing ───────────────────────────────────────────────────

/**
 * Parse the LLM output into an array of connections.
 * Handles markdown code fences and extra text around the JSON array.
 */
function parseConnections(raw: string, maxConnections: number): ParsedConnection[] {
  const arrayMatch = raw.match(/\[[\s\S]*\]/);
  if (!arrayMatch) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(arrayMatch[0]);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const connections: ParsedConnection[] = [];
  for (const item of parsed) {
    if (connections.length >= maxConnections) break;
    if (
      typeof item === 'object' &&
      item !== null &&
      typeof (item as Record<string, unknown>).insight === 'string' &&
      Array.isArray((item as Record<string, unknown>).connects) &&
      Array.isArray((item as Record<string, unknown>).tags)
    ) {
      const connects = ((item as Record<string, unknown>).connects as unknown[])
        .filter((c): c is string => typeof c === 'string');
      const tags = ((item as Record<string, unknown>).tags as unknown[])
        .filter((t): t is string => typeof t === 'string');

      // Must connect at least two cards to be a valid cross-domain insight
      if (connects.length >= 2) {
        connections.push({
          insight: (item as Record<string, unknown>).insight as string,
          connects,
          tags,
        });
      }
    }
  }

  return connections;
}

// ── FactCard Construction ──────────────────────────────────────────

function connectionToFactCard(
  connection: ParsedConnection,
  index: number,
  wanderingCount: number,
): FactCard {
  const now = Date.now();
  return {
    id: `wanderer-${wanderingCount}-${index}`,
    content: connection.insight,
    type: 'HEURISTIC',
    source: { module: 'wanderer' },
    tags: [...connection.tags, 'cross-domain', 'wanderer'],
    created: now,
    updated: now,
    confidence: 0.5, // moderate — speculative until validated
    links: connection.connects,
  };
}

// ── Factory ────────────────────────────────────────────────────────

/**
 * Create a Wanderer cognitive module.
 *
 * Background creative association: reviews stored FactCards and generates
 * cross-domain HEURISTIC connections via a cheap LLM call. Runs between
 * task executions, not during cognitive cycles.
 *
 * Fire-and-forget: on any error (LLM failure, parse failure), returns
 * empty connections and unchanged state. Never throws.
 */
export function createWanderer(
  memory: MemoryPortV2,
  llm: ProviderAdapter,
  config?: WandererConfig,
): CognitiveModule<WandererInput, WandererOutput, WandererState, WandererMonitoring, ControlDirective> {
  const id: ModuleId = moduleId(config?.id ?? 'wanderer');
  const maxConnections = config?.maxConnections ?? 3;
  const maxSample = config?.maxSample ?? 10;
  const minCards = config?.minCards ?? 3;

  return {
    id,

    async step(
      input: WandererInput,
      state: WandererState,
      _control: ControlDirective,
    ): Promise<StepResult<WandererOutput, WandererState, WandererMonitoring>> {
      // 1. Guard: not enough material to wander
      if (input.allCards.length < minCards) {
        const monitoring: WandererMonitoring = {
          type: 'wanderer',
          source: id,
          timestamp: Date.now(),
          cardsReviewed: 0,
          connectionsFound: 0,
        };

        return {
          output: { connections: [] },
          state,
          monitoring,
        };
      }

      try {
        // 2. Sample up to maxSample diverse cards
        const sampled = sampleDiverseCards(input.allCards, maxSample);

        // 3. Build the wandering prompt
        const prompt = buildWanderingPrompt(sampled);

        // 4. Call the LLM via ProviderAdapter (cheap model — oneshot, no tools)
        const result = await llm.invoke(
          [{ source: id, content: prompt, salience: 1, timestamp: Date.now() }],
          {
            pactTemplate: { mode: { type: 'oneshot' } },
            systemPrompt: 'You are a creative association engine. Output only valid JSON.',
          },
        );

        // 5. Parse connections from LLM response
        const parsed = parseConnections(result.output, maxConnections);

        // 6. Convert to HEURISTIC FactCards
        const cards: FactCard[] = parsed.map((conn, i) =>
          connectionToFactCard(conn, i, state.wanderingCount),
        );

        // 7. Store each card via memory port
        for (const card of cards) {
          await memory.storeCard(card);
        }

        // 8. Update state and return
        const newState: WandererState = {
          wanderingCount: state.wanderingCount + 1,
          connectionsGenerated: state.connectionsGenerated + cards.length,
        };

        const monitoring: WandererMonitoring = {
          type: 'wanderer',
          source: id,
          timestamp: Date.now(),
          cardsReviewed: sampled.length,
          connectionsFound: cards.length,
        };

        return {
          output: { connections: cards },
          state: newState,
          monitoring,
        };
      } catch (err: unknown) {
        // Fire-and-forget: on any error, return empty output, unchanged state
        const error: StepError = {
          message: err instanceof Error ? err.message : String(err),
          recoverable: true,
          moduleId: id,
          phase: 'WANDER',
        };

        const monitoring: WandererMonitoring = {
          type: 'wanderer',
          source: id,
          timestamp: Date.now(),
          cardsReviewed: 0,
          connectionsFound: 0,
        };

        return {
          output: { connections: [] },
          state,
          monitoring,
          error,
        };
      }
    },

    initialState(): WandererState {
      return {
        wanderingCount: 0,
        connectionsGenerated: 0,
      };
    },

    stateInvariant(state: WandererState): boolean {
      return state.wanderingCount >= 0 && state.connectionsGenerated >= 0;
    },
  };
}
