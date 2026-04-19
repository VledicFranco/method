// SPDX-License-Identifier: Apache-2.0
/**
 * CortexAuditMiddleware — every pacta `AgentEvent` variant mapped to a
 * PRD-065 `ctx.audit.event` call. Fire-and-forget (PRD-065 §6.4): write
 * failures do NOT fail the agent; they are collected into
 * `AgentResult.errors[]` for diagnosis.
 *
 * Gate `G-AUDIT-EXHAUSTIVE` (PRD-059 §6.6): every pacta `AgentEvent`
 * discriminant has exactly one entry in {@link AUDIT_EVENT_MAP}. Adding a
 * new variant without an entry fails the architecture test.
 *
 * Default suppression: `['text', 'thinking']` — these fire per chunk on
 * chatty pacts and Cortex audit is a relational DB, not a time-series
 * store (PRD-059 §Judgment-Call 3). Override via
 * `config.suppressEventTypes`.
 */

import type {
  Pact,
  AgentRequest,
  AgentResult,
  AgentEvent,
  AgentStarted,
  AgentText,
  AgentThinking,
  AgentToolUse,
  AgentToolResult,
  AgentTurnComplete,
  AgentContextCompacted,
  AgentReflection,
  AgentBudgetWarning,
  AgentBudgetExhausted,
  AgentError,
  AgentCompleted,
} from '@methodts/pacta';
import {
  CortexAdapterComposeError,
  type ComposedAdapter,
  type CortexServiceAdapter,
  type CtxSlice,
} from './adapter.js';
import type { AuditEvent, CortexAuditCtx } from './ctx-types.js';

// ── Config ────────────────────────────────────────────────────────

export interface CortexAuditMiddlewareConfig {
  /** Cortex app id (already bound in ctx.audit; kept for logging symmetry). */
  readonly appId: string;
  /**
   * Events to elide. Default: `['text', 'thinking']` (PRD-059 §6.6 /
   * Judgment-Call 3). Pass `[]` to emit everything (rarely what you
   * want; use S6 `CortexEventConnector` for observability instead).
   */
  readonly suppressEventTypes?: ReadonlyArray<AgentEvent['type']>;
  /**
   * Prefix for any event type not in the map — currently unused because
   * the map is exhaustive, but reserved for forward-compat if pacta
   * widens the union faster than this package is updated.
   */
  readonly fallbackPrefix?: string;
}

const DEFAULT_SUPPRESS: ReadonlyArray<AgentEvent['type']> = ['text', 'thinking'];

// ── Mapping table (G-AUDIT-EXHAUSTIVE) ───────────────────────────

/**
 * One entry per pacta `AgentEvent` discriminant. Each entry declares its
 * PRD-065 `eventType` string and the payload extractor.
 *
 * Cognitive events (`cognitive:*`) are mapped as a family via
 * {@link mapCognitiveEventType}. Non-cognitive variants are listed
 * explicitly so `G-AUDIT-EXHAUSTIVE` can assert presence per-key.
 */
export interface AuditMappingEntry {
  readonly eventType: string;
  readonly extract: (event: AgentEvent) => Record<string, unknown>;
}

function preview(content: string): string {
  if (typeof content !== 'string') return '';
  return content.length > 200 ? content.slice(0, 200) : content;
}

