# PRD 015 — On-Demand Commission via MCP Tools

**Status:** Draft
**Date:** 2026-03-15
**Scope:** Replace long commission prompts with MCP-driven task loading to prevent agent stalling
**Depends on:** PRD 004 (methodology runtime), PRD 005 (bridge), PRD 012 (reliability)
**Evidence:** OBS-02 (stalling on long prompts), EXP-OBS02 (threshold ~500 chars), stagger helps but doesn't fully solve concurrent activation
**Origin:** PO insight during stress testing — agents that use MCP tools immediately stay active; agents that receive long prompts stall

---

## 1. Problem Statement

Commissioned agents receive their entire task specification as a single initial prompt (1500+ tokens). Despite split delivery (EXP-OBS02), agents frequently stall — they enter "thinking" mode and never transition to tool-calling mode. The stalling rate increases with prompt length and concurrent agent count.

**Root cause hypothesis:** Claude Code has two cognitive modes:
1. **Passive mode** — reading a long context block, planning internally, no tool calls. The agent may "think itself into a corner" and stop.
2. **Active mode** — making tool calls, receiving results, deciding next action. Each tool response creates a new interaction cycle that keeps the agent engaged.

Long commission prompts push agents into passive mode. MCP tool calls pull them into active mode. The fix: **make the commission itself an MCP interaction**, not a prompt dump.

## 2. Proposed Architecture

### Commission Registry

Store commission tasks in a registry accessible via MCP tools. When an agent is spawned, it receives a minimal activation prompt that directs it to load its task via MCP:

```
You are a commissioned agent. Load your task:
  methodology_start({ methodology: "P2-SD", instance: "I2-METHOD" })
  Then call commission_load({ commission_id: "COM-2026-0315-001" })
```

The agent's first action is a tool call (active mode), not reading a wall of text (passive mode).

### Commission MCP Tools

New tools exposed by the method MCP server:

**`commission_load`** — Load a commission by ID. Returns the task spec in structured chunks:
```typescript
Input: { commission_id: string }
Output: {
  commission_id: string;
  objective: string;           // 1-2 sentences
  task_spec_path: string;      // path to PRD or task description
  routing: {
    task_type: string;         // "implement" | "review" | etc.
    method: string;            // "M1-IMPL"
    directive: string;         // "Do NOT use M1-COUNCIL"
  };
  essence: {
    purpose: string;
    invariant: string;
  };
  delivery_rules: string[];    // just the relevant 3-5 rule IDs
  file_scope: string[];        // allowed paths for sub-agents
  git_workflow: string;        // "worktree → branch → PR"
  next_step: string;           // "Call commission_context to get delivery rules and file list"
}
```

**`commission_context`** — Load detailed context for the current commission:
```typescript
Input: { commission_id: string, section: "rules" | "files" | "governance" | "sub_agents" }
Output: {
  section: string;
  content: string;             // the relevant section content
  next_step: string;           // "Read the files listed, then begin implementing"
}
```

**`commission_complete`** — Report commission completion:
```typescript
Input: {
  commission_id: string;
  result: "success" | "error" | "escalation";
  pr_url?: string;
  summary: string;
}
```

### Commission Storage

Commissions stored as YAML files in `.method/commissions/`:

```yaml
commission:
  id: COM-2026-0315-001
  created: "2026-03-15T10:00:00Z"
  created_by: steering-council  # or "manual"
  status: pending  # pending | active | completed | failed

  objective: "Implement PRD 012 Phase 1 — diagnostic instrumentation"
  task_spec: docs/prds/012-session-reliability.md
  task_section: "Component 4"

  routing:
    task_type: implement
    method: M1-IMPL
    methodology: P2-SD
    directive: "Do NOT use M1-COUNCIL"

  essence:
    purpose: "Runtime that makes formal methodologies executable by LLM agents"
    invariant: "Theory is source of truth"

  delivery_rules: [DR-03, DR-04, DR-09]

  file_scope:
    - "packages/bridge/src/**"
    - "packages/bridge/src/__tests__/**"

  git_workflow: worktree_pr  # worktree → branch → PR

  governance_context: "SESSION-022 D-035, RFC #1 highest priority"

  sub_agent_rules:
    max_agents: 3
    file_constraints:
      bridge: "packages/bridge/src/ only"
      tests: "packages/bridge/src/__tests__/ only"
      mcp: "packages/mcp/src/index.ts only"
```

