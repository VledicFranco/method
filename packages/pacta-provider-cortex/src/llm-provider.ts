// SPDX-License-Identifier: Apache-2.0
/**
 * CortexLLMProvider — routes pacta `AgentProvider.invoke` through
 * `ctx.llm.complete / structured / embed` per S3 §2 and PRD-059 §6.5.
 *
 * Single authority for cost + tokens: `ctx.llm` (atomic check-and-reserve).
 * Pacta's `budgetEnforcer` runs in predictive-only mode when this provider
 * is wired, driven by `capabilities().budgetEnforcement === 'native'` —
 * see `@methodts/pacta` BudgetEnforcerOptions (PRD-059 Wave 1).
 *
 * Compose-time validation (G-LLM-HANDLERS-PRESENT):
 *   - `ctx.llm` must be defined.
 *   - `config.handlers.onBudgetWarning / onBudgetCritical / onBudgetExceeded`
 *     must all be functions. Missing handler → CortexAdapterComposeError
 *     with reason 'missing_mandatory_handler'.
 *
 * Pact gate: if `pact.requires?.llm === true`, the provider also verifies
 * budget handlers exist at compose (SC-02/SC-09). The final end-to-end
 * assertion across `createMethodAgent` lives in PRD-058.
 *
 * v1 limitations (documented):
 *   - `streaming: false` — PRD-068 Wave 7 gates streaming; capabilities
 *     reports `false` and `Streamable.stream()` throws. (Open question O2.)
 *   - No `ctx.llm.reserve()/settle()` — PRD-059 R-01. We rely on PRD-068's
 *     per-call atomic `checkAndReserve`. Long resumable pacts with
 *     `batched-held` carry-over are a PRD-062 concern.
 *   - `thinkingBudgetTokens` / `temperature` drop silently — PRD-059 R-O3.
 *     Re-enable when `CompletionRequest.extra` is negotiated in Cortex 12.3.
 */

import type {
  Pact,
  AgentRequest,
  AgentResult,
  TokenUsage,
  CostReport,
  AgentEvent,
  AgentProvider,
  Streamable,
  ProviderCapabilities,
} from '@methodts/pacta';
import {
  CortexAdapterComposeError,
  type ComposedAdapter,
  type CortexServiceAdapter,
  type CtxSlice,
} from './adapter.js';
import type {
  BudgetStatus,
  CompletionRequest,
  CompletionResult,
  CortexLlmCtx,
  EmbeddingResult,
  LlmBudgetHandlers,
  LlmTier,
  StructuredResult,
} from './ctx-types.js';

// ── Configuration ─────────────────────────────────────────────────

/** Optional pact-level hint that some pacta consumers set on `pact.requires`. */
interface PactRequiresShape {
  readonly llm?: boolean;
}

type PactWithMaybeRequires = Pact<unknown> & { readonly requires?: PactRequiresShape };

/** Effort → LlmTier mapping function signature. */
export type TierFromEffortFn = (
  effort: 'low' | 'medium' | 'high' | undefined,
  pact: Pact<unknown>,
) => LlmTier;

export interface CortexLLMProviderConfig {
  /**
   * Static tier override. If set, every non-embedding call uses this tier
   * regardless of `pact.reasoning?.effort`. Embedding calls always route
   * to `'embedding'` regardless.
   */
  readonly tierOverride?: LlmTier;

  /**
   * Mandatory budget handlers per PRD-068 §5.4 / S3 §2.2. Compose throws
   * `CortexAdapterComposeError { reason: 'missing_mandatory_handler' }`
   * if any of the three is missing. Pass no-op implementations that log
   * if you truly don't care — the handler contract is presence, not
   * behavior.
   */
  readonly handlers: LlmBudgetHandlers;

  /**
   * Override the default `effort → tier` table (PRD-059 §6.5). Returns
   * the tier for non-embedding calls.
   */
  readonly tierFromEffort?: TierFromEffortFn;
}

// ── Tier mapping (PRD-059 §6.5, S3 §2.3) ──────────────────────────

const DEFAULT_TIER_MAP = {
  low: 'fast',
  medium: 'balanced',
  high: 'powerful',
  undefined: 'balanced',
} as const satisfies Record<'low' | 'medium' | 'high' | 'undefined', LlmTier>;

