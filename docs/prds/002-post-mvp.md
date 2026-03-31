---
title: "PRD — Post-MVP Hardening"
status: implemented
---

# PRD — Post-MVP Hardening

**Status:** Implemented
**Date:** 2026-03-14
**Scope:** Fixes and enhancements surfaced by EXP-001 MVP validation
**Depends on:** 001-mvp (completed)
**Evidence:** docs/exp/001-mvp-validation.md

---

## Purpose

The MVP (001) proved the core concept: 6 MCP tools that load, traverse, and query compiled methodologies. EXP-001 validated correctness under serial access (9/9 pass) and exposed three categories of improvement under real-world usage:

1. **Robustness** — the server breaks under concurrent agent access (expected, but needs fixing for production use)
2. **Agent UX** — tool responses lack context that agents need to detect problems and navigate efficiently
3. **Search quality** — theory lookup has a Unicode gap

This PRD scopes three focused improvements. Each is independently shippable.

---

## Problem

From EXP-001 findings:

- **EXP-001-I1:** `theory_lookup("Phi-Schema")` returns nothing because F4-PHI.md uses Unicode "Φ-Schema". Agents must guess alternative spellings.
- **EXP-001-I2/I3:** When multiple agents share the server, one agent's `methodology_load` silently overwrites another's session. Agents cannot detect that their session was swapped — `step_advance` returns only step IDs, which collide across methods (both M1-MDES and M1-COUNCIL use `sigma_0`, `sigma_1`, etc.).
- **Concurrent access is not hypothetical.** EXP-001 spawned 4 validation agents against one server. Real usage (human + background agents, or multiple Claude Code sessions) will hit the same issue.

---

## Improvements

### P1 — Richer Tool Responses

**Priority:** High — smallest change, biggest agent UX improvement

Enhance `step_advance` and `step_current` responses to include enough context for agents to detect session state issues and navigate without extra calls.

#### `step_advance` response

Current:
```json
{ "previousStep": "sigma_0", "nextStep": "sigma_1" }
```

Proposed:
```json
{
  "methodologyId": "P0-META",
  "methodId": "M1-MDES",
  "previousStep": { "id": "sigma_0", "name": "Orientation" },
  "nextStep": { "id": "sigma_1", "name": "Domain Theory Crystallization" },
  "stepIndex": 1,
  "totalSteps": 7
}
```

Rationale: agents can verify they're still in the right method without a separate `methodology_status` call. Step names make the response human-readable in logs.

#### `step_current` response

Current: returns the `Step` object (id, name, role, precondition, postcondition, guidance, outputSchema).

Proposed: wrap in a context envelope:

```json
{
  "methodologyId": "P0-META",
  "methodId": "M1-MDES",
  "stepIndex": 0,
  "totalSteps": 7,
  "step": { "id": "sigma_0", "name": "Orientation", "guidance": "...", ... }
}
```

Rationale: agents know where they are without a status call. Reduces tool call count per step from 2 (current + status) to 1.

#### `methodology_load` response

Current: plain text message.

Proposed: structured JSON + message:

```json
{
  "methodologyId": "P0-META",
  "methodId": "M1-MDES",
  "methodName": "Method Design from Established Domain Knowledge",
  "stepCount": 7,
  "objective": "...",
  "firstStep": { "id": "sigma_0", "name": "Orientation" },
  "message": "Loaded M1-MDES (7 steps). Call step_current to see the first step."
}
```

#### Scope

- Changes to `@method/core` state module: `advance()` and `current()` return enriched types
- Changes to `@method/mcp`: format the enriched responses
- No new tools, no new dependencies

---

### P2 — Theory Lookup: Unicode Normalization

**Priority:** Medium — one real search failure in EXP-001

#### Problem

F4-PHI.md's title is "Φ-Schema" (Unicode Phi). Searching `theory_lookup("Phi-Schema")` returns nothing because substring matching can't bridge `Φ` ↔ `Phi`.

#### Solution

