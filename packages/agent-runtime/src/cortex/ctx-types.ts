/**
 * Structural subset of the Cortex tenant-app `ctx` that `@method/agent-runtime`
 * needs at runtime. This is the **single source of truth** for the CortexCtx
 * shape inside `@method/agent-runtime`.
 *
 * ── R1 mitigation — DO NOT drift from `@method/pacta-provider-cortex` ──
 * PRD-058 §3.3 + Risk R1: the field shapes below MUST structurally align with
 * the narrow ctx types owned by `@method/pacta-provider-cortex`
 * (`src/ctx-types.ts`). When a facade here grows a field, the provider's
 * corresponding type MUST grow the same field in the same PR. If the facade
 * shrinks, coordinate a major-version bump on `@method/agent-runtime` per S1
 * §7 Compatibility. This co-location is the primary mitigation against
 * structural-type drift ruining tenant app runtime behavior despite
 * successful compilation.
 *
 * These types are **type-only** from Cortex's perspective — this package must
 * not import any value from `@t1/cortex-sdk` or `@cortex/*` at runtime
 * (gate G-BOUNDARY-NO-CORTEX-VALUE-IMPORT, S1 §8).
 *
 * Source-of-truth map (upstream Cortex docs, versioned 2026-04-14):
 *   - ctx.app        — t1-cortex-1/docs/rfcs/RFC-005-app-platform-service-library.md §9
 *   - ctx.llm        — t1-cortex-1/docs/prds/068-llm-service.md
 *   - ctx.audit      — t1-cortex-1/docs/prds/065-audit-service.md
 *   - ctx.events     — t1-cortex-1/docs/prds/072-events-service.md
 *   - ctx.storage    — t1-cortex-1/docs/prds/064-storage-service.md
 *   - ctx.jobs       — t1-cortex-1/docs/prds/071-jobs-service.md
 *   - ctx.schedule   — t1-cortex-1/docs/prds/075-schedule-service.md
 *   - ctx.auth       — t1-cortex-1/docs/prds/061-auth-as-a-service.md + RFC-005 §4.1.5
 *   - ctx.log        — RFC-005 §4.1 (cross-service logger contract)
 */

// ── ctx.llm (PRD-068) ─────────────────────────────────────────────

/**
 * Structural LLM facade. Intentionally minimal — PRD-059
 * `@method/pacta-provider-cortex` consumes the richer shape
 * (`CortexLlmCtx`) directly. This surface only names what S1 uses.
 */
export interface CortexLlmFacade {
  complete(req: {
    readonly tier: 'fast' | 'balanced' | 'powerful' | 'embedding' | 'standard' | 'reasoning';
    readonly prompt: string;
    readonly [k: string]: unknown;
  }): Promise<{
    readonly content?: string;
    readonly text?: string;
    readonly tokensIn?: number;
    readonly tokensOut?: number;
    readonly costUsd?: number;
    readonly providerModel?: string;
    readonly [k: string]: unknown;
  }>;
  structured?<T = unknown>(req: {
    readonly tier: 'fast' | 'balanced' | 'powerful' | 'embedding' | 'standard' | 'reasoning';
    readonly prompt: string;
    readonly schema?: unknown;
    readonly maxTokens?: number;
    readonly [k: string]: unknown;
  }): Promise<{ readonly value: T; readonly [k: string]: unknown }>;
  embed?(text: string): Promise<{ readonly vector: ReadonlyArray<number>; readonly [k: string]: unknown }>;
  registerBudgetHandlers?(handlers: {
    onBudgetWarning: (status: unknown) => void | Promise<void>;
    onBudgetCritical: (status: unknown) => void | Promise<void>;
    onBudgetExceeded: (status: unknown) => void | Promise<void>;
  }): void;
}

// ── ctx.audit (PRD-065) ───────────────────────────────────────────

export interface CortexAuditFacade {
  event(e: {
    readonly eventType?: string;
    readonly kind?: string;
    readonly actor?: { readonly sub?: string; readonly appId?: string } | string;
    readonly subject?: string;
    readonly payload?: Readonly<Record<string, unknown>>;
    readonly correlationId?: string;
  }): Promise<void> | void;
}

// ── ctx.events (PRD-072) ──────────────────────────────────────────

export interface CortexEventsFacade {
  publish(topic: string, payload: Readonly<Record<string, unknown>>): Promise<void> | void;
}

// ── ctx.storage (PRD-064) ─────────────────────────────────────────

