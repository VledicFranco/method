# RFC: Partitioned Workspace Composition

**Status:** Approved for Phase 1 — Trigger 1 (goal drift) confirmed by R-16 (T06: 0/3 at 30 cycles). See `003-decision-brief.md` and `003-strategic-evaluation.md`.
**Author:** PO + Lysica
**Date:** 2026-03-30
**Applies to:** `@method/pacta` (future phases), potentially `pv-agi`
**Organization:** Vidtecci
**Extends:** RFC 001 (Cognitive Composition), RFC 002 (SLM Compilation)

## Motivation

The Calculus of Cognitive Composition (RFC 001) defines an 8-module cognitive cycle where
all modules share a single Workspace — a flat, undifferentiated context buffer. PriorityAttend
manages context within the workspace via salience-based eviction, but all entries compete in
one queue. This design has a structural limitation discovered through empirical validation:

**Constraint blindness (R-14, N=25):** The cognitive cycle scores 0% on constraint-adherence
tasks (T04) while flat ReAct agents score 100%. Root cause: task constraints are evicted from
the workspace by higher-salience tool results. The Monitor detects action-level stagnation but
has no signal for semantic violations in produced artifacts. Threshold tuning has no effect
(R-15 ablation: identical failure at t=2, t=3, t=4).

This is not a threshold-tuning problem. It is a **structural limitation of single-workspace
architecture**. When one eviction policy governs all context, information types with different
retention needs compete destructively:

- Constraints need **permanent retention** — evicting a constraint produces silent failure
- Tool results need **aggressive recency** — old file contents waste context budget
- Goals/strategy need **goal-salience retention** — superseded strategies evict, active goals persist

A single eviction policy cannot serve all three. The evidence: T04 run 3 consumed 63K tokens
in a Write→Read loop because the Reasoner lost its constraint context and kept producing
violating code without the Monitor detecting it.

This RFC proposes that workspace context should not be monolithic. Different information
types need different retention strategies. Cognitive modules should load only the context
they need from typed partitions, not receive a dump of everything.

> **Epistemological note:** This RFC draws structural inspiration from Baddeley's multi-
> component Working Memory model (1974, 2000) — the insight that separate memory buffers
> with independent capacity limits and retention characteristics can coexist under a common
> executive. The analogy is structural, not biological: the claim is that the partitioning
> pattern is useful for engineering, not that LLMs are brains. Where the analogy diverges
> from the cited theory (and it does — see Limitations), the RFC should stand on its
> engineering merits alone.

## Goal

Define a **compositional pattern for workspace partitioning** where:

1. Each Partition is a typed storage domain (FCA) with its own eviction policy
2. Partitions compose via parallel aggregation — modules can query any subset
3. Cognitive modules declare typed context selectors — each LLM call loads only relevant
   entries from relevant partitions
4. Contradictions between partitions are permitted and resolved by the Reasoner through
   cross-partition deliberation
5. The pattern integrates with RFC 001 (module algebra) and RFC 002 (SLM compilation)

## Part 0: Minimum Viable Fix — The Pin Flag

Before introducing the full partition architecture, the constraint blindness problem has
a minimal fix that can be implemented and validated immediately:

### Implementation (~50 lines)

1. Add `pinned?: boolean` to `WorkspaceEntry`
2. In `evictLowest()`, skip entries where `pinned === true`
3. In the Observer, classify constraint-bearing entries with a rule-based keyword matcher:
   patterns like "must not", "never", "do not", "constraint:", "invariant:" set
   `contentType: 'constraint'` and `pinned: true`
4. In the Monitor, add a post-Write check: scan pinned constraint entries against the
   written artifact's content (string matching for ban-import, preserve-file patterns)

### Gate

Run R-13 experiment: T04 cognitive success ≥ 80% (4/5) without T01-T05 regression.

### Relationship to the Full Architecture

If the pin flag solves T04, the constraint blindness problem is closed. The partition
architecture (Parts I–V below) becomes the Phase 2+ generalization — justified by additional
problems that pinning alone cannot address:

- Token waste from monolithic context dumps (every module sees everything)
- Goal drift in long tasks (strategy context lost to tool result churn)
- Future domain-specific extensions (communication, patient context, etc.)

If the pin flag does NOT solve T04 (constraint still ignored despite being in context),
that evidence reveals a deeper problem and motivates the partition architecture more strongly.

**Either outcome validates the research. Ship the pin flag first.**

## Part I: The Workspace Partition

