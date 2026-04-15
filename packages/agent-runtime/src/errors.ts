/**
 * Error taxonomy for `@method/agent-runtime` (PRD-058 §6.5, S1 §4.6).
 *
 * Four composition/runtime errors originate in this package:
 *   - `ConfigurationError`  — options violate a strict-mode rule or peer-dep mismatch
 *   - `MissingCtxError`     — required `ctx.*` facade absent
 *   - `UnknownSessionError` — `resume()` hit a session that storage doesn't know
 *   - `IllegalStateError`   — `events()` called when `onEvent` was provided (or vice versa)
 *
 * All pacta error types pass through unchanged via the barrel re-export in
 * `index.ts`. Consumers never need to import from `@method/pacta` directly.
 */

/** Thrown at composition time when CreateMethodAgentOptions is invalid. */
export class ConfigurationError extends Error {
  readonly code = 'CONFIGURATION' as const;
  readonly reasons: ReadonlyArray<string>;

  constructor(message: string, reasons: ReadonlyArray<string> = []) {
    super(message);
    this.name = 'ConfigurationError';
    this.reasons = reasons;
  }
}

/** Thrown at composition time when a required ctx.* facade is absent. */
export class MissingCtxError extends Error {
  readonly code = 'MISSING_CTX' as const;
  readonly missing: ReadonlyArray<string>;

  constructor(missing: ReadonlyArray<string>) {
    super(
      `Cortex ctx is missing required facade(s): ${missing.join(', ')}. ` +
        `See PRD-058 §3.3 / S1 §4.1 for the structural contract and R1 mitigation notes.`,
    );
    this.name = 'MissingCtxError';
    this.missing = missing;
  }
}

/** Thrown at resume() time when no session matches the resumption token. */
export class UnknownSessionError extends Error {
  readonly code = 'UNKNOWN_SESSION' as const;
  readonly sessionId: string;

  constructor(sessionId: string) {
    super(`No session matching resumption token (sessionId=${sessionId}).`);
    this.name = 'UnknownSessionError';
    this.sessionId = sessionId;
  }
}

/** Thrown when events() is called but onEvent was provided (or vice versa). */
export class IllegalStateError extends Error {
  readonly code = 'ILLEGAL_STATE' as const;

  constructor(message: string) {
    super(message);
    this.name = 'IllegalStateError';
  }
}
