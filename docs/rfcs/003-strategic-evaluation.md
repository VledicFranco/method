# RFC 003 Strategic Evaluation — Beyond Task Metrics

**Date:** 2026-03-31
**Context:** Phase 5 SLM cognitive cycle complete, empirical triggers mostly negative, but the question isn't just "does it fix T03?"

---

## The Question

Should we implement RFC 003's partitioned workspace even if current task metrics don't demand it? The evaluation lens is not "does it fix a bug" but:

1. Does it enable complex behavior that's currently impossible?
2. Does it improve composition quality and experimentation velocity?
3. Does it open research paths toward AGI?

## What RFC 003 Actually Proposes (essence, not mechanics)

Strip away the implementation details. RFC 003's core proposition is:

> **Cognitive modules should operate on typed views of shared context, not raw dumps of everything.**

This is a separation-of-concerns claim about information architecture:
- The Monitor doesn't need file contents — it needs anomaly signals
- The Reasoner doesn't need past monitoring signals — it needs goals + constraints + recent state
- The Observer doesn't need old observations — it needs the new input

Currently, every module gets `workspace.snapshot()` — the same flat list. The module either uses what it needs and ignores the rest (wasting tokens), or gets confused by irrelevant entries (pollution). We've seen both: the Observer-every-cycle pollution (proven), and the workspace filling with large file contents on T06 (observed).

## Three Evaluation Lenses

### Lens 1: Engineering Value (Composition Quality)

**Current state:** The workspace is a god object. Every module reads everything, every module writes everything. Adding a new module (like the Evaluator in Phase 5) means it receives context it has no use for and writes entries that may interfere with other modules. We had to tune Observer frequency, workspace capacity, salience scores — all coupling-through-shared-mutable-state problems.

**With RFC 003:** Each module declares what it needs. Adding a module is additive — it declares its sources and budget, and other modules are unaffected. This is the same principle as FCA port interfaces, applied to workspace context. Today's "Observer fires every cycle → floods workspace → breaks T01" becomes structurally impossible if the Reasoner's context selector doesn't include Observer attention signals.

**Verdict:** RFC 003 would have **prevented** the Observer pollution problem at the architecture level, not requiring the cycle-gating workaround. It would make future module composition safer. But the engineering cost is real (~2 weeks implementation, ongoing maintenance of partition configs).

### Lens 2: Experimentation Velocity

**Current state:** Adding or modifying a cognitive module requires understanding the full workspace interaction surface. When we added the SLM Evaluator, we needed to understand its impact on workspace contents, monitor signals, and reasoner context. The cycle-gating fix required understanding how Observer entries affect the Reasoner through the shared workspace.

**With RFC 003:** Experiments become modular. Want to test a new "StrategyTracker" module? Define its partition, wire its selector, run the experiment. It can't interfere with existing modules because it reads from its own partition. Want to test different eviction strategies? Change one partition's policy, not the global eviction logic.

**Verdict:** Higher research velocity for cognitive architecture experiments. Each experiment is isolated by partition boundaries. This matters a lot for the RFC 001/002/003 research program where we're iterating on module designs.

### Lens 3: Path to AGI (Complex Cognition)

This is the lens the user cares most about. The question: does RFC 003 take us closer to the pv-agi metacognitive orchestration hypothesis?

**Current limitation: single-workspace = single-concern cognition.**

The cognitive cycle currently handles one task in one context. All information is one eviction decision away from being lost. This works for 15-cycle coding tasks. It does NOT work for:

- **Multi-goal reasoning:** An agent working on "implement feature X while maintaining invariant Y and preparing for migration Z" needs different retention for each concern. Single workspace can only optimize for one.

- **Hierarchical planning:** A planner that decomposes a goal into subgoals needs the parent goal to persist while subgoal context churns. Single workspace makes parent goals compete with subgoal tool results.

- **Cross-task learning:** An agent that remembers lessons from task N when executing task N+1 needs persistent strategic knowledge separate from ephemeral operational state. The Memory module (PRD 031) is a step in this direction but it writes to the same workspace.

