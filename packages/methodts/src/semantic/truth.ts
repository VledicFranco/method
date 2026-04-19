// SPDX-License-Identifier: Apache-2.0
/**
 * Truth — The result of a verified claim.
 *
 * Unlike boolean predicates, truths track HOW they were verified:
 * algorithmically (deterministic gate — confidence 1.0) or
 * semantically (LLM judgment — confidence < 1.0).
 *
 * This distinction is operationally load-bearing: composition of
 * algorithmic truths is reliable, composition of semantic truths
 * degrades multiplicatively. Gates are confidence amplifiers —
 * they convert semantic claims into algorithmic truths.
 *
 * @see advice/03-recursive-semantic-algorithms.md — Confidence tracking
 */

// ── Verification method ──

/** How a truth was established. */
export type VerificationMethod =
  | "algorithmic"   // Deterministic: gate test, type check, predicate evaluation → confidence 1.0
  | "semantic";     // LLM judgment: agent assertion, heuristic review → confidence < 1.0

// ── Truth ──

/** A verified claim with provenance. */
export type Truth = {
  /** Human-readable label for the claim. */
  readonly label: string;
  /** Whether the claim holds. */
  readonly holds: boolean;
  /** How the claim was verified. */
  readonly method: VerificationMethod;
  /** Confidence in the verification. 1.0 for algorithmic, (0, 1) for semantic. */
  readonly confidence: number;
};

// ── Constructors ──

/** An algorithmically verified truth (confidence = 1.0). */
export function algorithmic(label: string, holds: boolean): Truth {
  return { label, holds, method: "algorithmic", confidence: 1.0 };
}

/** A semantically asserted truth (confidence < 1.0). */
export function semantic(label: string, holds: boolean, confidence: number): Truth {
  return { label, holds, method: "semantic", confidence: Math.min(Math.max(confidence, 0), 1) };
}

// ── Composition ──

/** Multiply confidences for sequential composition (worst-case chaining). */
export function sequentialConfidence(truths: readonly Truth[]): number {
  return truths.reduce((acc, t) => acc * t.confidence, 1.0);
}

/** Parallel confidence: 1 - ∏(1 - p_i) — at least one succeeds. */
export function parallelConfidence(truths: readonly Truth[]): number {
  return 1 - truths.reduce((acc, t) => acc * (1 - t.confidence), 1.0);
}

/** Partition truths by verification method. */
export function partition(truths: readonly Truth[]): {
  algorithmic: readonly Truth[];
  semantic: readonly Truth[];
} {
  const alg: Truth[] = [];
  const sem: Truth[] = [];
  for (const t of truths) {
    if (t.method === "algorithmic") alg.push(t);
    else sem.push(t);
  }
  return { algorithmic: alg, semantic: sem };
}

/** All truths hold? */
export function allHold(truths: readonly Truth[]): boolean {
  return truths.every((t) => t.holds);
}
