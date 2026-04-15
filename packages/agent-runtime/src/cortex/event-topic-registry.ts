/**
 * METHOD_TOPIC_REGISTRY — the single source of truth for the 21 Cortex
 * `ctx.events` topics the method runtime emits (PRD-063, S6 §3.3).
 *
 * Invariants:
 *   - Frozen count: 21 distinct topics. Adding/removing is a surface change.
 *   - Every `sourceEventTypes[]` member MUST have a matching entry in
 *     `METHOD_RUNTIME_EVENT_AUDIT_MAP` (G-AUDIT-SUPERSET gate, §5 S3).
 *   - Topic names follow S6 §3.4 convention: `method.<runtime-domain>.<verb>
 *     [.<qualifier>]` with underscored qualifiers.
 *
 * Classification levels (from `EventFieldClassification`):
 *   0 — public          (ids, severities)
 *   1 — internal        (workdir, usernames, error messages, billing ids)
 *   2 — confidential    (approval artifacts, tool inputs, method outputs)
 *   3 — secret          (reserved — unused by v1)
 *
 * Hand-written in v1. S6 O4 (schema codegen from RuntimeEvent types) is
 * explicitly deferred — drift is guarded by the compile-time gate test in
 * `__tests__/gates.test.ts`.
 */

import type {
  MethodTopicDescriptor,
  RuntimeEventAuditMapping,
} from './ctx-types.js';

// ── Topic registry (21 entries) ─────────────────────────────────