### Agent Activation Flow

```
1. Bridge spawns agent with short prompt (~100 chars):
   "You are a commissioned agent. Call commission_load('COM-2026-0315-001') to get your task."

2. Agent calls commission_load → gets objective, routing, essence (structured, not prose)

3. Agent calls commission_context('rules') → gets delivery rules

4. Agent calls commission_context('files') → gets file list to read

5. Agent reads files, implements, tests

6. Agent calls commission_complete → reports result + PR URL
```

Each step is an MCP tool call → response → next action. The agent never enters passive mode because every instruction arrives as a tool response, not a prompt block.

## 3. Integration with Existing Systems

### /commission Skill Update

The `/commission` skill currently generates a monolithic prompt. With this PRD:
1. Skill creates a commission YAML in `.method/commissions/`
2. Skill generates a short activation prompt referencing the commission ID
3. Bridge spawns agent with the short prompt
4. Agent loads commission via MCP tools

### Steering Council Integration

Council sessions that produce commission decisions (e.g., D-035) write the commission YAML directly. The `/commission` skill reads council decisions and pre-populates governance_context.

### Bridge Spawn

`bridge_spawn` gains a `commission_id` field:
```typescript
bridge_spawn({
  workdir: "...",
  commission_id: "COM-2026-0315-001",  // agent auto-loads this on activation
  isolation: "worktree",
})
```

The bridge injects the activation prompt automatically when `commission_id` is provided.

## 4. Why This Solves Stalling

| Current (prompt-based) | Proposed (MCP-based) |
|----------------------|---------------------|
| 1500-token initial prompt | ~100-char activation |
| Agent reads passively | Agent calls tool immediately |
| Agent may plan indefinitely | Each tool response triggers next action |
| Split delivery helps but not reliable | No splitting needed — prompt is always short |
| Context lost on compaction | Commission loadable at any time via MCP |
| No structured progress | commission_load/context/complete are trackable |

**Key insight:** The methodology MCP tools already keep agents in active mode (methodology_start → step_current → step_advance loop). The commission system extends this pattern to task loading itself.

## 5. Implementation Phases

### Phase 1: Commission Storage + MCP Tools
- Commission YAML schema
- `.method/commissions/` directory
- `commission_load`, `commission_context`, `commission_complete` MCP tools
- Core functions in `@method/core`

### Phase 2: /commission Skill Integration
- Skill writes commission YAML instead of generating prompt
- Skill generates short activation prompt
- `bridge_spawn` accepts `commission_id`

### Phase 3: Validation
- Commission same task twice: once as prompt, once as MCP
- Compare: stall rate, time to first tool call, completion rate
- Test at 3 and 5 concurrent agents

## 6. Success Criteria

1. Agent spawned with commission_id makes first tool call within 5s (vs current 10-30s)
2. 5 concurrent commissioned agents achieve ≥90% completion (vs current 40-60% with stagger)
3. Commission context survives context compaction (re-loadable via MCP)
4. No commission prompt exceeds 200 chars
5. Existing prompt-based commissioning still works (backward compatible)

## 7. Out of Scope

- **Commission queue / scheduling** — commissions are created and spawned manually
- **Commission dependencies** — no DAG of commissions (use methodology's step DAG instead)
- **Commission persistence across bridge restarts** — YAML files persist, but active commission state is in-memory
- **Auto-commission from council** — council produces decisions, human fires commissions
