// SPDX-License-Identifier: Apache-2.0
/**
 * Provider Error Taxonomy (PRD 051 — S9)
 *
 * Frozen co-design record:
 *   .method/sessions/fcd-surface-provider-error-taxonomy/record.md
 *
 * Hierarchy:
 *   ProviderError (abstract, branded)
 *     ├─ TransientError (abstract) — provider already retried, caller should NOT retry
 *     │    ├─ RateLimitError    — 429 / quota exhausted
 *     │    ├─ NetworkError      — connection drop, DNS, 5xx
 *     │    └─ TimeoutError      — operation timed out
 *     └─ PermanentError (abstract) — will fail again deterministically
 *          ├─ AuthError          — 401, bad key, expired token
 *          ├─ InvalidRequestError — 400, schema violation
 *          ├─ CliExecutionError  — non-zero exit (non-rate-limit)
 *          ├─ CliSpawnError      — binary missing / perms
 *          └─ CliAbortError      — operator-initiated abort
 *
 * Retry ownership: provider owns transient retries (exhausts budget before
 * throwing TransientError). DAG owns semantic retries (gate failures), NOT
 * provider errors. Both transient and permanent are final at the DAG level.
 */

import type { ProviderClass, AccountId } from '@methodts/types';

// ── Branding for cross-module instanceof safety ─────────────────

/**
 * Symbol brand prevents instanceof false-negatives when pacta loads twice
 * (monorepo symlink/bundle hazards). Use `isProviderError(x)` not `instanceof`.
 */
const PROVIDER_ERROR_BRAND = Symbol.for('pacta.ProviderError');
type BrandedError = Error & { readonly [key: symbol]: true };

/** Cross-realm-safe check. Prefer this over `instanceof ProviderError`. */
export function isProviderError(x: unknown): x is ProviderError {
  return (
    typeof x === 'object' &&
    x !== null &&
    (x as BrandedError)[PROVIDER_ERROR_BRAND] === true
  );
}

export function isTransientError(x: unknown): x is TransientError {
  return isProviderError(x) && x.kind === 'transient';
}

export function isPermanentError(x: unknown): x is PermanentError {
  return isProviderError(x) && x.kind === 'permanent';
}

// ── Redaction helper ────────────────────────────────────────────

/**
 * Strips API-key patterns from error messages before surfacing.
 * MUST be called at construction time. Patterns: sk-ant-*, JWT shape, Bearer tokens.
 */
export function redactCredentials(message: string): string {
  return message
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-[REDACTED]')
    .replace(
      /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      '[JWT-REDACTED]',
    )
    .replace(
      /(Bearer|Authorization:\s*Bearer)\s+\S+/gi,
      '$1 [REDACTED]',
    );
}

// ── Base taxonomy ──────────────────────────────────────────────────

export interface ProviderErrorContext {
  readonly providerClass: ProviderClass;
  readonly accountId?: AccountId;
  /** ES2022 Error.cause — wraps the underlying error when applicable. */
  readonly cause?: unknown;
}

export abstract class ProviderError extends Error {
  /** Discriminator — use `err.kind === 'transient'` for narrowing. */
  abstract readonly kind: 'transient' | 'permanent';
  readonly providerClass: ProviderClass;
  readonly accountId?: AccountId;
  readonly [PROVIDER_ERROR_BRAND] = true as const;

  constructor(message: string, context: ProviderErrorContext) {
    super(redactCredentials(message), { cause: context.cause });
    this.providerClass = context.providerClass;
    this.accountId = context.accountId;
  }

  /** JSON serialization — excludes stack trace for log safety. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      kind: this.kind,
      message: this.message,
      providerClass: this.providerClass,
      accountId: this.accountId,
      code: (this as unknown as { code?: string }).code,
    };
  }
}

/**
 * Errors the provider has already retried (exhausted) OR did not retry but
 * are recoverable on future attempts. Caller should NOT retry — provider
 * exhausted its budget.
 */
export abstract class TransientError extends ProviderError {
  readonly kind = 'transient' as const;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    context: ProviderErrorContext & { retryAfterMs?: number },
  ) {
    super(message, context);
    this.retryAfterMs = context.retryAfterMs;
  }