### Definition

A **Partition** is a typed storage domain — a bounded workspace buffer with its own entry
types and eviction policy. The name reflects the engineering function: partitioning a single
undifferentiated workspace into typed zones with independent retention strategies.

Structurally analogous to Baddeley's multi-component working memory: the phonological loop,
visuospatial sketchpad, and episodic buffer are separate subsystems with independent capacity
limits, coexisting under a central executive. This RFC's partitions serve the same structural
role — typed buffers with different retention — without claiming to implement Baddeley's
specific mechanisms (rehearsal, decay, binding).

Formally, a Partition **P** is a tuple:

```
P = (W, T, E)
```

Where:
- **W** : Workspace — typed storage buffer with capacity limit
- **T** : Entry types — the set of entry types this partition accepts
- **E** : Eviction policy — function that manages capacity (retention strategy)

A partition's **operations** are:

```
store  : (entry, W) → W'   if type(entry) ∈ T
select : (types, budget, strategy, W) → [entry]
evict  : (W) → W'           applying E
```

Each partition exposes a **PartitionReadPort** — a typed query interface that consuming
modules use to select entries. Modules never access partition internals directly; the
read port is the only boundary crossing.

### Partition as FCA Domain (Phase 2+)

When the full partition architecture is implemented, each partition is structured as an
FCA domain with co-located artifacts:

```
partition/<name>/
  workspace.ts      — typed storage, capacity management
  types.ts          — entry type definitions
  eviction.ts       — eviction policy implementation
  read-port.ts      — PartitionReadPort: select(types, budget, strategy)
  config.ts         — capacity limits, eviction parameters
  __tests__/        — partition-level tests (isolation)
```

### Core Partitions

```
ConstraintPartition = (
  W:  ConstraintWorkspace,
  T:  { 'constraint', 'invariant', 'boundary', 'rule' },
  E:  NoEviction,                     // constraints persist until task completes
)

OperationalPartition = (
  W:  OperationalWorkspace,
  T:  { 'tool-result', 'observation', 'error', 'file-content' },
  E:  AggressiveRecency,              // newest wins, oldest evicted first
)

TaskPartition = (
  W:  TaskWorkspace,
  T:  { 'goal', 'strategy', 'progress', 'milestone' },
  E:  GoalSalience,                   // goals persist, superseded strategies evicted
)
```

### Partition Composition

Partitions compose via parallel aggregation:

```
PartitionSystem = P₁ ⊕ P₂ ⊕ ... ⊕ Pₙ
```

Where `⊕` is informal notation for: each partition maintains independent state, and any
module can query any subset of partitions via their read ports. There is no shared eviction —
each partition manages its own capacity independently.

> **Note on formalization:** The `⊕` notation is shorthand for parallel aggregation with
> shared read access. It is NOT a formally defined algebraic operator — properties such as
> associativity, commutativity, and identity have not been established. Formalizing these
> properties is an open research question (see Q4) that should follow empirical validation,
> not precede it.

**On openness:** Adding a new partition to the system requires no changes to existing
partitions. However, for existing modules to see entries in the new partition, their context
selectors must be updated — this is a known coupling point. Decoupling options (modules
declare entry TYPE requirements instead of partition names, with the system routing from
whichever partitions contain matching types) are discussed in Q5.

## Part II: Context Selection

### The Problem with Monolithic Context

In RFC 001's current implementation, every module receives the full workspace projection as
its LLM prompt context. Different modules have different information needs, but all pay the
same context cost:

```
Current:
  Module.step(input) → LLM call with [full workspace dump + input]

  Monitor gets:      file contents it doesn't need      → wasted tokens
  Reasoner gets:     old tool results it doesn't need    → wasted tokens
  Actor gets:        constraint text it doesn't need     → wasted tokens
  Every module pays: O(total workspace) tokens per call
```

### Typed Context Selection

Each cognitive module declares a **Context Selector** — a typed specification of what entries
it needs from which partitions:

```
ContextSelector = {
  sources:  [PartitionId],       // which partitions to query
  types:    [EntryType],         // which entry types to include
  budget:   TokenCount,          // maximum tokens for this module's context
  strategy: AttendStrategy,      // how to select within budget
}
```

Strategy options:
- `all` — include every matching entry (for small, critical partitions like Constraint)
- `recency` — most recent entries first
- `salience` — highest salience score first (current PriorityAttend behavior)
- `diversity` — maximize coverage of different entry types/topics

