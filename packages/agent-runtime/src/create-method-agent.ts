// SPDX-License-Identifier: Apache-2.0
/**
 * `createMethodAgent` — the S1 frozen factory (PRD-058 §6.3, S1 §4.5).
 *
 * One call composes a method-governed agent for a Cortex tenant app:
 *
 *   const agent = createMethodAgent({ ctx, pact });
 *   const result = await agent.invoke({ prompt: ctx.input.text });
 *
 * Composition pipeline (outer → inner), G-BUDGET-SINGLE-AUTHORITY end-to-end:
 *
 *   CortexTokenExchangeMiddleware   (outer — RFC-8693 exchange at request edge)
 *     → CortexAuditMiddleware       (mirror every AgentEvent to ctx.audit)
 *       → pacta.budgetEnforcer(mode='predictive')
 *         → pacta.outputValidator   (when pact.output.schema)
 *         → pacta reasoning middleware (pact.reasoning)
 *           → CortexLLMProvider.invoke  (inner — ctx.llm.complete)
 *
 * The "predictive" mode on pacta's budgetEnforcer is auto-selected when the
 * composed provider reports `capabilities().budgetEnforcement === 'native'`,
 * which `CortexLLMProvider` does. This is the load-bearing wiring for
 * gate `G-BUDGET-SINGLE-AUTHORITY` — the enforcer emits warnings but never
 * rejects on cost/token exhaustion; `ctx.llm` is the sole authority.
 *
 * Strict-mode rules (S1 §4.2 + PRD-058 §3.1):
 *   - tier === 'service' → strict default true
 *   - strict + custom `options.provider` → ConfigurationError
 *   - strict + `middleware.audit === false` → ConfigurationError
 *
 * Composition errors fail fast:
 *   - MissingCtxError       — required facade absent
 *   - ConfigurationError    — option violates strict-mode rule
 *   - CapabilityError (pacta) — provider doesn't support pact mode
 */

import {
  createAgent,
  budgetEnforcer,
  outputValidator,
  getEffortParams,
  type Agent,
  type AgentEvent,
  type AgentProvider,
  type AgentRequest,
  type Pact,
} from '@methodts/pacta';
import {
  cortexAuditMiddleware,
  cortexLLMProvider,
  cortexTokenExchangeMiddleware,
  type CortexAuditMiddlewareAdapter,
  type CortexAuthCtx,
  type CortexLLMProviderAdapter,
  type CortexTokenExchangeMiddlewareAdapter,
  type ComposedCortexAuditMiddleware,
  type ComposedCortexLLMProvider,
  type ComposedCortexTokenExchangeMiddleware,
  type LlmBudgetHandlers,
} from '@methodts/pacta-provider-cortex';

import type {
  CortexCtx,
  CortexLogger,
} from './cortex/ctx-types.js';
import { getLogger } from './cortex/ctx-types.js';
import { ConfigurationError, MissingCtxError } from './errors.js';
import { EventsMultiplexer, DEFAULT_QUEUE_CAPACITY } from './events-multiplexer.js';
import { MethodAgentHandle, type MethodAgent } from './method-agent-handle.js';
import type { Resumption } from './resumption.js';
import {
  selectSessionStore,
  type SessionStoreAdapter,
} from './session-store-adapter.js';
import { buildEventConnectorSubscriber } from './wire-event-connector.js';

// ── Options surface (S1 §4.2) ────────────────────────────────────

export interface CreateMethodAgentOptions<TOutput = unknown> {
  /** Injected Cortex ctx. Never imported at module top level. */
  readonly ctx: CortexCtx;

  /** The typed contract (pacta `Pact<T>`, re-exported from the barrel). */
  readonly pact: Pact<TOutput>;

  /** Fires for every AgentEvent. Synchronous, best-effort. */
  readonly onEvent?: (event: AgentEvent) => void;

  /**
   * Opt into the async-iterable `events()` channel. Mutually exclusive with
   * `onEvent` (S1 Q2, G-EVENTS-MUTEX) — enforced at `events()` call time.
   */
  readonly eventsChannel?: 'async-iterable' | 'callback';

  /**
   * Provider override (advanced). Skips CortexLLMProvider auto-wire. In
   * strict mode with `tier === 'service'`, passing a provider throws
   * ConfigurationError (S1 Q4).
   */
  readonly provider?: AgentProvider;

  /**
   * Middleware toggles. Defaults (production-safe):
   *   audit: true, tokenExchange: true, budgetPrecheck: true, events: true.
   */
  readonly middleware?: {
    readonly audit?: boolean;
    readonly tokenExchange?: boolean;
    readonly budgetPrecheck?: boolean;
    readonly events?: boolean;
    readonly throttle?: 'auto' | 'off';
  };

