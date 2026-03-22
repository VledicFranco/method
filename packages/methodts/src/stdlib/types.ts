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

/** Discovery state — what M2-MDIS operates on. */
export type DiscoveryState = {
  readonly informalPractice: string;
  readonly recognition: string;
  readonly draft: string;
  readonly trialResult: "pending" | "success" | "failed" | null;
  readonly evaluationResult: "promote" | "archive" | "revise" | null;
  readonly outcome: "compiled_method" | "promoted_axiom" | "archived" | null;
  readonly candidateComponents: readonly string[];
};

/** Instantiation state — what M4-MINS operates on. */
export type InstantiationState = {
  readonly methodId: string;
  readonly projectContext: string;
  readonly domainMorphism: string;
  readonly boundSteps: readonly string[];
  readonly roleFiles: readonly string[];
  readonly validated: boolean;
};

/** Composition state — what M5-MCOM operates on. */
export type CompositionState = {
  readonly methodA: string;
  readonly methodB: string;
  readonly mergedDomain: boolean;
  readonly composedDAG: boolean;
  readonly unifiedRoles: boolean;
  readonly compiled: boolean;
};

/** Derivation state — what M7-DTID operates on. */
export type DerivationState = {
  readonly sourceMethodId: string;
  readonly domainAnalysis: string;
  readonly implementationPlan: readonly string[];
  readonly derivedArtifacts: readonly string[];
  readonly faithfulnessChecked: boolean;
  readonly idd: string;
};

// ── P1-EXEC method states ──

/** Council state — what M1-COUNCIL operates on. */
export type CouncilState = {
  readonly challenge: string;
  readonly questions: readonly string[];
  readonly characterCards: readonly string[];
  readonly castApproved: boolean;
  readonly positions: readonly { character: string; question: string; stance: string }[];
  readonly positionUpdated: boolean;
  readonly decisions: readonly string[];
  readonly artifact: string | null;
  readonly allQuestionsResolved: boolean;
};

/** Orchestration state — what M2-ORCH operates on. */
export type OrchState = {
  readonly challenge: string;
  readonly subTasks: readonly string[];
  readonly scopes: readonly string[];
  readonly dispatched: boolean;
  readonly results: readonly string[];
  readonly integration: string | null;
  readonly verificationOutcome: "PASS" | "FAIL_INCOMPLETE" | "FAIL_INCONSISTENT" | null;
};

/** Traditional meta-prompting state — what M3-TMP operates on. */
export type TMPState = {
  readonly challenge: string;
  readonly subQuestions: readonly string[];
  readonly answers: readonly string[];
  readonly response: string | null;
  readonly verifyChecks: readonly { subQuestion: string; satisfied: boolean }[];
  readonly complete: boolean;
  readonly consistent: boolean;
};