export const METHOD_TOPIC_REGISTRY: readonly MethodTopicDescriptor[] = [
  // ── Session lifecycle (5) ───────────────────────────────────
  {
    topic: 'method.session.started',
    sourceEventTypes: ['session.spawned'],
    schemaVersion: 1,
    classifications: [{ field: '$.workdir', level: 1 }],
    description: 'A method runtime session has started — other apps may react (e.g. register observers).',
    schemaRef: './schemas/method/session-started.schema.json',
  },
  {
    topic: 'method.session.prompt.completed',
    sourceEventTypes: ['session.prompt.completed'],
    schemaVersion: 1,
    classifications: [{ field: '$.promptPreview', level: 1 }],
    description: 'A session prompt-response cycle completed. Reactive hook for follow-on flows.',
    schemaRef: './schemas/method/session-prompt-completed.schema.json',
  },
  {
    topic: 'method.session.ended',
    // session.killed and session.dead both project to this topic with a
    // `reason` discriminator set by the mapper.
    sourceEventTypes: ['session.killed', 'session.dead'],
    schemaVersion: 1,
    classifications: [],
    description: 'A session reached a terminal lifecycle state (killed or crashed).',
    schemaRef: './schemas/method/session-ended.schema.json',
  },
  {
    topic: 'method.session.stale',
    sourceEventTypes: ['session.stale'],
    schemaVersion: 1,
    classifications: [],
    description: 'A session has been idle past the stale threshold — supervisory signal.',
    schemaRef: './schemas/method/session-stale.schema.json',
  },
  {
    topic: 'method.session.error',
    sourceEventTypes: ['session.error'],
    schemaVersion: 1,
    classifications: [{ field: '$.error.message', level: 1 }],
    description: 'A session encountered an error — other apps may escalate.',
    schemaRef: './schemas/method/session-error.schema.json',
  },

  // ── Strategy lifecycle + gates (7) ──────────────────────────
  {
    topic: 'method.strategy.started',
    sourceEventTypes: ['strategy.started'],
    schemaVersion: 1,
    classifications: [{ field: '$.strategyId', level: 0 }],
    description: 'A strategy DAG began executing — orchestrator apps may react.',
    schemaRef: './schemas/method/strategy-started.schema.json',
  },
  {
    topic: 'method.strategy.completed',
    sourceEventTypes: ['strategy.completed'],
    schemaVersion: 1,
    classifications: [{ field: '$.result.summary', level: 1 }],
    description: 'A strategy finished successfully. Terminal milestone.',
    schemaRef: './schemas/method/strategy-completed.schema.json',
  },
  {
    topic: 'method.strategy.failed',
    sourceEventTypes: ['strategy.failed'],
    schemaVersion: 1,
    classifications: [{ field: '$.error.message', level: 1 }],
    description: 'A strategy failed terminally.',
    schemaRef: './schemas/method/strategy-failed.schema.json',
  },
  {
    // Both gate_passed and gate_failed project to a single topic with a
    // `result` discriminator (S6 §3.3 verbatim).
    topic: 'method.strategy.gate',
    sourceEventTypes: ['strategy.gate_passed', 'strategy.gate_failed'],
    schemaVersion: 1,
    classifications: [{ field: '$.reason', level: 1 }],
    description: 'A strategy gate resolved (result="passed" or "failed") — observable checkpoint.',
    schemaRef: './schemas/method/strategy-gate.schema.json',
  },
  {
    topic: 'method.strategy.gate.awaiting_approval',
    sourceEventTypes: ['strategy.gate.awaiting_approval'],
    schemaVersion: 1,
    classifications: [{ field: '$.artifact_markdown', level: 2 }],
    description: 'A human-approval gate fired — triggers the human-approval subscriber app.',
    schemaRef: './schemas/method/strategy-gate-awaiting-approval.schema.json',
  },
  {
    topic: 'method.strategy.gate.approval_response',
    sourceEventTypes: ['strategy.gate.approval_response'],
    schemaVersion: 1,
    classifications: [{ field: '$.feedback', level: 1 }],
    description: 'A human-approval decision was recorded — closes the awaiting_approval loop.',
    schemaRef: './schemas/method/strategy-gate-approval-response.schema.json',
  },

  // ── Trigger + methodology (3) ───────────────────────────────
  {
    topic: 'method.trigger.fired',
    sourceEventTypes: ['trigger.fired'],
    schemaVersion: 1,
    classifications: [{ field: '$.payload.*', level: 1 }],
    description: 'A trigger fired — enables app-to-app event chaining.',
    schemaRef: './schemas/method/trigger-fired.schema.json',
  },
  {
    topic: 'method.methodology.step_started',
    sourceEventTypes: ['methodology.step_started'],
    schemaVersion: 1,
    classifications: [],
    description: 'A methodology step started — long-running observable.',
    schemaRef: './schemas/method/methodology-step-started.schema.json',
  },
  {
    topic: 'method.methodology.step_completed',
    sourceEventTypes: ['methodology.step_completed'],
    schemaVersion: 1,
    classifications: [{ field: '$.output', level: 2 }],
    description: 'A methodology step completed — reactive checkpoint.',
    schemaRef: './schemas/method/methodology-step-completed.schema.json',
  },

  // ── Agent + tools + budget (5) ──────────────────────────────
  {
    topic: 'method.tool.used',
    sourceEventTypes: ['agent.tool_use'],
    schemaVersion: 1,
    classifications: [{ field: '$.input.*', level: 2 }],
    description: 'An agent invoked a tool — reactive surface for tool-observability apps.',
    schemaRef: './schemas/method/tool-used.schema.json',
  },
  {
    topic: 'method.agent.error',
    sourceEventTypes: ['agent.error'],
    schemaVersion: 1,
    classifications: [{ field: '$.message', level: 1 }],
    description: 'An agent invocation failed — reactive error routing.',
    schemaRef: './schemas/method/agent-error.schema.json',
  },
  {
    topic: 'method.agent.completed',
    sourceEventTypes: ['agent.completed'],
    schemaVersion: 1,
    classifications: [{ field: '$.usage.totalCostUsd', level: 1 }],
    description: 'A pacta agent invocation terminated — distinct from session.ended.',
    schemaRef: './schemas/method/agent-completed.schema.json',
  },
  {
    topic: 'method.budget.warning',
    sourceEventTypes: ['agent.budget_warning'],
    schemaVersion: 1,
    classifications: [
      { field: '$.resource', level: 0 },
      { field: '$.percentUsed', level: 0 },
    ],
    description: 'Budget threshold crossed (80%/95%) — ops apps act on these.',
    schemaRef: './schemas/method/budget-warning.schema.json',
  },
  {
    topic: 'method.budget.exhausted',
    sourceEventTypes: ['agent.budget_exhausted'],
    schemaVersion: 1,
    classifications: [],
    description: 'Budget exhausted — terminal budget event.',
    schemaRef: './schemas/method/budget-exhausted.schema.json',
  },

  // ── Cost + system health (6) ────────────────────────────────
  {
    topic: 'method.cost.rate_limited',
    sourceEventTypes: ['cost.rate_limited'],
    schemaVersion: 1,
    // O5 (S6 §8.5): accountId defaults to L1 pending Cortex security review.
    classifications: [{ field: '$.accountId', level: 1 }],
    description: 'A provider returned a rate-limit/429 — saturation signal for ops.',
    schemaRef: './schemas/method/cost-rate-limited.schema.json',
  },
  {
    topic: 'method.cost.account_saturated',
    sourceEventTypes: ['cost.account_saturated'],
    schemaVersion: 1,
    classifications: [{ field: '$.accountId', level: 1 }],
    description: 'Per-account saturation detected — cross-app billing relevance.',
    schemaRef: './schemas/method/cost-account-saturated.schema.json',
  },
  {
    topic: 'method.cost.integrity_violation',
    sourceEventTypes: ['cost.integrity_violation'],
    schemaVersion: 1,
    classifications: [{ field: '$.detail', level: 2 }],
    description: 'Cost-integrity violation — security-sensitive signal.',
    schemaRef: './schemas/method/cost-integrity-violation.schema.json',
  },
  {
    topic: 'method.system.bridge_state',
    sourceEventTypes: [
      'system.bridge_starting',
      'system.bridge_ready',
      'system.bridge_stopping',
      'system.bridge_crash',
    ],
    schemaVersion: 1,
    classifications: [{ field: '$.crashDetail', level: 2 }],
    description: 'Bridge process lifecycle state change — cross-app awareness of host health.',
    schemaRef: './schemas/method/system-bridge-state.schema.json',
  },
  {
    topic: 'method.system.recovery',
    sourceEventTypes: ['system.recovery_started', 'system.recovery_completed'],
    schemaVersion: 1,
    classifications: [],
    description: 'Bridge recovery sequence started or completed — observable startup milestone.',
    schemaRef: './schemas/method/system-recovery.schema.json',
  },
] as const;

