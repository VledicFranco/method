/**
 * `s3ServiceAdaptersPlugin` — asserts CortexServiceAdapters (S3) invariants:
 * every LLM call routes through `ctx.llm` (not a bypassing provider); token
 * exchange is invoked iff the fixture expects delegation; audit emitter
 * records at least one `method.agent.*` kind (the adapter wiring is live).
 */

import type { ConformancePlugin, PluginRunInput } from '../plugin.js';
import type { CheckVerdict } from '../compliance-report.js';
import { pass, fail, skip, auditKinds } from '../assertions-cortex.js';

export const s3ServiceAdaptersPlugin: ConformancePlugin = {
  id: 's3-service-adapters',
  version: '1.0.0',
  description:
    'CortexServiceAdapters (S3) — asserts every LLM call goes through ctx.llm, auth is invoked iff delegation expected, audit events bear the method.agent.* prefix.',
  requiresFixtures: '*',
  required: true,

  async run(input: PluginRunInput): Promise<ReadonlyArray<CheckVerdict>> {
    const { fixture, recorder } = input;
    const fixtureId = fixture.id;
    const verdicts: CheckVerdict[] = [];

    // ── A1 — LLM path through ctx.llm ─────────────────────────
    const a1 = {
      id: 'S3-A1-llm-routed-via-ctx',
      description: 'At least one ctx.llm.complete call was recorded when pact requires LLM.',
      fixtureId,
    };
    const pactRequiresLlm = fixture.scriptedLlm.length > 0;
    if (!pactRequiresLlm) {
      verdicts.push(skip(a1, 'pact does not exercise ctx.llm'));
    } else {
      const completeCalls = recorder
        .where('llm')
        .filter((c) => c.method === 'complete');
      if (completeCalls.length === 0) {
        verdicts.push(
          fail(
            a1,
            'no ctx.llm.complete calls recorded — app may be bypassing the Cortex LLM adapter',
          ),
        );
      } else {
        verdicts.push(pass(a1));
      }
    }

    // ── A2 — token exchange presence matches expectation ──────
    const a2 = {
      id: 'S3-A2-token-exchange-wired',
      description:
        'ctx.auth.exchangeForAgent is invoked iff fixture.expectsDelegation is true.',
      fixtureId,
    };
    const authExchanges = recorder
      .where('auth')
      .filter((c) => c.method === 'exchangeForAgent');
    const expectsDelegation = fixture.minimumExpectations.expectsDelegation;
    if (expectsDelegation && authExchanges.length === 0) {
      verdicts.push(fail(a2, 'fixture expects delegation but no exchangeForAgent call recorded'));
    } else if (!expectsDelegation && authExchanges.length > 0) {
      verdicts.push(
        fail(
          a2,
          `fixture does not expect delegation yet ${authExchanges.length} exchangeForAgent calls recorded`,
        ),
      );
    } else {
      verdicts.push(pass(a2));
    }

    // ── A3 — audit emitter live with method.agent.* kinds ─────
    const a3 = {
      id: 'S3-A3-audit-adapter-live',
      description: 'At least one audit event has a method.agent.* kind.',
      fixtureId,
    };
    const kinds = auditKinds(recorder);
    const methodAgentKinds = kinds.filter((k) => k.startsWith('method.agent.'));
    if (methodAgentKinds.length === 0) {
      verdicts.push(
        fail(
          a3,
          `no method.agent.* audit events recorded; kinds observed: [${kinds.join(', ')}]`,
        ),
      );
    } else {
      verdicts.push(pass(a3));
    }

    return verdicts;
  },
};