/** Adversarial review state — what M4-ADVREV operates on. */
export type AdvRevState = {
  readonly artifact: string;
  readonly artifactType: "rfc" | "pr" | "data_model" | "architecture" | "implementation" | "design" | "policy" | "method_candidate" | "other";
  readonly mandatoryDimensions: readonly string[];
  readonly advisors: readonly string[];
  readonly findings: readonly { id: string; severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" }[];
  readonly reviewReport: string | null;
  readonly synthesizers: readonly string[];
  readonly actionPlan: string | null;
  readonly iterationCount: number;
};

// ── P2-SD method states ──

/** Implementation state — what M1-IMPL operates on. */
export type ImplState = {
  readonly phaseDoc: string;
  readonly confidenceScore: number;
  readonly confidenceThreshold: number;
  readonly discrepancies: readonly { id: string; severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"; resolved: boolean }[];
  readonly goNoGo: boolean;
  readonly tasks: readonly string[];
  readonly tasksCompleted: readonly string[];
  readonly buildClean: boolean;
  readonly testsPassing: boolean;
  readonly sessionLog: string | null;
};

/** Distributed implementation state — what M2-DIMPL operates on. */
export type DImplState = {
  readonly phaseDoc: string;
  readonly tasks: readonly string[];
  readonly fileScopes: readonly string[];
  readonly dispatched: boolean;
  readonly taskResults: readonly string[];
  readonly gateAVerdicts: readonly ("PASS" | "FAIL")[];
  readonly gateBVerdict: "PASS" | "FAIL" | "GAP_DOCUMENTED" | null;
  readonly patchAttempts: number;
  readonly sessionLog: string | null;
};

/** Phase review state — what M3-PHRV operates on. */
export type PhaseReviewState = {
  readonly phaseArtifact: string;
  readonly archDocs: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly findings: readonly { id: string; severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" }[];
  readonly verdict: "PASS" | "CONDITIONAL" | "FAIL" | null;
  readonly reviewReport: string | null;
};

/** Drift audit state — what M4-DDAG operates on. */
export type DriftAuditState = {
  readonly auditWindow: number;
  readonly phases: readonly string[];
  readonly archDocs: readonly string[];
  readonly divergences: readonly string[];
  readonly driftVectors: readonly { id: string; severity: "STRUCTURAL" | "MODERATE" | "COSMETIC" }[];
  readonly driftReport: string | null;
};

/** Phase planning state — what M5-PLAN operates on. */
export type PlanState = {
  readonly prdSection: string;
  readonly phaseHistory: readonly string[];
  readonly archDocs: readonly string[];
  readonly tasks: readonly string[];
  readonly hasCarryover: boolean;
  readonly allTasksScoped: boolean;
  readonly allTasksRated: boolean;
  readonly phaseDoc: string | null;
};

/** Architecture refinement state — what M6-ARFN operates on. */
export type ArchRefineState = {
  readonly prdInput: string;
  readonly existingArchitecture: string;
  readonly archImpacts: readonly string[];
  readonly archDecisions: readonly string[];
  readonly archSpecFiles: readonly string[];
  readonly consistencyChecked: boolean;
  readonly archDoc: string | null;
};

/** PRD sectioning state — what M7-PRDS operates on. */
export type PRDSectionState = {
  readonly prd: string;
  readonly featureClusters: readonly string[];
  readonly prdSections: readonly string[];
  readonly dependencies: readonly { from: string; to: string }[];
  readonly deliveryOrder: readonly string[];
  readonly sectionMap: string | null;
};

// ── P-GH method states ──

/** Issue triage state — what M1-TRIAGE operates on. */
export type TriageState = {
  readonly issue: string;
  readonly issueType: "bug" | "feature" | "question" | "meta" | null;
  readonly scope: "trivial" | "small" | "medium" | "large" | null;
  readonly servesEssence: boolean;
  readonly overlapsPRD: boolean;
  readonly action: "commission" | "prd" | "escalate" | "close" | null;
  readonly triageDecision: string | null;
};

/** PR review state — what M2-REVIEW (P-GH) operates on. */
export type PRReviewState = {
  readonly pullRequest: string;
  readonly changedFiles: readonly string[];
  readonly deliveryRules: readonly string[];
  readonly findings: readonly { id: string; severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" }[];
  readonly verdict: "approve" | "needs_changes" | null;
  readonly reviewReport: string | null;
  readonly fixAttempts: number;
  readonly maxFixAttempts: number;
};

/** Merge conflict resolution state — what M3-RESOLVE operates on. */
export type ResolveState = {
  readonly pullRequest: string;
  readonly conflictFiles: readonly string[];
  readonly conflictTypes: readonly ("mechanical" | "semantic")[];
  readonly resolutionStrategy: "rebase" | "merge" | "cherry_pick" | "manual" | null;
  readonly resolved: boolean;
  readonly buildPassing: boolean;
  readonly resolutionRecord: string | null;
};

/** Issue work execution state — what M4-WORK operates on. */
export type WorkState = {
  readonly issue: string;
  readonly worktree: string | null;
  readonly branch: string | null;
  readonly plan: string | null;
  readonly implemented: boolean;
  readonly pullRequest: string | null;
  readonly reviewResult: string | null;
  readonly iterationCount: number;
  readonly workRecord: string | null;
};

// ── P3-GOV method states ──

/** RFC drafting state — what M1-DRAFT (P3-GOV) operates on. */
export type DraftState = {
  readonly gap: string;
  readonly mode: "initial" | "revision";
  readonly revisionCount: number;
  readonly reviewFeedback: readonly string[];
  readonly rfcWellFormed: boolean;
  readonly rfc: string | null;
};

/** Council review state — what M2-REVIEW (P3-GOV) operates on. */
export type GovReviewState = {
  readonly rfc: string;
  readonly reviewType: "domain" | "steering";
  readonly reviewingCouncil: string;
  readonly priorReviews: readonly string[];
  readonly debateCompleted: boolean;
  readonly verdict: "approve" | "approve_with_conditions" | "request_changes" | "block" | null;
};

/** Human approval state — what M3-APPROVE operates on. */
export type ApproveState = {
  readonly rfc: string;
  readonly reviews: readonly string[];
  readonly reviewPackage: string | null;
  readonly humanDecision: "approve" | "reject" | "request_changes" | null;
  readonly decisionRationale: string | null;
};

/** Commission handoff state — what M4-HANDOFF operates on. */
export type HandoffState = {
  readonly rfc: string;
  readonly governanceContext: string;
  readonly executionRequirements: readonly string[];
  readonly targetMethodology: "P2-SD" | "P1-EXEC" | null;
  readonly commission: string | null;
  readonly commissionReady: boolean;
};

// ── P3-DISPATCH method states ──

/** Interactive dispatch state — what M1-INTERACTIVE operates on. */
export type InteractiveState = {
  readonly targetMethodology: string;
  readonly targetMethod: string | null;
  readonly currentStep: string | null;
  readonly stepOutput: string | null;
  readonly humanDecision: "ADVANCE" | "RETRY" | "ABORT" | null;
  readonly routingConfirmed: boolean;
  readonly completed: boolean;
};

/** Semi-auto dispatch state — what M2-SEMIAUTO operates on. */
export type SemiAutoState = {
  readonly targetMethodology: string;
  readonly targetMethod: string | null;
  readonly currentStep: string | null;
  readonly stepOutput: string | null;
  readonly routingClear: boolean;
  readonly escalationNeeded: boolean;
  readonly scopeChangeDetected: boolean;
  readonly retryCount: number;
  readonly completed: boolean;
};

/** Full-auto dispatch state — what M3-FULLAUTO operates on. */
export type FullAutoState = {
  readonly targetMethodology: string;
  readonly targetMethod: string | null;
  readonly currentStep: string | null;
  readonly stepOutput: string | null;
  readonly retryCount: number;
  readonly maxRetries: number;
  readonly retriesExhausted: boolean;
  readonly abortTriggered: boolean;
  readonly failureLog: readonly string[];
  readonly completed: boolean;
};
