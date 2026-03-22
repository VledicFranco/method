/**
 * M1_IMPL — Method for Implementing Software from Architecture and PRDs (M1-IMPL v3.1).
 *
 * 9 steps in a linear DAG:
 *   Phase A (confidence raising): Inventory → Cross-Reference → Fix → Verify and Decide
 *   Phase B (implementation):     Orient → Diff → Implement → Validate → Record
 *
 * Two-phase structure: Phase A raises implementation confidence to a threshold by
 * auditing the spec corpus against source; Phase B executes implementation tasks
 * under validated specs. The YAML has a Phase A re-entry loop (sigma_A4 -> sigma_A1)
 * but for the stdlib we implement as a linear DAG with all steps in sequence.
 *
 * Phase 1b: all steps are script execution. Agent prompts are deferred
 * to Phase 2 when the provider system is wired in.
 */

import { Effect } from "effect";
import type { Method } from "../../../method/method.js";
import type { Step } from "../../../method/step.js";
import type { StepDAG } from "../../../method/dag.js";
import type { DomainTheory } from "../../../domain/domain-theory.js";
import type { Role } from "../../../domain/role.js";
import { check, TRUE } from "../../../predicate/predicate.js";

// ── State ──

type ImplState = {
  // Phase A state
  readonly specCorpusItems: number;
  readonly sourceFilesRead: number;
  readonly discrepancyCount: number;
  readonly unresolvedCritical: number;
  readonly unresolvedHigh: number;
  readonly severityRechecked: boolean;
  readonly confidenceScore: number;
  readonly goNoGoDecision: boolean;
  // Phase B state
  readonly taskRef: string;
  readonly filesChanged: readonly string[];
  readonly divergences: readonly string[];
  readonly decisions: readonly string[];
  readonly compileGate: "PASS" | "FAIL" | "NOT_RUN";
  readonly testPassCount: number;
  readonly testFailCount: number;
  readonly sessionRecorded: boolean;
};

// ── Domain Theory ──

const D_SI: DomainTheory<ImplState> = {
  id: "D_SI",
  signature: {
    sorts: [
      { name: "PhaseDoc", description: "The phase implementation plan", cardinality: "finite" },
      { name: "SourceFile", description: "A source file in scope", cardinality: "finite" },
      { name: "TestFile", description: "A test file", cardinality: "finite" },
      { name: "ArchDoc", description: "Architecture document", cardinality: "finite" },
      { name: "OrgDoc", description: "Organizational/top-tier document", cardinality: "finite" },
      { name: "MutationRecord", description: "A record of mutations applied during session", cardinality: "finite" },
      { name: "Task", description: "An implementation task from the PhaseDoc", cardinality: "finite" },
      { name: "Session", description: "A methodology session", cardinality: "finite" },
      { name: "Finding", description: "A finding from audit or review", cardinality: "finite" },
      { name: "Divergence", description: "A divergence from spec", cardinality: "finite" },
    ],
    functionSymbols: [],
    predicates: {
      inventory_complete: check<ImplState>("inventory_complete", (s) => s.specCorpusItems > 0 && s.sourceFilesRead > 0),
      catalog_complete: check<ImplState>("catalog_complete", (s) => s.discrepancyCount >= 0),
      fixes_applied: check<ImplState>("fixes_applied", (s) => s.unresolvedCritical === 0 && s.unresolvedHigh === 0 && s.severityRechecked),
      go_no_go: check<ImplState>("go_no_go", (s) => s.goNoGoDecision),
      oriented: check<ImplState>("oriented", (s) => s.taskRef.length > 0),
      diff_written: check<ImplState>("diff_written", (s) => s.filesChanged.length > 0),
      code_written: check<ImplState>("code_written", (s) => s.filesChanged.length > 0),
      build_clean: check<ImplState>("build_clean", (s) => s.compileGate === "PASS" && s.testFailCount === 0),
      session_recorded: check<ImplState>("session_recorded", (s) => s.sessionRecorded),
    },
  },
  axioms: {},
};

// ── Roles ──

const auditor: Role<ImplState> = {
  id: "auditor",
  description: "Pre-implementation. Reads spec corpus and existing source; produces confidence score; identifies and fixes discrepancies.",
  observe: (s) => s,
  authorized: ["sigma_0", "sigma_1", "sigma_2", "sigma_3"],
  notAuthorized: [],
};

const implementor: Role<ImplState> = {
  id: "implementor",
  description: "Writes production code. Works against verified spec. Records divergences. Never skips validation.",
  observe: (s) => s,
  authorized: ["sigma_4", "sigma_5", "sigma_6", "sigma_7", "sigma_8"],
  notAuthorized: [],
};

// ── Steps ──

