/**
 * Memory Module — retrieves relevant knowledge from memory and writes it to workspace.
 *
 * The memory module reads the current workspace snapshot, derives a retrieval
 * key from its contents, queries the MemoryPort, and writes retrieved entries
 * back to the workspace for downstream modules to consume.
 *
 * ## Cognitive Science Grounding
 *
 * **Primary analog: Hippocampal formation — episodic binding, contextual
 * retrieval, and long-term memory access.**
 *
 * - **ACT-R (Anderson, 2007) — Declarative Memory:** ACT-R's declarative
 *   module stores and retrieves chunks based on activation levels. Activation
 *   is a function of base-level learning (frequency + recency) and spreading
 *   activation (contextual match). Our Memory module derives a retrieval key
 *   from workspace contents (spreading activation analog) and queries the
 *   MemoryPort for relevant entries.
 *
 * - **SOAR (Laird, 2012) — Long-Term Memory:** SOAR has three LTM systems:
 *   procedural (production rules), semantic (general knowledge), and episodic
 *   (specific experiences). Our MemoryPort interface supports semantic (search)
 *   and procedural (retrieve) queries, corresponding to SOAR's semantic and
 *   procedural memories. Episodic memory (specific past experiences with
 *   temporal context) is partially supported through the Reflector's lesson
 *   storage.
 *
 * - **Hippocampal Binding (Eichenbaum, 2000; Squire, 2004):** The hippocampus
 *   binds disparate cortical representations into coherent episodic memories
 *   and supports context-dependent retrieval. Our Memory module writes
 *   retrieved entries to the workspace with high salience, placing them in
 *   the shared context for all modules — analogous to hippocampal replay
 *   injecting memories into cortical processing.
 *
 * - **Encoding Specificity (Tulving, 1973):** Memory retrieval is most
 *   effective when retrieval cues match encoding context. Our retrieval key
 *   derivation (concatenating workspace contents) is a crude approximation
 *   of encoding specificity — the current context drives what gets retrieved.
 *
 * **What this module captures:**
 * - Context-driven retrieval: workspace contents → retrieval key → MemoryPort query
 * - Workspace injection: retrieved memories written as high-salience entries
 * - Retrieval monitoring: count and relevance signals reported upward
 *
 * **What this module does NOT capture (known gaps):**
 * - No activation-based retrieval: ACT-R's base-level learning equation
 *   (frequency × recency) is not implemented. All memories are equally accessible.
 * - No retrieval interference: competing memories don't suppress each other.
 * - No goal-directed retrieval: the retrieval key is workspace-derived, not
 *   goal-derived. The Memory module doesn't know what the agent is trying to
 *   achieve, so it can't preferentially retrieve goal-relevant memories.
 * - No forgetting: stored memories persist indefinitely.
 *
 * **References:**
 * - Anderson, J. R. (2007). How Can the Human Mind Occur in the Physical Universe? Oxford UP.
 * - Laird, J. E. (2012). The Soar Cognitive Architecture. MIT Press.
 * - Eichenbaum, H. (2000). A cortical-hippocampal system for declarative memory.
 *   Nature Reviews Neuroscience, 1(1), 41-50.
 * - Tulving, E. (1973). Encoding specificity and retrieval processes in episodic memory.
 *   Psychological Review, 80(5), 352-373.
 *
 * @see docs/rfcs/001-cognitive-composition.md — Part IV, Phase 3 (REMEMBER)
 */

import type {
  CognitiveModule,
  ModuleId,
  MemoryMonitoring,
  ControlDirective,
  StepResult,
  StepError,
  WorkspaceWritePort,
  WorkspaceEntry,
  ReadonlyWorkspaceSnapshot,
} from '../algebra/index.js';
import { moduleId } from '../algebra/index.js';
import type { MemoryPort, MemoryEntry } from '../../ports/memory-port.js';

// ── Types ────────────────────────────────────────────────────────

/** Input to the memory module: a workspace snapshot to derive retrieval queries from. */
export interface MemoryModuleInput {
  /** Workspace snapshot to extract retrieval context from. */
  snapshot: ReadonlyWorkspaceSnapshot;
}

/** Output of the memory module: retrieved knowledge entries. */
export interface MemoryModuleOutput {
  /** Retrieved memory entries. */
  entries: MemoryEntry[];
  /** Number of entries retrieved. */
  count: number;
}

/** Memory module internal state. */
export interface MemoryModuleState {
  /** Total retrievals performed. */
  retrievalCount: number;
  /** Accumulated relevance across all retrievals. */
  accumulatedRelevance: number;
}

