// SPDX-License-Identifier: Apache-2.0
/**
 * Memory Module v3 — CLS dual-store retrieval for the cognitive loop.
 *
 * Retrieves from both episodic and semantic stores using ACT-R activation-based
 * retrieval during the REMEMBER phase. Writes retrieved entries to the workspace
 * as high-salience entries for downstream modules to consume.
 *
 * Invariants:
 * - MemoryV3 NEVER writes to the semantic store directly. Only the Consolidator does that.
 * - MemoryV3 does not handle the LEARN phase — that is the Consolidator's responsibility.
 * - Retrieval uses `searchByActivation()` which scores all entries in both stores
 *   using the four-component ACT-R activation formula (base-level, spreading, partial
 *   match, noise) and returns the top entries above the retrieval threshold.
 *
 * Grounded in: Complementary Learning Systems (CLS) theory,
 * ACT-R declarative memory retrieval (PRD 036).
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
import type {
  MemoryPortV3,
  EpisodicEntry,
  SemanticEntry,
  ActivationConfig,
} from '../../ports/memory-port.js';
import { defaultActivationConfig } from './activation.js';

// ── Types ────────────────────────────────────────────────────────

/** Input to the memory v3 module: a workspace snapshot for deriving retrieval context. */
export interface MemoryV3Input {
  /** Workspace snapshot to extract retrieval context tags from. */
  snapshot: ReadonlyWorkspaceSnapshot;
}

/** Output of the memory v3 module: retrieved entries from both stores. */
export interface MemoryV3Output {
  /** Retrieved entries (episodic + semantic, merged and sorted by activation). */
  retrieved: (EpisodicEntry | SemanticEntry)[];
  /** Number of entries retrieved. */
  count: number;
}

/** Memory v3 module internal state. */
export interface MemoryV3State {
  /** Total retrieval operations performed across all steps. */
  retrievalCount: number;
  /** Accumulated relevance across all steps. */
  accumulatedRelevance: number;
  /** Last context tags used for retrieval. */
  lastContext: string[];
}

/** Control directive for the memory v3 module. */
export interface MemoryV3Control extends ControlDirective {
  // No special control signals needed — basic ControlDirective suffices.
}

/** Configuration for the memory v3 module factory. */
export interface MemoryV3Config {
  /** Custom module ID. Defaults to 'memory-v3'. */
  id?: string;
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Extract context tags from workspace entries for spreading activation.
 *
 * Strategy: collect entry sources, stringified keys from structured content,
 * and any tags found in entry content objects.
 */
function extractContextTags(snapshot: ReadonlyWorkspaceSnapshot): string[] {
  const tags = new Set<string>();

  for (const entry of snapshot) {
    // Source module ID as context
    if (entry.source) {
      tags.add(String(entry.source));
    }

    // Extract tags from content
    const content = entry.content;
    if (typeof content === 'string') {
      // Extract bracketed tags like [MEMORY: ...], keywords
      const bracketMatches = content.match(/\[([^\]]+)\]/g);
      if (bracketMatches) {
        for (const match of bracketMatches) {
          tags.add(match.slice(1, -1).toLowerCase());
        }
      }
      // Take significant words (> 4 chars) from first 200 chars as context
      const words = content.slice(0, 200).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 4);
      for (const word of words.slice(0, 5)) {
        tags.add(word);
      }
    } else if (content && typeof content === 'object') {
      // Extract keys from structured content
      for (const key of Object.keys(content as Record<string, unknown>)) {
        tags.add(key);
      }
    }
  }

  return [...tags];
}

/**
 * Determine if an entry is episodic or semantic.
 */
function isEpisodic(entry: EpisodicEntry | SemanticEntry): entry is EpisodicEntry {
  return 'lastAccessed' in entry && 'accessCount' in entry && 'context' in entry;
}

/**
 * Format a retrieved entry's content for workspace display.
 */
function formatEntryContent(entry: EpisodicEntry | SemanticEntry): string {
  if (isEpisodic(entry)) {
    return `[EPISODIC] ${entry.content}`;
  }
  return `[SEMANTIC] ${entry.pattern} (confidence: ${entry.confidence})`;
}

// ── Factory ──────────────────────────────────────────────────────

/**
 * Create a Memory v3 cognitive module (CLS dual-store retrieval).
 *
 * Operates in the REMEMBER phase: queries both episodic and semantic stores
 * via ACT-R activation-based retrieval, writes results to the workspace.
 *
 * @param store - MemoryPortV3 implementation (e.g. InMemoryDualStore).
 * @param writePort - Workspace write port for emitting retrieved knowledge.
 * @param activationConfig - Optional ACT-R activation parameters. Defaults to standard config.
 * @param config - Optional module configuration (ID override).
 */
export function createMemoryV3(
  store: MemoryPortV3,
  writePort: WorkspaceWritePort,
  activationConfig?: ActivationConfig,
  config?: MemoryV3Config,
): CognitiveModule<MemoryV3Input, MemoryV3Output, MemoryV3State, MemoryMonitoring, MemoryV3Control> {
  const id = moduleId(config?.id ?? 'memory-v3');
  const actConfig = activationConfig ?? defaultActivationConfig();

  return {
    id,

    initialState(): MemoryV3State {
      return {
        retrievalCount: 0,
        accumulatedRelevance: 0,
        lastContext: [],
      };
    },

    async step(
      input: MemoryV3Input,
      state: MemoryV3State,
      _control: MemoryV3Control,
    ): Promise<StepResult<MemoryV3Output, MemoryV3State, MemoryMonitoring>> {
      try {
        // 1. Extract context tags from current workspace entries
        const context = extractContextTags(input.snapshot);

        // 2. Search both stores by ACT-R activation
        const retrieved = await store.searchByActivation(context, actConfig.maxRetrievals);

        // 3. Compute average activation as relevance score
        //    We use the count-based heuristic: more retrievals with context overlap = higher relevance
        let relevanceScore = 0;
        if (retrieved.length > 0) {
          // Heuristic: normalize by maxRetrievals to get a 0-1 score
          // More entries retrieved above threshold = more relevant context
          relevanceScore = Math.min(1, retrieved.length / actConfig.maxRetrievals);
        }

        // 4. Write each retrieved entry to workspace as high-salience entries
        for (const entry of retrieved) {
          const wsEntry: WorkspaceEntry = {
            source: id,
            content: formatEntryContent(entry),
            salience: 0.85, // High salience — retrieved memories are contextually relevant
            timestamp: Date.now(),
          };
          writePort.write(wsEntry);
        }

        // 5. Update state
        const newState: MemoryV3State = {
          retrievalCount: state.retrievalCount + retrieved.length,
          accumulatedRelevance: state.accumulatedRelevance + relevanceScore,
          lastContext: context,
        };

        // 6. Emit MemoryMonitoring signal
        const monitoring: MemoryMonitoring = {
          type: 'memory',
          source: id,
          timestamp: Date.now(),
          retrievalCount: retrieved.length,
          relevanceScore,
        };

        return {
          output: { retrieved, count: retrieved.length },
          state: newState,
          monitoring,
        };
      } catch (err: unknown) {
        const error: StepError = {
          message: err instanceof Error ? err.message : String(err),
          recoverable: true,
          moduleId: id,
          phase: 'remember',
        };

        const monitoring: MemoryMonitoring = {
          type: 'memory',
          source: id,
          timestamp: Date.now(),
          retrievalCount: 0,
          relevanceScore: 0,
        };

        return {
          output: { retrieved: [], count: 0 },
          state,
          monitoring,
          error,
        };
      }
    },
  };
}
