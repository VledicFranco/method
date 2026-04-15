/**
 * SessionStore error taxonomy — PRD-061 / S4 §4.4.
 *
 * Discriminated by `code`. The union MUST stay exhaustive so adapter
 * implementations fail closed on unknown conditions.
 */

export type SessionStoreErrorCode =
  | 'NOT_FOUND'              // no such session / checkpoint
  | 'DUPLICATE'              // create() collision
  | 'FENCED'                 // stale fencing token / lease stolen
  | 'LEASE_EXPIRED'          // lease TTL passed before renew
  | 'SCHEMA_INCOMPATIBLE'    // snapshot.schemaVersion unknown to adapter
  | 'FINGERPRINT_MISMATCH'   // pact drifted since last checkpoint
  | 'QUOTA_EXCEEDED'         // adapter-specific (Mongo quota, disk full)
  | 'BACKEND_UNAVAILABLE'    // transient — caller should retry with backoff
  | 'CORRUPT_SNAPSHOT'       // failed integrity check (hash / JSON parse)
  | 'INTERNAL';              // unknown; implementers must be specific when possible

export interface SessionStoreErrorOptions {
  readonly sessionId?: string;
  readonly retryable?: boolean;
  readonly cause?: unknown;
}

export class SessionStoreError extends Error {
  readonly code: SessionStoreErrorCode;
  readonly sessionId?: string;
  readonly retryable: boolean;
  readonly cause?: unknown;

  constructor(code: SessionStoreErrorCode, message: string, opts: SessionStoreErrorOptions = {}) {
    super(message);
    this.name = 'SessionStoreError';
    this.code = code;
    this.sessionId = opts.sessionId;
    this.retryable = opts.retryable ?? (code === 'BACKEND_UNAVAILABLE');
    this.cause = opts.cause;
  }
}

/** Type guard that survives serialization across HTTP / IPC boundaries. */
export function isSessionStoreError(e: unknown): e is SessionStoreError {
  if (!e || typeof e !== 'object') return false;
  const candidate = e as { name?: unknown; code?: unknown };
  return candidate.name === 'SessionStoreError' && typeof candidate.code === 'string';
}
