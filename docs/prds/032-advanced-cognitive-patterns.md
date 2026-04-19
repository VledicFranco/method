---
title: "PRD 032: Advanced Cognitive Patterns — Composable Agent Intelligence"
status: implemented
date: "2026-03-28"
tier: heavyweight
depends_on: [30, 31]
enables: []
blocked_by: []
complexity: high
domains_affected: [pacta, pacta-playground, experiments]
---

# PRD 032: Advanced Cognitive Patterns — Composable Agent Intelligence

**Status:** Implemented (all 8 patterns — including P4 dynamic personas with 5 built-in profiles)
**Author:** PO + Lysica
**Date:** 2026-03-28
**Package:** `@methodts/pacta` (L3 — library)
**Depends on:** PRD 030 (Cognitive Composition), PRD 031 (Cognitive Memory Module)
**Research:** `ov-research/experiments/EXP-027-advanced-cognitive-patterns.md`
**Organization:** Vidtecci — vida, ciencia y tecnologia

## Problem Statement

PRD 030 implemented the Calculus of Cognitive Composition. PRD 031 adds RAG-based memory. EXP-023 validated the basic architecture (4/5 tasks, 0.83x flat cost). But the current agent has a single cognitive mode — it deploys the same 5-module cycle for every task, every cycle, regardless of difficulty. It cannot:

- Run parallel reasoning tracks when conflicted (concurrent processes)
- Adjust cognitive overhead to task complexity (muscle memory → full deliberation)
- Use emotional-like signals as decision shortcuts (frustration, curiosity, confidence)
- Load task-appropriate reasoning styles dynamically (debugger vs architect)
- Apply reusable cognitive templates for common task types (thought patterns)
- Learn transferable lessons after task completion (structured reflection)
- Make creative between-task connections during idle time (mind wandering)
- React to environmental signals beyond the prompt (multi-sense attention)

Humans do all eight naturally. The cognitive composition algebra supports all eight as module compositions — they are not architecture changes but compositions of the existing `CognitiveModule<I,O,S,Mu,Kappa>` type. This PRD implements them.

**Evidence motivating this PRD:**
- EXP-023 Run 4: no single strategy config achieves 5/5 — the agent needs adaptive composition
- EXP-023 Run 8: memory retrieval adds noise — reflection (P6) produces better facts than extraction
- EXP-023 Task 04: consistently fails — needs adversarial self-reflection (P1) or thought patterns (P5)
- EXP-005: MBTI-augmented personas produce 21-34% more counter-arguments (ov-research)
- EXP-017: personas generate intellectual novelty when properly designed (ov-research)
- Council Debate #2: impasse-driven search expansion (Ohlsson), incubation effect, dual-process gating

## Objective

Implement 8 advanced cognitive patterns as composable modules and strategies within `@methodts/pacta`, organized into three tiers:

**Tier 1 — Foundation (Phases 1-3):** Patterns that fix known deficiencies
- P6: Reflection (post-outcome learning)
- P5: Thought Patterns (reusable cognitive templates)
- P2: Adaptive Cognitive Load (meta-composition)

**Tier 2 — Enhancement (Phases 4-6):** Patterns that add new capabilities
- P4: Dynamic Personas (task-appropriate reasoning styles)
- P1: Concurrent Processes (parallel adversarial reasoning)
- P3: Emotional Metacognition (affect signals)

**Tier 3 — Advanced (Phases 7-8):** Patterns that require infrastructure integration
- P7: Mind Wandering (background creative connections)
- P8: Multi-Sense Attention (event-driven stimuli)

## Architecture & Design

### Composability Principle

All patterns compose within the existing algebra. No new primitive types needed:

```
P1 (concurrent)   → parallel(moduleA, moduleB, merge)     // existing operator
P2 (adaptive)     → metaComposer.select(signals) → cycle  // higher-order module
P3 (emotion)      → affectModule.step() → workspace write  // standard module
P4 (persona)      → prompt injection via workspace write    // strategy config
P5 (patterns)     → FactCard type: PROCEDURE               // memory system
P6 (reflection)   → post-task module step → HEURISTIC card // standard module
P7 (wandering)    → async background module + memory       // scheduled module
P8 (multi-sense)  → EventBus → AttentionFilter → workspace // new port
```

### Layer Stack (unchanged from PRD 030)