function defaultTierFromEffort(
  effort: 'low' | 'medium' | 'high' | undefined,
  _pact: Pact<unknown>,
): LlmTier {
  return DEFAULT_TIER_MAP[effort ?? 'undefined'];
}

// ── Composed form ─────────────────────────────────────────────────

export interface ComposedCortexLLMProvider
  extends ComposedAdapter<Pact<unknown>>,
    AgentProvider,
    Streamable {
  readonly name: 'cortex-llm';
  capabilities(): ProviderCapabilities;
}

// ── Handler fire contract ────────────────────────────────────────

/**
 * Mirror `BudgetStatus` returned from ctx.llm into a single pacta event.
 * Read-only — never an enforcement path. Source: S3 §2.5 + §6.9.
 */
function mirrorBudgetEvent(
  status: BudgetStatus | undefined,
  onEvent: ((e: AgentEvent) => void) | undefined,
): void {
  if (!status || !onEvent) return;
  const limit = status.limitUsd;
  if (limit === undefined) return;
  const consumed = status.totalCostUsd;
  const percentUsed =
    status.percentUsed ?? (limit > 0 ? Math.round((consumed / limit) * 100) : 0);

  if (consumed >= limit) {
    onEvent({ type: 'budget_exhausted', resource: 'cost', consumed, limit });
    return;
  }
  if (percentUsed >= 80) {
    onEvent({
      type: 'budget_warning',
      resource: 'cost',
      consumed,
      limit,
      percentUsed,
    });
  }
}

// ── Usage + cost mapping ─────────────────────────────────────────

function toUsage(
  tokensIn: number,
  tokensOut: number,
): TokenUsage {
  return {
    inputTokens: tokensIn,
    outputTokens: tokensOut,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: tokensIn + tokensOut,
  };
}

