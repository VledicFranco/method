# pv-method

Runtime that makes formal methodologies executable by LLM agents. Loads compiled methodology YAML specs from the registry, exposes them via MCP tools, and includes a bridge for spawning and managing Claude Code sub-agent sessions.

## Essence

- **Purpose:** The runtime that makes formal methodologies executable by LLM agents.
- **Invariant:** Theory is the source of truth. When implementation and formal theory diverge, revise the implementation — never the theory.
- **Optimize for:** Faithfulness > simplicity > registry integrity.

## Commands

```bash
npm run build          # TypeScript build (all packages)
npm test               # Run all tests (core + bridge domains)
npm run bridge         # Start bridge server (builds first)
npm run bridge:dev     # Dev mode (tsx, no build step)
npm run bridge:stop    # Stop bridge + cleanup orphaned processes
npm run bridge:test    # Start test instance on port 3457 (isolated state, fixture repos)
npm run bridge:stop:test  # Stop test instance
npm run bridge -- --instance <name>  # Start a named instance from .method/instances/<name>.env
```

**Secrets:** API keys resolve automatically via 1Password CLI (`op run --env-file=.env.tpl`). Fallback: plain `.env` file if `op` is not available. See Guide 30 for setup details.

## Architecture — Fractal Component Architecture (FCA)

This project follows FCA (see `docs/fractal-component-architecture/`). The core principle: **the same structural discipline repeats at every scale** — from a function to a package to the system.

### Layer Stack (dependency flows downward only)

```
L4  @method/bridge     Application — HTTP server, wires everything, owns the process
    method-ctl         CLI — unified cluster management (status, nodes, projects)
L3  @method/cluster    Cluster protocol — membership, routing, federation (PRD 039, zero transport deps)
    @method/mcp        Protocol adapter — thin MCP tool wrappers over methodts
    @method/pacta      Modular agent SDK — pacts, providers, middleware, composition engine
    @method/pacta      cognitive/ — cognitive composition (algebra/, modules/, engine/) — PRD 030
    @method/pacta-*    Provider packages (claude-cli, anthropic), testkit, playground
L2  @method/methodts   Domain extensions — type system, stdlib catalog, strategy logic
    @method/testkit    Testing framework (assertions, builders, runners)
```

> **Note:** Methodology operations go through the `MethodologySource` port (defined in
> `packages/bridge/src/ports/methodology-source.ts`), backed by `StdlibSource` which wraps
> the `@method/methodts` stdlib catalog. See `docs/arch/methodology-source.md` for details.

**Rules:** Higher layers may depend on lower. Never the reverse. MCP handlers are thin wrappers — parse input, call methodts, format output.

### Bridge — Domain-Co-Located Structure (PRD 023)

The bridge (`packages/bridge/`) is an L4 application organized as FCA domains:

```
src/
  server-entry.ts          Composition root — wires ports, registers domains
  ports/                   Cross-domain port interfaces (PTY, filesystem, YAML)
  domains/
    cluster/               Cluster coordination — peer discovery, federation sink, adapters (PRD 039)
    sessions/              PTY session lifecycle, channels, parsing, scope enforcement
    methodology/           Methodology session persistence
    registry/              Registry management, resource copying
    projects/              Multi-project discovery, event persistence
    strategies/            Strategy pipeline execution, gates, retros
    tokens/                LLM usage tracking, subscription polling
    triggers/              Event trigger system (file, git, webhook, schedule)
    genesis/               Multi-project agent orchestration + ambient UI (PRD 025)
  shared/                  Cross-domain utilities (config reload, validation, websocket)
    event-bus/             Universal Event Bus — single event backbone (PRD 026)
```

Each domain is self-contained: core logic, tests, routes, config (Zod), and types co-located in one directory. Ports provide dependency injection at the composition root.

### Universal Event Bus (PRD 026)

All bridge domains emit typed `BridgeEvent` objects to a single bus (`ports/event-bus.ts`). Consumers subscribe via `EventSink` interface — registered only in the composition root. Built-in sinks: WebSocketSink (frontend), PersistenceSink (JSONL), ChannelSink (parent agents), GenesisSink (30s batched summaries). External connectors use `EventConnector` (extends EventSink with lifecycle). See `docs/arch/event-bus.md` for details.

**Connector config:** Set `EVENT_CONNECTOR_WEBHOOK_URL` env var to auto-register a webhook connector. Filter with `EVENT_CONNECTOR_WEBHOOK_FILTER_DOMAIN` and `EVENT_CONNECTOR_WEBHOOK_FILTER_SEVERITY` (comma-separated).

### Key FCA Principles for Contributors

1. **Every domain owns its artifacts** — tests, config, types, routes live with the domain, not in central directories
2. **Port pattern for external deps** — access external services through port interfaces, never direct imports
3. **Boundaries are enforced by structure** — directory structure IS the architecture; import violations are bugs
4. **Verify independently** — each domain's tests run in isolation without other domains
5. **Interface discipline** — treat every domain's exports as a library API; breaking changes need migration

### Other Key Directories

