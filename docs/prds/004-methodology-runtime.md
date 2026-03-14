# PRD — Runtime Methodology Execution: Live δ_Φ Sessions

**Status:** Draft
**Date:** 2026-03-14
**Scope:** Methodology-level session management + live δ_Φ evaluation + method composition within sessions
**Depends on:** 003-dispatch (completed — provides routing, validation, step_context tools)
**Requested by:** pv-agi (Vidtecci flagship — AGI research through metacognitive orchestration)
**Evidence:** pv-agi Session 001 (manual artifact production), pv-agi Session 002 (identified gap: council can't dispatch through tooling because methods don't compose within sessions)

---

## Purpose

PRD 003 made the methodology an active orchestrator — agents can evaluate routing, spawn sub-agents, validate outputs. But execution is still **single-method**: you load one method, traverse its steps, and the session ends.

pv-agi's steering council needs to **compose methods within a single methodology session**: debate a challenge (COUNCIL), decide to act, dispatch a sub-task (TMP or ORCH), receive the result, and continue the council session with the result in context. This is sequential method composition at runtime — the methodology's transition function `δ_Φ` driving the agent through a multi-method workflow.

This is the difference between "an agent that runs one method at a time" and "a system with executive control that selects and sequences methods adaptively."

---

## Problem

After PRD 003, an orchestrating agent can:
- ✅ Evaluate which method δ_Φ selects (via `methodology_get_routing`)
- ✅ Record the routing decision (via `methodology_select`)
- ✅ Get full step context for sub-agent prompts (via `step_context`)
- ✅ Validate sub-agent output (via `step_validate`)
- ✅ Advance through a method's step DAG (via `step_advance`)

But it **cannot**:
- ❌ Complete a method and transition to the next method within the same methodology session
- ❌ Evaluate δ_Φ *live* — observing current state and selecting the next method dynamically
- ❌ Forward outputs from method A to method B (method B can't see method A's results)
- ❌ Track methodology-level progress (which methods have completed, global objective status)
- ❌ Compose methods sequentially at runtime (COUNCIL → TMP → COUNCIL)

The methodology's transition function exists in the YAML but is never evaluated at runtime. The executive control layer is documented but not executable.

---

## Cognitive Architecture Justification

This PRD implements three cognitive functions that pv-agi's architecture table maps but the runtime currently lacks:

| Cognitive Function | Brain Structure | What This PRD Implements |
|---|---|---|
| Task switching | Prefrontal cortex | `methodology_transition` — complete one method, evaluate δ_Φ, select and load the next |
| Goal maintenance | Rostral PFC | Methodology-level session — tracks global objective `O_Φ` across method transitions |
| Working memory transfer | Central executive (Baddeley) | Cross-method output forwarding — method B receives method A's results via enhanced `step_context` |

Without these, pv-agi's architecture claims to model executive function but the runtime can't support it. This PRD closes the gap between the cognitive architecture specification and the executable infrastructure.

---

## What to Build

### Tool 1: `methodology_start`

Initialize a methodology-level session that tracks global state across method transitions.

```
Input:  {
  methodology_id: string,
  challenge?: string,          // Optional: the challenge being addressed
  session_id?: string          // Optional: explicit session ID
}
Output: {
  methodology_session_id: string,
  methodology: { id, name, objective, method_count },
  transition_function: { predicate_count, arm_count },
  status: "initialized",
  message: "Methodology P1-EXEC initialized. Call methodology_route to evaluate δ_Φ and select the first method."
}
Error: Methodology not found
```

Creates a session at the *methodology* level. This session persists across method transitions — it's the superordinate goal context.

### Tool 2: `methodology_route`

Evaluate δ_Φ against current state and return the recommended method with full reasoning.

```
Input:  {
  session_id?: string,
  challenge_predicates?: {     // Optional: pre-evaluated predicate values
    [predicate_name: string]: boolean
  }
}
Output: {
  methodology_id: string,
  evaluated_predicates: [{ name, value: boolean | null, source: "provided" | "inferred" }],
  selected_arm: { priority, label, condition, rationale },
  selected_method: { id, name, step_count, description },
  prior_methods_completed: [{ method_id, completed_at, output_summary }],
  message: "δ_EXEC selected M1-COUNCIL (Arm 1: adversarial pressure beneficial). Call methodology_load_method to begin execution."
}
Error: No methodology session active; δ_Φ evaluation failed (ambiguous predicates — escalate to human)
```