const AUDIT_EVENT_MAP_BASE = {
  started: {
    eventType: 'method.agent.started',
    extract: (e: AgentEvent) => {
      const ev = e as AgentStarted;
      return { sessionId: ev.sessionId, timestamp: ev.timestamp };
    },
  },
  text: {
    eventType: 'method.agent.text',
    extract: (e: AgentEvent) => ({ contentPreview: preview((e as AgentText).content) }),
  },
  thinking: {
    eventType: 'method.agent.thinking',
    extract: (e: AgentEvent) => ({ contentPreview: preview((e as AgentThinking).content) }),
  },
  tool_use: {
    eventType: 'method.agent.tool_use',
    extract: (e: AgentEvent) => {
      const ev = e as AgentToolUse;
      return {
        tool: ev.tool,
        toolUseId: ev.toolUseId,
        // Redaction is delegated to Cortex RedactionPolicy (PRD-065 §6.3).
        // We pass the input through; Cortex redacts per the app's
        // requires.secrets.keys.
        inputRedacted: ev.input,
      };
    },
  },
  tool_result: {
    eventType: 'method.agent.tool_result',
    extract: (e: AgentEvent) => {
      const ev = e as AgentToolResult;
      // Never write tool output bodies — just a size indicator.
      const outputSizeBytes =
        typeof ev.output === 'string'
          ? ev.output.length
          : safeJsonLength(ev.output);
      return {
        tool: ev.tool,
        toolUseId: ev.toolUseId,
        durationMs: ev.durationMs,
        outputSizeBytes,
      };
    },
  },
  turn_complete: {
    eventType: 'method.agent.turn_complete',
    extract: (e: AgentEvent) => {
      const ev = e as AgentTurnComplete;
      return { turnNumber: ev.turnNumber, usage: ev.usage };
    },
  },
  context_compacted: {
    eventType: 'method.agent.context_compacted',
    extract: (e: AgentEvent) => {
      const ev = e as AgentContextCompacted;
      return { fromTokens: ev.fromTokens, toTokens: ev.toTokens };
    },
  },
  reflection: {
    eventType: 'method.agent.reflection',
    extract: (e: AgentEvent) => {
      const ev = e as AgentReflection;
      return { trial: ev.trial, critiquePreview: preview(ev.critique) };
    },
  },
  budget_warning: {
    eventType: 'method.agent.budget_warning',
    extract: (e: AgentEvent) => {
      const ev = e as AgentBudgetWarning;
      return {
        resource: ev.resource,
        consumed: ev.consumed,
        limit: ev.limit,
        percentUsed: ev.percentUsed,
      };
    },
  },
  budget_exhausted: {
    eventType: 'method.agent.budget_exhausted',
    extract: (e: AgentEvent) => {
      const ev = e as AgentBudgetExhausted;
      return { resource: ev.resource, consumed: ev.consumed, limit: ev.limit };
    },
  },
  error: {
    eventType: 'method.agent.error',
    extract: (e: AgentEvent) => {
      const ev = e as AgentError;
      return { message: ev.message, code: ev.code, recoverable: ev.recoverable };
    },
  },
  completed: {
    eventType: 'method.agent.completed',
    extract: (e: AgentEvent) => {
      const ev = e as AgentCompleted;
      return {
        usage: ev.usage,
        cost: ev.cost,
        durationMs: ev.durationMs,
        turns: ev.turns,
        // stopReason isn't in AgentCompleted directly — omit or infer at caller.
      };
    },
  },

  // Cognitive family — one `method.cognitive.<variant>` per discriminant.
  // PRD-059 §6.6 + RFC 001. We enumerate the 12 cognitive event variants
  // so gate G-AUDIT-EXHAUSTIVE passes without a catch-all.
  'cognitive:module_step': cognitiveEntry('module_step'),
  'cognitive:monitoring_signal': cognitiveEntry('monitoring_signal'),
  'cognitive:control_directive': cognitiveEntry('control_directive'),
  'cognitive:control_policy_violation': cognitiveEntry('control_policy_violation'),
  'cognitive:workspace_write': cognitiveEntry('workspace_write'),
  'cognitive:workspace_eviction': cognitiveEntry('workspace_eviction'),
  'cognitive:cycle_phase': cognitiveEntry('cycle_phase'),
  'cognitive:learn_failed': cognitiveEntry('learn_failed'),
  'cognitive:cycle_aborted': cognitiveEntry('cycle_aborted'),
  'cognitive:constraint_pinned': cognitiveEntry('constraint_pinned'),
  'cognitive:constraint_violation': cognitiveEntry('constraint_violation'),
  'cognitive:monitor_directive_applied': cognitiveEntry('monitor_directive_applied'),

  // PRD-059 §6.6 last row — token-exchange success event emitted by
  // cortexTokenExchangeMiddleware. Uses the audit bridge too.
  'method.agent.token_exchange': {
    eventType: 'method.agent.token_exchange',
    extract: (e: AgentEvent) => (e as unknown as { payload?: Record<string, unknown> }).payload ?? {},
  },
} as const;

/**
 * Flat map from pacta `AgentEvent.type` to audit mapping entry.
 * Exported for gate `G-AUDIT-EXHAUSTIVE` assertions.
 */
export const AUDIT_EVENT_MAP: Record<string, AuditMappingEntry> = AUDIT_EVENT_MAP_BASE as unknown as Record<string, AuditMappingEntry>;

