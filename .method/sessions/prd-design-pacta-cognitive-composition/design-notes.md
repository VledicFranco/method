# PRD Design Notes — pacta-cognitive-composition

## Tier: heavyweight
## Phase: 6 (Finalize) — COMPLETE

### Layer 1: WHY

- Q1 (Problem): Pacta Phase 1 provides flat linear middleware composition (budget → output → provider). There is no structured way to compose modules that monitor each other, compete for workspace influence, or form hierarchical control loops. Current ReasoningPolicy + middleware cannot express parallel, competitive, or metacognitive composition patterns.
- Q2 (Who): Extension developers (Tier 3 from PRD 027) building agents that need mid-task strategy shifts, self-monitoring, or multi-module coordination. Also: the method project itself — validating whether cognitive science architectures translate to LLM agent design.
- Q3 (Evidence): Academic — 5 decades of cognitive science architectures (ACT-R, SOAR, GWT, Nelson & Narens, CLARION). No agent framework currently grounds itself in these patterns. [HONEST FRAMING] This is a theory-first design bet. No empirical Pacta failure data exists yet. The RFC's validation criteria (Part VII) are the test — experiments will follow implementation.
- Q4 (Cost of inaction): Pacta stays as a flat middleware SDK. Agents can't self-monitor, shift strategy mid-task based on metacognitive signals, or compose modules beyond linear pipelines. Research hypothesis remains untested.
- Q5 (Urgency): Pacta Phase 1 implemented (PRD 027-028 complete). Type system and port interfaces are in place. Phase 2 is the natural next step. RFC written and ready for implementation.

### Layer 2: WHAT

- Q6 (Solution): Implement the Calculus of Cognitive Composition as defined in docs/rfcs/001-cognitive-composition.md:
  1. Cognitive module type M = (I, O, S, μ, κ) with step: (I, S, κ) → (O, S', μ)
  2. Four composition operators: sequential (>>), parallel (|), competitive (<|>), hierarchical (▷)
  3. Bounded recursive tower: tower(M, n)
  4. Workspace — shared context with salience-based attention and eviction
  5. Two-level architecture — object-level (reasoner, actor, observer, memory) + meta-level (monitor, evaluator, planner, reflector)
  6. 8-phase cognitive cycle with default-interventionist pattern
  7. All 8 cognitive modules implemented
- Q7 (Alternatives):
  - Alt 1: Extend existing middleware stack with monitoring signals. Pro: incremental, backward-compatible. Con: middleware is linear — can't express parallel, competitive, or hierarchical composition. Monitoring bolted on, not structural. REJECTED.
  - Alt 2: Port existing cognitive architecture (ACT-R/SOAR) directly. Pro: decades of validation. Con: designed for biological simulation, not LLM agents. Token/context constraints differ fundamentally. Poor fit for Pacta's composition model. REJECTED.
  - Alt 3: Graph-based orchestration (LangGraph-style). Pro: well-understood paradigm. Con: graphs don't express metacognition, competitive selection, or salience-based workspace. Reduces Pacta to "another LangGraph." REJECTED.
- Q8 (Out of scope):
  1. Mathematical formalization (category theory, sheaf theory, process algebra) — theory work, not code
  2. System 1/2 compilation mechanism — RFC Q8, open research problem
  3. Biological fidelity — explicitly disclaimed by RFC
  4. Production deployment in the bridge — L3 library validation only, bridge integration is follow-up
  5. Validation experiments — experiments follow implementation, as with EXP-002/EXP-003 pattern
- Q9 (Success): The implementation works correctly — modules compose, workspace evicts, cycle executes, monitor intervenes. RFC's 3 validation criteria (outperform flat ReAct, catch errors, reduce token waste) are the success definition for follow-up experiments, not this PRD's acceptance criteria.
- Q10 (Acceptance criteria): See Phase 3. Shape: type system compiles, composition operators produce valid modules, workspace enforces capacity, cognitive cycle executes with default-interventionist skipping, monitor detects anomalies, all via Playground/testkit verification.

### Layer 3: HOW

- Q11 (Dependencies): @method/pacta (PRD 027), @method/pacta-testkit, @method/pacta-playground. No external deps (G-PORT gate).
- Q12 (Risks):
  1. R1 (High): Cognitive module step() semantics don't compose cleanly with stateless invoke() — provider mapping gap
  2. R2 (High): Workspace salience heuristics produce degenerate eviction without LLM-scored salience
  3. R3 (Medium): Default-interventionist pattern hard to tune — meta fires too often (cost) or too rarely (misses errors)
  4. R4 (Medium): Composition operators produce type-level combinatorial explosion making API unusable
  5. R5 (High): Theory doesn't translate — all 3 validation criteria fail in follow-up experiments
- Q13 (Rollout): Library (L3). Rollout = new package version. No deployment.
- Q14 (Monitoring): Playground benchmark results. Structured trace records from module steps.
- Q15 (Rollback): Don't promote to bridge integration. Existing Pacta Phase 1 unaffected.

### Layer 4: CONSTRAINTS

- Q16 (Appetite): Ambitious, unconstrained. Research priority. Time and token budget not limiting factors.
- Q17 (NFRs):
  - Cognitive cycle amortized cost target: <1.5x ReAct for routine turns (from RFC)
  - Zero runtime dependencies in @method/pacta (G-PORT gate preserved)
  - Composition operators must be type-safe (TypeScript generics, not any)
- Q18 (Cross-cutting):
  - Observability: every module step emits structured traces (RFC Part IV)
  - Backward compatibility: existing Pacta Phase 1 types (Pact, createAgent, middleware) continue working
  - Cognitive composition extends the SDK, doesn't replace it

### Open Markers
(none — all questions resolved)