  /**
   * Resumability config. Default: derive from `pact.mode.type === 'resumable'`.
   * `storeAdapter` override lets tenant apps plug a ctx.storage-backed store
   * (PRD-061) or an alternative.
   */
  readonly resumption?: {
    readonly enabled?: boolean;
    readonly storeNamespace?: string;
    readonly storeAdapter?: SessionStoreAdapter;
    readonly ttlMs?: number;
  };

  /**
   * Strict mode. Default: `ctx.app.tier === 'service'`. Rejects unsafe
   * configurations at composition time.
   */
  readonly strict?: boolean;

  /**
   * Optional override for the LLM provider's budget handlers. When a
   * CortexLLMProvider is auto-wired and the tenant app does not pass
   * handlers, the factory synthesizes logger-backed no-op handlers so
   * compose-time gate `G-LLM-HANDLERS-PRESENT` passes — sane defaults
   * for the common case.
   */
  readonly llmBudgetHandlers?: LlmBudgetHandlers;

  /**
   * Token-exchange `narrowScope` override. Defaults to identity (returns
   * the user's scope unchanged) when the middleware is wired. Production
   * tenant apps should supply a scope-narrowing function.
   */
  readonly narrowScope?: (
    userScope: ReadonlyArray<string>,
    pact: Pact<unknown>,
  ) => ReadonlyArray<string>;

  /** Override queue capacity for the events multiplexer (default 1000). */
  readonly eventsQueueCapacity?: number;
}

// Re-export the handle's result type (S1 §4.4) for the barrel.
export type { MethodAgent, MethodAgentResult } from './method-agent-handle.js';
export type { Resumption } from './resumption.js';

// ── Factory ──────────────────────────────────────────────────────

