---
guide: 8
title: "Prompting Methodology Agents"
domain: bridge
audience: [agent-operators]
summary: >-
  How to write orchestrator prompts, bridge_spawn parameters, and empirical patterns from production sessions.
prereqs: [1, 2, 10]
touches:
  - packages/mcp/src/
  - packages/bridge/src/pool.ts
---

# Guide 8 — Prompting Methodology Agents

How to write an orchestrator prompt that gets an agent to follow a methodology correctly. Based on empirical evidence from 4 production sessions across 2 projects.

## The Orchestrator Pattern

The agent that receives your prompt is **rho_executor** — the orchestrating role. It does not write code directly. It reads, evaluates, routes, delegates to sub-agents, and records. This separation is not aesthetic — it prevents the orchestrator from losing architectural context to source-level detail (the context-window-burn problem that motivates M2-DIMPL).

```
You (human) → Orchestrator (reads methodology, evaluates δ, spawns sub-agents)
                  ├── Sub-agent A (executes step, writes code, returns result)
                  ├── Sub-agent B (executes step, writes code, returns result)
                  └── Sub-agent C (reviews, produces findings)
```

## Prompt Structure

A methodology orchestrator prompt has 7 sections. Each is load-bearing — skipping one produces measurably worse results.

### 1. Role Declaration

State the role explicitly. Agents that aren't told they're orchestrators will default to doing all the work themselves.

```
You are an orchestrating agent for the {project} project. Your role is
rho_executor — you coordinate methodology execution, make routing decisions,
and spawn sub-agents for actual work. You do not write code or edit files
directly.
```

**Why this matters:** In the PRD 002 session, the orchestrator pattern worked: 12 sub-agents spawned, zero scope decisions delegated to sub-agents, all architectural choices made by the orchestrator. Without explicit role declaration, agents attempt everything in-context.

### 2. Objective

State what the agent is implementing and where the spec lives. Be specific — vague objectives produce vague routing.

```
Implement PRD 003 (P3-DISPATCH) following P2-SD methodology. The PRD is at
docs/prds/003-dispatch.md. Read it fully before beginning.
```

**Evidence:** The t1-cortex validation gaps session completed 7/8 tasks with clear PhaseDoc reference. Agents that read the full spec before starting make better routing decisions.

### 3. Methodology Binding

Name the methodology, the version, and the project card. Include the transition function table so the agent can evaluate δ without reading the full methodology YAML.

```
You follow P2-SD v2.0 as instantiated by I1-T1X. The instance card is at
.method/project-card.yaml — read it first.

P2-SD's transition function (δ_SD) routes by task type:
| task_type | Method |
|-----------|--------|
| section   | M7-PRDS |
| architecture | M6-ARFN |
| plan      | M5-PLAN |
| implement (parallel) | M2-DIMPL |
| implement | M1-IMPL |
| review    | M3-PHRV |
| audit     | M4-DDAG |
```

**Why the table:** Agents that see the routing table make correct δ evaluations 4/4 times (t1-cortex session). Agents that must infer routing from YAML files make slower, less confident decisions.

### 4. Execution Binding

Tell the agent to state which P1-EXEC method it uses for each step. This forces conscious method selection rather than defaulting to M3-TMP for everything.

```
For every step you execute, state which P1-EXEC execution method you're using:
- M3-TMP (default) — sequential single-agent reasoning
- M1-COUNCIL — when the step has multiple defensible positions
- M2-ORCH — when the step decomposes into 3+ parallel sub-tasks
```

**Critical learning from t1-cortex:** Include a **proportionality heuristic**. Without it, agents either always use M1-COUNCIL (overhead) or never use it (missed value):

```
M1-COUNCIL proportionality:
- USE when: decision affects security invariants, 3+ options with non-obvious
  tradeoffs, or decision is irreversible
- SKIP when: decision is reversible, low-stakes, with 2 clear options and no
  invariant tension — use M3-TMP with transparent inline reasoning instead
```

**Evidence:** The t1-cortex agent correctly overrode the prompt's M1-COUNCIL prescription for P2 (JIT sync), saving ~5 minutes of council overhead on a 30-second decision. The proportionality heuristic emerged from this override.

### 5. Retrospective Protocol

Embed the full retrospective schema in the prompt. Agents that see the schema produce structured, actionable retrospectives. Agents told "write a retrospective" produce generic summaries.

```
After completing each method, produce a retrospective YAML with:
- hardest_decision (mandatory): the moment of maximum uncertainty
- observations (mandatory, >= 1): gap/friction/success/surprise with evidence
- card_feedback (mandatory if card exists): per-rule verdict
- proposed_deltas (optional): your suggested changes
```

