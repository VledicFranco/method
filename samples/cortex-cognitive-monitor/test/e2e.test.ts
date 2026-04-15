/**
 * Monitor cognitive tenant app — E2E smoke test.
 *
 * PRD-068 Wave 1 Skeleton coverage:
 *   - composes against a MockCortexCtx bearing events + schedule
 *   - handshake (`module_online`) fires on compose
 *   - 30s heartbeat schedule is registered against ctx.schedule
 *   - `observeWorkspaceState` emits anomaly + confidence on the workspace
 *     topic family, both keyed on the traceId
 *   - `dispose` emits `module_offline` with reason=graceful
 *
 * Full cognitive integration (MonitorV2 detection + metacognitive
 * taxonomy) is not exercised here — see PRD-068 §10 D4 research gate.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { composeMonitorTenantApp, MONITOR_MODULE_VERSION } from '../src/agent.js';
import { createMockCtx } from './mock-ctx.js';

describe('cortex-cognitive-monitor — composition + handshake', () => {
  it('emits module_online on compose with role=monitor and our version', async () => {
    const { ctx, eventsFor } = createMockCtx({
      includeEvents: true,
      includeSchedule: true,
    });
    const handle = await composeMonitorTenantApp(ctx);
    const joins = eventsFor('method.cortex.workspace.module_online');
    assert.ok(joins.length >= 1, 'at least one module_online published');
    assert.equal(joins[0].moduleRole, 'monitor');
    assert.equal(joins[0].version, MONITOR_MODULE_VERSION);
    assert.equal(joins[0].appId, 'cortex-cognitive-monitor');
    await handle.dispose();
  });

  it('registers a */30s heartbeat schedule when ctx.schedule present', async () => {
    const { ctx, spies } = createMockCtx({
      includeEvents: true,
      includeSchedule: true,
    });
    const handle = await composeMonitorTenantApp(ctx);
    assert.ok(
      spies.scheduleRegister.callCount() >= 1,
      `expected ≥1 schedule.register calls, got ${spies.scheduleRegister.callCount()}`,
    );
    const [cron, handler] = spies.scheduleRegister.calls[0];
    assert.equal(cron, '*/30 * * * * *');
    assert.equal((handler as { kind: string }).kind, 'method.pact.continue');
    await handle.dispose();
  });

  it('tolerates missing ctx.schedule (compose still succeeds, no crash)', async () => {
    const { ctx } = createMockCtx({
      includeEvents: true,
      includeSchedule: false,
    });
    const handle = await composeMonitorTenantApp(ctx);
    assert.ok(handle);
    await handle.dispose();
  });
});

describe('cortex-cognitive-monitor — observeWorkspaceState', () => {
  it('emits anomaly + confidence keyed on traceId when severity is anomaly', async () => {
    const { ctx, eventsFor } = createMockCtx({
      includeEvents: true,
      includeSchedule: true,
    });
    const handle = await composeMonitorTenantApp(ctx);

    const report = await handle.observeWorkspaceState('trace-7', {
      step: 3,
      tool: 'fs/Read',
      lastArtifact: 'plan.md',
    });
    assert.equal(report.severity, 'anomaly');
    assert.equal(report.confidence, 0.78);

    const anomalies = eventsFor('method.cortex.workspace.anomaly');
    assert.equal(anomalies.length, 1, 'one anomaly emitted');
    assert.equal(anomalies[0].traceId, 'trace-7');
    assert.equal(anomalies[0].severity, 'anomaly');

    const confidences = eventsFor('method.cortex.workspace.confidence');
    assert.equal(confidences.length, 1);
    assert.equal(confidences[0].traceId, 'trace-7');
    assert.equal(confidences[0].scalar, 0.78);
    assert.equal(confidences[0].source, 'monitor');

    await handle.dispose();
  });

  it('suppresses anomaly emission when severity=ok', async () => {
    const { ctx, eventsFor } = createMockCtx({
      includeEvents: true,
      includeSchedule: true,
      llmContent: JSON.stringify({
        severity: 'ok',
        confidence: 0.95,
        detail: 'workspace nominal',
      }),
    });
    const handle = await composeMonitorTenantApp(ctx);
    const report = await handle.observeWorkspaceState('trace-ok', {});
    assert.equal(report.severity, 'ok');
    assert.equal(eventsFor('method.cortex.workspace.anomaly').length, 0);
    assert.equal(eventsFor('method.cortex.workspace.confidence').length, 1);
    await handle.dispose();
  });
});

describe('cortex-cognitive-monitor — dispose leaves gracefully', () => {
  it('emits module_offline with reason=graceful', async () => {
    const { ctx, eventsFor } = createMockCtx({
      includeEvents: true,
      includeSchedule: true,
    });
    const handle = await composeMonitorTenantApp(ctx);
    await handle.dispose();
    const leaves = eventsFor('method.cortex.workspace.module_offline');
    assert.equal(leaves.length, 1);
    assert.equal(leaves[0].moduleRole, 'monitor');
    assert.equal(leaves[0].reason, 'graceful');
  });
});
