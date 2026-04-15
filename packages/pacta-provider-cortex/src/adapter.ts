/**
 * Shared Cortex adapter pattern (S3 §1, frozen 2026-04-14).
 *
 * Every adapter in this package — LLM provider, audit middleware,
 * token-exchange middleware, and any future S4/S5/S6 adapters — satisfies
 * {@link CortexServiceAdapter}. The contract:
 *
 * 1. A factory returns a `CortexServiceAdapter<TCtxSlice, TPact, TConfig>`.
 * 2. `compose()` is the ONE place that may throw. After compose returns,
 *    the adapter is structurally correct and runtime errors become typed
 *    values (pacta `AgentResult.errors[]`, `stopReason: 'error' | 'budget_exhausted'`).
 * 3. `TCtxSlice` is the narrow slice of `ctx.*` the adapter consumes.
 *    Adapters never take the whole `ctx`.
 *
 * See `.method/sessions/fcd-surface-cortex-service-adapters/decision.md`.
 */

import type { CortexLlmCtx, CortexAuditCtx, CortexAuthCtx } from './ctx-types.js';

/**
 * The slice of Cortex ctx.* that an adapter consumes. Each adapter
 * declares exactly which ctx services it needs. This is the ONLY way
 * adapters reach Cortex. No global ctx, no fallbacks.
 *
 * Future ctx.* services (`storage`, `jobs`, `events`) extend this type
 * when their adapters land (S4/S5/S6). None are optional no-ops —
 * adapters fail-closed on missing services at compose time.
 */
export type CtxSlice = Partial<{
  llm: CortexLlmCtx;
  audit: CortexAuditCtx;
  auth: CortexAuthCtx;
  // storage: CortexStorageCtx;  // S4 — PRD-061
  // jobs:    CortexJobsCtx;     // S5 — PRD-062
  // events:  CortexEventsCtx;   // S6 — PRD-063
}>;

/**
 * Every Cortex adapter implements this shape. The `compose` step is the
 * sole place validation runs — after compose returns, the adapter is
 * guaranteed structurally correct.
 *
 * - `TCtxSlice` — the sub-record of `CtxSlice` this adapter requires.
 * - `TPact` — the pact shape the adapter asserts against.
 * - `TConfig` — static configuration the adapter accepts.
 */
export interface CortexServiceAdapter<
  TCtxSlice extends Partial<CtxSlice>,
  TPact,
  TConfig = unknown,
> {
  /** Stable identifier for diagnostics and gate assertions. */
  readonly name: string;

  /**
   * Validate + bind. Throws {@link CortexAdapterComposeError} for any
   * structural mismatch between pact and required ctx services. After
   * compose returns, the adapter is live. This is the ONE place that may
   * throw. Anything past compose returns typed results.
   */
  compose(args: {
    ctx: TCtxSlice;
    pact: TPact;
    config?: TConfig;
  }): ComposedAdapter<TPact>;
}

/** The bound, ready-to-run form returned by {@link CortexServiceAdapter.compose}. */
export interface ComposedAdapter<TPact> {
  readonly name: string;
  readonly requires: ReadonlyArray<keyof CtxSlice>;
  readonly pact: TPact;
  dispose?(): Promise<void>;
}

/**
 * Single error class every adapter throws from `compose()`. Consumers
 * handle one type, not N.
 */
export class CortexAdapterComposeError extends Error {
  readonly adapter: string;
  readonly reason:
    | 'missing_ctx_service'
    | 'missing_pact_field'
    | 'missing_mandatory_handler'
    | 'incompatible_version'
    | 'invalid_config';
  readonly details: Record<string, unknown>;

  constructor(
    adapter: string,
    reason: CortexAdapterComposeError['reason'],
    details: Record<string, unknown>,
  ) {
    super(
      `Cortex adapter "${adapter}" compose failed: ${reason} — ${JSON.stringify(
        details,
      )}`,
    );
    this.name = 'CortexAdapterComposeError';
    this.adapter = adapter;
    this.reason = reason;
    this.details = details;
  }
}
