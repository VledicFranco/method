---
type: co-design-record
surface: "ProviderError"
date: "2026-04-05"
owner: "pacta"
producer: "pacta (abstract base) + pacta-provider-* (concrete subclasses)"
consumer: "methodts dag-executor, pacta Throttler middleware, bridge strategies/sessions domains, MCP handlers"
direction: "providers → all callers (unidirectional, error-throw)"
status: frozen
mode: "new + breaking-migration"
prd: "051 — Cost Governor"
blocks: "PRD-051 Wave 0 W0.4, C-2, C-3, C-4"
---

# Co-Design Record — ProviderError Taxonomy

## Context

PRD 051 (Cost Governor) requires distinguishing **transient** errors (provider already retried, caller should not retry) from **permanent** errors (will fail again deterministically). Today, all provider errors extend raw `Error` with no discriminator — callers use string-matching or loose `instanceof` checks, producing double-retries and misclassifications.

**Retry ownership contract:**
- **Provider owns transient retries.** Claude-cli retries 429 internally with exponential backoff + `retry-after` respect. If exhausted, throws `RateLimitError` (TransientError).
- **DAG owns semantic retries.** DAG retries gate failures (node output didn't pass validation), NOT provider errors. Both `transient` and `permanent` are final at the DAG level; the discriminator feeds telemetry, not retry policy.

This prevents double-retry (provider 3× backoff × DAG 3× retry = 9 attempts) and centralizes rate-limit handling at the right layer.

## Interface

**File:** `packages/pacta/src/errors.ts` (new)

```typescript
import type { ProviderClass, AccountId } from '@methodts/types';

// ── Branding for cross-module instanceof safety ─────────────────────
/** Symbol brand prevents instanceof false-negatives when pacta loads twice
 *  (monorepo symlink/bundle hazards). Use `isProviderError(x)` not `instanceof`. */
const PROVIDER_ERROR_BRAND = Symbol.for('pacta.ProviderError');
type BrandedError = Error & { readonly [PROVIDER_ERROR_BRAND]: true };

/** Cross-realm-safe check. Prefer this over `instanceof ProviderError`. */
export function isProviderError(x: unknown): x is ProviderError {
  return typeof x === 'object' && x !== null && (x as BrandedError)[PROVIDER_ERROR_BRAND] === true;
}

export function isTransientError(x: unknown): x is TransientError {
  return isProviderError(x) && x.kind === 'transient';
}

export function isPermanentError(x: unknown): x is PermanentError {
  return isProviderError(x) && x.kind === 'permanent';
}

// ── Redaction helper ────────────────────────────────────────────────
/** Strips API-key patterns from error messages before surfacing.
 *  MUST be called at construction time. Patterns: sk-ant-*, JWT shape, Bearer tokens. */
export function redactCredentials(message: string): string {
  return message
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-[REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT-REDACTED]')
    .replace(/(Bearer|Authorization:\s*Bearer)\s+\S+/gi, '$1 [REDACTED]');
}

// ── Base taxonomy ──────────────────────────────────────────────────
export interface ProviderErrorContext {
  readonly providerClass: ProviderClass;
  readonly accountId?: AccountId;
  /** ES2022 Error.cause — wraps the underlying error when applicable. */
  readonly cause?: unknown;
}

export abstract class ProviderError extends Error implements BrandedError {
  /** Discriminator — use via `err.kind === 'transient'` for narrowing. */
  abstract readonly kind: 'transient' | 'permanent';
  readonly providerClass: ProviderClass;
  readonly accountId?: AccountId;
  readonly [PROVIDER_ERROR_BRAND] = true as const;

  constructor(message: string, context: ProviderErrorContext) {
    // Redact credentials from message before passing to Error constructor
    super(redactCredentials(message), { cause: context.cause });
    this.providerClass = context.providerClass;
    this.accountId = context.accountId;
  }

  /** JSON serialization — excludes stack trace for log safety. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      kind: this.kind,
      message: this.message,       // already redacted at construction
      providerClass: this.providerClass,
      accountId: this.accountId,
      code: (this as unknown as { code?: string }).code,  // dual-emit legacy field
    };
  }
}

/** Errors the provider has already retried (exhausted) OR did not retry but are
 *  recoverable on future attempts. Caller should NOT retry — provider exhausted its budget. */
export abstract class TransientError extends ProviderError {
  readonly kind = 'transient' as const;
  /** How long to wait before retrying, if the provider returned guidance (e.g., Retry-After header). */
  readonly retryAfterMs?: number;

  constructor(message: string, context: ProviderErrorContext & { retryAfterMs?: number }) {
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

// ── Concrete subclasses (re-homed from existing provider-specific classes) ──

/** 429 / rate-limit / quota-exhausted response from provider. */
export class RateLimitError extends TransientError {
  readonly code = 'RATE_LIMIT' as const;
  constructor(ctx: ProviderErrorContext & { retryAfterMs?: number; message?: string }) {
    super(ctx.message ?? 'Rate limit exceeded', ctx);
    this.name = 'RateLimitError';
  }
}

/** Transient network issue — connection drop, DNS, timeout on connect, 5xx. */
export class NetworkError extends TransientError {
  readonly code = 'NETWORK' as const;
  constructor(ctx: ProviderErrorContext & { message?: string; retryAfterMs?: number }) {
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

/** Authentication failed — bad API key, expired OAuth token, 401. Permanent until key rotated. */
export class AuthError extends PermanentError {
  readonly code = 'AUTH' as const;
  constructor(ctx: ProviderErrorContext & { message?: string }) {
    super(ctx.message ?? 'Authentication failed', ctx);
    this.name = 'AuthError';
  }
}

/** Request was malformed or semantically rejected — 400, invalid args, schema violation. */
export class InvalidRequestError extends PermanentError {
  readonly code = 'INVALID_REQUEST' as const;
  constructor(ctx: ProviderErrorContext & { message?: string }) {
    super(ctx.message ?? 'Invalid request to provider', ctx);
    this.name = 'InvalidRequestError';
  }
}

/** CLI binary exited with non-zero code. Migrates from CliExecutionError.
 *  Preserves exitCode + stderr fields for source compatibility. */
export class CliExecutionError extends PermanentError {
  readonly code = 'CLI_EXECUTION' as const;
  readonly exitCode: number;
  readonly stderr: string;
  constructor(ctx: ProviderErrorContext & { exitCode: number; stderr: string }) {
    super(`CLI exited with code ${ctx.exitCode}: ${redactCredentials(ctx.stderr).slice(0, 200)}`, ctx);
    this.name = 'CliExecutionError';
    this.exitCode = ctx.exitCode;
    this.stderr = redactCredentials(ctx.stderr);  // redact stderr too
  }
}

/** Failed to spawn the CLI binary — binary missing, perms. Migrates from CliSpawnError. */
export class CliSpawnError extends PermanentError {
  readonly code = 'CLI_SPAWN' as const;
  readonly binary: string;
  constructor(ctx: ProviderErrorContext & { binary: string; cause: unknown }) {
    super(`Failed to spawn "${ctx.binary}"`, ctx);
    this.name = 'CliSpawnError';
    this.binary = ctx.binary;
  }
}

/** Operator-initiated abort via AbortSignal. Migrates from CliAbortError.
 *  Classified as permanent because it's intentional cancellation, not a retry candidate. */
export class CliAbortError extends PermanentError {
  readonly code = 'CLI_ABORT' as const;
  constructor(ctx: ProviderErrorContext) {
    super('Provider invocation was aborted', ctx);
    this.name = 'CliAbortError';
  }
}

// ── Narrowing discriminated union (for exhaustive switching) ────────
export type AnyProviderError =
  | RateLimitError
  | NetworkError
  | TimeoutError
  | AuthError
  | InvalidRequestError
  | CliExecutionError
  | CliSpawnError
  | CliAbortError;
```

## Design Decisions

### Why abstract base + abstract subclasses?

The two-level abstraction (`ProviderError` → `{PermanentError, TransientError}` → concrete) allows three levels of catching:
- `catch (err) if isProviderError(err)` — any error from a provider
- `catch (err) if isTransientError(err)` — "wait and maybe retry later" errors for telemetry
- `catch (err) if err instanceof RateLimitError` — specific recovery action

### Why `Symbol.for('pacta.ProviderError')` branding?

Monorepo hazard (F-R-16): if `@methodts/pacta` is loaded twice (symlink + install mismatch, bundler hoisting issue), `instanceof ProviderError` returns `false` for errors thrown from a different module instance. `Symbol.for` is cross-realm: two realms share the same symbol via the global symbol registry. The `isProviderError` helper is the safe cross-module check.

### Why `code` field on concrete subclasses?

Preserves the `.code`-based catch pattern from legacy callers during migration:
```typescript
// old code:
if (err.name === 'CliExecutionError') { ... }
// new code:
if (err.code === 'CLI_EXECUTION') { ... }  // same check works — .code is stable
// or:
if (err instanceof CliExecutionError) { ... }  // still works — same class name
```

Dual-emit preserves both `.name` and `.code` for 2 minor versions (documented migration period).

### Why redact at construction time?

If message redaction happens on log emission, every logger must know the redaction rules. Redacting at construction means: the error message on the instance is **already safe**, regardless of which sink eventually serializes it. Defense-in-depth for F-S-11 (log redaction) and F-S-14 (provider-level logging).

### Why not `kind: 'cancelled'` for aborts?

Initially considered. Rejected because:
- The DAG retry decision for abort is identical to permanent error (don't retry).
- Telemetry distinction is already available via the concrete class name (`CliAbortError`).
- Adding a third kind complicates exhaustive switching and has no consumer with differentiated handling.

If a future consumer needs differentiated handling, they can check `err instanceof CliAbortError` directly.

### Retry-ownership contract (restated)

| Error kind | Provider retries? | Caller retries? | Telemetry signal |
|---|---|---|---|
| `transient` subclass | YES (already exhausted before throwing) | NO | "maybe try later" to operator |
| `permanent` subclass | NO (wouldn't help) | NO | "fix root cause" to operator |

At the DAG level, both produce a node failure. The distinction lives in event emission (`cost.rate_limited` vs `cost.auth_failed`) and operator dashboards.

## Migration Mapping

| Legacy class | Package | New base | New concrete | Change type |
|---|---|---|---|---|
| `CliTimeoutError` | pacta-provider-claude-cli | TransientError | `TimeoutError` | Renamed; `.name` preserved via compat alias |
| `CliSpawnError` | pacta-provider-claude-cli | PermanentError | `CliSpawnError` (re-homed) | Re-based; `.name` + `.binary` preserved |
| `CliExecutionError` | pacta-provider-claude-cli | PermanentError | `CliExecutionError` (re-homed) | Re-based; `.name` + `.exitCode` + `.stderr` preserved |
| `CliAbortError` | pacta-provider-claude-cli | PermanentError | `CliAbortError` (re-homed) | Re-based; `.name` preserved |
| `AnthropicApiError` | pacta-provider-anthropic | varies by status code | `RateLimitError` (429), `AuthError` (401), `InvalidRequestError` (400), `NetworkError` (5xx) | **Splits** — classification required per response |
| `OllamaApiError` | pacta-provider-ollama | varies | `NetworkError` (connect fail), `InvalidRequestError` (400) | Splits |

**Source compat:** `CliSpawnError`, `CliExecutionError`, `CliAbortError` keep their exported class names. Legacy `instanceof CliExecutionError` still works. `CliTimeoutError` becomes a **deprecated alias** for `TimeoutError` (re-exported) for 2 versions.

## Migration Audit Checklist

Before Wave 2 (C-2, C-3, C-4) merges, greps are run across all packages:

```bash
# Callers checking .code
grep -rn "err\.code\s*===" packages/ --include="*.ts"

# Callers checking .name
grep -rn "err\.name\s*===" packages/ --include="*.ts"

# String-matching on .message (brittle, should migrate to .code)
grep -rn "err\.message\.includes" packages/ --include="*.ts"
grep -rn "err\.message\.match" packages/ --include="*.ts"

# JSON.stringify on errors (migration risk — shape changes)
grep -rn "JSON\.stringify.*[Ee]rr" packages/ --include="*.ts"

# instanceof checks that may need .kind discriminator
grep -rn "instanceof.*Error" packages/ --include="*.ts"
```

Each hit must be evaluated:
- ✅ Using `.code` or `instanceof ConcreteClass` → preserved, OK
- ⚠️ Using `.name` string comparison → still works via dual-emit, but prefer `.code`
- ⚠️ Using `.message` string-match → migrate to `.code` or `.kind`
- ❌ Using `JSON.stringify(err)` shape assumptions → update to new schema (new fields: `kind`, `providerClass`, `accountId`)

## Producer

- **Domain:** pacta (L3 SDK)
- **Implementation:** `packages/pacta/src/errors.ts` (new file with full taxonomy)
- **Re-exports to concrete-subclass files:**
  - `packages/pacta-provider-claude-cli/src/cli-executor.ts` — re-export + construct on throw
  - `packages/pacta-provider-anthropic/src/anthropic-provider.ts` — classify + construct on throw
  - `packages/pacta-provider-ollama/src/ollama-provider.ts` — classify + construct on throw
- **Wiring:** no DI needed — error classes are values. Providers directly import and construct.

## Consumers

| Consumer | File | Usage |
|---|---|---|
| methodts DAG executor | `packages/methodts/src/strategy/dag-executor.ts:548-590` | Catch `ProviderError`, read `.kind`, treat both kinds as node failure; emit distinct telemetry |
| pacta Throttler middleware | `packages/pacta/src/middleware/throttler.ts` (new, C-2 scope) | Catch in try/finally; map to `ObserveOutcome.outcome`: `rate_limited` / `transient_error` / `permanent_error` |
| Bridge strategy executor | `packages/bridge/src/domains/strategies/strategy-executor.ts` | Propagates typed errors up to DAG |
| Bridge print-session | `packages/bridge/src/domains/sessions/print-session.ts` | Catches at session boundary for UI surfacing (sanitized message) |
| MCP tool handlers | `packages/mcp/src/tools/*.ts` | Map to tool error responses with sanitized user-facing messages |

**Injection approach:** Error types are imported as types (and constructors used at throw sites). No runtime injection — errors flow as exceptions through the call stack.

## Gate Assertions

Added to `packages/bridge/src/shared/architecture.test.ts` in Wave 0 (W0.6):

```typescript
// G-PORT: Providers throw ProviderError subclasses, not raw Error
describe('G-PORT: Provider errors use the ProviderError taxonomy', () => {
  const providerFiles = [
    'packages/pacta-provider-claude-cli/src/cli-executor.ts',
    'packages/pacta-provider-claude-cli/src/claude-cli-provider.ts',
    'packages/pacta-provider-anthropic/src/anthropic-provider.ts',
    'packages/pacta-provider-ollama/src/ollama-provider.ts',
  ];

  it('no bare "throw new Error(...)" in provider source', () => {
    const violations: string[] = [];
    for (const file of providerFiles) {
      const content = readFileSync(file, 'utf-8');
      // Match: throw new Error(...) but NOT throw new SomeSpecificError(...)
      const bareErrors = [...content.matchAll(/throw\s+new\s+Error\b/g)];
      if (bareErrors.length > 0) {
        violations.push(`${file}: ${bareErrors.length} bare throw new Error(...)`);
      }
    }
    assert.deepStrictEqual(violations, [], [
      'G-PORT violation: provider code must throw ProviderError subclasses.',
      'Use RateLimitError, AuthError, NetworkError, etc. with providerClass context.',
      '',
      ...violations,
    ].join('\n'));
  });

  it('provider imports from pacta errors module', () => {
    const violations: string[] = [];
    for (const file of providerFiles) {
      const content = readFileSync(file, 'utf-8');
      // Must import at least one of: ProviderError, PermanentError, TransientError, or a concrete subclass
      const hasImport = /from\s+['"]@method\/pacta['"]/.test(content) &&
                        /import.*\b(ProviderError|PermanentError|TransientError|RateLimitError|AuthError|NetworkError|TimeoutError|InvalidRequestError|CliExecutionError|CliSpawnError|CliAbortError)\b/.test(content);
      if (!hasImport) violations.push(`${file}: no ProviderError import`);
    }
    assert.deepStrictEqual(violations, [], [
      'G-PORT violation: providers must import error taxonomy from @methodts/pacta.',
      '',
      ...violations,
    ].join('\n'));
  });
});

// G-CREDENTIALS: error messages do not contain raw credential patterns
describe('G-CREDENTIALS: Errors redact credentials at construction', () => {
  it('redactCredentials function exists and strips known patterns', async () => {
    const { redactCredentials } = await import('@methodts/pacta');
    assert.equal(
      redactCredentials('auth failed for sk-ant-api03-abcdef1234'),
      'auth failed for sk-ant-[REDACTED]',
    );
    assert.equal(
      redactCredentials('Bearer eyJ.abc.eyJ.def.xyz'),
      'Bearer [JWT-REDACTED]',
    );
  });
});
```

## Agreement

**Frozen:** 2026-04-05
**Unblocks:** PRD 051 Wave 0 item W0.4; commissions C-2 (pacta), C-3 (claude-cli), C-4 (anthropic).

**Changes after freeze require:**
- Extension (new concrete subclass) → inline note in this record, no new session.
- New base kind (e.g., `kind: 'cancelled'`) → new `/fcd-surface` session.
- Constructor signature change → new session + migration plan.
- Field removal or rename → new session + migration plan.

**Reviewers (implicit via FCD discipline):** PO + C-2/C-3/C-4 commission implementers must work against this contract.
