// SPDX-License-Identifier: Apache-2.0
/**
 * Planner cognitive-module — Cortex tenant app composition root (PRD-068 W1).
 *
 * The Planner reacts to `method.cortex.workspace.anomaly` +
 * `.memory_recalled` + `.state` events and produces `plan_updated` +
 * `goal` emissions. In this Wave 1 skeleton, cognitive behavior is
 * scaffolded — the pact is declared and workspace emissions are wired,
 * but the full Planner logic is gated on the R-26c research rerun
 * (PRD-068 §10 D4).
 */

import {
  ScheduledPact,
  assertCtxCompatibility,
  createMethodAgent,
  createWorkspaceEventEmitter,
  withCorticalWorkspaceMembership,
  type AgentEvent,
  type CortexCtx,
  type MethodAgent,
  type CorticalWorkspaceMembershipHandle,
  type WorkspaceEventEmitter,
} from '@methodts/agent-runtime';

import { plannerPact, type PlanUpdate } from './pact.js';

export const PLANNER_MODULE_VERSION = '0.1.0-wave1-scaffold';
export const PLANNER_PACT_KEY = 'cortex-cognitive-planner';

export interface PlannerTenantHandle {
  readonly agent: MethodAgent<PlanUpdate>;
  readonly membership: CorticalWorkspaceMembershipHandle;
  readonly workspace: WorkspaceEventEmitter;
  /**
   * React to a workspace anomaly (from the Monitor app) by producing a
   * revised plan. The Planner emits `plan_updated` and `goal` to the
   * workspace. If `requiresMemoryRecall` is true it ALSO emits
   * `memory_query` (caller is responsible for awaiting the
   * `memory_recalled` response and re-invoking if needed).
   */
  reactToAnomaly(
    traceId: string,
    anomaly: Record<string, unknown>,
  ): Promise<PlanUpdate>;
  dispose(): Promise<void>;
}

export async function composePlannerTenantApp(
  ctx: CortexCtx,
): Promise<PlannerTenantHandle> {
  assertCtxCompatibility(ctx);

  const agent = createMethodAgent<PlanUpdate>({
    ctx,
    pact: plannerPact,
    onEvent: (event: AgentEvent): void => {
      void event;
    },
  });

  const membership = withCorticalWorkspaceMembership({
    ctx,
    moduleRole: 'planner',
    version: PLANNER_MODULE_VERSION,
    capabilities: [
      'plan/revise',
      'goal/declare',
      'memory_query/issue',
    ],
  });
  await membership.join();

  const workspace = createWorkspaceEventEmitter(ctx);

  if (ctx.schedule) {
    try {
      const payload = ScheduledPact.payload(PLANNER_PACT_KEY, {
        initialContext: { kind: 'heartbeat', moduleRole: 'planner' },
        budgetStrategy: 'fresh-per-continuation',
        perTickBudgetUsd: 0.001,
      });
      await ctx.schedule.register('*/30 * * * * *', {
        kind: 'method.pact.continue',
        payload: payload as unknown as Record<string, unknown>,
      });
    } catch (err) {
      ctx.log?.warn('cortex-cognitive-planner: heartbeat schedule failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function reactToAnomaly(
    traceId: string,
    anomaly: Record<string, unknown>,
  ): Promise<PlanUpdate> {
    const prompt = [
      `You are the Planner cognitive module. An anomaly has been reported`,
      `by the Monitor module. Produce a revised plan as a PlanUpdate`,
      `object.`,
      '',
      `traceId: ${traceId}`,
      `anomaly: ${JSON.stringify(anomaly)}`,
    ].join('\n');

    const result = await agent.invoke({ prompt });
    const update: PlanUpdate = (result.output as PlanUpdate | undefined) ?? {
      goalId: 'default-goal',
      statement: 'maintain workspace coherence',
      planSummary: 'no structured output — defaulting to hold plan',
      changedSteps: [],
      requiresMemoryRecall: false,
      rationale: 'fallback path',
    };

    // Emit goal first — establishes the (possibly new) goal before plan.
    await workspace.emit('method.cortex.workspace.goal', traceId, {
      goalId: update.goalId,
      statement: update.statement,
    });

    // Emit plan_updated with summary + changed step list.
    await workspace.emit('method.cortex.workspace.plan_updated', traceId, {
      planSummary: update.planSummary,
      changedSteps: update.changedSteps,
    });

    // If the Planner decided it needs historical context, emit a
    // memory_query. The Memory app responds with memory_recalled; the
    // root app is responsible for routing that back in a subsequent
    // reactToAnomaly call.
    if (update.requiresMemoryRecall) {
      await workspace.emit('method.cortex.workspace.memory_query', traceId, {
        queryKind: 'episodic',
        key: update.goalId,
        k: 5,
      });
    }

    return update;
  }

  async function dispose(): Promise<void> {
    await membership.leave('graceful');
    await agent.dispose();
  }

  return { agent, membership, workspace, reactToAnomaly, dispose };
}
