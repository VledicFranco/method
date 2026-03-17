# Vision — Strategy Pipelines

**Status:** Active brainstorm + design decisions
**Created:** 2026-03-16
**Council topic:** TOPIC-STRATEGY-PIPELINES (`.method/council/memory/strategy-pipelines.yaml`)
**PRD:** [017-strategy-pipelines.md](../prds/017-strategy-pipelines.md) (Phase 1 scope)

> This document is the permanent home for all ideas, research, and design decisions related to Strategy Pipelines. Ideas graduate from here to the PRD when they're scoped for implementation. Nothing is deleted — items are marked as graduated, deferred, or rejected with rationale.

---

## 1. Raw Ideas (PO brainstorm, 2026-03-16)

The original brainstorm, preserved verbatim:

- **Methodologies Pipelines (Aka a "Strategy"):** A DAG result of the composition of methodologies under a certain context, where every step is executable by an LLM, and potentially algorithmic steps happen in between methodic (LLM) steps.
  - Strategy pipeline design: Methodologies are forking points, methods linear pipelines (unless the method explicitly requests looping)
  - Strategy council: The council of agents that oversee the correct execution and report back.
  - Gates as mechanisms of ensuring that a step was done properly by an agent
    - Defined with computable/algorithmic gates (e.g. tests passing, observation tool, double confirm of LLM), allowing for automatic requeue of a step.
  - Methods as functions (input context + artifacts, output context + artifacts)
    - Reporting out of ordinary aspects as extra context, difficulties and challenges, or good to knows, useful for retrospectives etc
  - Done through the bridge or a new component.
  - Mandatory retrospective at the end.
  - `claude --print --output-format json --resume <session_id>` API in the bridge to schedule steps and as a mechanism for determinism (also `--resume` can help maintain or clear context)
    - This also through an interface, so that we can later on plug in Claude API or potentially another LLM provider.
  - Dynamic scripting for in-between steps also executable in the bridge
  - DAG automatic parallelization
  - Consider using Constellation Engine (repo in `../oss-constellation-engine`)
  - Event system. E.g. execute a Strategy on webhook or process event (e.g. new file), and output events, either to webhooks, process hooks, or to the method MCP for the "genesis" LLM (the one interfacing with the human) or other LLMs.
  - Guardrails, e.g. through the artifact and context system, ensure mutations are safe without having to use a human bottleneck for permissions. Smarter security model where mutations happen in a functional programming way and with minimum required access.
  - Registry of tools that are automatically saved and exposed, to help guide and restrict the agents on what and how to use it and when, and becomes explicit in the strategy. Also to help in retrospectives search or ideate the improvement of tools (CLI tools, MCP servers, sub methods to use, methods to formalize)
  - Visualization for humans to know the structure of a strategy

---

## 2. Council Design Decisions (Session 1, 2026-03-16)

Cast: Thane (leader), Kael (distributed systems), Mira (agent reliability), Voss (formal theory), Lyra (reactive/FP), Rune (production ops). 12 questions resolved, 5 position shifts, 0 escalations.

Full memory at `.method/council/memory/strategy-pipelines.yaml`. Full report at `tmp/20260316-council-strategy-prd.pdf`.

### D-001: Formal definition
A Strategy is a **higher-order methodology** in F1-FTH whose `D_STRATEGY` includes MethodologyInvocation, AlgorithmicGate, Artifact, Context as sorts. Transition function selects a frontier of parallel-executable nodes (extends §7 coalgebra to parallel selection, grounded in §8.1 open problem P1).

### D-002: Execution architecture
**Minimal TypeScript DAG executor** in the bridge, using Constellation Engine's `DagSpec` data model as type structure. Interfaces designed for future Constellation port. Middle ground between Lyra's full Constellation integration and Rune's minimal approach.

