# PhaseDoc — PRD 002: Post-MVP Hardening

> Handoff artifact from M5-PLAN (sigma_4) to M2-DIMPL implementation phase.

---

## 1. PRD Section Reference

| Field | Value |
|---|---|
| PRD | [`docs/prds/002-post-mvp.md`](../prds/002-post-mvp.md) |
| Status | Draft |
| Date | 2026-03-14 |
| Scope | Three independently shippable improvements (P1, P2, P3) surfaced by EXP-001 MVP validation |
| Evidence | [`docs/exp/001-mvp-validation.md`](../exp/001-mvp-validation.md) |
| Implementation order | P1 → P2 → P3 |

---

## 2. ArchDocs in Scope

| Architecture Doc | Path | Governs |
|---|---|---|
| State Model | [`docs/arch/state-model.md`](../arch/state-model.md) | P3 (Session Isolation) |
| MCP Layer | [`docs/arch/mcp-layer.md`](../arch/mcp-layer.md) | P1 (Richer Tool Responses) |
| Theory Lookup | [`docs/arch/theory-lookup.md`](../arch/theory-lookup.md) | P2 (Unicode Normalization) |
| Loader | [`docs/arch/loader.md`](../arch/loader.md) | P1 (LoadedMethod type context) |
| Path Resolution | [`docs/arch/path-resolution.md`](../arch/path-resolution.md) | P3 context |
| Dependencies | [`docs/arch/dependencies.md`](../arch/dependencies.md) | Dependency constraints |

All six ArchDocs verified accessible (sigma_0).

---

## 3. Task List

7 tasks with acceptance criteria, file scopes, severity, and role assignments.

### Task 1: P1-CORE-ADVANCE — Enrich `advance()` return type

- **Severity:** HIGH
- **Role:** implementor
- **Files:** `packages/core/src/state.ts`, `packages/core/src/types.ts`
- **Acceptance:**
  - `advance()` returns `methodologyId`, `methodId`
  - `previousStep` and `nextStep` are `{id, name}` objects (`nextStep` null at terminal)
  - Includes `stepIndex` and `totalSteps`
  - Session type export updated

### Task 2: P1-CORE-CURRENT — Enrich `current()` return type

- **Severity:** HIGH
- **Role:** implementor
- **Files:** `packages/core/src/state.ts`, `packages/core/src/types.ts`
- **Acceptance:**
  - `current()` returns context envelope: `methodologyId`, `methodId`, `stepIndex`, `totalSteps`, `step`
  - `step` field contains the same Step data previously returned directly
  - Return type defined and exported from `types.ts`

### Task 3: P1-MCP — Format enriched responses in MCP handlers

- **Severity:** MEDIUM
- **Role:** impl-sub-agent
- **Files:** `packages/mcp/src/index.ts`
- **Acceptance:**
  - `step_advance` JSON includes all enriched fields
  - Terminal step (`nextStep: null`) returns the full enriched JSON response, not plain text. Remove the current plain-text special case.
  - `step_current` JSON includes context envelope
  - `methodology_load` returns structured JSON with `methodologyId`, `methodId`, `methodName`, `stepCount`, `objective`, `firstStep`, `message`
  - For `methodology_load`, construct the structured response in MCP from the `LoadedMethod` object returned by `loadMethodology()`. Fields `methodologyId`, `methodId`, `name` (as `methodName`), `objective`, and `steps.length` (as `stepCount`) are available on `LoadedMethod`. `firstStep` is `steps[0]` `{id, name}`. This is response formatting, not business logic — acceptable under DR-04.
  - If `LoadedMethod.objective` is null, include `"objective": null` in the response — do not omit the field.
  - No new tools or dependencies

### Task 4: P2-CORE — Unicode normalization for theory lookup

- **Severity:** LOW
- **Role:** impl-sub-agent
- **Files:** `packages/core/src/theory.ts`
- **Acceptance:**
  - `theory_lookup("Phi-Schema")` returns F4-PHI.md content
  - `theory_lookup("sigma")` matches Σ references
  - `theory_lookup("delta")` matches δ_Φ references
  - Existing EXP-001 queries still pass
  - Normalization applied to all three search passes
  - Original content preserved in results

