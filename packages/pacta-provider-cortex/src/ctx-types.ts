/**
 * Narrow structural re-declaration of the Cortex SDK types this adapter
 * consumes — the SINGLE seam between `@method/pacta-provider-cortex` and
 * `@t1/cortex-sdk`.
 *
 * Gate `G-CORTEX-ONLY-PATH` (S3 §7, PRD-059 §7.1) forbids any runtime
 * import of `@t1/cortex-sdk` in this package. This file is the allow-list
 * entry — and the *only* one. Every other source file must import from
 * here, never from the SDK directly.
 *
 * These types are kept structurally compatible with Cortex SDK shapes
 * defined in:
 *   - t1-cortex-1/docs/prds/068-llm-service.md  (ctx.llm — PRD-068)
 *   - t1-cortex-1/docs/prds/065-audit-service.md (ctx.audit — PRD-065)
 *   - t1-cortex-1/docs/prds/061-auth-as-a-service.md (ctx.auth — PRD-061)
 *   - t1-cortex-1/docs/rfcs/RFC-005-app-platform-service-library.md §4.1, §4.1.5
 *
 * When `@t1/cortex-sdk` becomes installable, the factories in this package
 * will add `import type` lines that resolve to the SDK; the structural
 * re-declaration here will then serve as the documented, tested shape
 * contract. Structural assignability means no runtime change.
 *
 * NOTE: structural only — no runtime imports, no value-level references
 * to the SDK anywhere in this package (not even in this file).
 */

// ── ctx.llm (PRD-068) ─────────────────────────────────────────────

/** Tier selector for `ctx.llm.complete/structured/embed`. */
export type LlmTier = 'fast' | 'balanced' | 'powerful' | 'embedding';

/** Pre-call atomic budget state returned by `ctx.llm`. */
export interface BudgetStatus {
  /** Total cost consumed so far for this app's budget window, in USD. */
  readonly totalCostUsd: number;
  /** Hard limit in USD, if configured. */
  readonly limitUsd?: number;
  /** 0-100. When defined, the handler mirror layer uses this. */
  readonly percentUsed?: number;
  /** Optional tokens-consumed snapshot for the same window. */
  readonly totalTokens?: number;
  readonly tokenLimit?: number;
}

/** Input to `ctx.llm.complete` / `.structured`. */
export interface CompletionRequest {
  readonly prompt: string;
  readonly tier: LlmTier;
  /** Required by PRD-068 for the pre-reservation estimate. */
  readonly maxTokens: number;
  /** System prompt, if any. */
  readonly systemPrompt?: string;
  /** JSON schema for `structured()` calls. */
  readonly schema?: unknown;
  /**
   * Provider-specific extras. PRD-059 §Risks R-02 / S3 §2.3: until
   * Cortex 12.3 lands the `extra` field, `thinkingBudgetTokens` and
   * `temperature` drop silently. This field is reserved for that
   * co-design.
   */
  readonly extra?: Record<string, unknown>;
}

/** Output of `ctx.llm.complete`. */
export interface CompletionResult {
  readonly content: string;
  readonly tokensIn: number;
  readonly tokensOut: number;
  /** Post-reconcile real cost in USD — the source of truth. */
  readonly costUsd: number;
  /** Provider model id reported back (for `cost.perModel` bookkeeping). */
  readonly providerModel: string;
  /** Budget snapshot at the end of the call — drives handler mirror. */
  readonly budget?: BudgetStatus;
}

/** Output of `ctx.llm.structured`. */
export interface StructuredResult<T = unknown> {
  readonly value: T;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costUsd: number;
  readonly providerModel: string;
  readonly budget?: BudgetStatus;
}

/** Output of `ctx.llm.embed`. */
export interface EmbeddingResult {
  readonly vector: ReadonlyArray<number>;
  readonly dimensions: number;
  readonly tokensIn: number;
  readonly costUsd: number;
  readonly providerModel: string;
  readonly budget?: BudgetStatus;
}

/**
 * Budget threshold handlers fired by `ctx.llm` at 80/95/100% — PRD-068
 * §5.4 forbids `undefined`, and this adapter's compose() enforces
 * presence via gate `G-LLM-HANDLERS-PRESENT` (PRD-059 §Gates).
 *
 * The adapter does NOT poll; it simply registers these at compose time.
 * The budget mirror that flows through pacta events is a separate,
 * read-only pathway (see `llm-provider.ts`).
 */
export interface LlmBudgetHandlers {
  onBudgetWarning(status: BudgetStatus): void | Promise<void>;
  onBudgetCritical(status: BudgetStatus): void | Promise<void>;
  onBudgetExceeded(status: BudgetStatus): void | Promise<void>;
}

/** The subset of `ctx.llm` this adapter consumes. */
export interface CortexLlmCtx {
  complete(req: CompletionRequest): Promise<CompletionResult>;
  structured<T = unknown>(req: CompletionRequest): Promise<StructuredResult<T>>;
  embed(text: string): Promise<EmbeddingResult>;
  /**
   * Register the mandatory budget handlers. Implementations wire these
   * into the threshold fire-once logic described by PRD-068 §5.4.
   * Optional in the structural contract because some SDK versions
   * accept handlers via a different wiring (`cortexApp({ llm: handlers })`).
   */
  registerBudgetHandlers?(handlers: LlmBudgetHandlers): void;
}

// ── ctx.audit (PRD-065) ───────────────────────────────────────────

/** Payload envelope accepted by `ctx.audit.event`. */
export interface AuditEvent {
  /** App-domain event type, e.g., `method.agent.started`. See PRD-059 §6.6. */
  readonly eventType: string;
  /** Free-form payload; redacted server-side via the app's RedactionPolicy. */
  readonly payload: Record<string, unknown>;
  /** Optional correlation id — pacta session id in our case. */
  readonly correlationId?: string;
  /** Optional tenant/user attribution (for the `act_as` chain). */
  readonly actor?: { sub?: string; appId?: string };
}

/** The subset of `ctx.audit` this adapter consumes. */
export interface CortexAuditCtx {
  /** Fire-and-forget. Errors are collected into `AgentResult.errors[]`. */
  event(ev: AuditEvent): Promise<void> | void;
}

// ── ctx.auth (PRD-061 / RFC-005 §4.1.5) ───────────────────────────

/** RFC-8693 `act_as` chain entry. Structural — opaque sub + optional appId. */
export interface ActAsEntry {
  readonly sub: string;
  readonly appId?: string;
}

/** Exchanged token returned by `ctx.auth.exchange`. */
export interface ScopedToken {
  /** The raw JWT. */
  readonly token: string;
  /** Opaque audience claim. */
  readonly audience: string;
  /** Parsed `act_as` chain — length drives the depth cap. */
  readonly actAs: ReadonlyArray<ActAsEntry>;
  readonly scope: ReadonlyArray<string>;
  readonly expiresAt: number;
}

/** RFC-8693 token-exchange request shape. */
export interface TokenExchangeRequest {
  readonly subjectTokenType: string;
  readonly subjectToken: string;
  readonly actorTokenType?: string;
  readonly actorToken?: string;
  readonly audience: string;
  readonly scope?: string;
  readonly requestedTokenType?: string;
  readonly ttlSeconds?: number;
}

/** The subset of `ctx.auth` this adapter consumes. */
export interface CortexAuthCtx {
  exchange(req: TokenExchangeRequest): Promise<ScopedToken>;
  /** Agent service-account token — the default `actor` in the first exchange. */
  readonly serviceAccountToken?: string;
}