- **Metacognitive self-monitoring:** The Monitor needs a stable view of what the agent has been doing (action history, confidence trends). In a single workspace, these signals compete with tool results for slots. With a dedicated MonitoringPartition, the Monitor always has its full signal history.

- **Deliberation under contradiction:** RFC 003 Part IV (cross-partition deliberation) explicitly enables the Reasoner to see conflicting information from different partitions and deliberate. This is a prerequisite for nuanced decision-making under uncertainty — a core AGI capability.

**What becomes possible:**

1. **Context-stable long-horizon tasks.** TaskPartition with GoalSalience means goals survive across 50+ cycles. The T06 result (workspace filling with file contents at 3.5K tokens avg) is exactly the problem TaskPartition solves.

2. **Typed SLM compilation targets.** Each partition has a narrower entry schema than the monolithic workspace. A Monitor SLM trained on MonitoringPartition signals (anomaly patterns, confidence histories) would have a tighter input distribution than one trained on "everything in the workspace." RFC 002 + RFC 003 compound.

3. **Modular cognitive scaling.** Adding a new partition type (e.g., CommunicationPartition for multi-agent coordination, EpisodicPartition for cross-task memory) doesn't require redesigning existing modules. This is the extensibility primitive for building more complex cognitive architectures.

4. **Empirical architecture search.** With partitioned workspaces, you can systematically vary: How many partitions? What eviction policies? What context budgets per module? These become hyperparameters you can tune experimentally, not architectural decisions locked in at design time.

**Verdict:** RFC 003 is not just a workspace fix — it's the **memory architecture** for complex cognition. Single-workspace is to cognitive architecture what global variables are to software: it works for small programs but prevents scaling. The partition pattern is the module system.

## Cost-Benefit Summary

| Dimension | Without RFC 003 | With RFC 003 |
|-----------|----------------|-------------|
| Current tasks (T01-T05) | Work fine with pin flag + cycle-gating | Same performance, cleaner separation |
| Long tasks (T06+) | Workspace fills, goals may drift | TaskPartition preserves goals |
| Adding new modules | Requires understanding full workspace surface | Modular — declare selectors, wire partitions |
| SLM compilation | Works but wide input distributions | Narrower, typed distributions per partition |
| Multi-goal reasoning | Not possible — single eviction queue | Each goal in its own partition context |
| Research velocity | Each experiment risks workspace interactions | Experiments isolated by partition boundaries |
| Path to AGI | Capped at single-concern 15-cycle tasks | Extensible memory architecture for complex cognition |

## Implementation Cost

RFC 003 Phase 1 (the minimum useful version):
- Split workspace into Constraint + Operational + Task partitions
- PartitionReadPort per partition
- Rule-based entry router (already exists as classifyEntry)
- Per-module context selectors
- Per-partition deterministic monitors

Estimated: **~1-2 weeks of focused implementation**, not a research project. The formal algebra (Parts IV-V) can be deferred. The entry router already exists. The FCA domain structure maps directly to the implementation.

## Recommendation

**Implement RFC 003 Phase 1 — not because current tasks demand it, but because:**

1. It's the memory architecture the cognitive research program needs to scale beyond toy tasks
2. It compounds with RFC 002 (SLM compilation on narrower distributions)
3. It makes every future cognitive experiment cheaper to run (modular composition)
4. It's a prerequisite for multi-goal, long-horizon, and cross-task cognition
5. The implementation cost is bounded (~2 weeks) and the architecture is well-specified

The T06 experiment running now will provide one more data point (goal drift on long tasks), but the strategic case doesn't depend on it. Even if T06 passes at 30 cycles, RFC 003 is worth building for the research optionality it unlocks.

## What T06 Results Would Tell Us

- **T06 passes at 30 cycles:** No goal drift at this scale. RFC 003's urgency is lower but strategic value unchanged. Build it for the research program, not as an emergency fix.
- **T06 fails with aimless looping after cycle 15:** Goal drift confirmed. RFC 003's TaskPartition is needed NOW for long tasks. Urgency is higher.
- **T06 fails with the same "EventBus not extracted" at cycle 30:** Task is too hard for the LLM, regardless of workspace. RFC 003 doesn't help here — it's a reasoning limitation.
