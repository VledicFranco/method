---
title: "PRD 006 — Recursive Agent Orchestration"
status: implemented
---

# PRD 006 — Recursive Agent Orchestration

**Status:** Implemented
**Date:** 2026-03-15
**Previous:** Draft (2026-03-14)
**Scope:** Recursive session management, worktree isolation, council-to-bridge automation, guardrails
**Depends on:** PRD 004 (methodology session + routing tools), PRD 005 (bridge + dashboard)
**Evidence:** Phase A validation (bridge → method MCP chain works), GC-P2SD-006 (git staging conflicts), SESSION-014 (council maturity assessment)
**Implementation:** Components 1, 3, 4 implemented in prior PRDs. Components 2 (worktree isolation) and 4-partial (stale detection) implemented via bridge commission (commit 470ac56). 154 tests, 16 new. First successful bridge-commissioned implementation with PRD 008 visibility.
**PRD 021 impact:** **Extended.** Commission composition becomes typed `Prompt<TaskContext>` combinators. Sub-agent spawning gets pre-validated in TypeScript (depth, budget, capabilities checked before bridge call). Parent-child state flow becomes typed `WorldState<S>` → typed artifacts instead of untyped channel messages. Session chains carry typed state with `StateTrace<S>`.

---

## Purpose

Phase A validated that a spawned agent can use method MCP tools to follow a methodology. But the current system is flat — one level of spawning. The steering council's vision is deeper: a council commissions work → a bridge agent follows P2-SD → that agent spawns sub-agents for individual method steps → sub-agents produce results → retros flow back up.

PRD 006 closes the recursion gap: agents that spawn agents that follow methodologies.

---

## Problem

After PRD 004 and 005, the tools exist but three capabilities are missing:

**1. Recursive session management.** When a commissioned agent (level 1) spawns a sub-agent (level 2) via bridge_spawn, the sub-agent's methodology session has no relationship to the parent's. If level 2 spawns level 3, there's no session chain. Results don't flow up. Nobody tracks the recursion depth.

**2. Worktree isolation.** GC-P2SD-006 (2 MEDIUM, 2 projects): parallel agents sharing a working tree pick up each other's staged files during git add/commit. Worktrees solve this — each sub-agent gets an isolated copy of the repo. The bridge supports `workdir` but doesn't create worktrees automatically.

**3. Council-to-bridge automation.** The steering council produces commission decisions (D-021 through D-025) but firing them requires the human to copy-paste prompts. The `/commission` skill produces prompts but doesn't call bridge_spawn. The last mile — commission → bridge_spawn → agent running — is manual.

---

## Component 1: Parent-Child Session Chains

### Design

When a commissioned agent spawns a sub-agent, it passes its own session context:

```typescript
// Level 1 agent (commissioned by council)
bridge_spawn({
  workdir: "/path/to/worktree",
  session_id: "commission-001",           // its own methodology session
  spawn_args: ["--allowedTools", "mcp__method__*"],
  metadata: {
    parent_session: "commission-001",      // NEW: parent chain
    depth: 1,                              // NEW: recursion depth
    budget: { max_depth: 3, max_agents: 10 }  // NEW: guardrails
  }
})
```

The bridge records the parent-child relationship:

```typescript
type BridgeSession = {
  bridge_session_id: string;
  parent_session_id: string | null;    // null for root
  depth: number;                        // 0 for root, increments per level
  methodology_session_id: string | null;
  children: string[];                   // child bridge_session_ids
  budget: {
    max_depth: number;
    max_agents: number;
    agents_spawned: number;
  };
};
```

### API Changes

**`POST /sessions` (bridge_spawn):**
- New optional fields in request body: `parent_session_id`, `depth`, `budget`
- Bridge validates: `depth < budget.max_depth` (rejects if exceeded)
- Bridge validates: `agents_spawned < budget.max_agents` (rejects if exceeded)
- Response includes `depth` and `budget` status

**`GET /sessions/:id/status`:**
- Response includes `parent_session_id`, `depth`, `children[]`, `budget`

**`GET /sessions` (bridge_list):**
- Response includes parent-child tree structure
- Dashboard shows session hierarchy (indented tree view)

### Core Function

New `@method/core` function:

```typescript
export type SessionChain = {
  session_id: string;
  parent_session_id: string | null;
  depth: number;
  children: string[];
  budget: SessionBudget;
};

export type SessionBudget = {
  max_depth: number;
  max_agents: number;
  agents_spawned: number;
};
```

---

## Component 2: Worktree Isolation

### Design

When a commissioned agent needs to spawn parallel sub-agents, each sub-agent gets its own git worktree. This prevents GC-P2SD-006 (git staging conflicts).

**New bridge behavior:** When `bridge_spawn` receives `isolation: "worktree"`, the bridge:
1. Creates a git worktree: `git worktree add .claude/worktrees/{session_id} -b worktree-{session_id}`
2. Sets the spawned agent's workdir to the worktree path
3. On session kill: offers to merge worktree changes back or discard

**API Changes:**

**`POST /sessions` (bridge_spawn):**
- New optional field: `isolation: "worktree" | "shared"` (default: "shared")
- If "worktree": bridge creates worktree, sets workdir, tracks worktree path
- Response includes `worktree_path` if isolation = "worktree"

**`DELETE /sessions/:id` (bridge_kill):**
- New optional field: `worktree_action: "merge" | "keep" | "discard"` (default: "keep")
- "merge": cherry-pick worktree commits into the parent branch
- "keep": leave worktree on disk for manual merge
- "discard": remove worktree and branch

