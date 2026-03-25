/**
 * Research Agent — pre-assembled reference agent for research tasks.
 *
 * Default pact:
 * - Mode: oneshot
 * - Budget: maxTurns 30, maxCostUsd $1.00
 * - Scope: Read, Grep, Glob, WebSearch, WebFetch
 * - Reasoning: ReAct with think tool + reflect on failure
 *
 * Requires a provider — no default provider is shipped.
 */

import type { Pact } from '../pact.js';
import type { ReasoningPolicy } from '../reasoning/reasoning-policy.js';
import { createReferenceAgent } from './reference-agent.js';
import type { ReferenceAgent, ReferenceAgentConfig } from './reference-agent.js';

// ── Default Pact ────────────────────────────────────────────────

const RESEARCH_AGENT_PACT: Pact = {
  mode: { type: 'oneshot' },
  budget: {
    maxTurns: 30,
    maxCostUsd: 1.0,
  },
  scope: {
    allowedTools: ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch'],
  },
};

// ── Default Reasoning ───────────────────────────────────────────

const RESEARCH_AGENT_REASONING: ReasoningPolicy = {
  thinkTool: true,
  reflectOnFailure: true,
};

// ── Factory ─────────────────────────────────────────────────────

/**
 * Creates a pre-assembled research agent.
 *
 * @example
 * ```ts
 * const agent = researchAgent({ provider: myProvider });
 * const result = await agent.invoke({ prompt: 'Research the history of formal methods' });
 * ```
 */
export function researchAgent(config: ReferenceAgentConfig): ReferenceAgent {
  return createReferenceAgent(RESEARCH_AGENT_PACT, config, RESEARCH_AGENT_REASONING);
}
