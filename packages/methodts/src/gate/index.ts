/**
 * gate/ — Composable quality gates for methodology execution.
 *
 * Gate<S>: async predicate over world state S → GateResult<S>.
 * GateSuite<S>: named collection of gates (pre/post step).
 * Combinators: allPass(), anyPass(), withRetry(), executeWithRetry().
 * Runners: scriptGate, testRunner, httpChecker, checklistGate.
 * Algorithmic checks: checkNoAny, checkNoTodos, checkStructure, etc.
 * DagGateEvaluator: integration with the strategy DAG executor.
 */

export * from './gate.js';