```
L0  algebra/       Pure types (CognitiveModule, composition operators)
L1  modules/       Module factories (new: reflector-v2, affect, attention-filter, meta-composer)
L2  engine/        Orchestration (new: adaptive-cycle, background-scheduler)
```

### Port Dependencies

| Pattern | Ports Required | Status |
|---------|---------------|--------|
| P5, P6 | MemoryPort v2 (PRD 031) | Implemented |
| P4 | None (prompt injection) | Ready |
| P1 | None (parallel operator exists) | Ready |
| P3 | None (new module, standard interface) | Ready |
| P2 | None (higher-order composition) | Ready |
| P7 | MemoryPort v2, timer/scheduler | PRD 031 done, scheduler new |
| P8 | EventBus port (bridge PRD 026) | Bridge exists, port new |

## Phases

### Phase 1 — P6: Structured Reflection + P5: Thought Patterns

The highest-impact, lowest-cost patterns. Directly fix the memory quality problem from EXP-023.

**P6 Deliverables:**
- `modules/reflector-v2.ts` — Post-task reflection module
  - Input: task description + action history + outcome (pass/fail)
  - Processing: single LLM call (Haiku for cost) that answers:
    (1) What worked? (2) What failed? (3) What's the transferable lesson?
  - Output: 1-3 HEURISTIC FactCards with concise strategic content
  - Example output: "To break circular deps, extract a shared interface file before refactoring individual modules"
- Integration into `experiments/exp-023/run.ts`: reflection fires after each task run
- Reflection uses a cheap model (Haiku) to minimize cost (~$0.001 per reflection)

**P5 Deliverables:**
- `ThoughtPattern` type in `ports/memory-port.ts`:
  ```typescript
  interface ThoughtPattern {
    name: string;
    trigger: string;        // when to activate
    steps: string[];        // ordered cognitive steps
    exitCondition: string;  // when to stop
  }
  ```
- FactCard type extension: `type: 'PROCEDURE'` added to EpistemicType union
- 3 built-in patterns: `debug-trace`, `safe-deletion`, `refactoring`
- Pattern retrieval: memory module searches for PROCEDURE cards matching current task
- Pattern injection: matched pattern steps written to workspace as high-salience guide

**Exit criteria:**
- Post-task reflection produces 1-3 concise HEURISTIC cards per task run
- Thought patterns stored and retrieved successfully
- Cross-task learning with reflection produces higher-quality facts than raw extraction
- Task 05 (dead code) consistently passes with `safe-deletion` pattern loaded

### Phase 2 — P2: Adaptive Cognitive Load

Dynamic composition selection based on task complexity.

**Deliverables:**
- `modules/meta-composer.ts` — Higher-order module that selects cognitive profiles
  ```typescript
  type CognitiveProfile = 'muscle-memory' | 'routine' | 'deliberate' | 'conflicted' | 'creative';
  ```
- Profile classification rules (rule-based, no LLM call):
  - `muscle-memory`: Memory has a matching PROCEDURE pattern with confidence > 0.8
  - `routine`: Task matches a known type, no prior failures
  - `deliberate`: Task is novel or prior attempts have failed
  - `conflicted`: Multiple contradictory heuristics retrieved from memory
  - `creative`: Task has failed 2+ times, no matching patterns
- Each profile maps to a strategy config (from `experiments/exp-023/strategies.ts`):
  - `muscle-memory` → minimal cycle (1-3 steps, follow stored procedure)
  - `routine` → baseline config
  - `deliberate` → v2-full config with all monitoring
  - `conflicted` → parallel adversarial reasoning (P1, Phase 3)
  - `creative` → expanded search + mind wandering trigger (P7, Phase 7)
- Integration: meta-composer runs BEFORE the cognitive cycle, selects the config

**Exit criteria:**
- Simple tasks (T02 bug fix) run in muscle-memory mode when pattern exists: <5 cycles, <5K tokens
- Complex tasks (T01 circular dep) run in deliberate mode: full 15-cycle budget
- Meta-composer classification is correct ≥80% of the time (manual evaluation)
- Overall token cost decreases by ≥15% compared to always-deliberate baseline

### Phase 3 — P1: Concurrent Cognitive Processes

Parallel adversarial reasoning for conflicted situations.