### D-003: Step execution model
`claude --print --output-format json --resume <session_id>` for all automated steps. **Claude-first provider interface** with capability flags (`resume`, `budget_cap`, `tool_filtering`, `structured_output`). Streaming via `AsyncIterable` for real-time observability.

### D-004: Gate model
**Two-scope gates:** step gates (embedded in method steps, trigger requeue with failure context) and strategy gates (separate DAG nodes, depend on multiple step outputs). **Five types:** algorithmic, LLM-review, dual-confirm, human-approval, observation. Phase 1: algorithmic + observation + human-approval. Phase 2: LLM-review + dual-confirm.

### D-005: Methods as functions
`MethodFunction: (Context, Artifacts) → (Context', Artifacts', SideReport)`. Immutable artifact versioning. SideReport as first-class signal channel feeding council oversight, retrospectives, and retry context.

### D-006: DAG design
**Three node types:** methodology (fork points), gate (verification), script (algorithmic transformation). Automatic parallelization from dependency analysis. Conditional edges for routing-dependent paths. Sub-strategies deferred to future phase.

### D-007: Event system
Strategy YAML declares all triggers. **Phase 1:** manual + MCP triggers. **Phase 2:** webhooks, filesystem watchers, cron. Schema is future-proof — Phase 2 adds routers without changing Strategy definitions.

### D-008: Guardrails
Artifact immutability with versioning. **Capability model** for tool access (named sets: `implementation`, `read_only`, `github_operations`, etc.). Enforcement via `--allowedTools` in print mode. Security boundary acknowledged as prompt-level, not OS-level.

### D-009: Tool registry
Registry in `.method/tools.yaml`. Strategy references tools by ID. Static validation at startup (warn on missing). Dynamic discovery from MCP servers deferred to Phase 2.

### D-010: Strategy oversight
**Phase 1:** algorithmic oversight with configurable rules (gate failure thresholds, cost budgets, timeout escalation). **Phase 2:** LLM council (M1-COUNCIL instance) for complex oversight decisions.

### D-011: Retrospectives
Mandatory Strategy-level retro aggregating per-method retros, gate results, side reports, and Strategy metrics. Method-attributability analysis. GlyphJS format with visualizations.

### D-012: Visualization
**Phase 1:** static DAG visualization from Strategy YAML. **Phase 2:** runtime execution visualization with live SSE updates.

---

## 3. Research Findings

### Constellation Engine (2026-03-16)

Full analysis in council session. Key findings:

- **What it is:** Scala-based type-safe pipeline orchestration engine with automatic parallelization, suspension/resumption, priority scheduling, circuit breakers, and instrumentation hooks.
- **DAG model:** `DagSpec` (modules + data nodes + edges), `ModuleNodeSpec` (processing steps), `DataNodeSpec` (typed values), `InlineTransform` (30+ algorithmic operations).
- **Production-ready:** 0.9.0, 80% test coverage, stable at 10K+ executions, ~0.15ms per-node overhead.
- **Direct fits:** DAG execution, automatic parallelization, typed data flow, suspension/resumption, priority scheduling, observability hooks, circuit breakers, cancellation.
- **Gaps:** No event triggers (pull-only), no LLM step adapter, no Strategy definition language.
- **Decision:** Take design patterns (DagSpec types, deferred data flow), implement in TypeScript. Full port deferred to Phase 3.

### Claude Code `--print` mode (2026-03-16)

Full analysis in PRD 012 Phase 4. Key findings:

- **Gains over PTY:** structured JSON output, budget caps, pre-assigned session IDs, session branching (`--fork-session`), MCP isolation (`--strict-mcp-config`), fallback model, ephemeral sessions.
- **Preserves:** full tool access, multi-turn via `--resume`, tool filtering, system prompt control, all MCP tools.
- **Loses:** no live TUI, no interactive permissions (must use `bypassPermissions`), no mid-conversation input, no max-turns control.
- **JSON result:** `{ result, session_id, usage, total_cost_usd, num_turns, permission_denials, stop_reason }`.