### Constraint: Metals MCP

Per I1-T1X DR-21 (from retro evidence): Metals MCP is bound to the primary repository. Agents in worktrees cannot use Metals for Scala navigation. The bridge should tag worktree sessions so orchestrators know not to assign Metals-dependent tasks to worktree agents.

```typescript
type BridgeSession = {
  // ...existing fields...
  isolation: "worktree" | "shared";
  worktree_path: string | null;
  metals_available: boolean;           // false if isolation = "worktree"
};
```

---

## Component 3: Commission-to-Bridge Automation

### Design

The `/commission` skill currently produces a prompt for the human to paste. With bridge integration, it can fire directly:

**New commission flow:**
1. `/commission [task]` → composes the prompt (existing)
2. Human reviews the prompt (existing)
3. Human approves: "fire it" → skill calls bridge_spawn with the prompt (NEW)
4. Skill returns the bridge_session_id for monitoring

**Not automated:** The human approval step remains. The commission skill does NOT auto-fire — it presents the prompt, the human approves, THEN it spawns.

### MCP Tool Enhancement

**`bridge_spawn` metadata field enhancement:**
```
metadata: {
  commission_id: "D-025",              // council decision that authorized this
  commissioned_by: "steering-council",  // who commissioned
  task_summary: "Phase A validation",   // human-readable
  methodology: "P2-SD",                // expected methodology
  governance_context: "..."            // from council LOG
}
```

This metadata appears in the dashboard — the human can see which council decision spawned which agent.

---

## Component 4: Guardrails

### Recursion Depth Limit

Default: `max_depth: 3`. Three levels:
- Level 0: Root agent (orchestrator, commissioned by council)
- Level 1: Method-step agents (spawned by orchestrator for M1-IMPL steps)
- Level 2: Sub-task agents (spawned by method agents for parallel sub-tasks)
- Level 3: BLOCKED — no further spawning

Configurable per commission via `budget.max_depth`.

### Agent Budget

Default: `max_agents: 10`. Total agents spawned across all levels per commission chain.

When budget is exhausted, `bridge_spawn` returns an error:
```json
{
  "error": "BUDGET_EXHAUSTED",
  "message": "Agent budget exceeded: 10/10 agents spawned. Increase budget or complete existing work.",
  "budget": { "max_depth": 3, "max_agents": 10, "agents_spawned": 10 }
}
```

### Escalation on Budget Exhaustion

When an agent hits the budget limit:
1. It cannot spawn more sub-agents
2. It must complete the remaining work itself (degrade to single-agent)
3. It reports the budget exhaustion in its retrospective
4. The orchestrator (or human) can increase the budget if justified

### Session Timeout

Default: 30 minutes per session. If an agent hasn't responded in 30 minutes, the bridge marks it as stale. After 60 minutes, auto-kill.

Configurable per spawn via `timeout_ms`.

---

## Out of Scope

- **Formal P3-DISPATCH compilation** — the methodology YAML exists but runtime integration is a separate effort
- **Cross-machine bridge** — single bridge instance, single machine
- **Token budget tracking** — the bridge dashboard shows OAuth usage but doesn't enforce per-agent token limits
- **Automatic worktree merging** — merge is manual or via bridge_kill with `worktree_action: "merge"`, not automatic

---

## Implementation Order

### Phase 1: Parent-Child Sessions
- Core: `SessionChain` type + budget validation
- Bridge: `parent_session_id`, `depth`, `budget` in spawn/status/list
- Dashboard: session hierarchy tree view
- Tests: spawn chain, budget rejection, depth limit

### Phase 2: Worktree Isolation
- Bridge: `isolation: "worktree"` creates git worktree
- Bridge: `worktree_action` on kill (merge/keep/discard)
- Bridge: `metals_available` flag for worktree sessions
- Tests: parallel worktree agents, cherry-pick merge, Metals flag

### Phase 3: Commission-to-Bridge
- Commission skill: "fire it" action that calls bridge_spawn
- bridge_spawn: `metadata.commission_id` field
- Dashboard: commission metadata display
- Tests: commission → spawn → agent runs → results visible

### Phase 4: Guardrails
- Bridge: budget enforcement (depth + agent count)
- Bridge: session timeout (stale detection, auto-kill)
- Bridge: `BUDGET_EXHAUSTED` error response
- Tests: budget rejection, timeout, degradation to single-agent

---

## Success Criteria

1. A commissioned agent (level 0) spawns a sub-agent (level 1) that uses method MCP tools — parent-child relationship visible in dashboard
2. Two parallel sub-agents in worktrees produce commits that merge cleanly — no git staging conflicts
3. A commission from `/commission "fire it"` spawns a bridge agent with governance metadata
4. An agent at depth 2 attempts bridge_spawn and gets `BUDGET_EXHAUSTED` (max_depth: 2)
5. Dashboard shows session tree: root → children → grandchildren with methodology progress per node
6. Budget exhaustion is reported in the agent's retrospective

---

## Relationship to Steering Council

This PRD enables the council's vision: council decides → commission produces prompt → bridge fires agent → agent follows methodology → sub-agents execute steps → retros flow back → council reviews.

The guardrails (depth, budget, timeout) are the safety net the council needs to commission work at M2-SEMIAUTO autonomy without risking runaway spawning. The human retains veto via the commission approval step and the dashboard's real-time visibility.