```
registry/     Compiled methodology YAML specs — PRODUCTION ARTIFACTS, do not modify casually
theory/       Formal theory files (F1-FTH, F4-PHI)
docs/
  arch/       Architecture specs (one concern per file)
  prds/       Product requirement documents (001–027)
  guides/     Usage guides (29 guides)
  fractal-component-architecture/   FCA specification (7 parts)
  rfcs/       Research RFCs (001 cognitive composition, 002 small language models)
experiments/  Research experiments — see experiments/PROTOCOL.md
  PROTOCOL.md   How we run experiments, log results, coordinate parallel work
  AGENDA.md     Prioritized research backlog with claim protocol
  log/          Per-run YAML entries (merge-conflict-free)
  artifacts/    Large binaries — gitignored (models, checkpoints, ONNX exports)
  exp-slm/      SLM compilation validation (RFC 002, PRD 034)
  exp-cognitive-baseline/   Cognitive vs flat agent comparison (RFC 001)
.method/      Methodology execution home
  project-card.yaml   Essence, delivery rules, processes
  manifest.yaml       Installed methodologies and protocols
  council/            Steering council (TEAM, AGENDA, LOG)
  retros/             Retrospective artifacts
  strategies/         Event trigger strategy files
  instances/          Instance profile .env files for running multiple bridge instances on different ports with isolated state
```

## Delivery Rules

- **DR-01/02:** Registry files are production artifacts. Preserve compilation status and structural completeness.
- **DR-03:** Domain packages have zero transport dependencies. Bridge proxy tools go in `@method/mcp`.
- **DR-04:** MCP handlers are thin wrappers — parse input, call methodts, format output.
- **DR-05:** Use js-yaml for all YAML parsing. Preserve structure faithfully.
- **DR-09:** Tests use real YAML fixtures, not minimal mocks.
- **DR-12:** Architecture docs follow horizontal pattern — one file per concern in `docs/arch/`.
- **DR-13:** Validate YAML after registry edits: `node -e "require('js-yaml').load(require('fs').readFileSync('file.yaml','utf8'))"`.

Full set: `.method/project-card.yaml` (DR-01 through DR-14).

## Research & Experiments

This project has active research lines validated through structured experiments.

- **Protocol:** `experiments/PROTOCOL.md` — how to run experiments, log results, coordinate parallel agents, and distill findings
- **Agenda:** `experiments/AGENDA.md` — prioritized research backlog with claim protocol for parallel work
- **Run history:** `experiments/log/*.yaml` — one YAML per run, merge-conflict-free
- **Active experiments:** `experiments/exp-*/README.md` — hypothesis, methodology, findings per experiment

### Active Research Lines

| Line | RFC | Experiment | Status |
|------|-----|-----------|--------|
| SLM Compilation | `docs/rfcs/002-small-language-models.md` | `experiments/exp-slm/` | Gate 3 PASS, Gate 4 pending |
| Cognitive Architecture | `docs/rfcs/001-cognitive-composition.md` | `experiments/exp-cognitive-baseline/` | Preliminary (N=3) |

### Related Work (cross-project)

Distilled research findings live in the **ov-research** vault (`../ov-research/`), organized by knowledge domain. Key domains for this project:

- `ov-research/knowledge/slm-compilation/` — SLM learnability, data quality, overconfidence risk
- `ov-research/knowledge/methodology/` — formal theory, enforcement loops, composition algebra
- `ov-research/experiments/EXP-023-*` through `EXP-027-*` — cognitive module experiments

When asked about related work or prior findings, check ov-research first. The distillation protocol (how findings move from experiments/ to ov-research/) is in `experiments/PROTOCOL.md §7`.

## Sub-Agent Guidelines

If you are a sub-agent spawned for implementation work:

- **Do NOT modify registry YAML files** unless the task explicitly requires it. If a registry file has a parsing error, REPORT it — do not fix it.
- **Do NOT modify** `.method/project-card.yaml`, schema files, or council artifacts.
- **Do NOT commit to files outside your task scope.** One step, one deliverable per sub-agent.
- **Scope decisions go to the orchestrator.** If the task requires decisions beyond your scope, report back.
- When in doubt about a registry change, check the method's `compilation_record` to understand what gates it passed.
- To validate bridge changes, spin up a test instance with `npm run bridge:test` (port 3457, isolated state). Stop with `npm run bridge:stop:test`. The test instance uses fixture repos in `test-fixtures/bridge-test/` and does not interfere with the production bridge.

## Governance

This project uses the method system it builds. Instance: I2-METHOD, methodology: P2-SD v2.0.

**Skills:**
- `/steering-council` — project governance session
- `/council-team [challenge]` — adversarial expert debate
- `/commission [task]` — generate orchestrator prompt for a fresh agent

**Processes (enforced by steering council):**
- **PR-01:** Guide sync — update `docs/guides/` when `registry/` changes
- **PR-02:** Stale agenda escalation — items open 3+ sessions get resolved or archived
- **PR-03:** Retro placement — retrospectives go to `.method/retros/`, not `tmp/`

**Retrospectives:** After every methodology session, produce a retro at `.method/retros/retro-YYYY-MM-DD-NNN.yaml`. Include: `hardest_decision`, `observations` (>= 1), `card_feedback`, `proposed_deltas` (optional).