/** Control directive for the memory module. */
export interface MemoryModuleControl extends ControlDirective {
  /** Strategy for memory retrieval. Controls which MemoryPort method to use. */
  retrievalStrategy: 'episodic' | 'semantic' | 'procedural';
}

/** Configuration for the memory module factory. */
export interface MemoryModuleConfig {
  /** Custom module ID. Defaults to 'memory'. */
  id?: string;
  /** Maximum entries to retrieve per step. Defaults to 5. */
  maxRetrievals?: number;
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Derive a retrieval key from workspace snapshot contents.
 * Concatenates entry contents, truncated to a reasonable query length.
 */
function deriveRetrievalKey(snapshot: ReadonlyWorkspaceSnapshot): string {
  const parts: string[] = [];
  for (const entry of snapshot) {
    const content = typeof entry.content === 'string'
      ? entry.content
      : JSON.stringify(entry.content);
    parts.push(content);
  }
  const joined = parts.join(' ');
  // Truncate to 200 chars for a reasonable query
  return joined.slice(0, 200);
}

/**
 * Compute a relevance score for retrieved entries.
 * Heuristic: more entries with longer content = higher relevance.
 */
function computeRelevance(entries: MemoryEntry[]): number {
  if (entries.length === 0) return 0;
  const totalLength = entries.reduce((sum, e) => sum + e.value.length, 0);
  // Normalize: cap at 1.0, scale by number of entries and content length
  return Math.min(1, (entries.length * 0.15) + (totalLength / 2000));
}

// ── Factory ──────────────────────────────────────────────────────

/**
 * Create a Memory cognitive module.
 *
 * @param memory - The MemoryPort implementation for retrieval.
 * @param writePort - Workspace write port for emitting retrieved knowledge.
 * @param config - Optional configuration.
 */
export function createMemoryModule(
  memory: MemoryPort,
  writePort: WorkspaceWritePort,
  config?: MemoryModuleConfig,
): CognitiveModule<MemoryModuleInput, MemoryModuleOutput, MemoryModuleState, MemoryMonitoring, MemoryModuleControl> {
  const id = moduleId(config?.id ?? 'memory');
  const maxRetrievals = config?.maxRetrievals ?? 5;

  return {
    id,

    initialState(): MemoryModuleState {
      return {
        retrievalCount: 0,
        accumulatedRelevance: 0,
      };
    },

    async step(
      input: MemoryModuleInput,
      state: MemoryModuleState,
      _control: MemoryModuleControl,
    ): Promise<StepResult<MemoryModuleOutput, MemoryModuleState, MemoryMonitoring>> {
      try {
        const key = deriveRetrievalKey(input.snapshot);
        let entries: MemoryEntry[] = [];

        // Use search() if available (semantic strategy), otherwise retrieve() by key
        if (memory.search && (_control.retrievalStrategy === 'semantic' || _control.retrievalStrategy === 'episodic')) {
          entries = await memory.search(key, maxRetrievals);
        } else {
          // Procedural or fallback: retrieve by key
          const value = await memory.retrieve(key);
          if (value !== null) {
            entries = [{ key, value }];
          }
        }

        // Compute relevance
        const relevanceScore = computeRelevance(entries);

        // Write retrieved entries to workspace
        for (const entry of entries) {
          const wsEntry: WorkspaceEntry = {
            source: id,
            content: entry.value,
            salience: relevanceScore,
            timestamp: Date.now(),
          };
          writePort.write(wsEntry);
        }

        // Update state
        const newState: MemoryModuleState = {
          retrievalCount: state.retrievalCount + entries.length,
          accumulatedRelevance: state.accumulatedRelevance + relevanceScore,
        };

        const monitoring: MemoryMonitoring = {
          type: 'memory',
          source: id,
          timestamp: Date.now(),
          retrievalCount: entries.length,
          relevanceScore,
        };

        return {
          output: { entries, count: entries.length },
          state: newState,
          monitoring,
        };
      } catch (err: unknown) {
        const error: StepError = {
          message: err instanceof Error ? err.message : String(err),
          recoverable: true,
          moduleId: id,
          phase: 'retrieve',
        };

        const monitoring: MemoryMonitoring = {
          type: 'memory',
          source: id,
          timestamp: Date.now(),
          retrievalCount: 0,
          relevanceScore: 0,
        };

        return {
          output: { entries: [], count: 0 },
          state,
          monitoring,
          error,
        };
      }
    },
  };
}
