// SPDX-License-Identifier: Apache-2.0
/**
 * Review Agent — pre-assembled reference agent for code review tasks.
 *
 * Default pact:
 * - Mode: oneshot
 * - Budget: maxTurns 15, maxCostUsd $1.00
 * - Scope: Read, Grep, Glob (read-only — no write tools)
 * - Reasoning: ReAct with think tool
 *
 * Requires a provider — no default provider is shipped.
 */

import type { Pact } from '../pact.js';
import type { ReasoningPolicy } from '../reasoning/reasoning-policy.js';
import { createReferenceAgent } from './reference-agent.js';
import type { ReferenceAgent, ReferenceAgentConfig } from './reference-agent.js';

// ── Default Pact ────────────────────────────────────────────────

const REVIEW_AGENT_PACT: Pact = {
  mode: { type: 'oneshot' },
  budget: {
    maxTurns: 15,
    maxCostUsd: 1.0,
  },
  scope: {
    allowedTools: ['Read', 'Grep', 'Glob'],
  },
};

// ── Default Reasoning ───────────────────────────────────────────

const REVIEW_AGENT_REASONING: ReasoningPolicy = {
  thinkTool: true,
};

// ── Factory ─────────────────────────────────────────────────────

/**
 * Creates a pre-assembled code review agent.
 *
 * @example
 * ```ts
 * const agent = reviewAgent({ provider: myProvider });
 * const result = await agent.invoke({ prompt: 'Review the changes in src/parser.ts' });
 * ```
 */
export function reviewAgent(config: ReferenceAgentConfig): ReferenceAgent {
  return createReferenceAgent(REVIEW_AGENT_PACT, config, REVIEW_AGENT_REASONING);
}
