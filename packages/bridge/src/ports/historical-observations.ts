// SPDX-License-Identifier: Apache-2.0
/**
 * HistoricalObservations — Port interface (PRD 051 S5).
 *
 * Consumed by cost-governor domain (CostOracle reads history).
 * Implemented by ObservationsStore in cost-governor domain.
 */

import type { InvocationSignature, ProviderClass, AccountId } from '@methodts/types';

// ── Observation record ──────────────────────────────────────────

export interface Observation {
  readonly signature: InvocationSignature;
  readonly costUsd: number;
  readonly durationMs: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly tokensCacheRead: number;
  readonly tokensCacheWrite: number;
  readonly recordedAt: number;
  readonly accountId: AccountId;
  readonly providerClass: ProviderClass;
  readonly hmac: string;
}

// ── Capability token ────────────────────────────────────────────

/**
 * Opaque capability — only the composition root creates one and
 * passes it to the RateGovernor. Prevents poisoning via hostile
 * strategy authors.
 */
declare const __appendTokenBrand: unique symbol;
export type AppendToken = { readonly [__appendTokenBrand]: true };

/** Create an AppendToken. Only call this in the composition root. */
export function createAppendToken(): AppendToken {
  return Object.freeze({} as AppendToken);
}

// ── Port interface ──────────────────────────────────────────────

export interface HistoricalObservations {
  /** Query observations matching a signature, newest first. */
  query(sig: InvocationSignature, limit?: number): readonly Observation[];

  /** Append an observation. Requires a capability token. */
  append(obs: Omit<Observation, 'hmac'>, token: AppendToken): void;
}
