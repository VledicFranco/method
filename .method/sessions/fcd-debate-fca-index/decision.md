---
type: council-decision
topic: "@method/fca-index — FCA-Indexed Context Library for Token-Efficient Agent Retrieval"
date: "2026-04-08"
cast: [Oryn, Sable, Vera, Rion, Lena]
surface_advocate: Sable
ports_identified: [ProjectManifest, ComponentContext, IndexStore, ModeGate]
status: decided
---

# Decision: Build @method/fca-index as a Universal L3 Library

## What Was Decided

A new L3 package — `@method/fca-index` — that indexes FCA-compliant projects using a
hybrid SQLite + embedding store over co-located documentation. It ships:

1. **Query engine** — returns `ComponentContext` results with relevance + coverage scores
2. **Compliance tooling** — doc coverage checker, FCA gate validator, quality-gate installer
3. **Two modes** — discovery (< coverage threshold, warnings) and production (>= threshold, trusted)
4. **Two consumer surfaces** — structured API for MCP/methodts, human-readable CLI layer
5. **Universal scope** — works for any FCA project; `@method/mcp` ships a thin MCP adapter on top

## Key Design Decisions

### Coverage: Incremental Trust, Not Binary Precondition

- Every query response includes a `coverage_score` per returned component — no silent gaps
- **Discovery mode:** coverage < threshold → queries return results with coverage warnings, safe for exploration
- **Production mode:** coverage >= threshold → queries trusted by default, gates enforced
- Coverage is **library-computed** against the actual filesystem, never self-certified by the project
- Projects graduate into production mode when measured coverage crosses the (configurable) threshold

### Scope: Universal Library, Method-Specific Adapter

- `@method/fca-index` is universal — any FCA-compliant project can use it
- `@method/mcp` ships a thin adapter that wraps query API in MCP tool signatures
- `ComponentContext` type lives in the universal library; MCP tool schema lives in `@method/mcp`

### Consumer Surfaces: Two, Not One

- **Structured API** — typed `ComponentContext` objects for MCP/methodts consumers
- **Human-readable CLI** — coverage reports, compliance output for developers
- Shared core type (`CoverageReport`) underlies both; presentation layer is separate

## Arguments For

- FCA co-location guarantee means documentation IS the architectural map — sound foundation
- Coverage score in every query response solves the "silent gap" failure mode (agents acting on incomplete data)
- Two-mode design lets teams use the library before 100% compliance without risking agent errors
- Universal scope makes the library reusable outside the method ecosystem (long-term leverage)
- Lysica's SQLite + Lance precedent (semantic.lance + episodic.db) validates hybrid approach at production scale

## Arguments Against (Acknowledged)

- Port-first design requires 3 co-design sessions before implementation — slows first-ship
- Coverage score computation must be library-computed, not self-certified — adds implementation complexity
- Two consumer surfaces (MCP API + CLI) with different ergonomics risk diverging over time

## Surface Implications

### New Ports Needed

| Port | Producer | Consumer | Priority |
|------|----------|----------|----------|
| `ComponentContext` | `@method/fca-index` query engine | `@method/mcp`, CLI | **CRITICAL — Wave 0 first** |
| `ProjectManifest` | Consuming project (FCA dir structure) | `@method/fca-index` scanner | Wave 0 |
| `IndexStore` | Internal storage (SQLite+Lance) | Query engine | Wave 0 (decide if pluggable) |
| `ModeGate` | Compliance engine | CI/CD, quality gate runner | Wave 1 |

### Existing Ports Modified
None — new library.

### Canonical Types Required
- `ComponentContext` — query response: `{ path, level: FcaLevel, parts: FcaPart[], readme?, interfaceSummary?, portNames: string[], relevanceScore: number, coverageScore: number }`
- `FcaLevel` — enum L0–L5
- `FcaPart` — enum of 8 parts (Interface, Boundary, Port, Domain, Architecture, Verification, Observability, Documentation)
- `CoverageReport` — per-component coverage gap summary

## Wave 0 Co-Design Sessions Required

Before any implementation starts:

1. `/fcd-surface fca-index mcp` — define `ComponentContext` type with both `@method/fca-index` and `@method/mcp` present. **This is the composition theorem's highest-priority surface.**
2. `/fcd-surface fca-index consuming-project` — define `ProjectManifest` or confirm FCA directory convention is sufficient as implicit contract.
3. `/fcd-surface fca-index cli` — define `CoverageReport` type and structured vs. human output split.

## Open Questions

1. **Embedding model validation:** Voyage-3-lite (512 dims) validated for Lysica's conversation domain. Needs empirical check against FCA README + JSDoc content before committing. Different content distribution may warrant different model or dimensions.
2. **IndexStore pluggability:** Should the library allow swapping Lance for pgvector/other backends? Decides whether `IndexStore` is a real external port or an internal implementation detail.
3. **Coverage threshold default:** What % triggers production mode? Needs input from projects with varying documentation states before a sensible default can be set.

## Decision-to-Surface Tracing

| Decision | Surface Impact | Action |
|----------|---------------|--------|
| Universal L3 library | New port: ComponentContext between fca-index and mcp | `/fcd-surface fca-index mcp` |
| Scan any FCA project | New port: ProjectManifest between consuming-project and scanner | `/fcd-surface fca-index consuming-project` |
| CLI + API consumer split | New entity: CoverageReport shared across surfaces | `/fcd-surface fca-index cli` |
| Two-mode operation | New gate: ModeGate for coverage threshold enforcement | Add to architecture.test.ts in Wave 1 |