This is live routing. The transition function is evaluated, not just read. If predicates are ambiguous (can't determine true/false), the tool reports this as an escalation signal — the agent decides whether to proceed or ask the human.

**Key difference from `methodology_get_routing`:** `get_routing` returns the *structure* of δ_Φ (predicates + arms). `methodology_route` *evaluates* it against the current session state and returns a *decision*.

### Tool 3: `methodology_load_method`

Load a specific method within the active methodology session.

```
Input:  {
  method_id: string,
  session_id?: string
}
Output: {
  methodology_session_id: string,
  method: { id, name, step_count, first_step },
  methodology_progress: {
    methods_completed: number,
    methods_remaining: number | "unknown",  // Unknown if δ_Φ is adaptive
    current_method_index: number
  },
  prior_method_outputs: [{ method_id, step_outputs: [{ step_id, summary }] }],
  message: "Loaded M3-TMP (3 steps) within P1-EXEC session. Prior method outputs available in step_context."
}
Error: Method not in methodology's repertoire; no methodology session active
```

Loads a method within the methodology session — not a standalone method session. Prior method outputs are preserved and will be included in `step_context` calls.

### Enhancement: `step_context` — Cross-Method Outputs

Extend the existing `step_context` tool to include outputs from prior methods in the methodology session, not just prior steps in the current method.

```
Output (extended): {
  methodology: { id, name, progress, objective },
  method: { id, name, objective },
  step: { id, name, role, precondition, postcondition, guidance, output_schema },
  stepIndex: number,
  totalSteps: number,
  prior_step_outputs: [{ step_id, summary }],           // Same as before
  prior_method_outputs: [{ method_id, step_outputs }],   // NEW: from completed methods
  message: "Step context includes outputs from 1 prior method (M1-COUNCIL, 4 steps completed)."
}
```

This is the working memory transfer — method B sees method A's results without the agent having to manually carry them.

### Tool 4: `methodology_transition`

Complete the current method and evaluate δ_Φ for the next method. This is the task-switching mechanism.

```
Input:  {
  session_id?: string,
  completion_summary?: string,   // Optional: agent's summary of what the method achieved
  challenge_predicates?: {       // Optional: updated predicates for re-routing
    [predicate_name: string]: boolean
  }
}
Output: {
  completed_method: { id, name, step_count, outputs_recorded: number },
  methodology_progress: { methods_completed, global_objective_status: "in_progress" | "satisfied" | "failed" },
  next_method: {                 // null if δ_Φ returns None (methodology complete)
    id, name, step_count, description,
    routing_rationale: string    // Why δ_Φ selected this method
  } | null,
  message: "M1-COUNCIL completed. δ_EXEC re-evaluated → M3-TMP selected (well-scoped follow-up task). Call methodology_load_method to begin."
}
Error: No method currently loaded; current method has incomplete steps (must advance to terminal first)
```

The transition function is re-evaluated after each method completes. This enables adaptive routing — the methodology can change its mind based on what the previous method produced.

**Terminal condition:** If δ_Φ returns `None` (no more methods needed), `next_method` is null and `global_objective_status` is "satisfied" or "failed".

---

## Implementation Notes

### Session State Model

```
MethodologySession {
  id: string
  methodology_id: string
  challenge: string | null
  status: "initialized" | "routing" | "executing" | "transitioning" | "completed" | "failed"
  current_method_id: string | null
  completed_methods: [{
    method_id: string
    completed_at: timestamp
    step_outputs: [{ step_id, output_summary }]
    completion_summary: string | null
  }]
  global_objective_status: "in_progress" | "satisfied" | "failed"
}
```

The methodology session wraps method sessions. When `methodology_load_method` is called, it creates a standard method session (existing infrastructure) within the methodology session context.

### Relationship to Existing Tools

| Existing Tool | Behavior Change |
|--------------|----------------|
| `methodology_list` | No change |
| `methodology_get_routing` | No change — still returns δ_Φ structure |
| `methodology_select` | Becomes an alias for `methodology_start` + `methodology_load_method` (backward compatible) |
| `methodology_status` | Extended: includes methodology-level progress if a methodology session is active |
| `step_current` | No change |
| `step_advance` | No change — operates within the current method |
| `step_context` | Extended: includes `prior_method_outputs` when in a methodology session |
| `step_validate` | No change |
| `methodology_load` | No change — standalone method loading still works for non-methodology use |

### Session Isolation

Methodology sessions use the same `session_id` mechanism from PRD 002. A methodology session and its contained method sessions share a session ID — the methodology session is the parent context.

---

## Out of Scope

- **Parallel method dispatch** — blocked by open problem P4 (parallel retraction). Sequential composition only.
- **Persistent sessions** — methodology sessions are in-memory. Cross-session memory is a future extension.
- **Automated predicate evaluation** — the agent evaluates predicates and provides values. Server-side predicate evaluation is future work.
- **DAG branching within methods** — method-internal re-entry loops (e.g., M1-IMPL confidence loops) are a separate concern. This PRD handles method-to-method transitions.
- **Bridge integration** — this PRD extends the MCP server only. Bridge spawning of sub-agents for method execution is orchestrated by the calling agent, not by these tools.

---

## Implementation Order

### Phase 1: Methodology session model + `methodology_start`

Add `MethodologySession` to `@method/core`. Implement `methodology_start` tool. This is the foundation — all other tools depend on a methodology session existing.

### Phase 2: `methodology_route` + `methodology_load_method`

Live δ_Φ evaluation and method loading within a methodology session. After this phase, an agent can: start a methodology → evaluate routing → load the selected method → traverse its steps.

### Phase 3: `methodology_transition` + enhanced `step_context`

Method completion, re-routing, and cross-method output forwarding. After this phase, the full loop works: start → route → load → execute → transition → route → load → ... → complete.

### Phase 4: Integration validation

Run the pv-agi steering council acceptance test (see below).

---

## Acceptance Test

**Test case:** pv-agi steering council dispatching work through the tooling.

**Scenario:**
1. Agent calls `methodology_start({ methodology_id: "P1-EXEC" })`
2. Agent calls `methodology_route` with predicates indicating adversarial debate is beneficial → routes to M1-COUNCIL
3. Agent calls `methodology_load_method({ method_id: "M1-COUNCIL" })` and executes the council debate
4. Council decides to dispatch a well-scoped sub-task
5. Agent calls `methodology_transition` — completes M1-COUNCIL, re-evaluates δ_EXEC
6. δ_EXEC routes to M3-TMP (well-scoped follow-up)
7. Agent calls `methodology_load_method({ method_id: "M3-TMP" })` and executes the task
8. Task output is available in `step_context` via `prior_method_outputs`
9. Agent calls `methodology_transition` — completes M3-TMP
10. If more work needed, δ_EXEC routes back to M1-COUNCIL for review; if not, methodology completes

**Pass criteria:**
- Full loop executes without manual method loading or output copying
- `step_context` in step 8 includes M1-COUNCIL's outputs
- `methodology_transition` in step 9 correctly re-evaluates δ_EXEC
- Method switching is seamless — no session resets, no context loss

**F2 evidence (orchestration overhead):**
Compare this session against pv-agi Session 001 (council without dispatch tooling):
- PO intervention frequency (lower = better orchestration)
- Time from decision to executed artifact (faster = less overhead)
- Whether output quality is maintained or improved

---

## Success Criteria

1. An agent can call `methodology_start("P1-EXEC")` and receive a methodology-level session with transition function metadata
2. An agent can call `methodology_route` and receive a live δ_Φ evaluation with a selected method and routing rationale
3. An agent can complete a method and call `methodology_transition` to evaluate δ_Φ for the next method — receiving the next method or a terminal signal
4. `step_context` within method B includes outputs from completed method A (`prior_method_outputs`)
5. The pv-agi acceptance test (steering council → TMP dispatch → council review) passes end-to-end
6. Existing tools (`methodology_select`, `step_advance`, `step_validate`) continue to work unchanged (backward compatible)