// Assert freeze count at type level. Any edit here breaks CI (see gates.test.ts).
export const METHOD_TOPIC_COUNT = METHOD_TOPIC_REGISTRY.length;

/**
 * Reverse lookup: `RuntimeEvent.type` → topic descriptor.
 * Built once at module load. `undefined` for audit-only types.
 */
export const RUNTIME_EVENT_TYPE_TO_TOPIC: ReadonlyMap<string, MethodTopicDescriptor> =
  (() => {
    const m = new Map<string, MethodTopicDescriptor>();
    for (const desc of METHOD_TOPIC_REGISTRY) {
      for (const sourceType of desc.sourceEventTypes) {
        if (m.has(sourceType)) {
          throw new Error(
            `METHOD_TOPIC_REGISTRY: duplicate sourceEventType '${sourceType}' ` +
              `mapped to both '${m.get(sourceType)?.topic}' and '${desc.topic}'`,
          );
        }
        m.set(sourceType, desc);
      }
    }
    return m;
  })();

// ── Audit superset mapping (G-AUDIT-SUPERSET) ────────────────────

/**
 * Every `RuntimeEvent.type` that projects to a Cortex events topic MUST also
 * be audit-covered (S3 §3). The mapping here feeds:
 *   1. The audit dual-write path (permanent-publish-failure fallback).
 *   2. The `G-AUDIT-SUPERSET` compile-time gate test.
 *
 * Keys are `RuntimeEvent.type`; values are the Cortex `ctx.audit.event`
 * eventType the runtime event projects into on the audit path.
 *
 * Rationale strings are short — they surface in drift-detection reports.
 */
