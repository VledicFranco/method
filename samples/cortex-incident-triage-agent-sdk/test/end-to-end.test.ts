/**
 * Sample app E2E smoke test (C-4) — SDK-flavor.
 *
 * Mocking strategy
 * ----------------
 * The full vertical exercises:
 *
 *   createMethodAgent ─► claudeAgentSdkProvider ─► cortexAnthropicTransport
 *                                                  └─► (HTTP proxy on 127.0.0.1)
 *                                                  └─► @anthropic-ai/claude-agent-sdk
 *                                                       └─► spawns `claude` CLI
 *
 * Spawning the `claude` CLI inside a unit test is slow, non-hermetic, and
 * needs an API key. We therefore mock at the **provider** seam — the
 * same pattern C-1's `factory.test.ts` uses for surface coverage. A
 * stub `AgentProvider` plays the role of the SDK provider and returns a
 * fixture `AgentResult`. The composition under test is everything around
 * the provider:
 *
 *   - `createIncidentTriageAgent` wires the right pact + onEvent hook
 *   - `createMethodAgent` wraps the provider in the Cortex middleware stack
 *     (token-exchange → audit → budget enforcer → output validator)
 *   - `runTriageAgent` returns a Cortex-annotated AgentRunResult
 *
 * Acceptance criteria mapped:
 *   - AC-4.1: `agent.invoke()` against MockCortexCtx returns the expected
 *             output (severity / summary / nextAction).
 *   - AC-4.2: degraded-mode equivalent of ctx.llm.reserve/settle is
 *             observed via ctx.audit.event being called the expected
 *             number of times. In degraded mode the transport itself
 *             would also call ctx.audit.event per turn, but here we
 *             stub the provider so only the cortexAuditMiddleware path
 *             exercises ctx.audit.event — that suffices to prove the
 *             single-authority budget pattern compiles end-to-end.
 *   - AC-4.3: PRD AC-2 (Cortex composition) holds — the assembled stack
 *             type-checks, instantiates, runs, and returns the fixture
 *             output.
 *
 * Wiring smoke
 * ------------
 * A separate test verifies the **default** composition (no provider
 * override) instantiates without throwing — i.e. the cortex transport
 * boots the localhost proxy and adaptCtx accepts the nested CortexCtx.
 * This catches build-time wire breaks even though we don't call invoke().
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  type AgentProvider,
  type AgentRequest,
  type AgentResult,
  type Pact,
} from '@methodts/agent-runtime';

import { runTriageAgent, createIncidentTriageAgent } from '../src/agent.js';
import type { TriageOutput } from '../src/types.js';
import { createMockCtx } from './mock-ctx.js';

// ── Fixture stub provider ────────────────────────────────────────

const FIXTURE_OUTPUT: TriageOutput = {
  severity: 'warning',
  summary: 'Database connection pool saturated on db-west-2',
  nextAction: 'page on-call DBA, scale read replicas',
};

interface ProviderCallRecord {
  readonly pact: Pact<unknown>;
  readonly request: AgentRequest;
}

function makeStubSdkProvider(): {
  provider: AgentProvider;
  calls: ProviderCallRecord[];
} {
  const calls: ProviderCallRecord[] = [];
  const provider: AgentProvider = {
    name: 'stub-claude-agent-sdk',
    capabilities: () => ({
      // Mirror the real SDK provider's caps so createMethodAgent's
      // capability validator behaves identically.
      modes: ['oneshot'],
      streaming: true,
      resumable: false,
      budgetEnforcement: 'client',
      outputValidation: 'client',
      toolModel: 'function',
    }),
    async invoke<T>(pact: Pact<T>, request: AgentRequest): Promise<AgentResult<T>> {
      calls.push({ pact: pact as Pact<unknown>, request });

      const sessionId = 'sess-stub-c4';

      // The real SDK provider emits AgentEvents via the `onEvent`
      // callback the cortex audit middleware injects into
      // `request.metadata.onEvent` (see CortexAuditMiddleware.wrap).
      // We mirror the same pattern so `ctx.audit.event` fires through
      // the production wire — that's the AC-4.2 contract.
      const onEvent = request.metadata?.onEvent as
        | ((e: import('@methodts/agent-runtime').AgentEvent) => void)
        | undefined;
      const usage = {
        inputTokens: 200,
        outputTokens: 80,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 280,
      };
      const cost = {
        totalUsd: 0.0042,
        perModel: {
          'claude-sonnet-4-6': {
            tokens: usage,
            costUsd: 0.0042,
          },
        },
      };
      onEvent?.({
        type: 'started',
        sessionId,
        timestamp: new Date().toISOString(),
      });
      onEvent?.({
        type: 'turn_complete',
        turnNumber: 1,
        usage,
      });
      // Also emit a `text` event to exercise the suppressed-by-default
      // path through CortexAuditMiddleware (text/thinking are elided).
      onEvent?.({
        type: 'text',
        content: JSON.stringify(FIXTURE_OUTPUT),
      });
      onEvent?.({
        type: 'completed',
        result: FIXTURE_OUTPUT,
        usage,
        cost,
        durationMs: 1250,
        turns: 1,
      });

      // The real SDK returns its assembled `result` text. The
      // outputValidator middleware JSON.parses it against the pact's
      // schema and surfaces the parsed value as `output`.
      return {
        output: JSON.stringify(FIXTURE_OUTPUT) as unknown as T,
        sessionId,
        completed: true,
        stopReason: 'complete',
        usage: {
          inputTokens: 200,
          outputTokens: 80,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 280,
        },
        cost: {
          totalUsd: 0.0042,
          perModel: {
            'claude-sonnet-4-6': {
              tokens: {
                inputTokens: 200,
                outputTokens: 80,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                totalTokens: 280,
              },
              costUsd: 0.0042,
            },
          },
        },
        durationMs: 1250,
        turns: 1,
      };
    },
  };
  return { provider, calls };
}

// ── Tests ────────────────────────────────────────────────────────

describe('sample-cortex-incident-triage-agent-sdk — end to end (AC-4.1, AC-4.2, AC-4.3)', () => {
  it('AC-4.1 — runTriageAgent returns the fixture TriageOutput', async () => {
    const { ctx, spies } = createMockCtx({ appId: 'incident-triage-sdk-app' });
    const slackMessages: string[] = [];
    const stub = makeStubSdkProvider();

    const result = await runTriageAgent(
      ctx,
      (text) => {
        slackMessages.push(text);
      },
      { providerOverride: stub.provider },
    );

    // Result envelope is correctly assembled by createMethodAgent.
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.stopReason, 'complete');

    // Output passes the schema validator and matches the fixture.
    assert.ok(result.output, 'expected a parsed TriageOutput');
    assert.strictEqual(result.output?.severity, 'warning');
    assert.strictEqual(result.output?.summary, FIXTURE_OUTPUT.summary);
    assert.strictEqual(result.output?.nextAction, FIXTURE_OUTPUT.nextAction);

    // Stub provider was invoked exactly once (oneshot pact).
    assert.strictEqual(stub.calls.length, 1, 'provider.invoke called exactly once');
    assert.strictEqual(stub.calls[0].request.prompt, ctx.input?.text);

    // Spy on the prompt routed through — AC-4.1 boundary check.
    assert.ok(spies.auditEvent.callCount() >= 1, 'audit middleware fired');
  });

  it('AC-4.2 — ctx.audit.event called for the agent lifecycle (degraded-mode equivalent of reserve/settle)', async () => {
    // In full mode (Cortex O1 present), the transport would invoke
    // ctx.llm.reserve once and ctx.llm.settle once per HTTP turn. In
    // degraded mode (current) the transport instead emits a single
    // ctx.audit.event per turn. With the stub provider the transport
    // path is bypassed entirely, but the cortexAuditMiddleware path
    // still mirrors every AgentEvent into ctx.audit.event — which is
    // the load-bearing wire the rest of the C-2/C-4 contract depends
    // on. Asserting that count is >= 1 satisfies AC-4.2's intent for
    // degraded mode (PRD §degraded-mode footnote).
    const { ctx, spies } = createMockCtx();
    const stub = makeStubSdkProvider();

    const result = await runTriageAgent(
      ctx,
      undefined,
      { providerOverride: stub.provider },
    );

    assert.strictEqual(result.ok, true);

    // Degraded-mode reserve/settle equivalent: at least one audit event
    // landed for the invocation. The cortex audit middleware suppresses
    // the chatty `text` / `thinking` events by default, but `started`,
    // `turn_complete`, and `completed` always fire, so we expect ≥3
    // when the agent runs to completion.
    const auditCalls = spies.auditEvent.callCount();
    assert.ok(
      auditCalls >= 3,
      `expected ≥3 audit events for a successful invocation, got ${auditCalls}`,
    );

    // The MethodAgentResult.auditEventCount annotation echoes the same
    // count back to the tenant (PRD-058 §4 criterion 3).
    assert.ok(result.auditEventCount > 0, 'auditEventCount echoed on result');

    // Spy on llm.complete: it should NEVER be called by the SDK
    // provider path. The SDK routes via the cortex transport, not
    // ctx.llm.complete. With the stubbed provider (which also doesn't
    // touch ctx.llm), the call count must be exactly 0.
    assert.strictEqual(
      spies.llmComplete.callCount(),
      0,
      'SDK provider path must not invoke ctx.llm.complete',
    );
  });

  it('AC-4.3 — wiring smoke: real cortex transport composes without throwing (no invoke)', async () => {
    // Build the agent with the real claudeAgentSdkProvider +
    // cortexAnthropicTransport — i.e. NO providerOverride. We don't
    // call invoke() (would spawn the `claude` CLI subprocess), but
    // construction must succeed, proving:
    //   - adaptCtx() projects the nested CortexCtx into the flat shape
    //     the transport expects without TS errors
    //   - claudeAgentSdkProvider accepts the cortexAnthropicTransport
    //     output (transport contract holds at runtime)
    //   - createMethodAgent accepts the composed provider
    const { ctx } = createMockCtx();
    const agent = createIncidentTriageAgent(ctx);
    assert.ok(agent, 'composed agent constructed');
    assert.strictEqual(typeof agent.invoke, 'function');
    await agent.dispose();
  });

  it('emits Slack-via-onEvent when the SDK provider streams a completed event', async () => {
    // The SDK provider's stub returns a completed AgentResult; the
    // pacta engine synthesizes a `completed` AgentEvent for it, which
    // runTriageAgent's onEvent shim forwards to slackNotify.
    const { ctx } = createMockCtx();
    const slackMessages: string[] = [];
    const stub = makeStubSdkProvider();

    await runTriageAgent(
      ctx,
      (text) => {
        slackMessages.push(text);
      },
      { providerOverride: stub.provider },
    );

    assert.ok(
      slackMessages.length >= 1,
      `expected ≥1 slack message (completed event), got ${slackMessages.length}`,
    );
    // The completed message includes the turn count.
    const completed = slackMessages.find((m) => m.startsWith('triage completed'));
    assert.ok(completed, `expected a "triage completed" slack message; got ${slackMessages.join(' | ')}`);
  });
});
