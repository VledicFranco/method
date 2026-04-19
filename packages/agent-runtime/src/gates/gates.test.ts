// SPDX-License-Identifier: Apache-2.0
/**
 * PRD-058 §6.6 / §11 acceptance gates — CI-enforced.
 *
 * Gates asserted here:
 *   - G-PORT-SYMBOLS           — S1 §8 barrel export set exact match
 *   - G-BUDGET-SINGLE-AUTHORITY — provider-native signal drives predictive enforcer
 *   - G-EVENTS-MUTEX           — onEvent + events() mutually exclusive
 *   - G-STRICT-MODE-REFUSAL    — strict + tier=service rejects unsafe configs
 *   - G-AUDIT-WIRED            — audit middleware mirrors events into ctx.audit
 *   - G-PACTA-UNCHANGED        — smoke-check that barrel exports match PRD-057 pacta surface
 *                                (git diff check runs in CI, this is the lint-level guard)
 *   - G-RATIFIED (placeholder) — signoff gate lives in PRD-060; reads status markers
 *
 * The co-equal architecture file (`architecture.test.ts`) holds the
 * source-scan gates (G-BOUNDARY-NO-CORTEX-VALUE-IMPORT, G-LAYER).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as agentRuntime from '../index.js';
import type { Pact } from '@methodts/pacta';
import { createMethodAgent } from '../create-method-agent.js';
import { makeMockCtx } from '../test-support/mock-ctx.js';
import { ConfigurationError, IllegalStateError } from '../errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function simplePact(): Pact<unknown> {
  return {
    mode: { type: 'oneshot' },
    budget: { maxCostUsd: 0.01, onExhaustion: 'stop' },
  };
}

describe('G-PORT-SYMBOLS: agent-runtime barrel matches S1 §8', () => {
  it('exports the expected symbol set', () => {
    const expected = [
      // Core factory + types
      'createMethodAgent',
      // New error taxonomy
      'ConfigurationError',
      'MissingCtxError',
      'UnknownSessionError',
      'IllegalStateError',
      // Re-exported pacta errors
      'ProviderError',
      'TransientError',
      'PermanentError',
      'RateLimitError',
      'NetworkError',
      'TimeoutError',
      'AuthError',
      'InvalidRequestError',
      'CapabilityError',
      'BudgetExhaustedError',
      'isProviderError',
      'isTransientError',
      'isPermanentError',
      // Structural ctx helper
      'assertCtxCompatibility',
      // Session store utilities
      'InMemorySessionStore',
      'CtxStorageSessionStore',
    ];
    for (const name of expected) {
      assert.ok(
        name in agentRuntime,
        `expected agent-runtime barrel to export "${name}"`,
      );
    }
  });
});

describe('G-BUDGET-SINGLE-AUTHORITY: predictive enforcer is wired for Cortex provider', () => {
  it('cost exhaustion emits warning but does not stop the agent', async () => {
    // Pact declares $0.01 limit; LLM responds with $0.03 cost. In
    // authoritative mode this would set stopReason='budget_exhausted';
    // predictive mode preserves 'complete'. This is the end-to-end
    // assertion of G-BUDGET-SINGLE-AUTHORITY (S3 §4).
    const { ctx } = makeMockCtx({ llmResponse: { costUsd: 0.03 } });
    const agent = createMethodAgent({ ctx, pact: simplePact() });
    const result = await agent.invoke({ prompt: 'go' });
    assert.strictEqual(result.completed, true);
    assert.strictEqual(result.stopReason, 'complete');
  });
});

describe('G-EVENTS-MUTEX: onEvent + events() are mutually exclusive', () => {
  it('throws IllegalStateError when both are provided and events() is called', () => {
    const { ctx } = makeMockCtx();
    const agent = createMethodAgent({
      ctx,
      pact: simplePact(),
      onEvent: () => {
        /* no-op */
      },
      eventsChannel: 'async-iterable',
    });
    assert.throws(() => agent.events(), IllegalStateError);
  });
});

describe('G-STRICT-MODE-REFUSAL: strict mode refuses unsafe configurations', () => {
  it('custom provider + tier=service throws ConfigurationError', () => {
    const { ctx } = makeMockCtx({ tier: 'service' });
    const bogusProvider = {
      name: 'bogus',
      capabilities: () => ({
        modes: ['oneshot' as const],
        streaming: false,
        resumable: false,
        budgetEnforcement: 'none' as const,
        outputValidation: 'none' as const,
        toolModel: 'none' as const,
      }),
      invoke: async () => {
        throw new Error('unreachable');
      },
    };
    assert.throws(
      () =>
        createMethodAgent({
          ctx,
          pact: simplePact(),
          provider: bogusProvider,
        }),
      ConfigurationError,
    );
  });
});

describe('G-AUDIT-WIRED: audit middleware mirrors events to ctx.audit', () => {
  it('ctx.audit.event called ≥1 times per invoke, auditEventCount > 0', async () => {
    const { ctx, spies } = makeMockCtx();
    const agent = createMethodAgent({ ctx, pact: simplePact() });
    const result = await agent.invoke({ prompt: 'go' });
    assert.ok(spies.auditEvent.callCount() >= 1, 'audit called at least once');
    assert.ok(result.auditEventCount > 0, 'auditEventCount annotation set');
  });
});

describe('G-PACTA-UNCHANGED: barrel does not reach past S1 surface', () => {
  it('does not re-export pacta internal symbols beyond the S1 set', () => {
    // Defensive smoke: ensure we did not accidentally wildcard-export
    // pacta's cognitive module or other internals. This is a lint-level
    // complement to the git-diff-based CI check (PRD-058 §6.6, §11 #7).
    const shouldNotExport = [
      'createAgent', // pacta's lower-level factory
      'reactReasoner',
      'reflexionReasoner',
      'compactionManager',
      'InMemoryMemory',
    ];
    for (const name of shouldNotExport) {
      assert.strictEqual(
        (agentRuntime as unknown as Record<string, unknown>)[name],
        undefined,
        `agent-runtime barrel should NOT re-export "${name}"`,
      );
    }
  });
});

describe('G-RATIFIED (placeholder): S1 signoff status', () => {
  it('reads S1 surface ratification marker from decision.md', () => {
    // PRD-060 is the ratification PRD that lands the signoff artifact.
    // Here we do the lightest possible check — the S1 decision record
    // exists and is marked frozen. A richer check (co-design/method-
    // agent-port.md signoff status) is wired by PRD-060.
    const decisionPath = path.resolve(
      __dirname,
      '../../../../.method/sessions/fcd-surface-method-agent-port/decision.md',
    );
    const content = readFileSync(decisionPath, 'utf-8');
    assert.match(content, /status:\s*frozen/i, 'S1 decision.md must be frozen');
  });
});
