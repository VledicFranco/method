// SPDX-License-Identifier: Apache-2.0
/**
 * Domain evolution utilities — evidence aggregation and domain theory diffing.
 *
 * These functions support the methodology evolution loop:
 * 1. aggregateEvidence — summarize execution history from retrospectives
 * 2. diffDomainTheory — detect structural changes between domain theory versions
 * 3. classifyDomainChanges — categorize changes as conservative extensions or revisions
 *
 * Pure functions — no Effect dependency.
 */

import type { DomainTheory } from "../domain/domain-theory.js";
import type { MethodologyRetro } from "../runtime/retro.js";

/** Aggregated evidence summary from methodology retrospectives. */
export type EvidenceSummary = {
  readonly totalRuns: number;
  readonly avgCostUsd: number;
  readonly failureRate: number;
  readonly stepFailureRates: Readonly<Record<string, number>>;
};

/**
 * Aggregate evidence from a set of methodology retrospectives.
 * Computes summary statistics: total runs, average cost, failure rate.
 */
export function aggregateEvidence(retros: MethodologyRetro[]): EvidenceSummary {
  if (retros.length === 0) {
    return { totalRuns: 0, avgCostUsd: 0, failureRate: 0, stepFailureRates: {} };
  }

  const totalCost = retros.reduce((sum, r) => sum + r.cost.totalCostUsd, 0);
  const failures = retros.filter((r) => r.status !== "completed").length;

  return {
    totalRuns: retros.length,
    avgCostUsd: totalCost / retros.length,
    failureRate: failures / retros.length,
    // Phase 1 placeholder — step-level failure tracking requires StepResult data
    // in MethodologyRetro, which is not yet available. Will be implemented when
    // retro schema includes per-step failure counts.
    stepFailureRates: {},
  };
}

/** A single structural change to a domain theory. */
export type DomainChange = {
  readonly type:
    | "sort_added"
    | "sort_removed"
    | "axiom_added"
    | "axiom_removed"
    | "predicate_added"
    | "predicate_removed"
    | "function_added"
    | "function_removed";
  readonly name: string;
};

/**
 * Compute the structural diff between two domain theories.
 * Detects additions and removals of sorts, axioms, predicates, and functions.
 */
export function diffDomainTheory<S>(
  before: DomainTheory<S>,
  after: DomainTheory<S>,
): DomainChange[] {
  const changes: DomainChange[] = [];

  // Sorts
  const beforeSorts = new Set(before.signature.sorts.map((s) => s.name));
  const afterSorts = new Set(after.signature.sorts.map((s) => s.name));
  for (const name of afterSorts) {
    if (!beforeSorts.has(name)) changes.push({ type: "sort_added", name });
  }
  for (const name of beforeSorts) {
    if (!afterSorts.has(name)) changes.push({ type: "sort_removed", name });
  }

  // Axioms
  const beforeAxioms = new Set(Object.keys(before.axioms));
  const afterAxioms = new Set(Object.keys(after.axioms));
  for (const name of afterAxioms) {
    if (!beforeAxioms.has(name)) changes.push({ type: "axiom_added", name });
  }
  for (const name of beforeAxioms) {
    if (!afterAxioms.has(name)) changes.push({ type: "axiom_removed", name });
  }

  // Predicates
  const beforePreds = new Set(Object.keys(before.signature.predicates));
  const afterPreds = new Set(Object.keys(after.signature.predicates));
  for (const name of afterPreds) {
    if (!beforePreds.has(name)) changes.push({ type: "predicate_added", name });
  }
  for (const name of beforePreds) {
    if (!afterPreds.has(name)) changes.push({ type: "predicate_removed", name });
  }

  // Function symbols
  const beforeFns = new Set(before.signature.functionSymbols.map((f) => f.name));
  const afterFns = new Set(after.signature.functionSymbols.map((f) => f.name));
  for (const name of afterFns) {
    if (!beforeFns.has(name)) changes.push({ type: "function_added", name });
  }
  for (const name of beforeFns) {
    if (!afterFns.has(name)) changes.push({ type: "function_removed", name });
  }

  return changes;
}

/**
 * Classify a set of domain changes:
 * - "no_change" — empty diff
 * - "conservative_extension" — only additions (backward-compatible)
 * - "axiom_revision" — includes removals (breaking change)
 */
export function classifyDomainChanges(
  changes: DomainChange[],
): "conservative_extension" | "axiom_revision" | "no_change" {
  if (changes.length === 0) return "no_change";
  const hasRemoval = changes.some((c) => c.type.endsWith("_removed"));
  return hasRemoval ? "axiom_revision" : "conservative_extension";
}
