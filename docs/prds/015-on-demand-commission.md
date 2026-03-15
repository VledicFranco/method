# PRD 015 — Default Execution Method: Keep Agents Active via Step DAG

**Status:** Draft
**Date:** 2026-03-15
**Scope:** A generic compiled method (M-EXEC) that any agent follows when no specific methodology is loaded — provides the step_advance engagement loop for ad-hoc tasks, commissions, and any work that doesn't have a dedicated method
**Depends on:** PRD 004 (methodology runtime), PRD 005 (bridge), P0-META (compilation gates)
**Evidence:** OBS-02 (stalling on long prompts), EXP-OBS02 (threshold ~500 chars), agents using methodology MCP tools stay active
**Origin:** PO insight — agents following methodology steps via MCP never stall because `step_current → work → step_advance` keeps them in active tool-calling mode. Making this the DEFAULT for all bridge-spawned agents eliminates stalling at the infrastructure level.

---

## 1. Problem Statement

Commissioned agents receive their task as a monolithic prompt (1500+ tokens). Despite split delivery and stagger, agents frequently stall — they enter passive "thinking" mode and never transition to active tool calling.

**But agents following a methodology via MCP tools don't stall.** When an agent runs `methodology_start → step_current → step_advance`, it stays in an active loop: each step provides guidance, the agent does work, advances, gets next guidance. The methodology runtime acts as an engagement engine.

**The insight:** If ALL agent work followed a method — with steps, guidance, and the standard `step_advance` loop — agents would stay in active mode permanently. Not just commissions, but any ad-hoc task: bug fixes, research, documentation. The bridge spawns an agent → agent loads the default method → method's step DAG keeps the agent engaged.

This is **M3-TMP formalized as a step DAG**. M3-TMP is currently "just think through it sequentially" — no steps, no guidance, no auto-refresh. M-EXEC turns that into a structured loop that the methodology runtime manages.

## 2. The Default Execution Method (M-EXEC)

A new compiled method in `registry/P1-EXEC/M-EXEC/` following the standard 5-tuple. Unlike M3-TMP (which has no step DAG), M-EXEC provides structured steps that the methodology runtime manages:

```
M-EXEC = (D_EXEC, {rho_agent}, Γ_EXEC, O_EXEC, μ⃗_EXEC)
```

**Key difference from M3-TMP:** M3-TMP is unstructured — "think through it." M-EXEC has a step DAG with auto-refresh guidance, so the agent always knows its next action. This is what keeps agents in active mode.

### Step DAG (Γ_COM)

```
σ_0 (Activate)
  ↓
σ_1 (Load Commission)
  ↓
σ_2 (Load Context)
  ↓
σ_3 (Route Method)
  ↓
σ_4 (Execute)
  ↓
σ_5 (Deliver)
  ↓
σ_6 (Report)
```

### Step Definitions

**σ_0 — Activate**
- Guidance: "You are a commissioned agent. Call `step_advance` to load your commission."
- Output: none
- Purpose: Transition agent from passive → active. First action is always a tool call.

**σ_1 — Load Commission**
- Guidance: "Read your commission file at `{commission_path}`. Extract: objective, task_spec, routing, file_scope."
- Output schema: `{ objective: string, task_spec_path: string, routing: { task_type, method } }`
- Purpose: Agent reads the commission YAML. Structured by step guidance, not a prompt dump.

**σ_2 — Load Context**
- Guidance: "Read: (1) the task spec at `{task_spec_path}`, (2) `.method/project-card.yaml` for essence and delivery rules, (3) any files listed in the commission's `files_to_read`."
- Output schema: `{ files_read: string[], essence_understood: boolean }`
- Purpose: Context loading as a discrete step with validation.

**σ_3 — Route Method**
- Guidance: "Based on the commission's routing directive, call `methodology_load_method` to load the execution method (`{method}`). If the routing says M1-IMPL, load M1-IMPL. Do not re-evaluate routing."
- Output schema: `{ method_loaded: string }`
- Purpose: Explicit method loading. The commission pre-evaluated routing — the agent just follows it.

**σ_4 — Execute**
- Guidance: "Execute the loaded method (`{method}`) on the task. Follow its step DAG. For M1-IMPL: contextualize → inventory → implement → verify. Spawn sub-agents if needed (respect file_scope constraints)."
- Output schema: `{ method_completed: boolean, commits: string[], tests_passed: number }`
- Purpose: This is the actual work. The step guidance includes the commission's delivery rules and file scope.
- Note: This step wraps the execution method (M1-IMPL, M2-DIMPL, etc.) — the agent follows two step DAGs: M-COM's outer DAG and the execution method's inner DAG.

**σ_5 — Deliver**
- Guidance: "Push your branch and create a PR via `mcp__github-personal__create_pull_request`. Title: `{commission_title}`. Base: master. Include commit list and test results in PR body."
- Output schema: `{ pr_url: string, branch: string }`
- Purpose: Structured delivery with explicit tool calls.

**σ_6 — Report**
- Guidance: "Call `bridge_event` with type 'completed'. Include pr_url, test results, and summary. Write retrospective to `.method/retros/`."
- Output schema: `{ reported: boolean, retro_path: string }`
- Purpose: Completion reporting as a required step, not an optional prompt instruction.

### Why This Prevents Stalling