### xyflow / React Flow (2026-03-17)

Researched for Strategy DAG visualization. Key findings:

- **What it is:** React-based node graph library (35.7K stars, MIT, 3.6M weekly npm downloads). Custom React components as nodes, dagre/ELK layout, real-time state-driven updates, dark mode, zoom/pan/minimap.
- **DAG support:** Excellent — dagre integration for directed acyclic graphs, automatic parallelization visualization, conditional edges, priority-based node styling.
- **Custom nodes:** Any React component — methodology nodes with status badges, gate nodes with pass/fail indicators, script nodes with output previews.
- **Performance:** Tested to 450 nodes. 50-node Strategy DAGs are trivial.
- **Problem:** Requires React runtime. Bridge dashboard is server-rendered HTML with no build step.
- **Integration paths:**
  - **Path A (CDN):** Load React + ReactFlow via `<script>` tags. ~300KB JS, full interactivity. Moderate architectural departure.
  - **Path B (Server SVG):** Use dagre in Node.js for layout, generate raw SVG server-side. Zero client JS. Static only. Matches dashboard pattern.
  - **Path C (Separate SPA):** Vite-built React app at `/pipeline` route. Full features. Requires build pipeline.
- **Alternative:** Cytoscape.js — vanilla JS, CDN-loadable, dagre plugin, canvas-rendered (less customizable nodes but no React dependency).
- **Recommendation:** Path B for Phase 1 (static viz), evaluate Path A or Cytoscape.js for Phase 2 (runtime viz).

---

## 4. Deferred Ideas (not in Phase 1)

| Idea | Source | Rationale for deferral | Target phase |
|------|--------|----------------------|-------------|
| Sub-strategy composition | D-006 | Flat DAGs handle current use cases. Add hierarchy when needed. | Phase 3+ |
| LLM-review gates | D-004 | Algorithmic gates cover 90% of needs. Need Phase 1 data to know where LLM review helps. | Phase 2 |
| Dual-confirm gates | D-004 | Doubles LLM cost. Need evidence of where single-agent review fails. | Phase 2 |
| Webhook triggers | D-007 | Requires persistent event router surviving bridge restarts. | Phase 2 |
| Filesystem watchers | D-007 | Same persistent router requirement. | Phase 2 |
| Cron triggers | D-007 | Same persistent router requirement. | Phase 2 |
| Dynamic tool discovery | D-009 | Startup complexity. Static YAML sufficient for Phase 1. | Phase 2 |
| LLM oversight council | D-010 | Needs Phase 1 execution data to calibrate. | Phase 2 |
| Runtime DAG visualization | D-012 | Needs htmx migration in dashboard. | Phase 2 |
| Constellation Engine port | D-002 | 2-3 month project. Minimal executor sufficient for Phase 1. | Phase 3 |
| OS-level sandboxing | D-008 | Out of scope for methodology system. | Future |
| Method-attributability analysis | D-011 | Hard to automate reliably. | Phase 2+ |

---

## 5. Persistent Tensions

These tensions will resurface as we develop. Preserved here for future council sessions.

1. **Constellation integration vs build-from-scratch** — Lyra (Constellation's proven model) vs Rune (minimal TypeScript executor). Resolved via Kael's middle ground in Session 1. Will resurface at Phase 3 scoping.

2. **Formal theory compliance vs practical execution** — Voss (must be a methodology in F1-FTH) vs Lyra/Kael (needs parallel DAG engine). Resolved as "methodology outside, DAG engine inside." F1-FTH §8.1 provides theoretical foundation.

3. **Gate complexity vs reliability payoff** — Mira (all five gate types needed) vs Rune (algorithmic covers 90%). Resolved via phasing. Will resurface when Phase 1 data shows where algorithmic gates fail.

4. **Event-driven automation scope** — Lyra (reactive pipeline) vs Rune (manual triggers only). Resolved via phasing. Will resurface at Phase 2 when event router is designed.