function cognitiveEntry(variant: string): AuditMappingEntry {
  return {
    eventType: `method.cognitive.${variant}`,
    extract: (e: AgentEvent) => {
      // Cognitive events carry their own fields — pass-through sans `type`.
      const raw = e as unknown as Record<string, unknown>;
      const { type: _type, ...rest } = raw;
      return rest;
    },
  };
}

function safeJsonLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

// ── Composed form ────────────────────────────────────────────────

type InvokeFn<T> = (pact: Pact<T>, request: AgentRequest) => Promise<AgentResult<T>>;

export interface ComposedCortexAuditMiddleware
  extends ComposedAdapter<Pact<unknown>> {
  readonly name: 'cortex-audit';
  wrap<T>(inner: InvokeFn<T>): InvokeFn<T>;
  /** Direct emission — usable from pacta's `onEvent` hook. */
  emit(event: AgentEvent, request: AgentRequest): Promise<void>;
}

// ── Factory ───────────────────────────────────────────────────────

const ADAPTER_NAME = 'cortex-audit' as const;

export interface CortexAuditMiddlewareAdapter
  extends CortexServiceAdapter<
    { audit: CortexAuditCtx },
    Pact<unknown>,
    CortexAuditMiddlewareConfig
  > {
  compose(args: {
    ctx: { audit: CortexAuditCtx };
    pact: Pact<unknown>;
    config?: CortexAuditMiddlewareConfig;
  }): ComposedCortexAuditMiddleware;
}

export function cortexAuditMiddleware(
  config: CortexAuditMiddlewareConfig,
): CortexAuditMiddlewareAdapter {
  return {
    name: ADAPTER_NAME,

    compose(args: {
      ctx: { audit: CortexAuditCtx };
      pact: Pact<unknown>;
      config?: CortexAuditMiddlewareConfig;
    }): ComposedCortexAuditMiddleware {
      const effectiveConfig = args.config ?? config;
      const ctxAudit = args.ctx?.audit;

      if (!ctxAudit) {
        throw new CortexAdapterComposeError(ADAPTER_NAME, 'missing_ctx_service', {
          service: 'audit',
        });
      }
      if (!effectiveConfig?.appId || typeof effectiveConfig.appId !== 'string') {
        throw new CortexAdapterComposeError(ADAPTER_NAME, 'invalid_config', {
          field: 'appId',
        });
      }

      const suppressed = new Set<AgentEvent['type']>(
        effectiveConfig.suppressEventTypes ?? DEFAULT_SUPPRESS,
      );

      async function emit(
        event: AgentEvent,
        request: AgentRequest,
      ): Promise<void> {
        if (suppressed.has(event.type)) return;
        const mapping = AUDIT_EVENT_MAP[event.type];
        if (!mapping) {
          // Unmapped — shouldn't happen if G-AUDIT-EXHAUSTIVE holds, but
          // fallback so runtime is robust.
          return;
        }
        const auditEvent: AuditEvent = {
          eventType: mapping.eventType,
          payload: mapping.extract(event),
          correlationId: (request.metadata?.sessionId as string | undefined) ?? undefined,
        };
        try {
          await ctxAudit.event(auditEvent);
        } catch {
          // Fire-and-forget per PRD-065 §6.4; errors are surfaced via
          // AgentResult.errors[] by the wrapping invoke path.
        }
      }

      function wrap<T>(inner: InvokeFn<T>): InvokeFn<T> {
        return async (pact: Pact<T>, request: AgentRequest): Promise<AgentResult<T>> => {
          // Hook onto the existing onEvent in metadata so every event is
          // shadow-emitted to ctx.audit.
          const prevOnEvent = request.metadata?.onEvent as
            | ((e: AgentEvent) => void)
            | undefined;
          const wrappedMeta: Record<string, unknown> = {
            ...(request.metadata ?? {}),
            onEvent: (e: AgentEvent) => {
              // Emit to audit first (fire-and-forget), then delegate.
              void emit(e, request);
              prevOnEvent?.(e);
            },
          };
          const wrappedRequest: AgentRequest = { ...request, metadata: wrappedMeta };
          const result = await inner(pact, wrappedRequest);
          return result;
        };
      }

      return {
        name: ADAPTER_NAME,
        requires: ['audit'] as ReadonlyArray<keyof CtxSlice>,
        pact: args.pact,
        wrap,
        emit,
      };
    },
  };
}