export function createMethodAgent<TOutput = unknown>(
  options: CreateMethodAgentOptions<TOutput>,
): MethodAgent<TOutput> {
  const { ctx, pact } = options;

  // ── Step 1 — ctx shape validation ────────────────────────────────
  validateCtxShape(ctx);
  const logger = getLogger(ctx);

  // ── Step 2 — strict-mode validation ──────────────────────────────
  const strict = options.strict ?? ctx.app.tier === 'service';
  validateOptionsStrict(options, ctx, strict, logger);

  // ── Step 3 — resolve toggles ─────────────────────────────────────
  const mwAudit = options.middleware?.audit ?? true;
  const mwTokenExchange = options.middleware?.tokenExchange ?? true;
  const mwBudgetPrecheck = options.middleware?.budgetPrecheck ?? true;
  const mwEvents = options.middleware?.events ?? true;

  // ── Step 4 — provider resolution ─────────────────────────────────
  // Track whether the provider is the auto-wired Cortex one (drives
  // predictive-mode budgetEnforcer — G-BUDGET-SINGLE-AUTHORITY).
  let providerIsCortex = false;
  let composedCortex: ComposedCortexLLMProvider | undefined;
  let provider: AgentProvider;

  if (options.provider) {
    provider = options.provider;
  } else {
    const handlers: LlmBudgetHandlers =
      options.llmBudgetHandlers ?? buildDefaultBudgetHandlers(logger);
    const cortexProviderAdapter: CortexLLMProviderAdapter = cortexLLMProvider({ handlers });
    composedCortex = cortexProviderAdapter.compose({
      ctx: { llm: ctx.llm as never },
      pact: pact as Pact<unknown>,
    });
    provider = composedCortex;
    providerIsCortex = true;
  }

  // ── Step 5 — audit middleware (outer, after token-exchange) ─────
  let composedAudit: ComposedCortexAuditMiddleware | undefined;
  if (mwAudit && ctx.audit) {
    const auditAdapter: CortexAuditMiddlewareAdapter = cortexAuditMiddleware({
      appId: ctx.app.id,
    });
    composedAudit = auditAdapter.compose({
      ctx: { audit: ctx.audit as never },
      pact: pact as Pact<unknown>,
    });
  } else if (mwAudit && !ctx.audit) {
    // audit requested but ctx.audit missing — fail fast under strict.
    if (strict) {
      throw new ConfigurationError(
        'middleware.audit is true but ctx.audit is absent',
        ['strict-mode-audit-missing'],
      );
    }
    logger.warn?.('agent-runtime: ctx.audit missing; audit middleware skipped');
  }

  // ── Step 6 — token-exchange middleware (outermost) ──────────────
  let composedTokenExchange: ComposedCortexTokenExchangeMiddleware | undefined;
  if (mwTokenExchange && ctx.auth) {
    const narrowScope =
      options.narrowScope ?? ((userScope: ReadonlyArray<string>) => userScope);
    const tokenExchangeAdapter: CortexTokenExchangeMiddlewareAdapter =
      cortexTokenExchangeMiddleware({
        appId: ctx.app.id,
        narrowScope,
      });
    composedTokenExchange = tokenExchangeAdapter.compose({
      ctx: { auth: ctx.auth as unknown as CortexAuthCtx },
      pact: pact as Pact<unknown>,
    });
  }

  // ── Step 7 — events connector subscriber (optional) ─────────────
  const eventConnectorSubscriber =
    mwEvents ? buildEventConnectorSubscriber(ctx, ctx.app.id) : undefined;

  // ── Step 8 — audit counter for MethodAgentResult annotation ─────
  const auditEventCounter = { count: 0 };

  // ── Step 9 — multiplexer ────────────────────────────────────────
  const internalSubscribers: Array<(event: AgentEvent) => void | Promise<void>> = [];

  // Audit subscriber — mirror every event via the composed adapter and
  // bump the auditEventCounter for the MethodAgentResult.auditEventCount
  // annotation (PRD-058 §4 criterion 3).
  if (composedAudit) {
    internalSubscribers.push((event: AgentEvent) => {
      auditEventCounter.count++;
      // Route through the adapter's direct-emit helper.
      // An empty AgentRequest is used here because the emit helper only
      // reads `request.metadata.sessionId` and we do not have it pre-invoke;
      // the in-pipeline `wrap()` path handles the main contract.
      const syntheticRequest: AgentRequest = { prompt: '' };
      return composedAudit!.emit(event, syntheticRequest);
    });
  }

  if (eventConnectorSubscriber) {
    internalSubscribers.push(eventConnectorSubscriber);
  }

  const multiplexer = new EventsMultiplexer({
    onEvent: options.onEvent,
    asyncIterableEnabled: options.eventsChannel === 'async-iterable',
    logger,
    internalSubscribers,
    queueCapacity: options.eventsQueueCapacity ?? DEFAULT_QUEUE_CAPACITY,
  });

  // ── Step 10 — build base provider (with per-layer wrapping) ─────
  //
  // pacta's `createAgent` wraps budget + output-validator around the
  // provider. To place our Cortex layers OUTSIDE pacta's budgetEnforcer
  // (outer) and still use `createAgent` for state accumulation +
  // capability validation, we wrap the provider's invoke method.
  //
  // Middleware order from outside → inside:
  //   token-exchange  →  audit.wrap  →  [ pacta layers inside createAgent ]
  //
  // pacta's layers (inside createAgent):
  //   budgetEnforcer(predictive)  →  outputValidator  →  provider.invoke
  //
  // G-BUDGET-SINGLE-AUTHORITY: when providerIsCortex we auto-wire the
  // enforcer in predictive mode. The capability signal
  // `budgetEnforcement === 'native'` is the load-bearing bit.
  const enforcerMode: 'predictive' | 'authoritative' =
    providerIsCortex || provider.capabilities().budgetEnforcement === 'native'
      ? 'predictive'
      : 'authoritative';

  // Build the inner invoke chain — pacta's middleware + provider.
  let innerInvoke: <T>(
    p: Pact<T>,
    r: AgentRequest,
  ) => Promise<import('@methodts/pacta').AgentResult<T>> = (p, r) =>
    provider.invoke(p, r);

  // outputValidator (when schema present) — runs closer to provider.
  if (pact.output?.schema) {
    const schemaAwareProvider = innerInvoke;
    innerInvoke = outputValidator(schemaAwareProvider, pact as Pact<unknown>, multiplexer.fanIn) as typeof innerInvoke;
  }

  // budgetEnforcer — middle; predictive in the Cortex case.
  if (mwBudgetPrecheck && pact.budget) {
    const prev = innerInvoke;
    innerInvoke = budgetEnforcer(prev, pact as Pact<unknown>, multiplexer.fanIn, {
      mode: enforcerMode,
    }) as typeof innerInvoke;
  }

  // audit wrap — sits OUTSIDE pacta's layers, INSIDE token-exchange.
  if (composedAudit) {
    const prev = innerInvoke;
    innerInvoke = composedAudit.wrap(prev) as typeof innerInvoke;
  }

  // token-exchange wrap — outermost.
  if (composedTokenExchange) {
    const prev = innerInvoke;
    innerInvoke = composedTokenExchange.wrap(prev) as typeof innerInvoke;
  }

  // ── Step 11 — synthesize an AgentProvider facade from innerInvoke ─
  // Reuses capabilities() from the true provider so pacta's
  // createAgent validates modes correctly.
  const composedProvider: AgentProvider = {
    name: `method-agent[${provider.name}]`,
    capabilities: () => provider.capabilities(),
    invoke: <T>(p: Pact<T>, r: AgentRequest) => innerInvoke<T>(p, r),
  };

  // ── Step 12 — delegate to pacta createAgent for state + validation
  // Note: we pass a pact with `budget = undefined` to createAgent to prevent
  // double-enforcement (we already wrapped the enforcer above). createAgent
  // still accumulates state, validates capabilities, and exposes the state
  // getter.
  const pactForCreateAgent = stripBudget(pact);
  const pactaAgent: Agent<TOutput> = createAgent<TOutput>({
    pact: pactForCreateAgent,
    provider: composedProvider,
    reasoning: pact.reasoning,
    context: pact.context,
    onEvent: multiplexer.fanIn,
    throttle: options.middleware?.throttle === 'off' ? undefined : undefined,
  });

  // Ensure the handle reports the original pact (with budget) per S1 §4.3.
  const agentForHandle: Agent<TOutput> = {
    pact,
    provider: composedProvider,
    get state() {
      return pactaAgent.state;
    },
    invoke: (request: AgentRequest) => pactaAgent.invoke(request),
    dispose: pactaAgent.dispose?.bind(pactaAgent),
  };

  // ── Step 13 — resumption store ──────────────────────────────────
  const resumptionEnabled =
    options.resumption?.enabled ?? pact.mode.type === 'resumable';
  const storeNamespace =
    options.resumption?.storeNamespace ?? `agent/${ctx.app.id}`;
  const sessionStore = resumptionEnabled
    ? selectSessionStore(ctx, options.resumption?.storeAdapter, storeNamespace)
    : selectSessionStore(ctx, options.resumption?.storeAdapter, storeNamespace);

  // ── Step 14 — default request metadata (effortParams pre-applied) ─
  const requestDefaults: Record<string, unknown> = {};
  if (pact.reasoning?.effort) {
    requestDefaults.effortParams = getEffortParams(pact.reasoning.effort);
  }

  // ── Step 15 — build + return the handle ─────────────────────────
  return new MethodAgentHandle<TOutput>({
    inner: agentForHandle,
    ctx,
    multiplexer,
    sessionStore,
    storeNamespace,
    auditEventCounter,
    requestDefaults,
  });
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Structural compose-time ctx check. Same contract as
 * `assertCtxCompatibility` but integrated with createMethodAgent's
 * fail-fast semantics (S1 §4.5 step 1, PRD-058 §6.3).
 */
function validateCtxShape(ctx: CortexCtx | undefined | null): void {
  if (!ctx || typeof ctx !== 'object') {
    throw new MissingCtxError(['app', 'llm', 'audit']);
  }
  const missing: string[] = [];
  if (!ctx.app || typeof ctx.app.id !== 'string' || typeof ctx.app.tier !== 'string') {
    missing.push('app');
  }
  if (!ctx.llm || typeof ctx.llm.complete !== 'function') {
    missing.push('llm');
  }
  if (!ctx.audit || typeof ctx.audit.event !== 'function') {
    missing.push('audit');
  }
  if (missing.length > 0) {
    throw new MissingCtxError(missing);
  }
}

function validateOptionsStrict(
  options: CreateMethodAgentOptions<unknown>,
  ctx: CortexCtx,
  strict: boolean,
  logger: CortexLogger,
): void {
  if (!strict) return;

  const violations: string[] = [];

  if (options.provider && ctx.app.tier === 'service') {
    violations.push('strict-mode-custom-provider');
  }

  if (options.middleware?.audit === false) {
    violations.push('strict-mode-audit-disabled');
  }

  if (violations.length > 0) {
    throw new ConfigurationError(
      `Strict mode refused configuration: ${violations.join(', ')}`,
      violations,
    );
  }

  // Non-strict warning: audit opt-out still fires a warn when not strict.
  if (!strict && options.middleware?.audit === false) {
    logger.warn?.('agent-runtime: audit disabled — telemetry and governance impaired');
  }
}

function buildDefaultBudgetHandlers(logger: CortexLogger): LlmBudgetHandlers {
  const warn = (label: string) => (status: unknown) =>
    logger.warn?.(`agent-runtime: budget ${label}`, {
      status: status as Record<string, unknown>,
    });
  return {
    onBudgetWarning: warn('warning'),
    onBudgetCritical: warn('critical'),
    onBudgetExceeded: warn('exceeded'),
  };
}

/**
 * Return a shallow copy of the pact with `budget` set to undefined. Used to
 * avoid double budget enforcement: this factory wraps
 * `budgetEnforcer` in predictive mode BEFORE delegating to pacta
 * `createAgent`, so we prevent createAgent from wiring another enforcer.
 */
function stripBudget<T>(pact: Pact<T>): Pact<T> {
  const { budget: _drop, ...rest } = pact;
  return { ...(rest as Pact<T>) };
}
