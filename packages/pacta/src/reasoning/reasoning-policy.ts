// SPDX-License-Identifier: Apache-2.0
/**
 * Reasoning Policy — declarative configuration for agent reasoning behavior.
 *
 * The policy is pure data. Factory functions (e.g., reactReasoner()) read
 * the config and return middleware that implements the reasoning strategy.
 */

export interface AgentExample {
  /** The user prompt */
  prompt: string;

  /** The ideal agent response or tool sequence */
  response: string;
}

export interface ReasoningPolicy {
  /** Enable the think tool (zero-side-effect scratchpad) */
  thinkTool?: boolean;

  /** Inject planning instructions between agentic actions */
  planBetweenActions?: boolean;

  /** Enable verbal self-critique on failure */
  reflectOnFailure?: boolean;

  /** Maximum reflection trials before giving up */
  maxReflectionTrials?: number;

  /** Few-shot examples to inject into context */
  examples?: AgentExample[];

  /** Reasoning effort level — maps to provider-specific controls */
  effort?: 'low' | 'medium' | 'high';

  /** Custom reasoning instructions appended to agent context */
  instructions?: string;
}
