# PRD Design Notes — 043-workspace-constraint-pinning

## Tier: Standard
## Phase: 6 (Finalize) — COMPLETE

### Layer 1: WHY

- Q1 (Problem): Constraint blindness — cognitive cycle scores 0% on T04 (constraint-adherence tasks) while flat ReAct scores 100%. All runs identically violate constraints because workspace eviction removes them before Reasoner sees them.
- Q2 (Who): Any agent using the cognitive cycle on tasks with constraints (prohibitions, invariants, boundary rules). Validated on T04 (API versioning with side-effect trap).
- Q3 (Evidence): R-14 (N=25): T04 cognitive 0/5. R-03 (N=12): T04 cognitive 0/3. R-15 ablation: threshold tuning at t=2,3,4 doesn't help. T04 run 3: 63K token spiral. Deterministic, replicated failure across 8 runs.
- Q4 (Cost of inaction): Cognitive cycle cannot be used for any task with constraints — structurally worse than flat ReAct. The entire cognitive architecture (RFC 001) is blocked from production use.
- Q5 (Urgency): RFC 003 drafted 2026-03-30. R-14 baseline complete. Experiment infrastructure exists. Phase 0 is bounded — validate or refute the hypothesis cheaply before committing to full partition architecture.

### Layer 2: WHAT

- Q6 (Solution): Pin flag on WorkspaceEntry, constraint keyword classifier in Observer, post-Write constraint-violation check in Monitor, wire Monitor output (restrictedActions/forceReplan) to cycle orchestrator, diagnostic events for observability, R-13 experiment at N>=10.
- Q7 (Alternatives):
  - Alt 1: Full partition architecture (RFC 003 Phase 2) — 2-3 weeks, unvalidated hypothesis, overkill for evidence gathering
  - Alt 2: Prompt engineering ("always check constraints" in Reasoner prompt) — won't work because the constraint is evicted before the Reasoner sees it; the problem is information loss, not instruction following
  - Alt 3: Increase workspace capacity — delays but doesn't prevent eviction; constraints still lose to higher-salience tool results eventually
- Q8 (Out of scope): Full partition architecture (Phase 1+), SLM-compiled routing, per-module context selectors, token-based capacity, communication partition, new cognitive modules.
- Q9 (Success): R-13 gate: T04 cognitive >= 80% (8/10) without T01-T05 regression (overall cognitive >= 55%). Either outcome (pass or fail) is a valid research result.
- Q10 (Acceptance criteria): Pinned entries survive eviction. Constraint keywords detected and pinned. Post-Write violation emits signal. Monitor directives reach Actor/Planner. R-13 passes or provides diagnostic evidence for why it fails.

### Layer 3: HOW

- Q11 (Dependencies): None — all within @methodts/pacta, experiment infra exists
- Q12 (Risks):
  1. Pin flag works (constraint in context) but Reasoner still ignores it — deeper LLM compliance problem, not workspace architecture
  2. Keyword classifier false negatives on non-obvious constraints ("avoid side effects" vs "must NOT import")
  3. Monitor wiring fix has side effects on existing stagnation behavior (existing tests may break)
  4. Post-Write check triggers false positives (pattern match too aggressive)
- Q13 (Rollout): Internal research — no production rollout. Feature is additive (pinned field optional, classifier opt-in).
- Q14 (Monitoring): Diagnostic events (CognitiveConstraintPinned, CognitiveConstraintViolation, CognitiveMonitorDirectiveApplied) provide full observability.
- Q15 (Rollback): Revert commit. No data migration involved.

### Layer 4: CONSTRAINTS

- Q16 (Appetite): 2-3 days implementation + 1 day R-13 experiment. Standard tier justified by wiring fix + diagnostics + experiment rigor.
- Q17 (NFRs): No performance regression in workspace operations. Existing test suite passes.
- Q18 (Cross-cutting): Observability via cognitive events (existing event system). No backwards-breaking changes to WorkspaceEntry (field is optional).

### Open Markers
(none)
