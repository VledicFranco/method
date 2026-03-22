/**
 * @method/testkit — Testing and validation toolkit for MethodTS.
 *
 * Provides builders, assertions, harnesses, providers, and diagnostics
 * for testing methodologies, methods, steps, predicates, and domain theories.
 */

// ── Builders ──

export { domainBuilder, type DomainBuilder } from "./builders/domain.js";
export { scriptStep, agentStep, type ScriptStepOptions, type AgentStepOptions } from "./builders/step.js";
export { methodBuilder, type MethodBuilder } from "./builders/method.js";
export { methodologyBuilder, type MethodologyBuilder } from "./builders/methodology.js";
export { worldState, worldStateWithViolations } from "./builders/state.js";

// ── Assertions ──

export { assertHolds, assertRejects, assertEquivalent } from "./assertions/predicate.js";
export { assertSignatureValid, assertAxiomsSatisfied, assertAxiomsHold, assertAxiomsViolated } from "./assertions/domain.js";
export { assertCompiles, assertDAGAcyclic, assertDAGComposable, assertRolesCovered } from "./assertions/method.js";
export { assertCoherent, assertRoutesTo, assertTerminates, assertRoutingTotal } from "./assertions/methodology.js";
export { assertRetracts } from "./assertions/retraction.js";

// ── Runners ──

export { runStepIsolated, type StepHarnessResult, type StepHarnessOptions } from "./runners/step-harness.js";
export { runMethodologyIsolated, runMethodIsolated, type MethodHarnessOptions } from "./runners/method-harness.js";
export { scenario, type ScenarioRunner } from "./runners/scenario.js";

// ── Providers ──

export {
  RecordingProvider,
  SequenceProvider,
  silentProvider,
  type Recording,
  type RecordingProviderResult,
} from "./provider/recording-provider.js";

// ── Diagnostics ──

export { formatTrace, formatTraceWithFailures } from "./diagnostics/trace-printer.js";
export { formatCompilationReport, formatCoherenceResult } from "./diagnostics/report-printer.js";

// ── Re-exports from @method/methodts ──
// Common types and constructors so users don't need dual imports for basic tests.

export {
  // Predicate constructors
  check, and, or, not, implies, forall, exists, TRUE, FALSE,
  type Predicate,
  // Predicate evaluation
  evaluate, evaluateWithTrace, type EvalTrace,
  // Core types
  type DomainTheory, type SortDecl, type FunctionDecl,
  type Step, type StepExecution,
  type StepDAG, type StepEdge,
  type Method,
  type Methodology, type Arm, type SafetyBounds, type TerminationCertificate,
  type Role,
  type Measure,
  type WorldState,
  // Runtime results
  type MethodologyResult, type MethodResult, type StepResult,
  type CompletedMethodRecord, type ExecutionAccumulatorState,
  // Agent types
  type AgentResult, type AgentError, type AgentCommission,
  AgentProvider,
  // Compilation & coherence
  compileMethod, type CompilationReport, type CompilationGateResult,
  checkCoherence, type CoherenceResult, type CoherenceCheck,
  // Transition
  evaluateTransition, simulateRun, type TransitionResult,
  // Validation
  validateAxioms, validateSignature,
  // Retraction
  type Retraction, verifyRetraction,
  // Prompt
  Prompt,
} from "@method/methodts";