const steps: Step<ImplState>[] = [
  // Phase A
  {
    id: "sigma_0",
    name: "Inventory",
    role: "auditor",
    precondition: TRUE,
    postcondition: check("inventory_complete", (s: ImplState) => s.specCorpusItems > 0 && s.sourceFilesRead > 0),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_1",
    name: "Cross-Reference",
    role: "auditor",
    precondition: check("inventory_complete", (s: ImplState) => s.specCorpusItems > 0 && s.sourceFilesRead > 0),
    postcondition: check("catalog_complete", (s: ImplState) => s.discrepancyCount >= 0),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_2",
    name: "Fix",
    role: "auditor",
    precondition: check("catalog_complete", (s: ImplState) => s.discrepancyCount >= 0),
    postcondition: check("fixes_applied", (s: ImplState) => s.unresolvedCritical === 0 && s.unresolvedHigh === 0 && s.severityRechecked),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_3",
    name: "Verify and Decide",
    role: "auditor",
    precondition: check("fixes_applied", (s: ImplState) => s.unresolvedCritical === 0 && s.unresolvedHigh === 0 && s.severityRechecked),
    postcondition: check("go_no_go", (s: ImplState) => s.goNoGoDecision && s.confidenceScore >= 0.85),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  // Phase B
  {
    id: "sigma_4",
    name: "Orient",
    role: "implementor",
    precondition: check("go_no_go", (s: ImplState) => s.goNoGoDecision),
    postcondition: check("oriented", (s: ImplState) => s.taskRef.length > 0),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_5",
    name: "Diff",
    role: "implementor",
    precondition: check("oriented", (s: ImplState) => s.taskRef.length > 0),
    postcondition: check("diff_written", (s: ImplState) => s.filesChanged.length > 0),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_6",
    name: "Implement",
    role: "implementor",
    precondition: check("diff_written", (s: ImplState) => s.filesChanged.length > 0),
    postcondition: check("code_written", (s: ImplState) => s.filesChanged.length > 0),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_7",
    name: "Validate",
    role: "implementor",
    precondition: check("code_written", (s: ImplState) => s.filesChanged.length > 0),
    postcondition: check("build_clean", (s: ImplState) => s.compileGate === "PASS" && s.testFailCount === 0),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_8",
    name: "Record",
    role: "implementor",
    precondition: check("build_clean", (s: ImplState) => s.compileGate === "PASS" && s.testFailCount === 0),
    postcondition: check("session_recorded", (s: ImplState) => s.sessionRecorded),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
];

// ── DAG ──

const dag: StepDAG<ImplState> = {
  steps,
  edges: [
    { from: "sigma_0", to: "sigma_1" },
    { from: "sigma_1", to: "sigma_2" },
    { from: "sigma_2", to: "sigma_3" },
    { from: "sigma_3", to: "sigma_4" },
    { from: "sigma_4", to: "sigma_5" },
    { from: "sigma_5", to: "sigma_6" },
    { from: "sigma_6", to: "sigma_7" },
    { from: "sigma_7", to: "sigma_8" },
  ],
  initial: "sigma_0",
  terminal: "sigma_8",
};

// ── Progress measures ──

function implProgress(s: ImplState): number {
  let stage = 0;
  // Phase A
  if (s.specCorpusItems > 0 && s.sourceFilesRead > 0) stage = 1;
  if (s.discrepancyCount >= 0 && stage >= 1) stage = 2;
  if (s.unresolvedCritical === 0 && s.unresolvedHigh === 0 && s.severityRechecked) stage = 3;
  if (s.goNoGoDecision) stage = 4;
  // Phase B
  if (s.taskRef.length > 0 && stage >= 4) stage = 5;
  if (s.filesChanged.length > 0 && stage >= 5) stage = 6;
  if (s.filesChanged.length > 0 && stage >= 6) stage = 7;
  if (s.compileGate === "PASS" && s.testFailCount === 0 && stage >= 7) stage = 8;
  if (s.sessionRecorded) stage = 9;
  return stage / 9;
}

// ── Method ──

/** M1_IMPL — Method for Implementing Software from Architecture and PRDs (v3.1). 9 steps, linear DAG. */
export const M1_IMPL: Method<ImplState> = {
  id: "M1-IMPL",
  name: "Method for Implementing Software from Architecture and PRDs",
  domain: D_SI,
  roles: [auditor, implementor],
  dag,
  objective: check("session_complete", (s: ImplState) =>
    s.sessionRecorded && s.compileGate === "PASS" && s.testFailCount === 0,
  ),
  measures: [
    {
      id: "mu_compile_integrity",
      name: "Compile Integrity",
      compute: (s: ImplState) => (s.compileGate === "PASS" ? 1 : 0),
      range: [0, 1],
      terminal: 1,
    },
    {
      id: "mu_test_stability",
      name: "Test Stability",
      compute: (s: ImplState) => {
        const total = s.testPassCount + s.testFailCount;
        return total > 0 ? s.testPassCount / total : 0;
      },
      range: [0, 1],
      terminal: 1,
    },
    {
      id: "mu_impl_progress",
      name: "Implementation Progress",
      compute: implProgress,
      range: [0, 1],
      terminal: 1,
    },
  ],
};
