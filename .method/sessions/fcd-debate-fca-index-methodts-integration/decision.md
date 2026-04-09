---
type: council-decision
topic: "fca-index integration with methodts — context building before LLM calls"
date: "2026-04-09"
cast: [Orion, Vex, Mira, Sable, Lena]
surface_advocate: "Sable"
ports_identified: [ContextLoadExecutor]
---

## Decision: Two-Tier fca-index Context Integration with methodts

### Arguments For

1. **Layer DAG respected:** methodts (L2) never imports fca-index (L3). The `ContextLoadExecutor` adapter at L3 is the only new cross-layer dependency, flowing in the correct direction.
2. **DAG node is declarative:** Strategy authors express *what* to retrieve and *when*, not *how*. The executor handles mechanics. This matches the existing strategy DAG philosophy.
3. **Two-tier coverage:** Pre-execution `context-load` nodes handle predictable context needs cheaply (once per strategy run, targeted). The existing MCP `context_query` tool handles dynamic mid-execution needs with zero new infrastructure.
4. **Composes with existing primitives:** `ArtifactStore`, `DagNodeExecutor`, `ContextQueryPort` — no new runtime concepts needed.
5. **Token efficiency:** Per-step context is scoped to what each step actually needs rather than a global pre-dump.

### Arguments Against (Acknowledged)

- **Discovery gap:** Mid-execution retrieval via MCP tool is agent-discretionary. Mitigated by good strategy design + future step-level hints.
- **DAG node verbosity:** Strategy YAML grows with `context-load` nodes. Acceptable tradeoff for explicitness.

### Surface Implications

**New ports needed:**
- `ContextLoadExecutor` — DagNodeExecutor implementation for `context-load` node type
  - Producer: L3 adapter (bridge or new adapter package)
  - Consumer: DagStrategyExecutor in methodts (via DagNodeExecutor injection)
  - Status: **needs co-design** — `/fcd-surface methodts fca-index ContextLoadExecutor`

**Existing ports used (no modification):**
- `ContextQueryPort` in fca-index — consumed by ContextLoadExecutor. Frozen. ✓
- MCP `context_query` tool — existing. No changes. ✓

**Entity types affected:**
- `StrategyNode` / `StrategyNodeConfig` — needs new variant: `context-load`
- `ArtifactBundle` — must support `ComponentContext[]` values

**Wave 0 items:**
1. Define `context-load` node YAML schema
2. Co-design `ContextLoadExecutor` interface
3. Define ArtifactStore → prompt template convention for context-load results

**Co-design sessions needed:**
- `/fcd-surface methodts fca-index ContextLoadExecutor — DagNodeExecutor for context-load node type`

### Open Questions

1. Where does the adapter live? Bridge (simplest) or new adapter package?
2. How do step prompt templates reference context-load artifacts? (template variable convention)
3. Forward: should Step definitions declare `contextHints` for auto-planner? (not blocking Wave 0)
