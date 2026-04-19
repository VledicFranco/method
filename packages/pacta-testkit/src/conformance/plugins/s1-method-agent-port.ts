// SPDX-License-Identifier: Apache-2.0
/**
 * `s1MethodAgentPortPlugin` — checks C1–C6 from S8 §6 / PRD-065 §10.1.
 *
 * C1 — port entry via `createMethodAgent` (detected via MethodAgentResult
 *      annotations `appId` + `auditEventCount`).
 * C2 — budget handlers registered when pact declares `requires.llm`-style
 *      need. Detected via `llm.registerBudgetHandlers` call OR the
 *      `handlersRegistered` flag stamped by the mock.
 * C3 — audit minimum set (subset of `requiredAuditKinds`).
 * C4 — token exchange depth exactly 2 when `expectsDelegation`.
 * C5 — every requested tool is in `scope.allowedTools` when
 *      `expectsScopeCheck`.
 * C6 — resume roundtrip when `expectsResume`.
 */

import type { ConformancePlugin, PluginRunInput } from '../plugin.js';
import type { CheckVerdict } from '../compliance-report.js';
import {
  pass,
  fail,
  skip,
  maxDelegationDepth,
  auditKinds,
  missingAuditKinds,
  toolsRequestedAcrossCalls,
  budgetHandlersRegistered,
} from '../assertions-cortex.js';

export const s1MethodAgentPortPlugin: ConformancePlugin = {
  id: 's1-method-agent-port',
  version: '1.0.0',
  description:
    'MethodAgentPort (S1) — checks C1–C6: port entry, budget handlers, audit minimum, delegation depth, scope respect, resume roundtrip.',
  requiresFixtures: '*',
  required: true,

  async run(input: PluginRunInput): Promise<ReadonlyArray<CheckVerdict>> {
    const { fixture, recorder, agentResult, invocationError } = input;
    const fixtureId = fixture.id;
    const verdicts: CheckVerdict[] = [];

    // ── C1 — invokes via createMethodAgent ────────────────────
    const c1 = {
      id: 'S1-C1-invokes-via-createMethodAgent',
      description:
        'App produced a MethodAgent handle (MethodAgentResult has appId + auditEventCount).',
      fixtureId,
    };
    if (invocationError && !agentResult) {
      verdicts.push(
        fail(c1, `app invocation threw before any MethodAgentResult: ${invocationError.message}`),
      );
    } else if (!agentResult) {
      verdicts.push(fail(c1, 'app returned no MethodAgentResult'));
    } else if (
      typeof agentResult.appId !== 'string' ||
      typeof agentResult.auditEventCount !== 'number'
    ) {
      verdicts.push(
        fail(
          c1,
          `MethodAgentResult missing Cortex annotations (appId=${typeof agentResult.appId}, auditEventCount=${typeof agentResult.auditEventCount})`,
        ),
      );
    } else {
      verdicts.push(pass(c1));
    }

    // ── C2 — budget handlers registered ───────────────────────
    const c2 = {
      id: 'S1-C2-budget-handlers-registered',
      description:
        'When the pact requires an LLM, the app registered budget handlers before completion calls.',
      fixtureId,
    };
    const pactRequiresLlm = fixture.scriptedLlm.length > 0;
    if (!pactRequiresLlm) {
      verdicts.push(skip(c2, 'fixture does not exercise ctx.llm'));
    } else {
      const handlersPresent = budgetHandlersRegistered(recorder);
      if (handlersPresent) {
        verdicts.push(pass(c2));
      } else {
        verdicts.push(
          fail(
            c2,
            'no llm.registerBudgetHandlers call recorded; pact requires LLM budget handlers',
          ),
        );
      }
    }

    // ── C3 — audit minimum set ────────────────────────────────
    const c3 = {
      id: 'S1-C3-audit-minimum-set',
      description: 'Required audit event kinds were emitted at least once each.',
      fixtureId,
    };
    const kinds = auditKinds(recorder);
    const required = fixture.minimumExpectations.requiredAuditKinds;
    const missing = missingAuditKinds(kinds, required);
    if (kinds.length < fixture.minimumExpectations.minAuditEvents) {
      verdicts.push(
        fail(
          c3,
          `only ${kinds.length} audit events; fixture requires at least ${fixture.minimumExpectations.minAuditEvents}`,
        ),
      );
    } else if (missing.length > 0) {
      verdicts.push(
        fail(
          c3,
          `missing required audit kinds: ${missing.join(', ')}; observed: ${kinds.join(', ')}`,
        ),
      );
    } else {
      verdicts.push(pass(c3));
    }

    // ── C4 — token exchange depth ≤ 2 ─────────────────────────
    const c4 = {
      id: 'S1-C4-token-exchange-depth',
      description: 'Max delegation depth is exactly 2 when expectsDelegation, ≤ 2 always.',
      fixtureId,
    };
    const depth = maxDelegationDepth(recorder);
    if (fixture.minimumExpectations.expectsDelegation) {
      if (depth === 2) {
        verdicts.push(pass(c4));
      } else {
        verdicts.push(
          fail(
            c4,
            `expected delegation depth 2; observed ${depth}. Violating fixture: ${fixture.id}.`,
          ),
        );
      }
    } else {
      if (depth <= 2) {
        if (depth === 0) {
          verdicts.push(skip(c4, 'fixture has expectsDelegation=false; no delegation observed'));
        } else {
          verdicts.push(pass(c4));
        }
      } else {
        verdicts.push(fail(c4, `delegation depth ${depth} exceeds cap of 2`));
      }
    }

    // ── C5 — scope respect ────────────────────────────────────
    const c5 = {
      id: 'S1-C5-scope-respect',
      description: 'All requested tools are within pact.scope.allowedTools.',
      fixtureId,
    };
    if (!fixture.minimumExpectations.expectsScopeCheck) {
      verdicts.push(skip(c5, 'fixture does not exercise scope enforcement'));
    } else {
      const allowed = fixture.pact.scope?.allowedTools ?? [];
      const allowedSet = new Set(allowed);
      const requested = toolsRequestedAcrossCalls(recorder);
      const violations = requested.filter((t) => !allowedSet.has(t));
      if (violations.length === 0) {
        verdicts.push(pass(c5));
      } else {
        verdicts.push(
          fail(
            c5,
            `tools out of scope: [${violations.join(', ')}]; allowed: [${allowed.join(', ')}]`,
          ),
        );
      }
    }

    // ── C6 — resume roundtrip ─────────────────────────────────
    const c6 = {
      id: 'S1-C6-resume-roundtrip',
      description: 'App suspends and re-enters via agent.resume with an equivalent terminal.',
      fixtureId,
    };
    if (!fixture.minimumExpectations.expectsResume) {
      verdicts.push(skip(c6, 'fixture not resumable'));
    } else {
      const kindsSet = new Set(kinds);
      const hasSuspend = kindsSet.has('method.agent.suspended');
      const hasResume = kindsSet.has('method.agent.resumed');
      const hasCompleted = kindsSet.has('method.agent.completed');
      if (hasSuspend && hasResume && hasCompleted) {
        verdicts.push(pass(c6));
      } else {
        verdicts.push(
          fail(
            c6,
            `resume roundtrip incomplete: suspended=${hasSuspend}, resumed=${hasResume}, completed=${hasCompleted}`,
          ),
        );
      }
    }

    return verdicts;
  },
};
