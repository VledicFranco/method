# gate/ — Gate System

Composable quality gates for methodology step execution. A gate is a typed predicate over world state that either passes (allowing a step to proceed) or fails (blocking progression with a `GateError`).

## Components

| Component | Description |
|-----------|-------------|
| `Gate<S>` | Core gate interface — async function from world state `S` to `GateResult<S>` |
| `GateSuite<S>` | Named collection of gates run before/after a step |
| `allPass()` / `anyPass()` | Gate combinators — compose gates with AND/OR semantics |
| `withRetry()` / `executeWithRetry()` | Retry wrappers for flaky gates (test runners, network checks) |
| `scriptGate` | Runs a shell command; passes if exit code 0 |
| `testRunner` | Runs the project's test suite; passes if all tests pass |
| `httpChecker` | HTTP health check gate; passes if endpoint returns 2xx |
| `checklistGate` | Human-in-the-loop checklist gate; renders attestation prompts |
| `DagGateEvaluator` | Gate evaluator integrated with the DAG strategy executor |
| `algorithmic-checks.ts` | G-NO-ANY, G-NO-TODOS, G-STRUCTURE, G-PORT-SUBSTANCE (deterministic static checks) |
| `RuntimeObserver` | Observability interface for gate evaluation events |

## Gate Result Types

- `GateResult<S>`: `{ passed: boolean, score?: number, evidence?: string, error?: GateError }`
- `GateSuiteResult<S>`: aggregated result across all gates in a suite

## Usage

Gates are declared in methodology YAML (`gates:` field on each arm/step) and resolved by the runtime before step execution. Failed gates halt progression and surface evidence to the agent for remediation.
