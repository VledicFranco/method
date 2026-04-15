/**
 * Sample Cortex tenant app — the entry-point module Cortex calls with a
 * real `ctx`. In production deployment, Cortex wires this through the
 * category: agent runtime (RFC-005 §10.2). Here the tests drive the
 * same function with a mock ctx.
 *
 * One import, one call — PRD-058 §1.
 */

import {
  createMethodAgent,
  assertCtxCompatibility,
  type AgentEvent,
  type CortexCtx,
  type MethodAgentResult,
} from '@method/agent-runtime';
import { incidentTriagePact } from './pacts/incident-triage.js';
import type { TriageOutput } from './types.js';

export interface AgentRunResult {
  readonly ok: boolean;
  readonly output?: TriageOutput;
  readonly costUsd: number;
  readonly auditEventCount: number;
  readonly stopReason: MethodAgentResult<TriageOutput>['stopReason'];
}

/**
 * Tenant app entry — given a Cortex `ctx`, create a method-governed agent
 * and run it against the incident payload in `ctx.input.text`.
 *
 * The `slackNotify` function wires `ctx.notify.slack` (not part of the
 * S1 surface — tenant-specific) through `onEvent`. Tests pass a spy so
 * they can assert Slack was invoked.
 */
export async function runTriageAgent(
  ctx: CortexCtx,
  slackNotify?: (text: string) => void,
): Promise<AgentRunResult> {
  // R1 (dual-ctx-drift) mitigation — guarded boot check.
  assertCtxCompatibility(ctx);

  const agent = createMethodAgent({
    ctx,
    pact: incidentTriagePact,
    onEvent: (event: AgentEvent): void => {
      if (event.type === 'text' && slackNotify) {
        slackNotify(event.content);
      }
      if (event.type === 'completed' && slackNotify) {
        slackNotify(`triage completed (turns=${event.turns})`);
      }
    },
  });

  const prompt = ctx.input?.text ?? 'triage the latest incident';
  const result = await agent.invoke({ prompt });
  await agent.dispose();

  return {
    ok: result.completed,
    output: result.output,
    costUsd: result.cost.totalUsd,
    auditEventCount: result.auditEventCount,
    stopReason: result.stopReason,
  };
}
