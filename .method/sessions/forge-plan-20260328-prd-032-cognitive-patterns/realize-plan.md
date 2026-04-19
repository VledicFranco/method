# Realization Plan — PRD 032: Advanced Cognitive Patterns

## PRD Summary

**Objective:** Implement 8 advanced cognitive patterns (P1-P8) as composable modules within `@methodts/pacta`. All patterns compose within the existing `CognitiveModule<I,O,S,Mu,Kappa>` algebra — no new primitive types, only new module factories, port interfaces, and config files.

**Phases:** 7 (reflection+patterns, adaptive load, concurrent, personas, affect, attention, wandering)
**Patterns:** P1 (concurrent), P2 (adaptive), P3 (affect), P4 (personas), P5 (thought patterns), P6 (reflection), P7 (wandering), P8 (attention)
**Acceptance criteria:** AC-1 through AC-10
**Success criteria:** SC-1 through SC-10
**Domains affected:** pacta (ports, cognitive/modules, cognitive/engine, config), experiments (exp-023)
**Dependencies:** PRD 030 (done), PRD 031 (5/6 commissions complete)

## Codebase Survey

### Existing artifacts (relevant to this PRD)

| File | Role | Relevance |
|------|------|-----------|
| `ports/memory-port.ts` | MemoryPort v2, FactCard, EpistemicType union | P5 adds `PROCEDURE` to EpistemicType, P5 adds `ThoughtPattern` type |
| `ports/embedding-port.ts` | EmbeddingPort for vector search | Used by P5 pattern retrieval |
| `ports/memory-impl.ts` | InMemoryMemory implementation | Must support new `PROCEDURE` type |
| `modules/reflector.ts` | Legacy reflector (v1) — template-based lesson extraction | P6 replaces with LLM-based reflector-v2 |
| `modules/memory-module-v2.ts` | FactCard retrieval + extraction | P5 pattern injection extends this |
| `modules/monitor.ts` | Stagnation detection, interventions | P3 affect signals feed into this |
| `modules/reasoner-actor.ts` | LLM reasoning + tool execution | P4 persona injection targets system prompt |
| `algebra/composition.ts` | `parallel()`, `competitive()` operators | P1 uses `parallel()` for adversarial reasoning |
| `engine/cycle.ts` | Cognitive cycle orchestration | P2 meta-composer wraps this |
| `experiments/exp-023/run.ts` | Experiment runner | Integration target for all patterns |
| `experiments/exp-023/strategies.ts` | Strategy configs | P2 meta-composer selects from these |

### Existing types that will be extended

- `EpistemicType = 'FACT' | 'HEURISTIC' | 'RULE' | 'OBSERVATION'` — needs `'PROCEDURE'`
- `FactCard` — unchanged, but P5 stores ThoughtPatterns as PROCEDURE-typed cards
- `ReasonerActorMonitoring` — P3 may read confidence/action signals from this
- `CognitiveConfig` in `strategies.ts` — P2 meta-composer selects among these

## FCA Partition

| Commission | Domain | Phase | Title | Depends On | Wave |
|------------|--------|-------|-------|------------|------|
| C-0 | ports (shared) | Pre | Shared surface: PROCEDURE type + ThoughtPattern + AttentionPort | — | 0 |
| C-1 | cognitive/modules | P1 | Reflector v2 — LLM-based structured reflection | C-0 | 1 |
| C-2 | cognitive/modules + config | P1 | Thought patterns — built-in PROCEDURE cards + retrieval | C-0 | 1 |
| C-3 | cognitive/modules + engine | P2 | Meta-composer — adaptive cognitive load selection | C-1, C-2 | 2 |
| C-4 | cognitive/modules | P3 | Concurrent processes — parallel adversarial reasoning | C-0 | 3 |
| C-5 | config | P4 | Dynamic personas — profile registry + prompt injection | C-0 | 3 |
| C-6 | cognitive/modules | P5 | Emotional metacognition — affect signal computation | C-0 | 3 |
| C-7 | cognitive/modules + ports | P6 | Multi-sense attention — event filter + AttentionPort | C-0 | 4 |
| C-8 | cognitive/modules | P7 | Mind wandering — background association module | C-1 | 4 |
| C-9 | experiments | P1-7 | Experiment harness integration — --pattern flags + wiring | C-1..C-8 | 5 |

**Total:** 10 commissions (C-0 through C-9), 6 waves (0-5)

## Waves