**What makes a good retrospective:**
- The `hardest_decision` field forces genuine reflection — it's the most reliable signal
- `card_feedback` with per-rule verdicts is the highest-value output for card evolution
- `proposed_deltas` with `current`/`proposed`/`rationale` produce directly actionable changes

**What makes a bad retrospective:** "Everything worked fine, no observations." This has never been true in any session we've run. The minimum-1-observation requirement prevents this, but the agent must be told to be genuine.

**Evidence:** The t1-cortex retrospective was the highest-quality in the system: 5 genuine observations, 7 card feedback entries, 4 actionable proposed deltas, zero rote compliance.

### 6. Execution Protocol

Walk the agent through the methodology's execution sequence, but **trust the agent's routing judgment**. Provide defaults and evaluation criteria, not rigid prescriptions.

**Do this:**
```
Step 1 — Evaluate δ_SD: does the PRD need sectioning?
Step 2 — For each section, evaluate: architecture → plan → implement → review
Step 3 — After all sections: consider drift audit if 3+ sections
```

**Don't do this:**
```
Step 1 — Run M7-PRDS
Step 2 — Run M6-ARFN
Step 3 — Run M5-PLAN
Step 4 — Run M1-IMPL
```

The second version removes the agent's routing autonomy. The agent should evaluate δ_SD at each step, not follow a hardcoded sequence. Some PRDs don't need sectioning. Some sections don't need architecture updates.

**Evidence:** The t1-cortex agent's best decisions were overrides — choosing P1-EXEC/M2-ORCH over P2-SD/M2-DIMPL for trivial tasks, and M3-TMP over M1-COUNCIL for a simple decision. These overrides were correct because the agent evaluated the actual challenge, not a prescribed sequence.

### 7. Sub-Agent Instructions

Define what sub-agents receive and what authority they have. This section prevents scope creep and ensures delivery rule compliance.

```
When spawning sub-agents:
1. Give each a clear, bounded task — one step or one deliverable
2. Include relevant delivery rules from the project card
3. Include the role note for their role
4. Tell sub-agents to commit their work
5. Do not let sub-agents make scope decisions — they report back, you decide
6. State which P1-EXEC method the sub-agent should use
```

### Spawning Sub-Agents via Bridge

When the orchestrator uses the bridge to spawn sub-agents, use `bridge_spawn` with the full parameter set:

```
bridge_spawn({
  workdir: "/path/to/project",
  spawn_args: ["--allowedTools", "mcp__method__*"],
  session_id: "current-session-id",
  nickname: "impl-auth-module",
  purpose: "Implement the auth module per PRD 003 section 2",
  parent_session_id: "orchestrator-bridge-session-id",
  depth: 1,
  budget: { max_depth: 3, max_agents: 10 },
  isolation: "worktree",
  timeout_ms: 1800000,
  mode: "pty",
  allowed_paths: ["packages/auth/**", "packages/shared/types/**"],
  scope_mode: "enforce"
})
```

**Parameter reference:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `workdir` | Yes | Working directory for the spawned agent |
| `spawn_args` | No | CLI arguments for the Claude Code process |
| `initial_prompt` | No | Initial prompt sent on spawn |
| `session_id` | No | Methodology session ID to correlate with the bridge session |
| `nickname` | No | Human-readable agent name (auto-generated if omitted) |
| `purpose` | No | Why this agent was spawned (1-2 sentences for operator context) |
| `parent_session_id` | No | Bridge session ID of the parent (creates parent-child chain) |
| `depth` | No | Recursion depth (0 = root, increments per level) |
| `budget` | No | Chain constraints: `max_depth` (default 3), `max_agents` (default 10) |
| `isolation` | No | `"worktree"` (git worktree per agent) or `"shared"` (default) |
| `timeout_ms` | No | Stale timeout in ms (default: 30 minutes). Auto-killed at 2x. |
| `mode` | No | `"pty"` (interactive TUI) or `"print"` (headless JSON). Default: `"pty"`. |
| `allowed_paths` | No | Glob patterns of files the agent may modify (PRD 014). Empty = no constraint. |
| `scope_mode` | No | `"enforce"` (pre-commit hook, requires worktree) or `"warn"` (events only). Default: `"enforce"`. |

The `spawn_args` field passes CLI flags to the spawned Claude Code process:
- `["--dangerously-skip-permissions"]` — bypass all permission prompts (development only)
- `["--allowedTools", "mcp__method__*"]` — allow methodology MCP tools without prompting (production)

The `session_id` parameter auto-correlates the methodology session with the bridge session — no manual ID mapping needed. The `parent_session_id` + `depth` + `budget` fields enable parent-child session chains with budget enforcement (PRD 006). The `nickname` and `purpose` fields give agents human-readable identity for dashboard observability (PRD 007). The `isolation` and `allowed_paths` + `scope_mode` fields enable worktree-based scope enforcement (PRD 014).

