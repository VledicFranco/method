/**
 * Context Policy — declarative configuration for context window management.
 *
 * Formalizes the three canonical strategies for long-horizon tasks:
 * compact (summarize in place), notes (external scratchpad), subagent
 * (fresh windows with summary extraction).
 */

import type { MemoryPort } from '../ports/memory-port.js';

export interface ContextPolicy {
  /** Fraction of context window (0-1) that triggers compaction */
  compactionThreshold?: number;

  /** Custom instructions appended to the compaction prompt */
  compactionInstructions?: string;

  /** Strategy for managing context pressure */
  strategy?: 'compact' | 'notes' | 'subagent' | 'none';

  /** Memory port for the 'notes' strategy */
  memory?: MemoryPort;

  /** Token budget for sub-agent summary extraction */
  subagentSummaryTokens?: number;

  /** Token budget reserved for the system prompt */
  systemPromptBudget?: number;
}