**Deliverables:**
- `modules/conflict-resolver.ts` — Merges outputs from parallel reasoner-actors
  - Input: two competing action proposals + their reasoning
  - Output: synthesized action (may be one of the two, or a novel combination)
  - Synthesis prompt: "Two approaches are proposed: [A] and [B]. Which is better and why? Or propose a synthesis."
- Integration with `parallel()` composition operator (already implemented in algebra)
- Trigger: meta-composer (P2) classifies task as 'conflicted', OR monitor detects
  adversarial signals (contradictory heuristics in workspace)
- Configuration:
  - Reasoner A: "Propose the most direct solution"
  - Reasoner B: "What could go wrong? Propose a safer alternative"
  - Resolver: picks the winner or synthesizes

**Exit criteria:**
- Task 04 (API versioning) passes when concurrent mode fires:
  Reasoner A proposes copying v1 handler, Reasoner B identifies side effects,
  resolver synthesizes "extract pure logic first"
- Token cost: ≤2x single-reasoner cost per conflicted cycle
- Concurrent mode fires on ≤20% of cycles (dual-process gating)

### Phase 4 — P4: Dynamic Persona Loading

Task-appropriate reasoning styles injected via system prompt.

**Deliverables:**
- `config/personas.ts` — Persona profile registry
  ```typescript
  interface PersonaProfile {
    name: string;
    expertise: string[];
    reasoningStyle: string;   // injected into system prompt
    mbtiType: string;         // cognitive function stack
    biases: string[];         // known blind spots to watch for
  }
  ```
- 5 built-in personas: `debugger` (ISTJ), `architect` (INTJ), `reviewer` (ENFJ), `explorer` (ENTP), `specialist` (ISTP)
- Selection: meta-composer (P2) selects persona based on task type + memory patterns
- Mid-task switching: monitor can trigger persona switch when task type shifts
- Integration: persona's `reasoningStyle` prepended to reasoner-actor system prompt

**Exit criteria:**
- Personas measurably change agent behavior (action distribution shifts)
- Debugger persona improves Task 02 (bug fix) pass rate and reduces cycles
- Architect persona improves Task 01 (circular dep) by reasoning at system level
- No persona degrades performance vs no-persona baseline

### Phase 5 — P3: Emotional Metacognition

Affect signals computed from behavioral patterns.

**Deliverables:**
- `modules/affect-module.ts` — Computes emotional valence from observables
  ```typescript
  interface AffectSignal {
    valence: number;    // -1 (bad) to +1 (good)
    arousal: number;    // 0 (calm) to 1 (urgent)
    label: string;      // 'confident' | 'anxious' | 'frustrated' | 'curious'
  }
  ```
- Computation rules (no LLM call):
  - Confidence trend declining over 3 cycles → 'anxious' (-0.5, 0.7)
  - 3+ successful actions → 'confident' (0.8, 0.2)
  - Same action repeated 3x → 'frustrated' (-0.7, 0.9)
  - Novel information discovered → 'curious' (0.5, 0.5)
- Workspace injection: "Current state: {label}. {context-appropriate guidance}"
- Monitor integration: affect signal feeds into stagnation detection
  (frustrated + stagnating = immediate reframe, not just constrain)

**Exit criteria:**
- Affect signals computed correctly from behavioral traces
- 'frustrated' signal + reframe intervention reduces stagnation loops by ≥30%
- 'curious' signal extends exploration cycles (delays premature constrain)
- Token overhead: <5% per cycle (rule-based computation + ~20 token workspace write)

### Phase 6 — P8: Multi-Sense Attention (Partial)

Event-driven stimuli for test results and file changes.

**Deliverables:**
- `ports/attention-port.ts` — AttentionPort interface
  ```typescript
  interface CognitiveEvent {
    type: 'tool-result' | 'test-result' | 'file-changed' | 'lint-error' | 'timer' | 'user-message' | 'memory-trigger';
    priority: 'high' | 'medium' | 'low';
    content: unknown;
    source: string;
  }
  interface AttentionPort {
    subscribe(filter: (event: CognitiveEvent) => boolean): void;
    poll(): CognitiveEvent[];
  }
  ```
- `modules/attention-filter.ts` — Filters events by relevance to current task
  - High priority (test failure, user message) → immediate workspace injection
  - Medium (file changed, lint error) → queue, inject if relevant
  - Low (timer, memory trigger) → only during mind-wandering mode
- Integration: VirtualToolProvider emits test-result events after Edit actions
  in the experiment harness (simulated multi-sense)