**The critical constraint:** "Do not let sub-agents make scope decisions." In every session, the orchestrator made better scope decisions than sub-agents would have because it holds the full context.

## Project Card Integration

The project card is the bridge between abstract methodology and project-specific constraints. Include it by reference, not by inlining all rules.

```
The instance card is at .method/project-card.yaml — read it first.
```

Then highlight the 3-5 delivery rules most relevant to this task:

```
Critical rules for this session:
- DR-01: Metals MCP mandatory for Scala navigation
- DR-03: Core has zero transport dependencies
- DR-04: MCP is thin wrapper (boundary: envelope construction = formatting, acceptable)
```

**Don't** inline all 20 delivery rules in the prompt. The agent reads the card. You highlight what matters.

**Evidence:** The t1-cortex agent actively used 7 of 20 rules and reported that 2 were overly restrictive for the task context. This is exactly the card feedback mechanism working — the card evolves from real usage data.

## Common Mistakes

### 1. Over-prescribing routing

**Bad:** "Run M1-COUNCIL for the architecture decision, then M5-PLAN, then M1-IMPL."

**Good:** "Evaluate δ_SD for each phase. For design decisions with multiple defensible positions, consider M1-COUNCIL."

The agent's routing judgment is empirically better than static prescriptions. Give it evaluation criteria, not commands.

### 2. Skipping the retrospective

Every prompt should include the retrospective protocol. The 4 retrospectives we've collected have already produced 2 gap candidates, 4 card revisions, and 1 validated method evolution. This data doesn't exist without the retrospective section.

### 3. Making the orchestrator write code

The moment the orchestrator starts editing files, it loses its architectural context advantage. Sub-agents write code; the orchestrator coordinates. If the task is so small that spawning a sub-agent feels silly, the task is M3-TMP-scale and the orchestrator should still delegate — just to a simpler sub-agent.

### 4. Not reading the files first

The prompt should include a "Step 0: Read these files" section. Every session that started with file reading produced better routing decisions than sessions that jumped straight to execution.

```
Before spawning any sub-agents, read these files:
1. The PRD or PhaseDoc
2. The project card
3. Relevant architecture docs
4. Current source files in scope
```

### 5. Rigid Phase A for trivial tasks

M1-IMPL Phase A (spec audit) is a 4-step confidence-raising process. For a well-described bug fix or trivial task, Phase A collapses to "read the spec, confirm the file, GO." The prompt should acknowledge this:

```
Phase A scaling: for trivial tasks with clear specs, Phase A collapses.
For complex tasks with ambiguous specs, run full sigma_A1-A4.
```

## Template

A minimal orchestrator prompt template:

```markdown
You are an orchestrating agent for {project}. Role: rho_executor. You do not
write code directly.

### Objective
Implement {what} following {methodology} instance {card_id}.
Spec: {path}. Read it first.

### Methodology
{methodology} v{version}. Card: .method/project-card.yaml.
δ routing table: {table}
Critical delivery rules: {3-5 rules}

### Execution Binding
State M3-TMP/M1-COUNCIL/M2-ORCH per step.
M1-COUNCIL when: security invariants, 3+ options, irreversible.
M3-TMP when: reversible, low-stakes, clear options.

### Retrospective (mandatory)
{embedded schema}

### Protocol
Step 0: Read {files}
Step 1: Evaluate δ for {challenge}
Step 2: For each section: architecture → plan → implement → review
Step 3: Produce retrospectives

### Sub-Agents
{sub-agent instructions with delivery rules}

### Start
Read Step 0 files, then evaluate δ.
```

## Empirical Basis

| Session | Project | Methods Used | Tasks Done | Retro Quality | Key Learning |
|---------|---------|-------------|------------|---------------|-------------|
| PRD 002 | pv-method | M5-PLAN, M1-IMPL | 7/7 (100%) | Medium (post-hoc) | Phase A catches spec bugs; DR-04 boundary ambiguous |
| P1-EXEC review | pv-method | M3-PHRV | 4 files reviewed | High | M1-COUNCIL has undeclared symbols |
| P2-SD review | pv-method | M3-PHRV | 6 files reviewed | High | YAML citation format friction |
| Validation gaps | t1-cortex | M2-ORCH, M1-IMPL, M1-COUNCIL, M3-TMP | 7/8 (87.5%) | Highest | Agent routing > prompt routing; proportionality needed; Metals+worktree incompatible |

This guide will evolve as more sessions produce retrospective data. The recommendations here are grounded in 4 sessions — enough for patterns, not enough for certainty.
