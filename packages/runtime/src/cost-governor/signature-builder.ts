// SPDX-License-Identifier: Apache-2.0
/**
 * Signature Builder — canonicalizes invocation parameters into
 * an InvocationSignature for cost prediction lookups.
 */

import type { InvocationSignature } from '@methodts/types';

/** Input size bucket thresholds (character count). */
const SIZE_THRESHOLDS = {
  xs: 1_000,
  s: 10_000,
  m: 100_000,
  l: 1_000_000,
} as const;

export function inputSizeBucket(
  charCount: number,
): InvocationSignature['inputSizeBucket'] {
  if (charCount < SIZE_THRESHOLDS.xs) return 'xs';
  if (charCount < SIZE_THRESHOLDS.s) return 's';
  if (charCount < SIZE_THRESHOLDS.m) return 'm';
  if (charCount < SIZE_THRESHOLDS.l) return 'l';
  return 'xl';
}

/**
 * Build a canonical InvocationSignature from invocation parameters.
 * Capabilities are sorted for stable hashing.
 */
export function buildSignature(params: {
  methodologyId: string;
  capabilities: readonly string[];
  model: string;
  promptCharCount: number;
}): InvocationSignature {
  return {
    methodologyId: params.methodologyId,
    capabilities: [...params.capabilities].sort(),
    model: params.model,
    inputSizeBucket: inputSizeBucket(params.promptCharCount),
  };
}

/**
 * Produce a stable string hash for an InvocationSignature.
 * Used as Map key for observation lookups.
 */
export function signatureKey(sig: InvocationSignature): string {
  return `${sig.methodologyId}|${sig.capabilities.join(',')}|${sig.model}|${sig.inputSizeBucket}`;
}