| Step | Agent action | Mode |
|------|-------------|------|
| σ_0 | `step_advance` | Active (tool call) |
| σ_1 | `Read` commission file | Active (tool call) |
| σ_2 | `Read` 3-5 files | Active (tool calls) |
| σ_3 | `methodology_load_method` | Active (tool call) |
| σ_4 | Execute method (many tool calls) | Active |
| σ_5 | `git push` + `create_pull_request` | Active (tool calls) |
| σ_6 | `bridge_event` + write retro | Active (tool calls) |

**The agent is never in passive mode.** Every step requires tool calls. The methodology runtime's `step_current` provides fresh guidance at each transition, keeping the agent oriented.

## 3. Commission Storage

Commissions stored as YAML in `.method/commissions/`:

```yaml
commission:
  id: COM-2026-0315-001
  created: "2026-03-15"
  status: pending  # pending | active | completed | failed

  # What to do
  objective: "Implement PRD 012 Phase 1 — diagnostic instrumentation"
  task_spec: docs/prds/012-session-reliability.md
  task_section: "Component 4"
  title: "feat(bridge): diagnostic instrumentation (PRD 012 Phase 1)"

  # How to route
  routing:
    task_type: implement
    method: M1-IMPL
    methodology: P2-SD
    directive: "Do NOT use M1-COUNCIL"

  # Essence (loaded in σ_2)
  essence:
    purpose: "Runtime that makes formal methodologies executable by LLM agents"
    invariant: "Theory is source of truth"

  # Constraints
  delivery_rules: [DR-03, DR-04, DR-09]
  file_scope:
    - "packages/bridge/src/**"
    - "packages/bridge/src/__tests__/**"
  files_to_read:
    - ".method/project-card.yaml"
    - "docs/prds/012-session-reliability.md"
    - "packages/bridge/src/pool.ts"
    - "packages/bridge/src/pty-watcher.ts"

  # Git workflow
  git_workflow: worktree_pr
  base_branch: master

  # Governance
  governance_context: "SESSION-022 D-035, RFC #1 highest priority"
```

## 4. Agent Activation Flow

```
Bridge spawns agent with ~50 char prompt:
  "Call step_advance to start your commission."

Agent: step_current → σ_0 guidance: "Call step_advance"
Agent: step_advance → σ_1 guidance: "Read commission at .method/commissions/COM-001.yaml"
Agent: Read → gets commission YAML
Agent: step_advance → σ_2 guidance: "Read these 4 files: ..."
Agent: Read × 4
Agent: step_advance → σ_3 guidance: "Load M1-IMPL"
Agent: methodology_load_method → M1-IMPL loaded
Agent: step_advance → σ_4 guidance: "Execute M1-IMPL on the task"
  ... (M1-IMPL inner step DAG runs) ...
Agent: step_advance → σ_5 guidance: "Push and create PR"
Agent: git push + create_pull_request
Agent: step_advance → σ_6 guidance: "Report completion"
Agent: bridge_event + write retro
DONE
```

## 5. Integration

### /commission Skill
Skill creates commission YAML, then spawns via bridge with:
```
bridge_spawn({
  workdir,
  isolation: "worktree",
  initial_prompt: "Call step_advance to start your commission.",
  metadata: { commission_id: "COM-2026-0315-001" }
})
```

### Methodology Runtime
The commission method (M-COM) is compiled against P0-META like any other method. It lives in P1-EXEC alongside M1-COUNCIL, M2-ORCH, M3-TMP.

### P1-EXEC Routing
M-EXEC becomes the **default** in P1-EXEC's delta function. When no specific execution method is selected (proportionality check says "this doesn't need M1-COUNCIL or M2-ORCH"), route to M-EXEC instead of M3-TMP. M-EXEC wraps the execution method — σ_4 loads and runs M1-IMPL/M2-DIMPL/etc.

**M3-TMP is not deprecated** — it remains available for truly unstructured thinking tasks. But bridge-spawned agents default to M-EXEC because the step DAG prevents stalling.

### Auto-load on Bridge Spawn
When `bridge_spawn` is called with `initial_prompt`, the bridge can auto-load M-EXEC for the agent:
1. Call `methodology_start` with P2-SD (or whatever methodology)
2. Route to M-EXEC as the execution binding
3. Agent's first `step_current` returns σ_0 guidance

This means every bridge-spawned agent is automatically in the methodology step loop — no prompt engineering needed to prevent stalling.

## 6. Success Criteria

1. Agent spawned with M-COM makes first tool call within 3s
2. Agent loads commission context incrementally — no step receives >200 tokens of guidance
3. 5 concurrent M-COM agents achieve ≥90% completion
4. Commission context survives context compaction (re-loadable via step_current)
5. Auto-retro generated at σ_6 (PR-03 enforcement)
6. Existing prompt-based commissioning still works (backward compatible)

## 7. Implementation Phases

### Phase 1: Commission YAML Schema + Storage
- `.method/commissions/` directory
- Commission YAML schema
- `/commission` skill writes YAML instead of prompt

### Phase 2: M-COM Method Compilation
- Compile M-COM against P0-META (G0-G6 gates)
- Register in `registry/P1-EXEC/M-COM/`
- 7-step DAG with guidance and output schemas

### Phase 3: Runtime Integration
- Add commission_id to bridge_spawn metadata
- P1-EXEC delta routes to M-COM when commission_id present
- M-COM σ_4 loads and runs the execution method

### Phase 4: Validation
- Commission same task as prompt vs M-COM
- Compare stall rates at 1, 3, 5 concurrent agents
- Measure time to first tool call

## 8. Out of Scope

- Commission queue / scheduling
- Commission dependencies (DAG of commissions)
- Auto-commission from council decisions
- Commission persistence across bridge restarts (YAML persists, runtime state doesn't)
