# Theory Mapping: F1-FTH to MethodTS

How the formal theory (F1-FTH: Formal Theory of Holistic Methodologies) maps to TypeScript types in MethodTS.

## How to Read This

Each row in the mapping table uses one of three fidelity labels:

- **Faithful** -- the MethodTS type directly encodes the formal definition. The structure, constraints, and semantics match. The type is the definition, expressed in TypeScript.
- **Pragmatic** -- the MethodTS type captures the intent of the formal definition but makes engineering tradeoffs. For example, replacing proof obligations with finite-state testing, or simplifying infinite structures to runtime checks.
- **Implementation concept** -- a type that has no F1-FTH counterpart. It exists purely for engineering reasons (runtime plumbing, testing infrastructure, deployment).

The theory file `theory/F1-FTH.md` is the source of truth. When implementation and theory diverge, revise the implementation.

## Mapping Table

| F1-FTH Definition | MethodTS Type | Fidelity | Notes |
|---|---|---|---|
| Def 1.1 D = (Sigma, Ax) | `DomainTheory<S>` | Faithful | Sigma-structure instantiated as type parameter S. Signature carries sorts, function symbols, and named predicates. Axioms are `Record<string, Predicate<S>>`. |
| Def 1.2 Sigma-structure | `WorldState<S>` | Faithful | `value: S` is the Sigma-structure. Enriched with `axiomStatus` for runtime tracking. |
| Def 1.3 Mod(D) | `validateAxioms()` | Faithful | Membership test: evaluates all axioms against a state, returns `{ valid, violations }`. |
| Def 2.1 Role rho = (pi_rho, alpha_rho) | `Role<S, V>` | Pragmatic | `observe: (S) => V` is the observation projection pi_rho. Authorized transitions alpha_rho simplified to `authorized: string[]` and `notAuthorized: string[]` for Phase 1. Optional `authorizedTransitions` field provides the full state-dependent form. |
| Def 4.1 Step sigma = (pre, post, guidance, tools) | `Step<S>` | Faithful | Extended with hybrid execution (`StepExecution<S>`: agent or script), suspension policy, and context specification. Core 4-tuple preserved: `precondition`, `postcondition`, `execution.prompt` (guidance), `tools`. |
| Def 4.3 Composability | `checkComposability()` | Pragmatic | Tests post(A) implies pre(B) over finite test states. Necessary but not sufficient -- finite-state testing, not proof. |
| Def 4.4 StepDAG Gamma = (V, E, sigma_init, sigma_term) | `StepDAG<S>` | Faithful | Direct structural match. `steps` (vertices), `edges`, `initial`, `terminal`. `topologicalOrder()` computes execution sequence. |
| Def 5.2 Progress preorder | `ProgressOrder<S>` | Faithful | `compare: (a: S, b: S) => number` encodes the preorder. Negative = a closer to objective, 0 = equal, positive = b closer. |
| Def 5.3 Measure mu : Mod(D) -> R | `Measure<S>` | Faithful | `compute: (S) => number` with declared `range` and `terminal` value. Optional `order` field carries the progress preorder. |
| Def 6.1 Method M = (D, Roles, Gamma, O, mu-vec) | `Method<S>` | Faithful | 5-tuple preserved. `domain`, `roles`, `dag` (Gamma), `objective` (O), `measures` (mu-vec). |
| Def 6.3 Retraction (embed, project) | `Retraction<P, C>` | Faithful | `embed: (P) => C`, `project: (C) => P`. Round-trip verified by `verifyRetraction()` over test states. |
| Def 7.1 Methodology Phi = (D_Phi, delta_Phi, O_Phi) | `Methodology<S>` | Faithful | Coalgebraic structure preserved. `domain` (D_Phi), `arms` (priority-stack encoding of delta_Phi), `objective` (O_Phi). `evaluateTransition()` evaluates delta_Phi deterministically. |
| Def 7.4 Termination certificate | `TerminationCertificate<S>` | Pragmatic | `measure: (S) => number` with `decreases: string` (proof sketch as text). The formal definition requires a well-founded measure with a strict decrease proof; Phase 1 encodes the measure but uses a string-based argument rather than a machine-checked proof. |
| guidance_sigma | `Prompt<A>` | Faithful | Contravariant functor. `run: (A) => string`. Composes via `andThen` (monoid), adapts via `contramap`. `section`, `when`, `map` for structural transforms. |
| Sigma-sentence (closed) | `Predicate<A>` | Faithful | Tagged union ADT with all standard connectives: `check`, `and`, `or`, `not`, `implies`, `forall`, `exists`, `val`. Evaluated by `evaluate()` and `evaluateWithTrace()`. |

## Deferred Concepts

The following F1-FTH concepts are planned for Phase 2 and are not yet encoded in MethodTS:

| Concept | F1-FTH Reference | Phase 2 Plan |
|---|---|---|
| Tool type | Def 3.x | `Tool<I, O>` type with typed input/output and effect execution. Currently tools are referenced by string ID in `Step.tools`. |
| Domain morphism | Def 6.2 | Typed domain morphisms for cross-domain method composition. Currently handled implicitly through `Retraction<P, C>`. |
| Inter-method coherence | Def 6.4 | Formal coherence checking across methods within a methodology. Currently tested via `checkComposability` on individual edges. |

## Implementation Concepts

Types that exist in MethodTS with no direct F1-FTH counterpart. These serve engineering needs -- runtime plumbing, testing, deployment, observability.

| MethodTS Type | Category | Purpose |
|---|---|---|
| `Gate<S>` | Verification | Wraps a `Predicate<S>` with evaluation semantics, timing, witnesses, retries. Used for compilation gates and runtime quality checks. |
| `GateSuite<S>` | Verification | Named collection of gates with AND/OR composition (`allPass`, `anyPass`). |
| `Commission<A>` | Deployment | Rendered agent prompt + bridge spawn parameters + governance metadata. The artifact that deploys a sub-agent. |
| `templates.*` | Deployment | Built-in commission templates: `implementation`, `review`, `council`, `retro`. |
| `EventBus<S>` | Observability | In-memory event bus for runtime events. Emit/subscribe/waitFor/history. |
| `RuntimeEvent<S>` | Observability | 20-variant union type covering methodology lifecycle, method selection, step execution, safety, strategy. |
| `SuspendedMethodology<S>` | Runtime | Captures full state when the runtime yields control: reason, state, trace, accumulator, position. |
| `Resolution<S>` | Runtime | What the caller provides to resume: continue, provide_value, rerun_step, skip_step, abort. |
| `SuspensionReason<S>` | Runtime | Why the runtime suspended: gate_review, error, safety_warning, human_decision, etc. |
| `AgentProvider` | Runtime | Effect service interface abstracting the agent backend (bridge, mock, future providers). |
| `MockAgentProvider` | Testing | Declarative test double for `AgentProvider`. Ordered response matchers, fallback, failure triggers. |
| `StrategyController<S>` | Strategy | Wraps a methodology with adaptive decision logic for multi-run orchestration. |
| `StrategyDecision<S>` | Strategy | Decision after a methodology run: done, rerun, switch_methodology, abort. |
| `CompilationReport` | Meta | Result of `compileMethod` -- per-gate results (G1-G6), overall status. |
| `ProjectCard` | Meta | Static instantiation of abstract methodologies to concrete project contexts. |
| `RuntimeConfig` | Runtime | Event bus sizing, retry policy, default suspension behavior. |
| `InsightStore` | Runtime | Key-value store for inter-step knowledge transfer (agent steps produce insights consumed by later steps). |
| `Extractor` | Runtime | Effect-based service for extracting world fragments (command execution, git operations). |
