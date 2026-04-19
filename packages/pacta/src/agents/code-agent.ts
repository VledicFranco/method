// SPDX-License-Identifier: Apache-2.0
/**
 * Code Agent — pre-assembled reference agent for coding tasks.
 *
 * Default pact:
 * - Mode: oneshot
 * - Budget: maxTurns 20, maxCostUsd $2.00
 * - Scope: Read, Grep, Glob, Edit, Write, Bash
 * - Reasoning: ReAct with think tool + plan between actions
 *
 * Requires a provider — no default provider is shipped.
 */

import type { Pact } from '../pact.js';
import type { ReasoningPolicy } from '../reasoning/reasoning-policy.js';
import { createReferenceAgent } from './reference-agent.js';
import type { ReferenceAgent, ReferenceAgentConfig } from './reference-agent.js';

// ── Default Pact ────────────────────────────────────────────────

const CODE_AGENT_PACT: Pact = {
  mode: { type: 'oneshot' },
  budget: {
    maxTurns: 20,
    maxCostUsd: 2.0,
  },
  scope: {
    allowedTools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'],
  },
};

// ── Default Reasoning ───────────────────────────────────────────

const CODE_AGENT_REASONING: ReasoningPolicy = {
  thinkTool: true,
  planBetweenActions: true,
};

// ── Factory ─────────────────────────────────────────────────────

/**
 * Creates a pre-assembled coding agent.
 *
 * @example
 * ```ts
 * const agent = codeAgent({ provider: myProvider });
 * const result = await agent.invoke({ prompt: 'Fix the bug in parser.ts', workdir: '/project' });
 * ```
 */
export function codeAgent(config: ReferenceAgentConfig): ReferenceAgent {
  return createReferenceAgent(CODE_AGENT_PACT, config, CODE_AGENT_REASONING);
}