**Exit criteria:**
- Agent reacts to simulated test failures without being told to check
- Irrelevant events are filtered (no workspace pollution)
- High-priority events interrupt the current cycle

### Phase 7 — P7: Mind Wandering

Background creative connections between tasks.

**Deliverables:**
- `modules/wanderer.ts` — Background association module
  - Runs between task executions (not during cycles)
  - Reviews all stored FactCards
  - Uses a cheap LLM call (Haiku) to generate cross-domain associations:
    "Given these facts from different tasks, what unexpected connections exist?"
  - Stores promising connections as HEURISTIC cards with moderate confidence
- Scheduling: runs after every 3 task completions, or on explicit trigger
- Memory integration: wanderer reads from and writes to FactCardStore

**Exit criteria:**
- Wanderer generates at least 1 cross-domain connection per 3-task batch
- At least one generated connection is retrieved and used in a subsequent task
- Token cost per wandering session: <$0.01 (Haiku + small context)
- Does not degrade performance (connections are moderate-confidence, not forced)

## Success Criteria

1. **SC-1:** Adaptive load (P2) reduces average token cost by ≥15% vs fixed deliberate mode
2. **SC-2:** Reflection (P6) produces higher-quality FactCards than in-cycle extraction (measured by retrieval usefulness in subsequent tasks)
3. **SC-3:** Thought patterns (P5) make Task 05 (dead code) consistently pass (≥4/5 at N=5)
4. **SC-4:** Concurrent processes (P1) make Task 04 (API versioning) pass (≥3/5 at N=5)
5. **SC-5:** Dynamic personas (P4) measurably change behavior without degrading pass rate
6. **SC-6:** Emotional signals (P3) reduce stagnation loops by ≥30%
7. **SC-7:** Mind wandering (P7) produces at least 1 usable cross-task insight per 5-task batch
8. **SC-8:** Multi-sense (P8) enables reactive behavior (agent notices test failures without being told)
9. **SC-9:** All 8 patterns compose without architecture changes — only new modules + configs
10. **SC-10:** Combined system achieves ≥4/5 on task battery at ≤1.0x flat cost

## Acceptance Criteria

- AC-1: P6 reflector-v2 produces 1-3 HEURISTIC cards per task with concise strategic content
- AC-2: P5 ThoughtPattern type exists, 3 built-in patterns retrievable from memory
- AC-3: P2 meta-composer selects profile correctly ≥80% (manual eval on 20 tasks)
- AC-4: P1 parallel adversarial reasoning fires and produces synthesized actions
- AC-5: P4 persona injection changes action distribution measurably (chi-squared test)
- AC-6: P3 affect signals computed correctly from traces (unit tests for each emotion)
- AC-7: P8 attention filter passes high-priority events, blocks low-priority
- AC-8: P7 wanderer generates cross-domain associations
- AC-9: All patterns use CognitiveModule<I,O,S,Mu,Kappa> — no new primitive types
- AC-10: Experiment harness supports `--pattern=P1..P8` flags for selective activation

## Non-Goals

- Training or fine-tuning (all patterns are inference-time compositions)
- Real-time multi-agent communication (single agent, self-composed)
- Production deployment (experimental validation only)
- Full P8 integration with bridge EventBus (partial: VirtualToolProvider events only)
- Psychologically realistic emotion modeling (P3 is heuristic, not affective computing)

## Dependencies

- PRD 030 (Cognitive Composition) — implemented ✅
- PRD 031 (Cognitive Memory Module) — 5/6 commissions complete
- EXP-023 experiment infrastructure — ready ✅
- EXP-027 research document — written ✅
- `parallel()` and `competitive()` composition operators — implemented in algebra ✅
- `@anthropic-ai/sdk` — installed ✅
- Voyage AI API key — configured ✅

## Risk Assessment

- **Highest risk:** P2 (adaptive load) classification accuracy — rule-based may not generalize
- **Token cost risk:** P1 (concurrent) doubles cost per conflicted cycle — dual-process gating is critical
- **Integration risk:** P8 (multi-sense) requires event infrastructure not yet in experiment harness
- **Quality risk:** P7 (mind wandering) may produce noise rather than insight
- **Mitigation:** Each phase has independent success criteria; patterns can be enabled/disabled via config. A pattern that degrades performance is simply turned off.
