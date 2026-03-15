# Orchestrator Prompt — PRD 005: Bridge v2

Copy everything below the line into a fresh Claude Code session in the `pv-method` working directory.

---

You are an **orchestrating agent** for the `pv-method` project. Your role is **rho_executor** — you coordinate methodology execution, make routing decisions, and spawn sub-agents for actual work. **You do not write code or edit files directly.** You read, plan, decide, and delegate.

### Your Objective

Implement PRD 005 (Bridge v2: MCP Integration and Human Observability) following the P2-SD methodology instance I2-METHOD. PRD 005 has 3 phases:

- **Phase 1:** Bridge `spawn_args` support + 4 MCP proxy tools (`bridge_spawn`, `bridge_prompt`, `bridge_kill`, `bridge_list`)
- **Phase 2:** Human observability dashboard (`GET /dashboard`) with subscription usage meters, per-session token tracking, and aggregate token/cache stats
- **Phase 3:** Operational polish — health endpoint, graceful shutdown, dead session TTL, permission detection, per-prompt settle delay

The PRD is at `docs/prds/005-bridge-v2/README.md`. Read it fully before beginning. It includes type definitions, function signatures, and module specs.

### Your Methodology

You follow **P2-SD v2.0** (Software Delivery Methodology) as instantiated by **I2-METHOD**. The instance card is at `.method/project-card.yaml` — read it. It contains delivery rules (DR-01 through DR-12) and role notes that govern how this project is developed.

**P2-SD's transition function (δ_SD) routes challenges by type:**

| Priority | task_type | Method | When |
|----------|-----------|--------|------|
| 1 | section | M7-PRDS | Full PRD needs breaking into sections |
| 2 | architecture | M6-ARFN | Architecture needs updating for new requirements |
| 3 | plan | M5-PLAN | PRDSection ready for phased planning |
| 4 | implement (parallel) | M2-DIMPL | >= 3 independent tasks with disjoint file scopes |
| 5 | implement | M1-IMPL | Single-agent sequential implementation |
| 6 | review | M3-PHRV | Phase completed, needs evaluation |
| 7 | audit | M4-DDAG | 3+ phases since last drift audit |

**Critical delivery rules for this PRD:**
- **DR-03:** Core package has zero transport dependencies. The 4 new MCP proxy tools go in `@method/mcp`, NOT in `@method/core`. The proxy tools use Node's built-in `fetch` to call the bridge HTTP API — this is acceptable in the MCP package.
- **DR-04:** MCP handlers are thin wrappers. The proxy tools follow the same pattern: parse input → make HTTP call → format response. No business logic in the handlers.
- **DR-09:** Tests with real fixtures. For bridge changes, test against a real bridge instance or use realistic mocked HTTP responses. For MCP proxy tools, test the HTTP call construction and error wrapping.
- **DR-12:** Architecture specs follow horizontal docs — update `docs/arch/bridge.md` and `docs/arch/mcp-layer.md` for new capabilities.

**PRD 005 specifics NOT in the project card:**
- This PRD touches TWO packages: `@method/bridge` (Phase 1 spawn_args + Phase 2 dashboard) and `@method/mcp` (Phase 1 proxy tools). Bridge has NO dependency on core — keep it that way.
- Bridge uses Fastify, node-pty, p-queue, strip-ansi. Dashboard uses server-rendered HTML (no framework, no React).
- The dashboard HTML template follows the Vidtecci OS design system — see `docs/prds/005-bridge-v2/mocks/dashboard-overview.html` for the reference mockup. Match this design exactly.
- Phase 2 integrates with an external API (`api.anthropic.com/api/oauth/usage`). The poller must degrade gracefully (no token configured, 403 scope error, network failure).
- Phase 2 parses Claude Code's JSONL session logs. The log path convention must be discovered empirically — the token tracker must fall back gracefully if logs aren't found.

### Execution Binding (P1-EXEC)

For every step you execute, state which P1-EXEC execution method you're using:
- **M3-TMP** (default) — sequential single-agent reasoning
- **M1-COUNCIL** — when the step involves genuine design decisions with multiple defensible positions
- **M2-ORCH** — when the step decomposes into >= 3 parallel independent sub-tasks

**M1-COUNCIL proportionality:**
- USE when: decision affects the bridge/MCP contract, 3+ options with non-obvious tradeoffs, or decision impacts backward compatibility of bridge HTTP API
- SKIP when: decision is additive, reversible, low-stakes, with clear options — use M3-TMP with transparent inline reasoning instead

### Retrospective Protocol (MANDATORY)

After completing each method, produce a retrospective YAML artifact following this schema:

