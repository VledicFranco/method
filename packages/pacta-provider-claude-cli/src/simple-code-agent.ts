/**
 * Simple Code Agent — pre-assembled reference agent using Claude CLI.
 *
 * Pact: oneshot mode, standard code tools (Read, Grep, Glob, Edit, Write).
 * Intended as a quick-start for common code tasks.
 */

import type { Pact, Agent } from '@method/pacta';
import { createAgent } from '@method/pacta';
import { claudeCliProvider, type ClaudeCliProviderOptions } from './claude-cli-provider.js';

// ── Default Pact ─────────────────────────────────────────────────

const SIMPLE_CODE_PACT: Pact<string> = {
  mode: { type: 'oneshot' },
  scope: {
    allowedTools: ['Read', 'Grep', 'Glob', 'Edit', 'Write'],
  },
};

// ── Factory ──────────────────────────────────────────────────────

/**
 * Create a simple code agent with Claude CLI provider.
 *
 * Uses oneshot mode with Read/Grep/Glob/Edit/Write tools.
 *
 * @param options - Optional Claude CLI provider configuration
 * @returns A ready-to-invoke Agent
 */
export function simpleCodeAgent(options?: ClaudeCliProviderOptions): Agent<string> {
  const provider = claudeCliProvider(options);
  return createAgent({
    pact: SIMPLE_CODE_PACT,
    provider,
  });
}
