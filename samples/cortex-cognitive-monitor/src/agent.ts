/**
 * Monitor cognitive-module — Cortex tenant app composition root.
 *
 * PRD-068 Wave 1 Skeleton. The tenant app's Cortex category is `agent`,
 * Tier 2. Composition:
 *
 *   1. Validate ctx shape via `assertCtxCompatibility`.
 *   2. Create the method agent via `createMethodAgent({ ctx, pact: monitorPact })`.
 *   3. Join the cortical workspace via `withCorticalWorkspaceMembership`
 *      (handshake protocol, S11).
 *   4. Register a 30s heartbeat via `ScheduledPact` when `ctx.schedule` is
 *      available (it always should be in production; dev harness may omit).
 *   5. Return a handle that the Cortex entry point invokes per workspace
 *      event and disposes on shutdown.
 *
 * Research gate: the actual MonitorV2 cognitive behavior
 * (prediction-error tracking, metacognitive taxonomy) is NOT wired in
 * this Wave 1 scaffold. Full cognitive integration is gated on the
 * R-26c rerun in `experiments/exp-cognitive-baseline/` per PRD-068 §10
 * D4. The scaffold demonstrates that the Cortex-hosting wiring is
 * correct — workspace emits, handshake, budget isolation, resumable
 * continuation — independent of the cognitive-depth question.
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
} from '@method/agent-runtime';

import { monitorPact, type MonitorReport } from './pact.js';

export const MONITOR_MODULE_VERSION = '0.1.0-wave1-scaffold';
export const MONITOR_PACT_KEY = 'cortex-cognitive-monitor';
export const MONITOR_HEARTBEAT_SCHEDULE_NAME =
  'cortex-cognitive-monitor-heartbeat';

export interface MonitorTenantHandle {
  readonly agent: MethodAgent<MonitorReport>;
  readonly membership: CorticalWorkspaceMembershipHandle;
  readonly workspace: WorkspaceEventEmitter;
  /**
   * Trigger Monitor's reaction to a new workspace state snapshot. In the
   * full cognitive integration this runs MonitorV2's detection pass; in
   * the Wave 1 scaffold it drives `agent.invoke` against the snapshot and
   * emits the structured MonitorReport as `anomaly`/`confidence`.
   */
  observeWorkspaceState(
    traceId: string,
    snapshot: Record<string, unknown>,
  ): Promise<MonitorReport>;
  dispose(): Promise<void>;
}

export async function composeMonitorTenantApp(
  ctx: CortexCtx,
): Promise<MonitorTenantHandle> {
  assertCtxCompatibility(ctx);

  const agent = createMethodAgent<MonitorReport>({
    ctx,
    pact: monitorPact,
    onEvent: (event: AgentEvent): void => {
      // Wave 1 scaffold: no extra onEvent wiring. The agent-runtime audit
      // + event connector middleware handles mirroring events to
      // ctx.audit and ctx.events (for the non-workspace topics).
      void event;
    },
  });

  const membership = withCorticalWorkspaceMembership({
    ctx,
    moduleRole: 'monitor',
    version: MONITOR_MODULE_VERSION,
    capabilities: ['workspace.state/observe', 'anomaly/emit', 'confidence/emit'],
  });
  await membership.join();

  const workspace = createWorkspaceEventEmitter(ctx);

  // Register a 30s heartbeat schedule (S5 / PRD-068 §5.3). Cortex's
  // schedule tick handler invokes `method.pact.continue` with the
  // ScheduledPact payload built below; in production the tenant app's
  // continuation handler routes that tick into `membership.tickHeartbeat()`.
  if (ctx.schedule) {
    try {
      const payload = ScheduledPact.payload(MONITOR_PACT_KEY, {
        initialContext: { kind: 'heartbeat', moduleRole: 'monitor' },
        budgetStrategy: 'fresh-per-continuation',
        perTickBudgetUsd: 0.001,
      });
      await ctx.schedule.register('*/30 * * * * *', {
        kind: 'method.pact.continue',
        payload: payload as unknown as Record<string, unknown>,
      });
    } catch (err) {
      // Heartbeat registration is best-effort; the first `module_online`
      // JOIN still announces presence. Peers will eventually mark us
      // offline after 90s, but the sample still compiles + runs locally.
      ctx.log?.warn('cortex-cognitive-monitor: heartbeat schedule failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function observeWorkspaceState(
    traceId: string,
    snapshot: Record<string, unknown>,
  ): Promise<MonitorReport> {
    const prompt = [
      `You are the Monitor cognitive module. Given the workspace snapshot`,
      `below, emit a structured MonitorReport indicating severity,`,
      `confidence (0-1), and a short detail string.`,
      '',
      `traceId: ${traceId}`,
      `snapshot: ${JSON.stringify(snapshot)}`,
    ].join('\n');

    const result = await agent.invoke({ prompt });
    const report: MonitorReport = (result.output as MonitorReport | undefined) ?? {
      severity: 'ok',
      confidence: 0.5,
      detail: 'no structured output',
    };

    // Emit anomaly + confidence to the cortical workspace. Both are keyed
    // on traceId so peers can correlate on the reasoning episode.
    if (report.severity !== 'ok') {
      await workspace.emit('method.cortex.workspace.anomaly', traceId, {
        kind:
          report.severity === 'anomaly'
            ? 'conflict'
            : 'drift',
        severity: report.severity,
        detail: report.detail,
        confidence: report.confidence,
      });
    }
    await workspace.emit('method.cortex.workspace.confidence', traceId, {
      scalar: report.confidence,
      source: 'monitor',
    });

    return report;
  }

  async function dispose(): Promise<void> {
    await membership.leave('graceful');
    await agent.dispose();
  }

  return { agent, membership, workspace, observeWorkspaceState, dispose };
}