function toCost(
  costUsd: number,
  providerModel: string,
  usage: TokenUsage,
): CostReport {
  return {
    totalUsd: costUsd,
    perModel: {
      [providerModel]: { tokens: usage, costUsd },
    },
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

// ── The factory ──────────────────────────────────────────────────

const ADAPTER_NAME = 'cortex-llm' as const;

/**
 * Factory return shape — satisfies {@link CortexServiceAdapter} AND narrows
 * `compose`'s return type to {@link ComposedCortexLLMProvider} so callers
 * get `.invoke`, `.capabilities`, `.stream` without needing a cast.
 */
export interface CortexLLMProviderAdapter
  extends CortexServiceAdapter<
    { llm: CortexLlmCtx },
    Pact<unknown>,
    CortexLLMProviderConfig
  > {
  compose(args: {
    ctx: { llm: CortexLlmCtx };
    pact: Pact<unknown>;
    config?: CortexLLMProviderConfig;
  }): ComposedCortexLLMProvider;
}

/**
 * The only public entrypoint of this module. Returns a
 * `CortexServiceAdapter`; call `.compose({ ctx, pact })` to bind.
 */
export function cortexLLMProvider(
  config: CortexLLMProviderConfig,
): CortexLLMProviderAdapter {
  return {
    name: ADAPTER_NAME,

    compose(args: {
      ctx: { llm: CortexLlmCtx };
      pact: Pact<unknown>;
      config?: CortexLLMProviderConfig;
    }): ComposedCortexLLMProvider {
      const effectiveConfig = args.config ?? config;
      const ctxLlm = args.ctx?.llm;

      // ── G-CORTEX-ONLY-PATH enforcement is structural (see ctx-types.ts) ──
      // ── G-LLM-HANDLERS-PRESENT (compose-time validation) ─────────────
      if (!ctxLlm) {
        throw new CortexAdapterComposeError(ADAPTER_NAME, 'missing_ctx_service', {
          service: 'llm',
        });
      }
      const handlers = effectiveConfig?.handlers;
      if (!handlers || typeof handlers.onBudgetWarning !== 'function') {
        throw new CortexAdapterComposeError(
          ADAPTER_NAME,
          'missing_mandatory_handler',
          { handler: 'onBudgetWarning' },
        );
      }
      if (typeof handlers.onBudgetCritical !== 'function') {
        throw new CortexAdapterComposeError(
          ADAPTER_NAME,
          'missing_mandatory_handler',
          { handler: 'onBudgetCritical' },
        );
      }
      if (typeof handlers.onBudgetExceeded !== 'function') {
        throw new CortexAdapterComposeError(
          ADAPTER_NAME,
          'missing_mandatory_handler',
          { handler: 'onBudgetExceeded' },
        );
      }

      // Register handlers with ctx.llm. Some SDK shapes accept handlers
      // via `cortexApp({ llm: handlers })`; if this specific ctx surface
      // exposes `registerBudgetHandlers`, wire it here. No-op otherwise.
      if (typeof ctxLlm.registerBudgetHandlers === 'function') {
        ctxLlm.registerBudgetHandlers(handlers);
      }

      // Pact-level gate (SC-09): if the pact declares requires.llm and
      // we got here, handlers are present — satisfied. Any other pact
      // fields like `budget` remain pacta's concern.
      const pactWithRequires = args.pact as PactWithMaybeRequires;
      void pactWithRequires.requires?.llm; // presence assertion only

      const tierResolver: TierFromEffortFn =
        effectiveConfig.tierFromEffort ?? defaultTierFromEffort;
      const tierOverride = effectiveConfig.tierOverride;

      // ── invoke (non-streaming path) ───────────────────────────────
      async function invoke<T>(
        pact: Pact<T>,
        request: AgentRequest,
      ): Promise<AgentResult<T>> {
        const startedAt = Date.now();

        const sessionId =
          request.resumeSessionId ??
          (request.metadata?.sessionId as string | undefined) ??
          `cortex-${startedAt.toString(36)}`;

        const onEvent = (request.metadata?.onEvent as
          | ((e: AgentEvent) => void)
          | undefined);

        onEvent?.({ type: 'started', sessionId, timestamp: nowIso() });

        const effort = pact.reasoning?.effort;
        const embedHint =
          (request.metadata?.cortexEmbed as boolean | undefined) ?? false;

        const tier: LlmTier = embedHint
          ? 'embedding'
          : (tierOverride ?? tierResolver(effort, pact as Pact<unknown>));

        // `effortParams` is set by pacta's `effortMapper` middleware on
        // `request.metadata`. `maxTokens` is required by PRD-068 for the
        // pre-reservation estimate.
        const effortParams =
          (request.metadata?.effortParams as
            | { maxTokens?: number }
            | undefined) ?? {};
        const maxTokens =
          effortParams.maxTokens ??
          (request.metadata?.maxTokens as number | undefined) ??
          4096;

        const baseReq: CompletionRequest = {
          prompt: request.prompt,
          systemPrompt: request.systemPrompt,
          tier,
          maxTokens,
          // PRD-059 R-O3: drop thinkingBudgetTokens/temperature until
          // ctx.llm adds the `extra` field (Cortex 12.3 co-design).
        };

        try {
          // Branch by call type — schema present → structured; embed → embed; else → complete.
          if (embedHint) {
            const emb = await ctxLlm.embed(request.prompt);
            return finalize<T>(emb, /*output=*/ undefined as T, sessionId, startedAt, onEvent);
          }

          const schema = pact.output?.schema;
          if (schema !== undefined) {
            const res = await ctxLlm.structured({ ...baseReq, schema });
            return finalize<T>(
              res,
              res.value as T,
              sessionId,
              startedAt,
              onEvent,
            );
          }

          const res = await ctxLlm.complete(baseReq);
          return finalize<T>(
            res,
            res.content as unknown as T,
            sessionId,
            startedAt,
            onEvent,
          );
        } catch (err) {
          return handleInvokeError<T>(err, sessionId, startedAt, onEvent);
        }
      }

      // ── capabilities ──────────────────────────────────────────────
      function capabilities(): ProviderCapabilities {
        return {
          modes: ['oneshot', 'resumable', 'persistent'],
          streaming: false,
          resumable: false,
          // LOAD-BEARING: drives predictive mode on pacta budgetEnforcer
          // via createMethodAgent (PRD-058 / S1).
          budgetEnforcement: 'native',
          outputValidation: 'client',
          toolModel: 'none',
        };
      }

      return {
        name: ADAPTER_NAME,
        requires: ['llm'] as ReadonlyArray<keyof CtxSlice>,
        pact: args.pact,
        capabilities,
        invoke,

        // Streamable stub — v1 deferred (PRD-059 R-03, S3 §2.4, open question O2).
        // When PRD-068 Wave 7 lands streaming, this becomes a real generator
        // and capabilities.streaming flips to true. No surface change.
        async *stream(): AsyncIterable<AgentEvent> {
          throw new Error(
            'CortexLLMProvider.stream: streaming is not implemented in v1 (PRD-068 Wave 7 gated)',
          );
        },
      };
    },
  };
}

// ── Result-building helpers ──────────────────────────────────────

function finalize<T>(
  res: CompletionResult | StructuredResult | EmbeddingResult,
  output: T,
  sessionId: string,
  startedAt: number,
  onEvent: ((e: AgentEvent) => void) | undefined,
): AgentResult<T> {
  const tokensIn = res.tokensIn;
  const tokensOut = 'tokensOut' in res ? res.tokensOut : 0;
  const costUsd = res.costUsd;
  const providerModel = res.providerModel;
  const usage = toUsage(tokensIn, tokensOut);
  const cost = toCost(costUsd, providerModel, usage);
  const durationMs = Date.now() - startedAt;

  onEvent?.({
    type: 'turn_complete',
    turnNumber: 1,
    usage,
  });

  // Mirror ctx.llm BudgetStatus into pacta budget events (read-only; S3 §6.9).
  mirrorBudgetEvent(res.budget, onEvent);

  onEvent?.({
    type: 'completed',
    result: output,
    usage,
    cost,
    durationMs,
    turns: 1,
  });

  return {
    output,
    sessionId,
    completed: true,
    stopReason: 'complete',
    usage,
    cost,
    durationMs,
    turns: 1,
  };
}

/** Map ctx.llm errors into typed pacta AgentResult / events. */
function handleInvokeError<T>(
  err: unknown,
  sessionId: string,
  startedAt: number,
  onEvent: ((e: AgentEvent) => void) | undefined,
): AgentResult<T> {
  const message = err instanceof Error ? err.message : String(err);
  const code = extractErrorCode(err);
  const durationMs = Date.now() - startedAt;

  // BudgetExceeded: translate to stopReason='budget_exhausted' (S3 §2.1 step 6).
  if (code === 'BudgetExceeded' || /budget.*exceed/i.test(message)) {
    onEvent?.({
      type: 'budget_exhausted',
      resource: 'cost',
      consumed: 0,
      limit: 0,
    });
    return synthesizeErrorResult<T>(
      sessionId,
      durationMs,
      /*completed=*/ false,
      'budget_exhausted',
    );
  }

  // RateLimited: recoverable error; rethrow-equivalent by returning with error stopReason.
  if (code === 'RateLimited' || /rate.?limit/i.test(message)) {
    onEvent?.({
      type: 'error',
      message,
      recoverable: true,
      code: 'rate_limited',
    });
    return synthesizeErrorResult<T>(
      sessionId,
      durationMs,
      /*completed=*/ false,
      'error',
    );
  }

  onEvent?.({
    type: 'error',
    message,
    recoverable: false,
    code: code ?? 'cortex_llm_error',
  });
  return synthesizeErrorResult<T>(
    sessionId,
    durationMs,
    /*completed=*/ false,
    'error',
  );
}

function extractErrorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const c = (err as { code?: unknown }).code;
    if (typeof c === 'string') return c;
  }
  if (err && typeof err === 'object' && 'name' in err) {
    const n = (err as { name?: unknown }).name;
    if (typeof n === 'string') return n;
  }
  return undefined;
}

function synthesizeErrorResult<T>(
  sessionId: string,
  durationMs: number,
  completed: boolean,
  stopReason: AgentResult<T>['stopReason'],
): AgentResult<T> {
  return {
    output: undefined as T,
    sessionId,
    completed,
    stopReason,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
    },
    cost: { totalUsd: 0, perModel: {} },
    durationMs,
    turns: 0,
  };
}
