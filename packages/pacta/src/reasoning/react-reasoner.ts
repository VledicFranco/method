// SPDX-License-Identifier: Apache-2.0
/**
 * ReAct Reasoner — injects think tool and planning instructions.
 *
 * ReAct (Reasoning + Acting) strategy:
 * - If policy.thinkTool: adds a zero-side-effect "think" tool to the tool list
 *   via metadata, allowing the agent to reason in a structured scratchpad.
 * - If policy.planBetweenActions: injects planning instructions into the system
 *   prompt, asking the agent to plan before each tool use.
 * - If policy.instructions: appends custom reasoning instructions to context.
 *
 * Reference: Yao et al., "ReAct: Synergizing Reasoning and Acting in Language Models" (2023)
 */

import type { Pact, AgentRequest } from '../pact.js';
import type { AgentEvent } from '../events.js';
import type { ToolDefinition } from '../ports/tool-provider.js';
import type { ReasoningPolicy } from './reasoning-policy.js';
import type { InvokeFn, ReasonerMiddleware } from './reasoner-middleware.js';

// ── Think Tool Definition ────────────────────────────────────────

export const THINK_TOOL: ToolDefinition = {
  name: 'think',
  description:
    'Use this tool to think through a problem step-by-step. ' +
    'This is a zero-side-effect scratchpad — it does not execute anything. ' +
    'Use it to plan, reason about observations, or decide your next action.',
  inputSchema: {
    type: 'object',
    properties: {
      thought: {
        type: 'string',
        description: 'Your reasoning, plan, or analysis.',
      },
    },
    required: ['thought'],
  },
};

// ── Planning Instructions ────────────────────────────────────────

const PLAN_BETWEEN_ACTIONS_PROMPT =
  'Before each tool use, briefly state: (1) what you observed, ' +
  '(2) what you plan to do next and why, (3) what you expect to happen. ' +
  'Use the think tool for complex reasoning chains.';

// ── Factory ──────────────────────────────────────────────────────

/**
 * Creates a ReAct-style reasoning middleware.
 *
 * Reads the reasoning policy and returns middleware that:
 * - Adds a think tool definition to the request metadata
 * - Injects planning instructions into the system prompt
 * - Appends custom reasoning instructions if provided
 */
export function reactReasoner(policy?: Partial<ReasoningPolicy>): ReasonerMiddleware {
  const thinkTool = policy?.thinkTool ?? false;
  const planBetweenActions = policy?.planBetweenActions ?? false;
  const customInstructions = policy?.instructions;

  return <T>(
    inner: InvokeFn<T>,
    _pact: Pact<T>,
    _onEvent?: (event: AgentEvent) => void,
  ): InvokeFn<T> => {
    // If nothing is enabled, pass through
    if (!thinkTool && !planBetweenActions && !customInstructions) {
      return inner;
    }

    return async (pact: Pact<T>, request: AgentRequest) => {
      const augmented = augmentRequest(request, thinkTool, planBetweenActions, customInstructions);
      return inner(pact, augmented);
    };
  };
}

// ── Request Augmentation ─────────────────────────────────────────

function augmentRequest(
  request: AgentRequest,
  thinkTool: boolean,
  planBetweenActions: boolean,
  customInstructions?: string,
): AgentRequest {
  const parts: string[] = [];

  if (request.systemPrompt) {
    parts.push(request.systemPrompt);
  }

  if (planBetweenActions) {
    parts.push(PLAN_BETWEEN_ACTIONS_PROMPT);
  }

  if (customInstructions) {
    parts.push(customInstructions);
  }

  const augmented: AgentRequest = { ...request };

  // Inject system prompt additions
  if (parts.length > 0) {
    augmented.systemPrompt = parts.join('\n\n');
  }

  // Add think tool to metadata so providers can include it in tool lists
  if (thinkTool) {
    const existingTools: ToolDefinition[] =
      (request.metadata?.reasoningTools as ToolDefinition[] | undefined) ?? [];

    augmented.metadata = {
      ...request.metadata,
      reasoningTools: [...existingTools, THINK_TOOL],
    };
  }

  return augmented;
}
