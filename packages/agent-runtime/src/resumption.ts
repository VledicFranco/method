// SPDX-License-Identifier: Apache-2.0
/**
 * Opaque `Resumption` descriptor codec (PRD-058 §5 / §6.4 D4).
 *
 * The public shape (S1 §4.4) exposes only three fields:
 *   - `sessionId`  — human-readable correlation id
 *   - `opaque`     — base64url(JSON(internal)) — tenant apps treat as a black box
 *   - `expiresAt`  — unix ms
 *
 * The internal payload shape (`ResumptionPayload`) is NOT exported from the
 * package barrel. `parseResumption` accepts the outer `Resumption` and
 * recovers the internal payload; `createResumption` does the reverse.
 *
 * Versioning: the internal payload carries `v: 1`. Future bumps branch here.
 */

import { UnknownSessionError } from './errors.js';

/** Public Resumption descriptor (S1 §4.4) — opaque at the boundary. */
export interface Resumption {
  readonly sessionId: string;
  readonly opaque: string;
  readonly expiresAt: number;
}

/**
 * Internal payload. NOT exported from the package barrel. Consumers must
 * treat `Resumption.opaque` as a black box.
 */
export interface ResumptionPayload {
  readonly v: 1;
  readonly sessionId: string;
  readonly checkpointRef?: string;
  readonly budgetRef?: string;
  readonly storeNamespace?: string;
}

/** Default TTL — 7 days. See PRD-058 §12 Judgment Call 2. */
export const DEFAULT_RESUMPTION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Base64url encode without padding. Node-friendly. */
function toBase64Url(s: string): string {
  return Buffer.from(s, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Base64url decode. Supports padded + unpadded inputs. */
function fromBase64Url(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLen), 'base64').toString('utf-8');
}

/**
 * Build an opaque `Resumption` from an internal payload + TTL.
 */
export function createResumption(
  payload: ResumptionPayload,
  ttlMs: number = DEFAULT_RESUMPTION_TTL_MS,
): Resumption {
  const expiresAt = Date.now() + ttlMs;
  const json = JSON.stringify(payload);
  return {
    sessionId: payload.sessionId,
    opaque: toBase64Url(json),
    expiresAt,
  };
}

/**
 * Recover the internal payload from an opaque `Resumption`.
 *
 * Throws {@link UnknownSessionError} if the payload is corrupt, missing a
 * sessionId, or fails the version check.
 */
export function parseResumption(resumption: Resumption): ResumptionPayload {
  if (!resumption || typeof resumption.opaque !== 'string') {
    throw new UnknownSessionError(resumption?.sessionId ?? '');
  }
  let payload: ResumptionPayload | undefined;
  try {
    const raw = fromBase64Url(resumption.opaque);
    const parsed = JSON.parse(raw) as Partial<ResumptionPayload>;
    if (parsed?.v !== 1 || typeof parsed.sessionId !== 'string') {
      throw new UnknownSessionError(resumption.sessionId);
    }
    payload = parsed as ResumptionPayload;
  } catch (err) {
    if (err instanceof UnknownSessionError) throw err;
    throw new UnknownSessionError(resumption.sessionId);
  }
  if (payload.sessionId !== resumption.sessionId) {
    // Defensive: the outer sessionId must match the inner payload.
    throw new UnknownSessionError(resumption.sessionId);
  }
  return payload;
}

/** True when the token has not yet expired. */
export function isResumptionLive(resumption: Resumption, nowMs: number = Date.now()): boolean {
  return resumption.expiresAt > nowMs;
}