### Task 5: P3-CORE — Add SessionManager to core

- **Severity:** CRITICAL
- **Role:** implementor
- **Files:** `packages/core/src/state.ts` (or new `session-manager.ts`), `packages/core/src/types.ts`, `packages/core/src/index.ts`
- **Acceptance:**
  - `getOrCreate("agent-1")` returns same Session on repeated calls
  - `getOrCreate("agent-1")` and `getOrCreate("agent-2")` return independent Sessions
  - Default session available for backwards compatibility
  - Advancing in one session doesn't affect another
  - `createSession` continues to work

### Task 6: P3-MCP — Add `session_id` parameter to MCP tools

- **Severity:** HIGH
- **Role:** impl-sub-agent
- **Files:** `packages/mcp/src/index.ts`
- **Acceptance:**
  - All six tools accept optional `session_id`
  - When provided, routes to correct session via SessionManager
  - When omitted, uses default session (backwards compatible)
  - Two different `session_id`s yield independent state

### Task 7: P3-INTEGRATION — Validate session isolation

- **Severity:** MEDIUM
- **Role:** impl-sub-agent
- **Files:** `packages/core/src/__tests__/session-manager.test.ts` (new), optionally `packages/mcp/src/__tests__/session-routing.test.ts` (new)
- **Acceptance:**
  - Two sessions with different methods, independent state
  - `step_advance` in session A doesn't affect session B
  - Default (no `session_id`) works as MVP
  - Tests use real YAML fixtures per DR-09

---

## 4. Carryover Summary

| Field | Value |
|---|---|
| `has_carryover` | true (from sigma_0) |
| `carryover_tasks_merged` | 0 (all 4 carryover items already absorbed by PRD-derived tasks) |

| Carryover Item | Absorbed By |
|---|---|
| EXP-001-I1 (Phi-Schema Unicode gap) | Task 4 (P2-CORE) |
| EXP-001-I2 (error path untestable under concurrency) | Task 7 (P3-INTEGRATION) |
| EXP-001-I3 (`step_advance` lacks step names/method ID) | Tasks 1, 3 (P1-CORE-ADVANCE, P1-MCP) |
| Singleton session limitation | Tasks 5, 6 (P3-CORE, P3-MCP) |

---

## 5. Known Exclusions

Explicitly out of scope per PRD 002:

- Persistence across server restarts (future PRD)
- DAG-aware traversal (requires rethinking advance API)
- Methodology-level routing (δ_Φ evaluation)
- Session expiry/cleanup (acceptable for now)

---

## 6. Architecture Constraints Applied

| Constraint | Effect |
|---|---|
| DR-03 (core = zero transport deps) | Tasks 1, 2, 4, 5: no MCP SDK imports in core |
| DR-04 (MCP = thin wrapper) | Tasks 3, 6: enrichment logic in core, not MCP |
| DR-09 (real YAML fixture tests) | Task 7: tests load from `registry/` |
| DR-12 (horizontal docs) | Arch doc updates go as separate concerns |

---

## 7. Dispatch Recommendation

File scope overlap analysis for M2-DIMPL routing:

- Tasks 1, 2, 5 all write `state.ts` + `types.ts` — cannot parallelize
- Task 4 (`theory.ts`) is fully independent — can parallelize with anything
- Tasks 3 and 6 both write `mcp/index.ts` — cannot parallelize with each other

**Recommended dispatch order:**

1. **Serial block A:** Tasks 1 + 2 (P1-CORE, same files/concern)
2. **Parallel block B:** Task 3 (P1-MCP) + Task 4 (P2-CORE) — after block A
3. **Serial block C:** Task 5 (P3-CORE) — after block A
4. **Serial block D:** Task 6 (P3-MCP) — after block C
5. **Task 7** (P3-INTEGRATION) — after blocks C and D

---

## 8. Coverage Check

All PRD requirements are covered. Zero unmapped requirements. Every PRD-002 requirement maps to at least one task, and every task maps back to a PRD requirement or carryover item.