### Module Context Bindings

```
Reasoner.selector = {
  sources:  ['task', 'operational', 'constraint'],
  types:    ['goal', 'strategy', 'tool-result', 'constraint', 'error'],
  budget:   8192,
  strategy: 'salience',
}

Monitor.selector = {
  sources:  ['constraint', 'operational'],
  types:    ['constraint', 'anomaly-signal', 'action-result'],
  budget:   2048,
  strategy: 'all',       // Monitor gets ALL constraints + recent signals
}

Actor.selector = {
  sources:  ['operational', 'task'],
  types:    ['plan-step', 'tool-result', 'file-content'],
  budget:   4096,
  strategy: 'recency',
}
```

### Context Loading

Context assembly lives in the cycle orchestrator (L4 — the same location that currently
constructs per-module inputs via `workspace.snapshot()`). The process is decomposed into
explicit steps:

```
buildContext(module, partitionSystem):
  1. For each partitionId in module.selector.sources:
       entries += partition.readPort.select(module.selector.types, budget, strategy)
  2. Merge entries across partitions (concatenate)
  3. Truncate to module.selector.budget
  4. Return formatted context
```

Each partition's `readPort.select()` is a port call — the module never accesses partition
internals. The merge step is trivial (concatenate + truncate). Context selectors are wired
at composition time: each module receives only the `PartitionReadPort` instances declared
in its selector, preventing access to undeclared partitions.

### Token Efficiency

The theoretical improvement from selective context loading is significant but unmeasured
in the current system. Before claiming specific reduction ratios, the implementation should:

1. Profile actual context volume per module in the single-workspace architecture
2. Measure how much irrelevant context each module currently receives
3. Compare before/after with per-module selectors on the same task set

This measurement is a Phase 1 deliverable, not an up-front claim.

**RFC 002 synergy:** Focused contexts are easier to SLM-compile. A Monitor seeing 2K tokens
of typed constraint signals is a simpler prediction problem than a Monitor seeing 32K tokens
of mixed content. Per-module context selection creates tighter, more predictable input
distributions — better SLM compilation targets.

## Part III: Entry Routing

### The Routing Problem

When the Observer processes new input, it must classify entries into the correct partition.
A misrouted constraint entry (classified as operational and subject to recency eviction)
reproduces exactly the constraint blindness the RFC exists to fix. Routing is the load-
bearing mechanism of the partition architecture.

### Phase 1: Rule-Based Router

For R-13 validation, a deterministic keyword/regex classifier is sufficient. The T04 task
constraints are explicit and syntactically detectable:

```typescript
function classifyEntry(content: string): { contentType: string; partition: PartitionId } {
  const lower = content.toLowerCase();

  // Constraint patterns: prohibitions, invariants, boundaries
  if (/\b(must not|never|do not|shall not|cannot)\b/.test(lower) ||
      /\b(constraint|invariant|boundary|prohibited)\b/i.test(lower)) {
    return { contentType: 'constraint', partition: 'constraint' };
  }

  // Goal patterns: objectives, requirements, deliverables
  if (/\b(goal|objective|task|deliver|implement|create|build)\b/i.test(lower)) {
    return { contentType: 'goal', partition: 'task' };
  }

  // Default: operational
  return { contentType: 'operational', partition: 'operational' };
}
```

This is deterministic, testable, and requires no LLM call. The patterns can be extended
based on routing error analysis from experiments.

### Known Limitations

- **Ambiguity:** "Implement email validation" is both a goal and potentially has constraint
  implications. The rule-based router classifies by first match, which may miss secondary
  classifications. Multi-label routing is a Phase 2 concern.