Add a normalization pass before matching:

1. Build a character map for common mathematical Unicode → ASCII:
   ```
   Φ/φ → Phi, Σ/σ → Sigma, Γ/γ → Gamma, δ → delta, μ → mu,
   π → pi, ρ → rho, ν → nu, ≼ → preceq, → → ->, ∈ → in, etc.
   ```

2. Normalize both the search term and the indexed content before matching
3. Keep original content in results (normalization is internal to search)

#### Scope

- Changes to `packages/core/src/theory.ts` only
- Add `normalizeForSearch(text: string): string` helper
- Apply in `lookupTheory` before all three search passes
- No new dependencies

#### Acceptance

- `theory_lookup("Phi-Schema")` returns F4-PHI.md content
- `theory_lookup("sigma")` matches `Σ` references
- `theory_lookup("delta")` matches `δ_Φ` references
- Existing queries (from EXP-001) continue to pass

---

### P3 — Session Isolation

**Priority:** High for multi-agent use — larger scope

#### Problem

The MCP server holds one `createSession()` singleton. Any `methodology_load` overwrites it. When multiple agents connect (through the same MCP transport or separate transports), they clobber each other's state.

#### Design Options

**Option A — Session ID parameter:**

Add an optional `session_id` parameter to all tools. The server maintains a `Map<string, Session>`. If no session_id is provided, use a default session (backwards compatible).

```
methodology_load({ methodology_id: "P0-META", method_id: "M1-MDES", session_id: "agent-1" })
step_current({ session_id: "agent-1" })
```

Pros: explicit, debuggable, no protocol-level changes.
Cons: agents must manage session IDs; adds a parameter to every call.

**Option B — Per-transport sessions:**

The MCP SDK provides transport-level identity. Create a new session for each transport connection. Sessions are isolated by construction — no agent action required.

Pros: zero agent-side changes.
Cons: depends on MCP SDK transport semantics; may not work for stdio transport (single transport = single session).

**Option C — Auto-generated session with token:**

`methodology_load` returns a `session_token` in its response. Subsequent tools require it. No token = new session.

Pros: explicit without agent-managed IDs.
Cons: same parameter overhead as Option A.

#### Recommendation

Start with **Option A** — simplest to implement, explicit, backwards compatible. The default session (no session_id) preserves MVP behavior. Agents that need isolation pass a session_id.

#### Scope

- `@method/core`: `createSession` stays as-is. Add a `SessionManager` that holds `Map<string, Session>` with `getOrCreate(sessionId)`.
- `@method/mcp`: add optional `session_id` to all tool input schemas. Route through `SessionManager`.
- No new dependencies.

#### Acceptance

- Two agents loading different methods with different session_ids see independent state
- Default (no session_id) uses a shared session (backwards compatible)
- Session state is isolated: advance in session A does not affect session B

---

## Out of Scope

- **Persistence across server restarts** — deferred to a future PRD (`.methodology/` directory)
- **DAG-aware traversal** — deferred; requires rethinking the advance API for branching
- **Methodology-level routing (δ_Φ evaluation)** — deferred; requires encoding driving predicates as evaluable logic
- **Session expiry / cleanup** — sessions accumulate in memory; acceptable for now given server restarts between work sessions

---

## Implementation Order

P1 → P2 → P3. Each is independently shippable.

- **P1** (richer responses) is the smallest change with immediate UX benefit. Ship first.
- **P2** (Unicode normalization) is a focused fix to one module. Ship second.
- **P3** (session isolation) is the largest change. Ship third, after P1/P2 are validated.

---

## Success Criteria

1. Rerun EXP-001 theory lookup suite: 9/9 pass (including "Phi-Schema")
2. Rerun EXP-001 with 4 concurrent agents: each agent sees only its own session state (no cross-contamination)
3. `step_advance` response includes method ID and step names — agent can verify session identity without extra calls
4. `step_current` response includes progress context (stepIndex, totalSteps) — agent navigates with one call instead of two
