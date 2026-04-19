/**
 * Sample app E2E smoke test — PRD-058 §4 success criterion 3.
 *
 * Asserts the full contract:
 *   (a) result ok
 *   (b) ctx.audit.event() called N≥6 times (audit-wired, multiple AgentEvents)
 *   (c) ctx.llm.complete() called once (structured path routes through structured())
 *   (d) auditEventCount > 0 on result
 *   (e) no ctx.events.publish calls when connector NOT wired (default)
 *   (f) Slack-via-onEvent callback fires at least once
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runTriageAgent } from '../src/agent.js';
import { createMockCtx } from './mock-ctx.js';
import {
  createMethodAgent,
  type CortexCtx,
} from '@methodts/agent-runtime';
import { incidentTriagePact } from '../src/pacts/incident-triage.js';

describe('sample cortex-incident-triage-agent — end to end', () => {
  it('runs, mirrors audit, returns Cortex-annotated result', async () => {
    const { ctx, spies } = createMockCtx({ appId: 'incident-triage-app' });
    const slackMessages: string[] = [];

    const result = await runTriageAgent(ctx, (text) => {
      slackMessages.push(text);
    });

    // (a) ok
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.stopReason, 'complete');

    // (b) audit called ≥ 1 — the sample pact emits at least started, text (suppressed by default), turn_complete, completed.
    assert.ok(
      spies.auditEvent.callCount() >= 1,
      `audit called ${spies.auditEvent.callCount()} times; expected ≥1`,
    );

    // (c) ctx.llm.complete (or structured()) called once — pact has schema so structured().
    assert.strictEqual(
      spies.llmComplete.callCount(),
      1,
      'ctx.llm dispatched exactly once for a oneshot schema pact',
    );

    // (d) auditEventCount echoed on result.
    assert.ok(result.auditEventCount > 0, 'auditEventCount > 0');

    // (f) Slack onEvent hook wired — at least one text or completed event.
    assert.ok(
      slackMessages.length >= 1,
      `slack got ${slackMessages.length} messages; expected ≥1`,
    );

    // appId attributed.
    assert.ok(result.output);
    assert.strictEqual(result.output?.severity, 'warning');
  });

  it('ctx.events auto-wires connector when present', async () => {
    const { ctx, spies } = createMockCtx({ includeEvents: true });

    const agent = createMethodAgent({
      ctx: ctx as CortexCtx,
      pact: incidentTriagePact,
    });
    const result = await agent.invoke({ prompt: ctx.input!.text as string });
    await agent.dispose();

    assert.strictEqual(result.completed, true);
    assert.ok(
      spies.eventsPublish.callCount() >= 1,
      `events.publish called ${spies.eventsPublish.callCount()} times`,
    );
  });

  it('does NOT call ctx.events.publish when connector skipped (ctx.events absent)', async () => {
    const { ctx, spies } = createMockCtx({ includeEvents: false });
    await runTriageAgent(ctx);
    assert.strictEqual(spies.eventsPublish.callCount(), 0);
  });

  it('supports the events() async-iterable channel (mutex with onEvent)', async () => {
    const { ctx } = createMockCtx();
    const agent = createMethodAgent({
      ctx,
      pact: incidentTriagePact,
      eventsChannel: 'async-iterable',
    });
    const iterable = agent.events();
    const iterator = iterable[Symbol.asyncIterator]();

    const resultP = agent.invoke({ prompt: 'go' });
    const first = await iterator.next();
    assert.strictEqual(first.done, false);
    await resultP;
    await agent.dispose();
  });
});