export interface CortexStorageFacade {
  get(key: string): Promise<Readonly<Record<string, unknown>> | null | undefined>;
  put(key: string, value: Readonly<Record<string, unknown>>): Promise<void>;
  delete(key: string): Promise<void>;
}

// ── ctx.jobs (PRD-071) ────────────────────────────────────────────

export interface CortexJobsFacade {
  enqueue(job: {
    readonly kind: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly runAfterMs?: number;
  }): Promise<{ readonly jobId: string }>;
}

// ── ctx.schedule (PRD-075) ────────────────────────────────────────

export interface CortexScheduleFacade {
  register(
    cron: string,
    handler: { readonly kind: string; readonly payload: Readonly<Record<string, unknown>> },
  ): Promise<{ readonly scheduleId: string }>;
}

// ── ctx.auth (PRD-061 / RFC-005 §4.1.5) ───────────────────────────

export interface CortexAuthFacade {
  /**
   * RFC 8693 token exchange. Depth cap (≤2) is enforced by
   * `CortexTokenExchangeMiddleware` in `@method/pacta-provider-cortex`.
   */
  exchange?(req: {
    readonly subjectTokenType: string;
    readonly subjectToken: string;
    readonly audience: string;
    readonly scope?: string;
    readonly [k: string]: unknown;
  }): Promise<{ readonly token: string; readonly expiresAt: number; readonly [k: string]: unknown }>;
  exchangeForAgent?(
    parentToken: string,
    scope: ReadonlyArray<string>,
  ): Promise<{ readonly token: string; readonly expiresAt: number }>;
  readonly serviceAccountToken?: string;
}

// ── ctx.log ───────────────────────────────────────────────────────

export interface CortexLogger {
  info(msg: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(msg: string, fields?: Readonly<Record<string, unknown>>): void;
  error(msg: string, fields?: Readonly<Record<string, unknown>>): void;
  debug?(msg: string, fields?: Readonly<Record<string, unknown>>): void;
}

// ── ctx.app (RFC-005 §9) ──────────────────────────────────────────

export interface CortexAppFacade {
  readonly id: string;
  readonly tier: 'service' | 'tool' | 'web';
}

// ── Top-level CortexCtx ───────────────────────────────────────────

/**
 * Structural subset of the Cortex tenant-app ctx.
 *
 * Consumer responsibility: pass the real Cortex `ctx`. Structural typing
 * means any ctx with these shapes satisfies MethodAgentPort.
 *
 * Producer responsibility: never narrow an existing field without a
 * breaking-change migration. Adding optional fields is non-breaking.
 */
export interface CortexCtx {
  /** Cortex app identity. Used for per-AppId budget + audit attribution. */
  readonly app: CortexAppFacade;

  /** LLM facade (PRD-068). The ONLY path to a model from agent-runtime. */
  readonly llm: CortexLlmFacade;

  /** Audit sink (PRD-065). Every AgentEvent is mirrored here. */
  readonly audit: CortexAuditFacade;

  /** Event bus (PRD-072). Optional — set by CortexEventConnector in PRD-063. */
  readonly events?: CortexEventsFacade;

  /** Per-app KV/document storage (PRD-064). Backs the session store. */
  readonly storage?: CortexStorageFacade;

  /** Job queue (PRD-071). Backs resumable-mode continuations (PRD-062). */
  readonly jobs?: CortexJobsFacade;

  /** Scheduler (PRD-075). Used only by createScheduledMethodAgent (Phase B). */
  readonly schedule?: CortexScheduleFacade;

  /** Token exchange (RFC 8693 per RFC-005 §4.1.5). Required for delegated agents. */
  readonly auth?: CortexAuthFacade;

  /** Structured logger. Falls back to a no-op if absent. */
  readonly log?: CortexLogger;

  /** Input envelope. Present in Cortex tenant entry points. */
  readonly input?: { readonly text?: string; readonly [k: string]: unknown };

  /** Notification facade — tenant apps access this from onEvent; not used by the port itself. */
  readonly notify?: Readonly<Record<string, unknown>>;
}

/**
 * Minimal no-op logger used when `ctx.log` is absent. Internal — not exported.
 */
export function getLogger(ctx: CortexCtx): CortexLogger {
  if (ctx.log) return ctx.log;
  const noop = (): void => {
    /* no-op */
  };
  return { info: noop, warn: noop, error: noop, debug: noop };
}