- **False negatives:** Constraints expressed without keyword markers ("The v2 handler should
  avoid side effects") may be misclassified. Error rate analysis from R-13 experiments will
  quantify this.
- **Phase 2+ options:** LLM-based classification or SLM-compiled routing (RFC 002) for cases
  where keyword matching fails. The router itself is a candidate for SLM compilation —
  possibly the simplest classification target in the system.

## Part IV: Cross-Partition Deliberation

### Contradictions Are Permitted

Different partitions hold different perspectives that can contradict:

- **ConstraintPartition:** "Do not import from notifications service"
- **OperationalPartition:** "The notifications service has the email validation function we need"
- **TaskPartition:** "Implement email validation for the v2 handler"

This is the natural state of a multi-perspective system. The resolution mechanism is
straightforward: the Reasoner's context selector includes entries from all relevant
partitions, so it sees the contradiction and deliberates.

LLMs are naturally capable of weighing competing considerations — this is their strongest
capability. What they need is to **see** the contradiction. The partition architecture
ensures they do, because constraints are never evicted and the Reasoner's selector always
includes the ConstraintPartition.

### Priority Through Architecture, Not Rules

In single-workspace design, constraint priority must be encoded as rules ("always check
constraints before acting"). In partition design, priority emerges from architecture:

- ConstraintPartition has `NoEviction` → constraints are always present
- Monitor selector includes ConstraintPartition with `strategy: 'all'` → Monitor always
  sees all constraints
- Reasoner selector includes ConstraintPartition → Reasoner always weighs constraints

The architectural decision (constraints don't evict) produces the behavioral outcome
(constraints are always respected). **Information architecture determines cognitive behavior.**

## Part V: Per-Partition Monitoring

### Deterministic Monitors

Each partition can have a co-located monitor function — a deterministic check (not an
LLM call) that validates partition-specific quality criteria:

```
ConstraintPartition.monitor  → post-Write: pattern-match constraint predicates against
                                written artifacts (string matching, no LLM)
OperationalPartition.monitor → detects stagnation loops (current Monitor V1 logic —
                                consecutive read-only actions, already deterministic)
TaskPartition.monitor        → detects goal staleness (no progress entries for N cycles)
```

These monitors produce typed signals:

```
PartitionSignal = {
  severity: 'critical' | 'high' | 'medium' | 'low',
  partition: PartitionId,
  type: string,          // 'constraint-violation' | 'stagnation' | 'goal-stale'
  detail: string,
}
```

Using a common signal interface (severity + partition + type + detail) rather than per-
partition signal types. This means the signal consumer does not need to know about specific
partition types — it operates on severity, making it genuinely partition-agnostic.

### Signal Aggregation

The existing Monitor module (or its successor) aggregates partition signals at the cycle
orchestration layer (L4). Priority is determined by signal severity, not partition identity:

```
Signal Priority (by severity):
  critical → immediate RESTRICT + REPLAN  (e.g., constraint violation)
  high     → REPLAN if persistent         (e.g., repeated stagnation)
  medium   → flag for next cycle          (e.g., goal staleness)
  low      → log only
```

This replaces the current Monitor's monolithic signal processing with a severity-based
aggregation over typed partition signals. The Monitor remains a single module at L4 — there
is no separate "Meta-Monitor." The per-partition monitors are deterministic functions
co-located with their partition (L2/L3 domain logic), not RFC 001 cognitive modules.

## Part VI: Integration with RFC 001 and RFC 002

### RFC 001: Module Algebra

The partition architecture refines how module input (I) is constructed without changing
the module algebra itself. Modules still have the (I, O, S, μ, κ) signature. The change:

```
RFC 001:  module.step(workspaceSnapshot, state, control)
RFC 003:  module.step(buildContext(module, partitionSystem), state, control)
```

The `buildContext` function lives in the cycle orchestrator (L4), the same location that
currently calls `workspace.snapshot()`. Each module's I type becomes a typed, filtered
projection of the partition system rather than a monolithic snapshot.

> **Honest note:** This changes the effective semantics of module composition. In RFC 001,
> all modules see the same workspace — composition is output-to-shared-workspace. In RFC 003,
> each module sees a different projection — composition becomes shared-medium-with-typed-views.
> This is a different composition topology. A future formalization (Q4) should characterize
> this change precisely rather than claiming backward compatibility.

The 8-phase cognitive cycle is unchanged. No new phases are added in the core architecture.

### RFC 002: SLM Compilation Synergy

Partition architecture improves SLM compilation prospects:

1. **Focused context** → smaller, typed input distributions → better compilation targets
2. **Typed entries** → tighter DSL grammars (ConstraintPartition entries have known schema)
3. **Entry routing** → classification task → SLM-compilable (possibly the simplest target)
4. **Per-partition monitors** → deterministic functions, not LLM modules (already "compiled")

## Part VII: Worked Example — T04 Constraint Blindness Fix

### Current Architecture (fails)

```
Cycle 1: Observer reads task → "create v2 handler, must NOT import notifications"
         All entries go to single Workspace
Cycle 3: Tool results from file reads fill workspace
         PriorityAttend evicts task description (low recency salience)
Cycle 5: Reasoner writes v2 handler → imports notifications (constraint evicted)
         Monitor sees: no stagnation, no low confidence → no intervention
         Result: FAIL
```

### Pin Flag Fix (Phase 0)

```
Cycle 1: Observer reads task → keyword matcher tags "must NOT import notifications"
           as contentType: 'constraint', pinned: true
Cycle 3: Tool results fill workspace, eviction runs
         Pinned constraint entries survive eviction
Cycle 5: Reasoner sees constraint in context → writes v2 handler WITHOUT notifications
         Result: PASS (if Reasoner respects constraint in context)
```

### Partition Architecture (Phase 1+)

```
Cycle 1: Observer reads task → Router classifies entries:
           "create v2 handler" → TaskPartition (goal)
           "must NOT import notifications" → ConstraintPartition (constraint)
           "must NOT import audit" → ConstraintPartition (constraint)

Cycle 3: Tool results fill OperationalPartition (aggressive recency eviction)
         ConstraintPartition: untouched (NoEviction policy)
         TaskPartition: goal persists (GoalSalience policy)

Cycle 5: Reasoner.buildContext():
           TaskPartition.select()       → "create v2 handler"
           ConstraintPartition.select() → "must NOT import notifications/audit"
           OperationalPartition.select() → recent file contents
         Reasoner sees constraint → writes v2 handler WITHOUT notifications
         Result: PASS

Recovery path (if Reasoner ignores constraint despite seeing it):
Cycle 5: Actor writes v2 handler with notifications import
         ConstraintPartition.monitor post-Write check:
           reads file → finds "import ... from 'notifications'"
           matches constraint predicate
           emits PartitionSignal { severity: 'critical', type: 'constraint-violation' }
         Monitor aggregates signal → RESTRICT(Write) + REPLAN
Cycle 6: Reasoner replans with constraint violation in context
         Writes correct v2 handler
         Result: PASS (with recovery)
```

## Part VIII: Implementation Cost Estimates

Each phase is gated on evidence from the previous phase.

### Phase 0 — Pin Flag (~50 lines, 1-2 days)

- Add `pinned?: boolean` to `WorkspaceEntry` in `workspace-types.ts`
- Skip pinned entries in `evictLowest()` in `workspace.ts`
- Add keyword-based constraint classifier in Observer
- Add constraint-violation check in Monitor (post-Write string match)
- **Gate:** R-13 experiment — T04 ≥ 80% without regression

### Phase 1 — Typed Context Selection (3-5 days)

- Add per-module `ContextSelector` configs
- Refactor `cycle.ts` to use `buildContext(module, ...)` instead of `workspace.snapshot()`
- Add `contentType` field to `WorkspaceEntry` (already partially supported)
- Profile token usage per module before/after
- **Gate:** Token usage ≤ 60% of baseline at equal success rate

### Phase 2 — Full Partition Architecture (2-3 weeks)

- Split `WorkspaceManager` into typed `PartitionManager` with per-partition stores
- Implement `PartitionReadPort` interfaces per partition
- Implement rule-based entry router (promote from Observer keyword matcher)
- Add per-partition deterministic monitors with `PartitionSignal` aggregation
- FCA domain structure: `partition/<name>/` co-located artifacts
- **Gate:** T01-T05 parity with flat agent (cognitive ≥ 75% overall)

### Future phases (evidence-gated)

- LLM/SLM-based entry routing (when keyword routing error rate is measured and insufficient)
- Communication partition + communicator module (when communication failures are observed)
- Formal composition properties for `⊕` (when empirical patterns reveal which properties hold)

## Part IX: Open Research Questions

**Q1 — Dynamic budget allocation:** Should partition token budgets be fixed or dynamic?
ConstraintPartition might need 200 tokens for simple tasks and 2000 for complex ones.
Dynamic allocation (each partition declares min/preferred, remainder to Operational) adds
complexity but improves robustness.

**Q2 — Partition lifecycle:** Are partitions static (defined at system design time) or
dynamic (created per-task)? A medical domain might need a PatientPartition that exists only
during patient interaction. Dynamic creation adds flexibility but complicates the pattern.

**Q3 — Cross-partition learning:** When the Reflector distills a cycle into knowledge,
which partition does the learning go to? The Reflector needs a routing function similar to
the Observer's entry router.

**Q4 — Formal composition properties:** The `⊕` notation is currently informal shorthand
for parallel aggregation with shared read access. Can it be formalized? Is `⊕` associative?
Commutative? Does an identity (empty partition) exist? These properties should be investigated
after empirical validation reveals which invariants actually hold in practice.

**Q5 — Decoupling module selectors from partition names:** Currently, modules declare
`sources: [PartitionId]` — creating coupling between modules and specific partitions. An
alternative: modules declare entry TYPE requirements only, and the system routes from
whichever partitions contain matching types. This would make partition addition truly open.

## Part X: Limitations

**Neuroscience mapping is structural, not mechanistic.** This RFC draws inspiration from
Baddeley's multi-component model (separate buffers with independent capacity), but does not
implement Baddeley's specific mechanisms (articulatory rehearsal, visuospatial maintenance,
episodic binding). The partitions are typed storage pools with configurable eviction — a
software pattern, not a cognitive model.

**GWT divergence.** Global Workspace Theory (Baars, 1988) proposes a single broadcast
workspace where specialist processors compete for access. This RFC proposes multiple
independent partitions — structurally the opposite of GWT. The RFC's pull-based context
selection (modules query partitions) differs from GWT's push-based broadcast (workspace
content is broadcast to all processors). GWT is cited for historical context, not as
architectural justification.

**N=25 evidence base.** The motivating evidence (R-14 baseline, N=25) is real but thin.
The Phase 0 pin flag validates the hypothesis cheaply. Full partition architecture should
not be built until Phase 0 results confirm the structural diagnosis.

**Routing error propagation.** A misrouted constraint entry (classified as operational)
reproduces the exact failure the RFC exists to fix. The rule-based router's error rate on
constraint classification is unknown and must be measured in R-13 experiments.

**Module-partition coupling.** Adding a new partition requires updating module selectors.
This is a known coupling point that limits the "open composition" claim. See Q5 for
mitigation approaches.

## Future Extensions

### Communication Partition

**Status:** Speculative — no empirical evidence of communication failures in current
experiments (R-14, R-15).

A dedicated communication partition could store style directives, user preferences, tone
norms, and domain conventions. A Communicator module could produce user-facing output with
domain-appropriate framing (medical empathy, legal precision, engineering terseness).

This extension is motivated by the observation that "how you communicate is as important as
how you execute" — particularly for non-engineering domains (medical, legal, diplomatic).
However, it requires its own motivating experiments and PRD before implementation. If
communication drift is observed empirically, this section provides the architectural path.

### SLM-Compiled Router

The rule-based entry router (Part III) could be replaced with an SLM-compiled classifier
(RFC 002) for more nuanced natural-language constraint detection. This is likely the simplest
SLM compilation target — a binary/multiclass classifier over short text spans.

### Formal Algebra

If partition composition proves effective empirically, the `⊕` notation should be formalized
with proven algebraic properties. This requires characterizing the actual composition
topology (shared-medium-with-typed-views) rather than assuming standard algebraic structure.

## References

### Cognitive Architecture Theory
- Baddeley, A. D. (2000). The episodic buffer: a new component of working memory?
  *Trends in Cognitive Sciences*, 4(11), 417-423.
- Baddeley, A. D., & Hitch, G. (1974). Working memory. In G. H. Bower (Ed.),
  *Psychology of Learning and Motivation*, Vol. 8, pp. 47-89.
- Baars, B. J. (1988). *A Cognitive Theory of Consciousness*. Cambridge University Press.
- Minsky, M. (1986). *The Society of Mind*. Simon & Schuster.
- Anderson, J. R. (2007). *How Can the Human Mind Occur in the Physical Universe?*
  Oxford University Press.

### Metacognition and Monitoring
- Nelson, T. O., & Narens, L. (1990). Metamemory: A theoretical framework and new findings.
  In G. H. Bower (Ed.), *Psychology of Learning and Motivation*, Vol. 26, pp. 125-173.
- Botvinick, M. M. et al. (2001). Conflict monitoring and cognitive control.
  *Psychological Review*, 108(3), 624-652.

### Agent Architectures
- Sumers, T. R. et al. (2024). Cognitive Architectures for Language Agents (CoALA).
  *arXiv:2309.02427*.
- Laird, J. E. (2012). *The Soar Cognitive Architecture*. MIT Press.

### Communication and Pragmatics
- Grice, H. P. (1975). Logic and conversation. In P. Cole & J. Morgan (Eds.),
  *Syntax and Semantics*, Vol. 3, pp. 41-58.
- Brown, P., & Levinson, S. C. (1987). *Politeness: Some Universals in Language Usage*.
  Cambridge University Press.
