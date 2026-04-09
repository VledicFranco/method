# cognitive/modules/ — Cognitive Modules

Stateless cognitive reasoning functions. Each module takes a `CognitiveWorkspace` and produces typed output that gets routed to a partition. Modules are composed via the algebra operators in `algebra/`.

## Module Catalog

| Module | Description |
|--------|-------------|
| `Planner` | Decomposes goals into ordered task sequences |
| `Monitor` / `MonitorV2` | Observes execution state and detects anomalies or goal drift |
| `Reasoner` / `ReasonerActor` / `ReasonerActorV2` | Core reasoning + action decision (ReAct pattern) |
| `Reflector` / `ReflectorV2` | Self-critique and belief revision |
| `Evaluator` | Scores outputs against quality criteria |
| `Consolidator` | Merges related workspace entries to prevent redundancy |
| `Observer` | Monitors external world state changes |
| `MemoryModule` / `MemoryModuleV2` / `V3` | Working memory operations (store, retrieve, forget) |
| `Attention` / `PriorityAttend` | Focuses workspace on most relevant entries |
| `ConflictResolver` | Detects and resolves contradictions in workspace content |
| `ConstraintClassifier` | Classifies whether a proposed action violates constraints |
| `MetaComposer` | Composes sub-modules dynamically based on task type |
| `PersonaModule` | Applies persona-specific reasoning style to outputs |
| `CuriosityModule` | Generates exploration suggestions (used in research tasks) |
| `AffectModule` | Emotional state modeling (research use — RFC 001 experiments) |
| `Wanderer` | Random exploration module for creative / open-ended tasks |
| `Verifier` | Formal output verification against predicates |
| `Router` | Routes workspace content to appropriate downstream modules |
| `Actor` | Action execution interface — converts module decisions into tool calls |
| `Activation` | Module activation function — determines if a module should run this cycle |

## Design

All modules are stateless functions — they read the workspace and return output, never mutating shared state directly. The engine routes outputs to partitions. This enables testing each module in isolation by constructing a minimal workspace fixture.