### Wave 0 — Shared Surface Preparation

Orchestrator applies before any commission starts. These are type-level and interface changes that multiple commissions depend on.

**Changes:**

1. **`packages/pacta/src/ports/memory-port.ts`**
   - Add `'PROCEDURE'` to the `EpistemicType` union:
     ```typescript
     export type EpistemicType = 'FACT' | 'HEURISTIC' | 'RULE' | 'OBSERVATION' | 'PROCEDURE';
     ```
   - Add `ThoughtPattern` interface:
     ```typescript
     export interface ThoughtPattern {
       name: string;
       trigger: string;        // when to activate
       steps: string[];        // ordered cognitive steps
       exitCondition: string;  // when to stop
     }
     ```
   - No breaking changes: existing consumers of EpistemicType continue to work because `PROCEDURE` is additive.

2. **`packages/pacta/src/ports/attention-port.ts`** (new file)
   - `CognitiveStimulus` interface (renamed from PRD's `CognitiveEvent` to avoid collision with `algebra/events.ts` export):
     ```typescript
     export interface CognitiveStimulus {
       type: 'tool-result' | 'test-result' | 'file-changed' | 'lint-error' | 'timer' | 'user-message' | 'memory-trigger';
       priority: 'high' | 'medium' | 'low';
       content: unknown;
       source: string;
     }
     export interface AttentionPort {
       subscribe(filter: (event: CognitiveStimulus) => boolean): void;
       poll(): CognitiveStimulus[];
     }
     ```
   - Note: The PRD calls this `CognitiveEvent` but that name already exists in `algebra/events.ts`. Use `CognitiveStimulus` to avoid collision. The commission card for C-7 will reference this.

3. **`packages/pacta/src/cognitive/algebra/module.ts`** — No changes needed. All new modules use the existing `CognitiveModule<I,O,S,Mu,Kappa>` type.

4. **`packages/pacta/src/cognitive/algebra/index.ts`** — No re-exports needed at this stage. Port types are imported directly from their files, not via the algebra barrel.

**Verification:** `npm run build` passes after Wave 0 changes. Existing tests remain green because `PROCEDURE` is additive and `attention-port.ts` is a new file with no consumers yet.

### Wave 1 — Foundation: Reflection + Thought Patterns (parallel)

Two independent commissions that both write to `cognitive/modules/` but to different files.

- **C-1: Reflector v2** — `modules/reflector-v2.ts` (new file, does not modify `reflector.ts`)
- **C-2: Thought Patterns** — `config/thought-patterns.ts` (new dir + file), minor extension to `modules/memory-module-v2.ts` for PROCEDURE card injection

These are parallel because C-1 writes a new file and C-2 writes to a different new file + a different section of memory-module-v2.

### Wave 2 — Adaptive Load: Meta-Composer

- **C-3: Meta-Composer** depends on C-1 (needs reflection data for classification) and C-2 (needs pattern retrieval for muscle-memory detection)

### Wave 3 — Enhancement Patterns (parallel)

Three independent modules, each in a separate new file:

- **C-4: Conflict Resolver** — `modules/conflict-resolver.ts` (new file, uses `parallel()` from algebra)
- **C-5: Persona Registry** — `config/personas.ts` (new file, pure data + selection logic)
- **C-6: Affect Module** — `modules/affect-module.ts` (new file, rule-based computation)

All three are independent: different files, no data dependencies between them.

### Wave 4 — Advanced Patterns (parallel)

- **C-7: Attention Filter** — `modules/attention-filter.ts` (new file, consumes AttentionPort)
- **C-8: Wanderer** — `modules/wanderer.ts` (new file, depends on memory + LLM)

Parallel because they touch different files. C-8 depends on C-1 (reflector-v2 produces the HEURISTIC cards that wanderer reviews), but C-1 is in Wave 1, so the dependency is already satisfied.

### Wave 5 — Experiment Integration

- **C-9: Experiment Harness** — integrates all modules into `experiments/exp-023/run.ts`. Must wait for all module commissions (C-1 through C-8). Adds `--pattern=P1..P8` flags for selective activation.

## Commission Cards

### C-0: Shared Surface — PROCEDURE Type + ThoughtPattern + AttentionPort

- **Domain:** ports (shared surface)
- **Executed by:** Orchestrator (not a sub-agent commission)
- **Wave:** 0
- **Files modified:**
  - `packages/pacta/src/ports/memory-port.ts` — add `PROCEDURE` to EpistemicType, add ThoughtPattern interface
  - `packages/pacta/src/ports/attention-port.ts` — new file: CognitiveStimulus, AttentionPort
- **Verification:** `npm run build` passes, existing tests green
- **Tasks:**
  1. Add `'PROCEDURE'` to EpistemicType union in memory-port.ts
  2. Add `ThoughtPattern` interface to memory-port.ts (after FactCard)
  3. Create `attention-port.ts` with CognitiveStimulus + AttentionPort interfaces
  4. Run `npm run build` — verify no breakage

### C-1: Reflector v2 — LLM-Based Structured Reflection

- **Domain:** cognitive/modules
- **Allowed paths:** `packages/pacta/src/cognitive/modules/reflector-v2.ts`, `packages/pacta/src/cognitive/modules/__tests__/reflector-v2.test.ts`
- **Forbidden paths:** `packages/pacta/src/ports/*`, `experiments/**`, `packages/pacta/src/cognitive/modules/reflector.ts` (do not modify v1)
- **Branch:** `feat/prd032-c1-reflector-v2`
- **Wave:** 1
- **Depends on:** C-0 (PROCEDURE type exists)
- **PRD pattern:** P6
- **Deliverables:**
  - `createReflectorV2(memory: MemoryPortV2, llm: ProviderAdapter, config?)` factory
  - Input: `{ taskDescription: string, actionHistory: string[], outcome: { success: boolean, reason: string } }`
  - Processing: single LLM call (Haiku model) answering: (1) What worked? (2) What failed? (3) Transferable lesson
  - Output: 1-3 HEURISTIC FactCards with concise strategic content
  - Implements `CognitiveModule<ReflectorV2Input, ReflectorV2Output, ReflectorV2State, ReflectorMonitoring, ControlDirective>`
  - Fire-and-forget error semantics (same as v1 reflector)
- **Acceptance criteria:** AC-1 (produces 1-3 HEURISTIC cards per task with concise strategic content)
- **Tasks:**
  1. Define ReflectorV2Input, ReflectorV2Output, ReflectorV2State types
  2. Implement `createReflectorV2` factory with LLM call for reflection prompt
  3. Parse LLM response into 1-3 HEURISTIC FactCards with proper source metadata
  4. Store produced cards via `memory.storeCard()`
  5. Implement fire-and-forget error handling (return empty output, unchanged state)
  6. Write unit tests: success path (mock LLM returns structured lessons), error path (LLM failure), card quality assertions
- **Estimated tasks:** 6

### C-2: Thought Patterns — Built-In PROCEDURE Cards + Retrieval

- **Domain:** cognitive/modules + config (new directory)
- **Allowed paths:** `packages/pacta/src/config/thought-patterns.ts` (new), `packages/pacta/src/cognitive/modules/__tests__/thought-patterns.test.ts` (new)
- **Forbidden paths:** `packages/pacta/src/ports/*`, `experiments/**`
- **Branch:** `feat/prd032-c2-thought-patterns`
- **Wave:** 1
- **Depends on:** C-0 (PROCEDURE type + ThoughtPattern interface exist)
- **PRD pattern:** P5
- **Deliverables:**
  - 3 built-in ThoughtPattern definitions: `debug-trace`, `safe-deletion`, `refactoring`
  - `getBuiltInPatterns(): ThoughtPattern[]` — returns all built-in patterns
  - `patternToFactCard(pattern: ThoughtPattern): FactCard` — converts a ThoughtPattern to a PROCEDURE-typed FactCard for storage
  - `seedPatterns(memory: MemoryPortV2): Promise<void>` — stores all built-in patterns as PROCEDURE cards if not already present
  - `formatPatternForWorkspace(pattern: ThoughtPattern): string` — renders pattern steps as a high-salience workspace injection string
- **Acceptance criteria:** AC-2 (ThoughtPattern type exists, 3 built-in patterns retrievable from memory)
- **Tasks:**
  1. Create `packages/pacta/src/config/` directory
  2. Define 3 built-in ThoughtPattern objects (`debug-trace`, `safe-deletion`, `refactoring`) with trigger conditions, step sequences, and exit conditions grounded in EXP-023 task analysis
  3. Implement `patternToFactCard()` — converts ThoughtPattern to FactCard with `type: 'PROCEDURE'`, serialized steps in content, trigger as tag
  4. Implement `seedPatterns()` — stores built-in patterns via `memory.storeCard()`, idempotent (checks by tag before inserting)
  5. Implement `formatPatternForWorkspace()` — renders as numbered step list with trigger/exit markers
  6. Write unit tests: seed + retrieve cycle, format output structure, idempotency
- **Estimated tasks:** 6

### C-3: Meta-Composer — Adaptive Cognitive Load Selection

- **Domain:** cognitive/modules + engine
- **Allowed paths:** `packages/pacta/src/cognitive/modules/meta-composer.ts` (new), `packages/pacta/src/cognitive/modules/__tests__/meta-composer.test.ts` (new)
- **Forbidden paths:** `packages/pacta/src/ports/*`, `experiments/**`
- **Branch:** `feat/prd032-c3-meta-composer`
- **Wave:** 2
- **Depends on:** C-1 (reflector-v2 produces HEURISTIC cards), C-2 (thought patterns produce PROCEDURE cards)
- **PRD pattern:** P2
- **Deliverables:**
  - `CognitiveProfile` type: `'muscle-memory' | 'routine' | 'deliberate' | 'conflicted' | 'creative'`
  - `classifyTask(memory: MemoryPortV2, taskDescription: string, priorFailures: number): Promise<CognitiveProfile>` — rule-based classification (no LLM call):
    - `muscle-memory`: PROCEDURE card with confidence > 0.8 matches task
    - `routine`: known task type, no prior failures
    - `deliberate`: novel task or prior failures > 0
    - `conflicted`: multiple contradictory HEURISTIC cards retrieved
    - `creative`: failures >= 2, no matching PROCEDURE cards
  - `profileToStrategyConfig(profile: CognitiveProfile): Partial<CognitiveConfig>` — maps profiles to strategy parameters (cycle budget, monitoring intensity)
  - `createMetaComposer(memory: MemoryPortV2)` — higher-order module that runs before the cognitive cycle, writes selected profile to workspace
- **Acceptance criteria:** AC-3 (meta-composer classification correct >= 80% on manual eval)
- **Tasks:**
  1. Define CognitiveProfile type and classification rule interfaces
  2. Implement `classifyTask()` with rule-based logic: query memory for PROCEDURE cards, count contradictory HEURISTIC cards, check failure history
  3. Implement `profileToStrategyConfig()` mapping each profile to cycle budget + monitoring config
  4. Implement `createMetaComposer()` factory as `CognitiveModule` — step function queries memory, classifies, writes profile to workspace
  5. Write unit tests: each classification rule with synthetic FactCard sets, edge cases (empty memory, ties)
- **Estimated tasks:** 5

### C-4: Concurrent Processes — Parallel Adversarial Reasoning

- **Domain:** cognitive/modules
- **Allowed paths:** `packages/pacta/src/cognitive/modules/conflict-resolver.ts` (new), `packages/pacta/src/cognitive/modules/__tests__/conflict-resolver.test.ts` (new)
- **Forbidden paths:** `packages/pacta/src/ports/*`, `experiments/**`, `packages/pacta/src/cognitive/algebra/*`
- **Branch:** `feat/prd032-c4-conflict-resolver`
- **Wave:** 3
- **Depends on:** C-0 (shared types)
- **PRD pattern:** P1
- **Deliverables:**
  - `createConflictResolver(llm: ProviderAdapter, config?)` factory
  - Input: `{ proposalA: { action: string, reasoning: string }, proposalB: { action: string, reasoning: string } }`
  - Processing: single LLM call — "Two approaches proposed: [A] and [B]. Which is better and why? Or propose a synthesis."
  - Output: synthesized action (one of the two, or a novel combination) + reasoning
  - Implements `CognitiveModule` interface
  - Designed to be used with `parallel(reasonerA, reasonerB, merge)` where merge feeds into the conflict resolver
  - Configuration: reasoner A = "most direct solution", reasoner B = "what could go wrong? safer alternative"
- **Acceptance criteria:** AC-4 (parallel adversarial reasoning fires and produces synthesized actions)
- **Tasks:**
  1. Define ConflictResolverInput, ConflictResolverOutput, ConflictResolverState types
  2. Implement `createConflictResolver` factory with synthesis prompt
  3. Parse LLM response: extract chosen approach (A, B, or synthesis) + justification
  4. Implement dual-process gating: only fire when contradictory signals detected (don't always run parallel)
  5. Write unit tests: synthesis of two proposals (mock LLM), single-proposal passthrough, error handling
- **Estimated tasks:** 5

### C-5: Dynamic Personas — Profile Registry + Prompt Injection

- **Domain:** config
- **Allowed paths:** `packages/pacta/src/config/personas.ts` (new), `packages/pacta/src/config/__tests__/personas.test.ts` (new)
- **Forbidden paths:** `packages/pacta/src/ports/*`, `experiments/**`, `packages/pacta/src/cognitive/modules/*`
- **Branch:** `feat/prd032-c5-personas`
- **Wave:** 3
- **Depends on:** C-0
- **PRD pattern:** P4
- **Deliverables:**
  - `PersonaProfile` interface: `{ name, expertise[], reasoningStyle, mbtiType, biases[] }`
  - 5 built-in personas: `debugger` (ISTJ), `architect` (INTJ), `reviewer` (ENFJ), `explorer` (ENTP), `specialist` (ISTP)
  - `getPersona(name: string): PersonaProfile | undefined`
  - `selectPersona(taskType: string, memorySignals: { patterns: string[], failures: number }): PersonaProfile` — rule-based persona selection
  - `formatPersonaInjection(persona: PersonaProfile): string` — formats the system prompt prepend
- **Acceptance criteria:** AC-5 (persona injection changes action distribution measurably)
- **Tasks:**
  1. Define PersonaProfile interface
  2. Implement 5 built-in persona profiles with grounded reasoning styles, MBTI types, expertise areas, and documented blind spots
  3. Implement `selectPersona()` — rule-based: bug tasks -> debugger, architecture tasks -> architect, review tasks -> reviewer, stuck tasks -> explorer, narrow tasks -> specialist
  4. Implement `formatPersonaInjection()` — renders persona as system prompt section
  5. Write unit tests: selection logic for each task type, format output structure
- **Estimated tasks:** 5

### C-6: Emotional Metacognition — Affect Signal Computation

- **Domain:** cognitive/modules
- **Allowed paths:** `packages/pacta/src/cognitive/modules/affect-module.ts` (new), `packages/pacta/src/cognitive/modules/__tests__/affect-module.test.ts` (new)
- **Forbidden paths:** `packages/pacta/src/ports/*`, `experiments/**`
- **Branch:** `feat/prd032-c6-affect-module`
- **Wave:** 3
- **Depends on:** C-0
- **PRD pattern:** P3
- **Deliverables:**
  - `AffectSignal` interface: `{ valence: number, arousal: number, label: string }`
  - `createAffectModule(config?)` factory — rule-based computation, no LLM call
  - Computation rules (from observable behavioral patterns):
    - Confidence trend declining over 3 cycles -> `anxious` (-0.5, 0.7)
    - 3+ successful actions -> `confident` (0.8, 0.2)
    - Same action repeated 3x -> `frustrated` (-0.7, 0.9)
    - Novel information discovered -> `curious` (0.5, 0.5)
  - Workspace injection: "Current state: {label}. {context-appropriate guidance}"
  - Output feeds into monitor for stagnation detection integration
- **Acceptance criteria:** AC-6 (affect signals computed correctly from traces — unit tests for each emotion)
- **Tasks:**
  1. Define AffectSignal interface and AffectModuleState (tracking recent actions, confidence history)
  2. Implement confidence trend detection (sliding window of last 3 cycles)
  3. Implement action repetition detection (compare last 3 actions)
  4. Implement success streak and novelty detection rules
  5. Implement `createAffectModule()` factory with workspace write for affect signal
  6. Write unit tests: each affect label triggered by synthetic behavioral traces, edge cases (empty history, mixed signals)
- **Estimated tasks:** 6

### C-7: Multi-Sense Attention — Event Filter + AttentionPort Integration

- **Domain:** cognitive/modules + ports
- **Allowed paths:** `packages/pacta/src/cognitive/modules/attention-filter.ts` (new), `packages/pacta/src/cognitive/modules/__tests__/attention-filter.test.ts` (new)
- **Forbidden paths:** `experiments/**`
- **Branch:** `feat/prd032-c7-attention-filter`
- **Wave:** 4
- **Depends on:** C-0 (AttentionPort interface exists)
- **PRD pattern:** P8
- **Deliverables:**
  - `createAttentionFilter(attention: AttentionPort, config?)` factory
  - Priority-based filtering:
    - High priority (test-result failure, user-message) -> immediate workspace injection
    - Medium (file-changed, lint-error) -> queue, inject if relevant to current task
    - Low (timer, memory-trigger) -> only during mind-wandering mode
  - Queue management: medium events accumulate, injected when workspace has capacity
  - Implements `CognitiveModule` — step function polls AttentionPort, filters, writes to workspace
  - `InMemoryAttentionPort` test implementation for unit testing
- **Acceptance criteria:** AC-7 (attention filter passes high-priority events, blocks low-priority)
- **Tasks:**
  1. Implement `InMemoryAttentionPort` (test helper: push events, poll returns them)
  2. Define AttentionFilterInput, AttentionFilterOutput, AttentionFilterState types
  3. Implement priority-based filtering logic with queue for medium events
  4. Implement `createAttentionFilter()` factory with workspace injection for high-priority events
  5. Write unit tests: high-priority passes through, low-priority blocked, medium queued and released, empty poll
- **Estimated tasks:** 5

### C-8: Mind Wandering — Background Association Module

- **Domain:** cognitive/modules
- **Allowed paths:** `packages/pacta/src/cognitive/modules/wanderer.ts` (new), `packages/pacta/src/cognitive/modules/__tests__/wanderer.test.ts` (new)
- **Forbidden paths:** `packages/pacta/src/ports/*`, `experiments/**`
- **Branch:** `feat/prd032-c8-wanderer`
- **Wave:** 4
- **Depends on:** C-1 (reflector-v2 produces HEURISTIC cards that wanderer reviews)
- **PRD pattern:** P7
- **Deliverables:**
  - `createWanderer(memory: MemoryPortV2, llm: ProviderAdapter, config?)` factory
  - Runs between task executions (not during cycles)
  - Step function: (1) read all FactCards via `memory.allCards()`, (2) group by source task, (3) single cheap LLM call (Haiku): "Given these facts from different tasks, what unexpected connections exist?", (4) store promising connections as HEURISTIC cards with moderate confidence (0.5)
  - Scheduling config: `{ runEveryNTasks: number }` (default: 3)
  - Implements `CognitiveModule` interface — but invoked outside the cycle loop
- **Acceptance criteria:** AC-8 (wanderer generates cross-domain associations)
- **Tasks:**
  1. Define WandererInput, WandererOutput, WandererState types
  2. Implement FactCard grouping by source task and cross-domain prompt construction
  3. Implement LLM call for association generation (cheap model, small context)
  4. Parse response into HEURISTIC FactCards with moderate confidence and cross-task links
  5. Implement `createWanderer()` factory with scheduling state tracking
  6. Write unit tests: association generation (mock LLM), empty memory, single-task memory (no cross-domain possible)
- **Estimated tasks:** 6

### C-9: Experiment Harness Integration — --pattern Flags + Full Wiring

- **Domain:** experiments
- **Allowed paths:** `experiments/exp-023/run.ts`, `experiments/exp-023/strategies.ts`
- **Forbidden paths:** `packages/**`
- **Branch:** `feat/prd032-c9-experiment-integration`
- **Wave:** 5
- **Depends on:** C-1 through C-8 (all module commissions)
- **PRD patterns:** All (integration)
- **Deliverables:**
  - CLI flags: `--pattern=P1,P2,...,P8` for selective pattern activation
  - Reflector-v2 (P6): fires after each task run, stores HEURISTIC cards
  - Thought patterns (P5): seed patterns at experiment start, inject matched pattern before reasoning
  - Meta-composer (P2): runs before cognitive cycle, selects profile, adjusts cycle budget
  - Concurrent (P1): wired via `parallel()` when meta-composer selects 'conflicted' profile
  - Personas (P4): inject selected persona's reasoningStyle into reasoner-actor system prompt
  - Affect (P3): runs each cycle, writes affect signal to workspace, feeds monitor
  - Attention (P8): VirtualToolProvider emits test-result events, attention filter injects to workspace
  - Wanderer (P7): runs after every 3 tasks in cross-task mode
  - Comparison report: per-pattern metrics (pass rate, token cost, cycle count)
- **Acceptance criteria:** AC-10 (harness supports `--pattern=P1..P8` flags for selective activation)
- **Tasks:**
  1. Add CLI argument parsing for `--pattern=P1,P2,...,P8` flags (comma-separated, default: none)
  2. Wire reflector-v2 (P6) into post-task phase: fire after each task, log card count
  3. Wire thought patterns (P5): seed at start, inject before reasoner-actor in cycle
  4. Wire meta-composer (P2): classify task before cycle, select strategy config
  5. Wire concurrent mode (P1): when profile is 'conflicted', use parallel() with conflict-resolver
  6. Wire personas (P4): inject selected persona into reasoner-actor system prompt
  7. Wire affect module (P3): add to cycle, feed signal to monitor
  8. Wire attention filter (P8): VirtualToolProvider emits CognitiveStimulus events, filter injects
  - (P7 wanderer wiring is part of the cross-task mode, integrated in step 2-3 flow)
- **Estimated tasks:** 8

## Shared Surface Protocol

All shared surface changes are applied in Wave 0 by the orchestrator, before any commission starts. This prevents merge conflicts and ensures all commissions build against the same type definitions.

| Wave | File | Change | Consumers |
|------|------|--------|-----------|
| 0 | `ports/memory-port.ts` | Add `'PROCEDURE'` to EpistemicType union | C-1, C-2, C-3, C-8 |
| 0 | `ports/memory-port.ts` | Add `ThoughtPattern` interface | C-2, C-3, C-9 |
| 0 | `ports/attention-port.ts` | New file: CognitiveStimulus + AttentionPort interfaces | C-7, C-9 |

**No mid-wave surface changes.** All commissions within a wave operate on independent files. The only cross-commission dependency within a wave is Wave 1 (C-1 and C-2), but they write to separate files (`reflector-v2.ts` vs `config/thought-patterns.ts`) so no conflict is possible.

**Naming collision avoidance:** The PRD uses `CognitiveEvent` for the attention port event type. However, `CognitiveEvent` is already exported from `algebra/events.ts`. The shared surface uses `CognitiveStimulus` instead. All commission cards reference `CognitiveStimulus`.

## Acceptance Gates

| Gate | Commission | Verification |
|------|-----------|-------------|
| AC-1: Reflector-v2 produces 1-3 HEURISTIC cards per task | C-1 | Unit test: mock LLM returns structured reflection, verify 1-3 cards with type HEURISTIC |
| AC-2: ThoughtPattern type exists, 3 built-in patterns retrievable | C-2 | Unit test: seedPatterns() + searchCards(query, {type: 'PROCEDURE'}) returns 3 cards |
| AC-3: Meta-composer classification correct >= 80% | C-3 | Unit test: 5+ synthetic scenarios, each correctly classified. Manual eval deferred to experiment. |
| AC-4: Parallel adversarial reasoning fires + synthesizes | C-4 | Unit test: two proposals in, synthesized action out. Integration test: parallel() composition. |
| AC-5: Persona injection changes action distribution | C-5 | Unit test: formatPersonaInjection() produces non-empty system prompt section. Integration deferred to C-9. |
| AC-6: Affect signals computed correctly from traces | C-6 | Unit tests: each of 4 affect labels triggered by synthetic behavioral patterns |
| AC-7: Attention filter passes high-priority, blocks low | C-7 | Unit tests: high-priority events injected, low-priority blocked, medium queued |
| AC-8: Wanderer generates cross-domain associations | C-8 | Unit test: mock LLM returns associations, verify HEURISTIC cards stored with confidence 0.5 |
| AC-9: All patterns use CognitiveModule type | C-1..C-8 | `npm run build` passes — type system enforces this |
| AC-10: --pattern flags for selective activation | C-9 | Manual: run with `--pattern=P6` activates only reflector-v2 |

## Success Criteria Traceability

| SC | Patterns | Commissions | Validated By |
|----|----------|-------------|--------------|
| SC-1: Token cost -15% with adaptive load | P2 | C-3, C-9 | Experiment: deliberate-only vs meta-composer baseline |
| SC-2: Reflection > extraction quality | P6 | C-1, C-9 | Experiment: compare reflector-v2 cards vs memory-module-v2 extraction |
| SC-3: Task 05 passes with safe-deletion pattern | P5 | C-2, C-9 | Experiment: `--pattern=P5 --task=05` at N=5 |
| SC-4: Task 04 passes with concurrent mode | P1 | C-4, C-9 | Experiment: `--pattern=P1,P2 --task=04` at N=5 |
| SC-5: Personas change behavior without degradation | P4 | C-5, C-9 | Experiment: compare action distributions with/without personas |
| SC-6: Affect reduces stagnation by 30% | P3 | C-6, C-9 | Experiment: stagnation loop count with/without affect module |
| SC-7: Wanderer produces 1+ insight per 5-task batch | P7 | C-8, C-9 | Experiment: cross-task mode, count useful retrievals |
| SC-8: Agent reacts to test failures | P8 | C-7, C-9 | Experiment: inject test-result event, verify workspace reaction |
| SC-9: No new primitive types | All | C-1..C-8 | `npm run build` — all modules typed as CognitiveModule<...> |
| SC-10: Combined >= 4/5 at <= 1.0x flat cost | All | C-9 | Experiment: full pattern suite vs flat baseline |

## Risk Assessment

- **Critical path length:** 5 waves (W0 -> W1 -> W2 -> W3 -> W4 -> W5) — 6 sequential steps. The longest chain is C-0 -> C-2 -> C-3 -> C-9 (4 commission-hops).
- **Largest wave:** W3 (3 parallel commissions: C-4, C-5, C-6)
- **Surface changes:** Contained to Wave 0 only (3 changes: 2 in memory-port.ts, 1 new file). No mid-stream surface edits.
- **New file count:** 8 new module/config files + 1 new port file = 9 new files. Existing files modified: 2 (memory-port.ts at Wave 0, run.ts + strategies.ts at Wave 5).
- **LLM-calling modules:** C-1 (reflector-v2), C-4 (conflict-resolver), C-8 (wanderer) — all use ProviderAdapter, testable with mock adapters.
- **Token cost risk:** P1 (concurrent) doubles cost per conflicted cycle. Mitigated by dual-process gating in C-4 (only fires on 'conflicted' classification from C-3).
- **Integration risk:** C-9 is the largest commission (8 tasks) and touches the most patterns. Mitigate by testing each pattern flag independently before testing combinations.
- **Quality risk:** P7 (wanderer) may produce noise. Mitigated by moderate confidence (0.5) on generated cards — they won't dominate retrieval.
- **Naming collision:** `CognitiveEvent` already in algebra — resolved by using `CognitiveStimulus` in attention-port.ts.

## Dependency DAG

```
C-0 (shared surface)
 |
 +---> C-1 (reflector-v2)  ----+---> C-3 (meta-composer) --+
 |                              |                           |
 +---> C-2 (thought-patterns) -+                           |
 |                                                          |
 +---> C-4 (conflict-resolver) ----------------------------+
 |                                                          |
 +---> C-5 (personas) ------------------------------------+
 |                                                          |
 +---> C-6 (affect-module) --------------------------------+
 |                                                          |
 +---> C-7 (attention-filter) ----> C-9 (experiment) <-----+
 |                                       ^
 +---> C-8 (wanderer) --- (via C-1) ----+
```

All edges are acyclic. Wave assignment respects all dependencies.

## Verification Report

| Gate | Status | Details |
|------|--------|---------|
| Single-domain | PASS | Each commission targets one primary domain (modules, config, ports, or experiments) |
| No wave conflicts | PASS | No two commissions in the same wave modify the same file |
| DAG acyclic | PASS | C-0 -> {C-1,C-2} -> C-3, C-0 -> {C-4,C-5,C-6}, C-0 -> {C-7}, C-1 -> C-8, all -> C-9. No cycles. |
| Surfaces enumerated | PASS | 3 surface changes, all in Wave 0: memory-port.ts (x2), attention-port.ts (x1) |
| Scope complete | PASS | All commissions have allowed + forbidden paths |
| Criteria traceable | PASS | Every AC maps to a commission. Every SC maps to commission(s) + experiment validation. |
| PRD coverage | PASS | All 8 patterns (P1-P8) mapped. All 10 ACs mapped. All 10 SCs traced. |
| Task bounds | PASS | Commission task counts: C-0(4), C-1(6), C-2(6), C-3(5), C-4(5), C-5(5), C-6(6), C-7(5), C-8(6), C-9(8) — all within 3-8 range |
| CognitiveEvent collision | PASS | Renamed to CognitiveStimulus in attention-port.ts to avoid algebra/events.ts collision |
| No architecture changes | PASS | All patterns are new modules + configs. No changes to algebra types, composition operators, or cycle engine. SC-9 satisfied by construction. |

**Overall: 10/10 gates pass**

## Status Tracker

Total: 10 commissions, 6 waves (0-5)
Completed: (none)
In progress: (none)
Pending: C-0, C-1, C-2, C-3, C-4, C-5, C-6, C-7, C-8, C-9
