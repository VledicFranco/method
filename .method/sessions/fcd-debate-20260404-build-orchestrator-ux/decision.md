---
type: council-decision
topic: "FCD automation UX — /build orchestrator for automated design→implement→verify→validate"
date: "2026-04-04"
cast: [Maren (Surface Advocate), Kai (Velocity Champion), Sable (DX Architect), Thorne (Reliability Engineer), Lux (Leader)]
surface_advocate: "Maren"
ports_identified: [BuildOrchestrator pact, CheckpointProtocol]
---

# Decision: Pacta Cognitive Agent as `/build` Orchestrator

## Summary

A single `/build "requirement"` command invokes a Pacta cognitive agent (the BuildOrchestrator) that drives the full FCD lifecycle: design → plan → commission → review. Inner steps remain strategy DAGs executed via existing MCP tools. The cognitive loop handles failures (retry, reroute, escalate) and human interaction (clarifying questions, approvals, mid-flight adjustments).

## Arguments For

- **Single entry point** eliminates pipeline ceremony — users describe intent in natural language
- **Cognitive loop handles non-DAG control flow** — review rejection → targeted retry, upstream invalidation → pause + amend, all without adding loop semantics to the DAG engine
- **Existing infrastructure reused** — all 8 FCD strategies, MCP tools, RuntimeObserver, dashboard work as-is
- **Matches prior council decision** (Meta Agent Loop 2026-03-21) on cognitive orchestration
- **Failure recovery is first-class** — the agent reasons about failures, not just retries blindly (60% success with context vs 20% blind — standing evidence from strategy-pipelines council)

## Arguments Against (Acknowledged)

- **Cognitive agent adds latency and cost** to the happy path (an extra reasoning layer). Mitigated: agent is thin in the no-failure case — observe strategy status, advance when green.
- **Observability is harder** than pure YAML DAG. Mitigated: mandatory audit trail — every decision logged with reasoning.
- **Checkpoint/resume is new engineering** — no existing checkpoint protocol for Pacta agents. Must be designed and built.

## Architecture

```
User: /build "Add rate limiting to API gateway"
  │
  ▼
BuildOrchestrator (Pacta cognitive agent)
  │  Uses enriched preset: reasoner + monitor + evaluator
  │  Budget-constrained, checkpoint-enabled
  │
  ├─ Phase 1: Clarification (up to 3 conversational turns)
  │    → Confirm scope, stakeholders, constraints
  │    → Present plan summary for approval
  │
  ├─ Phase 2: Design (drives s-fcd-design via strategy_execute MCP tool)
  │    → Monitors via strategy_status
  │    → On failure: analyze, amend prompt, retry
  │    → On success: checkpoint
  │
  ├─ Phase 3: Plan (drives s-fcd-plan)
  │    → Validates commission count and wave structure
  │    → On upstream issue: pause, surface to user
  │    → On success: checkpoint
  │
  ├─ Phase 4: Implement (drives s-fcd-commission-orch)
  │    → Monitors parallel commissions
  │    → On commission failure: targeted retry with failure context
  │    → On success: checkpoint
  │
  ├─ Phase 5: Review (drives s-fcd-review)
  │    → If REQUEST_CHANGES: route findings to relevant commissions, re-implement
  │    → If APPROVE: proceed to completion
  │    → Loop limit: 2 implement→review cycles max
  │
  └─ Completion: summary report, total cost, artifact links
```

## Three-View UX Model

| View | Purpose | Implementation |
|------|---------|----------------|
| **Conversational** | Intent capture, decisions, mid-flight adjustment | Pacta agent ↔ Claude Code session |
| **Progress dashboard** | Live DAG visualization, gate status, cost | RuntimeObserver → WebSocket → bridge dashboard |
| **Artifact review** | PRD, plan, code diffs, review findings | `.method/sessions/` file browser in dashboard |

## Surface Implications

### New Ports

1. **BuildOrchestrator pact** — Pacta pact definition
   - Execution mode: resumable
   - Budget: configurable per-invocation (default $15)
   - Scope: MCP tools only (strategy_execute, strategy_status, strategy_abort, project tools)
   - Output: PipelineReport schema (stages completed, cost, artifacts, findings)
   - Checkpoint: serialize at wave boundaries

2. **CheckpointProtocol** — pipeline state serialization
   - Format: YAML in `.method/sessions/{session}/checkpoints/`
   - Content: current phase, completed strategy IDs, artifact manifest, cost accumulator
   - Resume: orchestrator reads checkpoint, skips completed phases

### Existing Ports Reused (no changes)

- Strategy MCP tools (strategy_execute, strategy_status, strategy_abort)
- RuntimeObserver (gate lifecycle events → WebSocket)
- Bridge event bus (progress monitoring)
- Session filesystem (artifact storage)

### Entity Types

- `PipelineCheckpoint` — wave index, strategy execution results, artifact snapshot, cumulative cost

### Wave 0 Items (before implementation)

1. Define BuildOrchestrator Pacta pact (budget, scope, checkpoint schema, escalation rules)
2. Define CheckpointProtocol serialization format
3. Verify MCP tool coverage for orchestrator → strategy communication
4. Design audit trail format for agent decisions

### Co-Design Sessions Needed

1. `/fcd-surface BuildOrchestrator ↔ StrategyEngine` — pact's interaction pattern with inner DAGs
2. `/fcd-surface CheckpointProtocol ↔ BridgePersistence` — checkpoint survival across bridge restarts

## Open Questions

1. **Skill vs endpoint?** `/build` should be both — skill for interactive Claude Code sessions, bridge endpoint for headless CI. Same orchestrator agent, different entry points.
2. **Ephemeral vs persistent?** Start ephemeral (one agent per /build invocation). Persistent can come later if cross-build learning proves valuable.
3. **Which Pacta preset?** Enriched (reasoner + monitor + evaluator). Full cognitive stack is overkill for orchestration. Add memory module only if cross-build learning is needed.
4. **Review loop limit?** 2 implement→review cycles max before escalating to human. Prevents infinite retry on fundamentally misspecified requirements.

## Observability Requirements (from Thorne)

1. Every orchestrator decision logged: action taken, reasoning, evidence
2. Cost tracked at every stage with budget alerts at 80% and 100%
3. Checkpoint at every wave boundary — resume survives bridge restart
4. Kill switch at node, wave, and pipeline level
