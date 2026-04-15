/**
 * Structural mirrors of `CortexCtx` + `MethodAgentResult` from
 * `@method/agent-runtime` (frozen by S1).
 *
 * These types are duplicated here (not imported) so that consumers of
 * `@method/pacta-testkit` do not need a TypeScript project reference to
 * `@method/agent-runtime`. The conformance runner / mock ctx structurally
 * match whatever `CortexCtx` the caller passes (`structural type` means the
 * shapes align at the call site).
 *
 * **Drift contract:** the fields declared here must stay byte-for-byte in
 * sync with `packages/agent-runtime/src/cortex/ctx-types.ts` and
 * `packages/agent-runtime/src/method-agent-handle.ts`. When the agent
 * runtime adds a facade field or widens a method, this file adds the same.
 * Compat gate `G-BOUNDARY` scans the conformance directory for **value**
 * imports from `@method/agent-runtime` (none permitted); the type-level
 * alignment is enforced by convention + this mirrored file.
 *
 * Last sync: 2026-04-14 against agent-runtime@0.1.0.
 */

// ── ctx.app ──────────────────────────────────────────────────────
export interface CortexAppFacade {
  readonly id: string;
  readonly tier: 'service' | 'tool' | 'web';
}

// ── ctx.llm ──────────────────────────────────────────────────────
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

// ── ctx.audit ────────────────────────────────────────────────────
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

// ── ctx.events ───────────────────────────────────────────────────
export interface CortexEventsFacade {
  publish(topic: string, payload: Readonly<Record<string, unknown>>): Promise<void> | void;
}

// ── ctx.storage ──────────────────────────────────────────────────
export interface CortexStorageFacade {
  get(key: string): Promise<Readonly<Record<string, unknown>> | null | undefined>;
  put(key: string, value: Readonly<Record<string, unknown>>): Promise<void>;
  delete(key: string): Promise<void>;
}

// ── ctx.jobs ─────────────────────────────────────────────────────
export interface CortexJobsFacade {
  enqueue(job: {
    readonly kind: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly runAfterMs?: number;
  }): Promise<{ readonly jobId: string }>;
}

// ── ctx.schedule ─────────────────────────────────────────────────
export interface CortexScheduleFacade {
  register(
    cron: string,
    handler: { readonly kind: string; readonly payload: Readonly<Record<string, unknown>> },
  ): Promise<{ readonly scheduleId: string }>;
}

// ── ctx.auth ─────────────────────────────────────────────────────
export interface CortexAuthFacade {
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

// ── ctx.log ──────────────────────────────────────────────────────
export interface CortexLogger {
  info(msg: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(msg: string, fields?: Readonly<Record<string, unknown>>): void;
  error(msg: string, fields?: Readonly<Record<string, unknown>>): void;
  debug?(msg: string, fields?: Readonly<Record<string, unknown>>): void;
}

// ── CortexCtx (top-level) ────────────────────────────────────────
export interface CortexCtx {
  readonly app: CortexAppFacade;
  readonly llm: CortexLlmFacade;
  readonly audit: CortexAuditFacade;
  readonly events?: CortexEventsFacade;
  readonly storage?: CortexStorageFacade;
  readonly jobs?: CortexJobsFacade;
  readonly schedule?: CortexScheduleFacade;
  readonly auth?: CortexAuthFacade;
  readonly log?: CortexLogger;
  readonly input?: { readonly text?: string; readonly [k: string]: unknown };
  readonly notify?: Readonly<Record<string, unknown>>;
}

// ── MethodAgentResult (S1 §4.4) ──────────────────────────────────
/**
 * Structural mirror of `MethodAgentResult<T>`. Fields beyond pacta's
 * `AgentResult<T>`: `appId`, `auditEventCount`, optional `resumption`.
 * The full pacta shape is typed as the index signature so structural
 * compatibility holds.
 */
export interface MethodAgentResult<TOutput = unknown> {
  readonly output: TOutput;
  readonly sessionId: string;
  readonly completed: boolean;
  readonly stopReason: 'complete' | 'budget_exhausted' | 'timeout' | 'killed' | 'error';
  readonly usage: Readonly<Record<string, unknown>>;
  readonly cost: Readonly<Record<string, unknown>>;
  readonly durationMs: number;
  readonly turns: number;
  readonly appId: string;
  readonly auditEventCount: number;
  readonly resumption?: Readonly<Record<string, unknown>>;
}