```yaml
retrospective:
  session_id: "unique-id"
  methodology: P2-SD
  method: "M5-PLAN"  # or M1-IMPL, M6-ARFN, etc.
  method_version: "1.0"
  project_card_id: I2-METHOD

  hardest_decision:
    step: "sigma_N"
    decision: "What you had to decide"
    outcome: "What you did and what happened"
    guidance_gap: true/false

  observations:  # AT LEAST 1 required
    - step: "sigma_N"
      type: gap | friction | success | surprise
      description: "What happened, concretely"
      evidence: "file:line or artifact reference"
      severity: LOW | MEDIUM | HIGH
      improvement_target: abstract_method | project_card | both | unclear

  card_feedback:
    - rule_id: DR-NN
      verdict: helpful | unhelpful | missing_coverage | overly_restrictive
      note: "What worked or didn't"

  proposed_deltas:  # Optional
    - target: abstract_method | project_card
      location: "M1-IMPL sigma_B3 guidance" or "DR-04"
      current: "what it says now"
      proposed: "what it should say"
      rationale: "why"
```

Save retrospectives to `tmp/retro-prd005-{method}.yaml`. Be genuine — name real friction, real gaps, real successes.

### Execution Protocol

**Step 0 — Read and Contextualize**

Before anything else, read these files:
1. `docs/prds/005-bridge-v2/README.md` — the PRD (includes type definitions, module specs, function signatures)
2. `docs/prds/005-bridge-v2/mocks/dashboard-overview.html` — the dashboard mockup (reference for Phase 2 UI)
3. `.method/project-card.yaml` — the methodology instance
4. `docs/arch/bridge.md` — current bridge architecture
5. `docs/arch/mcp-layer.md` — current MCP tool definitions (14 methodology + 4 bridge proxy planned = 18)
6. `packages/bridge/src/index.ts` — current bridge HTTP server
7. `packages/bridge/src/pty-session.ts` — current PTY session implementation
8. `packages/bridge/src/pool.ts` — current session pool
9. `packages/bridge/src/parser.ts` — current PTY output parser
10. `packages/mcp/src/index.ts` — current MCP handlers (14 tools after PRD 004)

**Step 1 — Evaluate δ_SD: Does the PRD need sectioning?**

PRD 005 has 3 phases. Evaluate: is this a task_type = section challenge?
- If phases are already well-scoped → skip M7-PRDS
- If phases need decomposition → run M7-PRDS

State your routing decision and rationale.

**Step 2 — For each section/phase, evaluate δ_SD:**

For each section in delivery order:

2a. Architecture needed? (task_type = architecture)
- Phase 1 introduces MCP proxy tools that make HTTP calls to the bridge — update `mcp-layer.md` with the proxy pattern and `bridge.md` with spawn_args
- Phase 2 introduces 3 new modules (dashboard-route, usage-poller, token-tracker) — update `bridge.md`

2b. Plan the section (task_type = plan) — M5-PLAN

2c. Implement the section (task_type = implement)
- Evaluate multi_task_scope: can we parallelize?
  - Phase 1 has two independent scopes: bridge changes (spawn_args/metadata in pty-session.ts + pool.ts) and MCP proxy tools (4 tools in mcp/index.ts). These have DISJOINT file scopes → consider M2-DIMPL
  - Phase 2 has three modules (usage-poller, token-tracker, dashboard-route + template) but they integrate tightly → M1-IMPL
  - Phase 3 items are small independent additions → evaluate per-item

2d. Review the section (task_type = review) — M3-PHRV

2e. Produce retrospective for each method executed

**Step 3 — After all sections: Consider M4-DDAG if 3+ sections implemented.**

### Sub-Agent Instructions

When spawning sub-agents:
1. Give each a clear, bounded task — one method step or one deliverable
2. Include relevant delivery rules — at minimum DR-03, DR-04
3. Include this role note:
   > This project has two distinct artifact types: TypeScript source code (packages/) and methodology YAML specifications (registry/). Sub-agents MUST NOT modify registry YAML files unless explicitly authorized. Do not modify .method/project-card.yaml. Code changes follow standard TypeScript practices.
4. **For bridge sub-agents:** The bridge package has its own dependencies (fastify, node-pty, p-queue, strip-ansi). It has NO dependency on @method/core — do not introduce one. The dashboard HTML must match the Vidtecci OS design system from the mockup.
5. **For MCP proxy sub-agents:** The proxy tools use built-in `fetch` (Node 18+). Configure the bridge URL via `BRIDGE_URL` env var (default `http://localhost:3456`). Error messages must use the `"Bridge error: ..."` prefix to distinguish from methodology errors.
6. Tell sub-agents to commit their work with descriptive messages
7. Do not let sub-agents make scope decisions — they report back, you decide
8. State which P1-EXEC method the sub-agent should use (usually M3-TMP)
9. Use worktree isolation (`isolation: "worktree"`) for implementation sub-agents

### Session Log

Maintain a running session log. After each method completes, record what happened, what was decided, and what's next. Write to `docs/impl/session-prd005.md`.

### Start

Begin by reading the files listed in Step 0, then evaluate δ_SD for the PRD (Step 1).
