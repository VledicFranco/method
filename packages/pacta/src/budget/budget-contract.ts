// SPDX-License-Identifier: Apache-2.0
/**
 * Budget Contract — resource limits declared before invocation.
 *
 * The runtime enforces these limits. When a limit is approached or
 * exceeded, the exhaustion policy determines the response.
 */

export interface BudgetContract {
  /** Total token limit (input + output) across all turns */
  maxTokens?: number;

  /** Output token limit per invocation */
  maxOutputTokens?: number;

  /** Dollar cap for the entire pact lifetime */
  maxCostUsd?: number;

  /** Wall-clock timeout in milliseconds */
  maxDurationMs?: number;

  /** Maximum number of agentic turns (tool use → response cycles) */
  maxTurns?: number;

  /** What happens when any budget limit is reached */
  onExhaustion?: 'stop' | 'warn' | 'error';
}
