/**
 * stdlib state types — domain-specific state shapes for methodology execution.
 *
 * Each type corresponds to the state a specific method or methodology operates on.
 * All fields are readonly for immutability (Σ-structures are snapshots).
 *
 * @see F1-FTH Def 1.2 — Σ-structure instantiation
 */

/** Meta-methodology state — what P0-META operates on. */
export type MetaState = {
  readonly targetRegistry: readonly string[];
  readonly compiledMethods: readonly string[];
  readonly highGapMethods: readonly string[];
  readonly needsInstantiation: readonly string[];
  readonly composablePairs: readonly [string, string][];
  readonly informalPractices: readonly string[];
  readonly selfConsistentMethods: readonly string[];
};

/** Method design state — what M1-MDES operates on. */
export type DesignState = {
  readonly domainKnowledge: string;
  readonly candidateComponents: readonly string[];
  readonly gateVerdicts: Readonly<Record<string, "PASS" | "FAIL" | null>>;
  readonly sufficiencyDecision: "proceed" | "redirect" | null;
  readonly guidanceFinalized: boolean;
  readonly compiled: boolean;
};

/** Evolution state — what M3-MEVO operates on. */
export type EvolutionState = {
  readonly targetMethod: string;
  readonly gaps: readonly { name: string; severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" }[];
  readonly evidenceSummary: string;
  readonly proposedChanges: readonly string[];
  readonly recompiled: boolean;
};

/** Instantiation state — what M4-MINS operates on. */
export type InstantiationState = {
  readonly methodId: string;
  readonly projectContext: string;
  readonly boundMethod: boolean;
  readonly validated: boolean;
};