  override toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), retryAfterMs: this.retryAfterMs };
  }
}

/** Errors that will fail again deterministically. Caller should NOT retry. */
export abstract class PermanentError extends ProviderError {
  readonly kind = 'permanent' as const;
}

// ── Concrete subclasses ─────────────────────────────────────────

/** 429 / rate-limit / quota-exhausted response from provider. */
export class RateLimitError extends TransientError {
  readonly code = 'RATE_LIMIT' as const;
  constructor(
    ctx: ProviderErrorContext & { retryAfterMs?: number; message?: string },
  ) {
    super(ctx.message ?? 'Rate limit exceeded', ctx);
    this.name = 'RateLimitError';
  }
}

/** Transient network issue — connection drop, DNS, timeout on connect, 5xx. */
export class NetworkError extends TransientError {
  readonly code = 'NETWORK' as const;
  constructor(
    ctx: ProviderErrorContext & { message?: string; retryAfterMs?: number },
  ) {
    super(ctx.message ?? 'Network error during provider invocation', ctx);
    this.name = 'NetworkError';
  }
}

/** Operation timed out. Migrates from CliTimeoutError. */
export class TimeoutError extends TransientError {
  readonly code = 'TIMEOUT' as const;
  readonly timeoutMs: number;
  constructor(ctx: ProviderErrorContext & { timeoutMs: number }) {
    super(`Provider invocation timed out after ${ctx.timeoutMs}ms`, ctx);
    this.name = 'TimeoutError';
    this.timeoutMs = ctx.timeoutMs;
  }
}

/** Authentication failed — bad API key, expired OAuth token, 401. */
export class AuthError extends PermanentError {
  readonly code = 'AUTH' as const;
  constructor(ctx: ProviderErrorContext & { message?: string }) {
    super(ctx.message ?? 'Authentication failed', ctx);
    this.name = 'AuthError';
  }
}

/** Request was malformed or semantically rejected — 400, invalid args. */
export class InvalidRequestError extends PermanentError {
  readonly code = 'INVALID_REQUEST' as const;
  constructor(ctx: ProviderErrorContext & { message?: string }) {
    super(ctx.message ?? 'Invalid request to provider', ctx);
    this.name = 'InvalidRequestError';
  }
}

/** CLI binary exited with non-zero code. Migrates from CliExecutionError. */
export class CliExecutionError extends PermanentError {
  readonly code = 'CLI_EXECUTION' as const;
  readonly exitCode: number;
  readonly stderr: string;
  constructor(
    ctx: ProviderErrorContext & { exitCode: number; stderr: string },
  ) {
    super(
      `CLI exited with code ${ctx.exitCode}: ${redactCredentials(ctx.stderr).slice(0, 200)}`,
      ctx,
    );
    this.name = 'CliExecutionError';
    this.exitCode = ctx.exitCode;
    this.stderr = redactCredentials(ctx.stderr);
  }
}

/** Failed to spawn the CLI binary — binary missing, perms. */
export class CliSpawnError extends PermanentError {
  readonly code = 'CLI_SPAWN' as const;
  readonly binary: string;
  constructor(ctx: ProviderErrorContext & { binary: string; cause: unknown }) {
    super(`Failed to spawn "${ctx.binary}"`, ctx);
    this.name = 'CliSpawnError';
    this.binary = ctx.binary;
  }
}

/** Operator-initiated abort via AbortSignal. */
export class CliAbortError extends PermanentError {
  readonly code = 'CLI_ABORT' as const;
  constructor(ctx: ProviderErrorContext) {
    super('Provider invocation was aborted', ctx);
    this.name = 'CliAbortError';
  }
}

// ── Discriminated union for exhaustive switching ────────────────

export type AnyProviderError =
  | RateLimitError
  | NetworkError
  | TimeoutError
  | AuthError
  | InvalidRequestError
  | CliExecutionError
  | CliSpawnError
  | CliAbortError;
