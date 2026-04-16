/**
 * Planner cognitive tenant app — E2E smoke test (PRD-068 Wave 1 Skeleton).
 *
 * Covers:
 *   - compose + handshake (module_online as planner)
 *   - heartbeat schedule registered on ctx.schedule
 *   - reactToAnomaly emits goal + plan_updated + memory_query
 *   - traceId correctly injected on every workspace emission
 *   - dispose emits module_offline
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { composePlannerTenantApp, PLANNER_MODULE_VERSION } from '../src/agent.js';
import { createMockCtx } from './mock-ctx.js';

describe('cortex-cognitive-planner — composition + handshake', () => {
  it('emits module_online as role=planner with our version', async () => {
    const { ctx, eventsFor } = createMockCtx({
      includeEvents: true,
      includeSchedule: true,
    });
    const handle = await composePlannerTenantApp(ctx);
    const joins = eventsFor('method.cortex.workspace.module_online');
    assert.ok(joins.length >= 1);
    assert.equal(joins[0].moduleRole, 'planner');
    assert.equal(joins[0].version, PLANNER_MODULE_VERSION);
    await handle.dispose();
  });

  it('registers the 30s heartbeat cron', async () => {
    const { ctx, spies } = createMockCtx({
      includeEvents: true,
      includeSchedule: true,
    });
    const handle = await composePlannerTenantApp(ctx);
    assert.ok(spies.scheduleRegister.callCount() >= 1);
    assert.equal(spies.scheduleRegister.calls[0][0], '*/30 * * * * *');
    await handle.dispose();
  });
});

describe('cortex-cognitive-planner — reactToAnomaly', () => {
  it('emits goal + plan_updated + memory_query in response to anomaly', async () => {
    const { ctx, eventsFor } = createMockCtx({
      includeEvents: true,
      includeSchedule: true,
    });
    const handle = await composePlannerTenantApp(ctx);

    const update = await handle.reactToAnomaly('trace-11', {
      kind: 'conflict',
      severity: 'anomaly',
      detail: 'constraint C-3 violated at step 3',
      confidence: 0.78,
    });

    assert.equal(update.goalId, 'goal-42');
    assert.equal(update.requiresMemoryRecall, true);

    const goals = eventsFor('method.cortex.workspace.goal');
    assert.equal(goals.length, 1);
    assert.equal(goals[0].traceId, 'trace-11');
    assert.equal(goals[0].goalId, 'goal-42');

    const plans = eventsFor('method.cortex.workspace.plan_updated');
    assert.equal(plans.length, 1);
    assert.equal(plans[0].traceId, 'trace-11');
    assert.deepEqual(plans[0].changedSteps, ['step-3', 'step-4', 'step-5']);

    const queries = eventsFor('method.cortex.workspace.memory_query');
    assert.equal(queries.length, 1);
    assert.equal(queries[0].traceId, 'trace-11');
    assert.equal(queries[0].queryKind, 'episodic');
    assert.equal(queries[0].k, 5);

    await handle.dispose();
  });

  it('skips memory_query when requiresMemoryRecall=false', async () => {
    const { ctx, eventsFor } = createMockCtx({
      includeEvents: true,
      includeSchedule: true,
      llmContent: JSON.stringify({
        goalId: 'goal-simple',
        statement: 'proceed',
        planSummary: 'no change needed',
        changedSteps: [],
        requiresMemoryRecall: false,
        rationale: 'anomaly self-resolving',
      }),
    });
    const handle = await composePlannerTenantApp(ctx);
    await handle.reactToAnomaly('trace-x', { kind: 'drift' });
    assert.equal(eventsFor('method.cortex.workspace.memory_query').length, 0);
    assert.equal(eventsFor('method.cortex.workspace.plan_updated').length, 1);
    await handle.dispose();
  });
});

describe('cortex-cognitive-planner — dispose', () => {
  it('leaves gracefully', async () => {
    const { ctx, eventsFor } = createMockCtx({
      includeEvents: true,
      includeSchedule: true,
    });
    const handle = await composePlannerTenantApp(ctx);
    await handle.dispose();
    const leaves = eventsFor('method.cortex.workspace.module_offline');
    assert.equal(leaves.length, 1);
    assert.equal(leaves[0].moduleRole, 'planner');
    assert.equal(leaves[0].reason, 'graceful');
  });
});