export const METHOD_RUNTIME_EVENT_AUDIT_MAP: ReadonlyMap<string, RuntimeEventAuditMapping> =
  new Map<string, RuntimeEventAuditMapping>([
    // Session lifecycle
    ['session.spawned', { auditEventType: 'method.session.spawned' }],
    ['session.prompt.completed', { auditEventType: 'method.session.prompt.completed' }],
    ['session.killed', { auditEventType: 'method.session.killed' }],
    ['session.dead', { auditEventType: 'method.session.dead' }],
    ['session.stale', { auditEventType: 'method.session.stale' }],
    ['session.error', { auditEventType: 'method.session.error' }],

    // Strategy lifecycle + gates
    ['strategy.started', { auditEventType: 'method.strategy.started' }],
    ['strategy.completed', { auditEventType: 'method.strategy.completed' }],
    ['strategy.failed', { auditEventType: 'method.strategy.failed' }],
    ['strategy.gate_passed', { auditEventType: 'method.strategy.gate_passed' }],
    ['strategy.gate_failed', { auditEventType: 'method.strategy.gate_failed' }],
    [
      'strategy.gate.awaiting_approval',
      { auditEventType: 'method.strategy.gate.awaiting_approval' },
    ],
    [
      'strategy.gate.approval_response',
      { auditEventType: 'method.strategy.gate.approval_response' },
    ],

    // Trigger + methodology
    ['trigger.fired', { auditEventType: 'method.trigger.fired' }],
    ['methodology.step_started', { auditEventType: 'method.methodology.step_started' }],
    ['methodology.step_completed', { auditEventType: 'method.methodology.step_completed' }],

    // Agent + tools
    ['agent.tool_use', { auditEventType: 'method.agent.tool_use' }],
    ['agent.error', { auditEventType: 'method.agent.error' }],
    ['agent.completed', { auditEventType: 'method.agent.completed' }],
    ['agent.budget_warning', { auditEventType: 'method.agent.budget_warning' }],
    ['agent.budget_exhausted', { auditEventType: 'method.agent.budget_exhausted' }],

    // Cost
    ['cost.rate_limited', { auditEventType: 'method.cost.rate_limited' }],
    ['cost.account_saturated', { auditEventType: 'method.cost.account_saturated' }],
    ['cost.integrity_violation', { auditEventType: 'method.cost.integrity_violation' }],

    // System health
    ['system.bridge_starting', { auditEventType: 'method.system.bridge_starting' }],
    ['system.bridge_ready', { auditEventType: 'method.system.bridge_ready' }],
    ['system.bridge_stopping', { auditEventType: 'method.system.bridge_stopping' }],
    ['system.bridge_crash', { auditEventType: 'method.system.bridge_crash' }],
    ['system.recovery_started', { auditEventType: 'method.system.recovery_started' }],
    ['system.recovery_completed', { auditEventType: 'method.system.recovery_completed' }],
  ]);

/**
 * Verify at module load that METHOD_TOPIC_REGISTRY and
 * METHOD_RUNTIME_EVENT_AUDIT_MAP stay aligned — every events-path
 * RuntimeEvent type has an audit-map entry. This runs in every import
 * (not only tests); a drift regression throws before any code that depends
 * on the registry is reached.
 */
(() => {
  const missing: string[] = [];
  for (const desc of METHOD_TOPIC_REGISTRY) {
    for (const sourceType of desc.sourceEventTypes) {
      if (!METHOD_RUNTIME_EVENT_AUDIT_MAP.has(sourceType)) {
        missing.push(sourceType);
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `G-AUDIT-SUPERSET violation at module load: RuntimeEvent types ` +
        `{${missing.join(', ')}} are mapped to ctx.events topics but are ` +
        `missing from METHOD_RUNTIME_EVENT_AUDIT_MAP. See PRD-063 §S5.`,
    );
  }
})();
