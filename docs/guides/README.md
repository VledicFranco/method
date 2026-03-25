# Guides

Conceptual and operational guides for the method system — what methods and methodologies are, how they work, and how to use them.

## Guide Index

| # | Guide | Domain | Audience | What you'll learn |
|---|-------|--------|----------|-------------------|
| 1 | [What is a Method?](01-what-is-a-method.md) | concepts | Everyone | The 5-tuple, steps, objectives, and why formalism matters |
| 2 | [What is a Methodology?](02-what-is-a-methodology.md) | concepts | Everyone | How methodologies route to methods, transition functions, P1-EXEC as example |
| 3 | [The Meta-Method Family (P0)](03-meta-methods.md) | registry | Method designers | How methods are designed, compiled, evolved, and composed |
| 4 | [Execution Methods (P1)](04-execution-methods.md) | registry | Agent operators | COUNCIL, ORCH, TMP, ADVREV — when to use each, how routing works |
| 5 | [Software Delivery (P2)](05-software-delivery.md) | registry | Delivery teams | The full PRD-to-audit loop, all 7 methods, worked example |
| 6 | [Project Cards & Instantiation](06-project-cards.md) | governance | Project leads | How to parameterize a methodology for your project |
| 7 | [Compilation Gates (G0-G6)](07-compilation-gates.md) | registry | Method designers | What each gate checks, common failures, how to fix them |
| 8 | [Prompting Methodology Agents](08-prompting-methodology-agents.md) | bridge | Agent operators | How to write orchestrator prompts, spawn parameters, empirical patterns |
| 9 | [The Retrospective Protocol](09-retrospective-protocol.md) | governance | Everyone | Self-improvement loop, retro schema, aggregation, thresholds, empirical results |
| 10 | [Bridge Orchestration](10-bridge-orchestration.md) | bridge | Agent operators | Using the bridge + MCP tools for multi-method sessions with sub-agents |
| 11 | [Protocols and Method Discovery](11-protocols-and-discovery.md) | registry | Method designers | How informal practices become formal methods — the R&D pipeline |
| 12 | [The Steering Council](12-steering-council.md) | governance | Project leads | Persistent governance council, essence guardianship, session structure |
| 13 | [Installation and .method/](13-installation.md) | governance | Project leads | The .method/ directory, manifest, installation specs, committed vs ephemeral |
| 14 | [Extending the Bridge Dashboard UI](14-bridge-dashboard-ui.md) | bridge | Contributors | Dashboard rendering architecture, Vidtecci OS design system, adding panels and pages |
| 15 | [Remote Access via Tailscale](15-remote-access.md) | bridge | Agent operators | Accessing the bridge from a phone or remote machine over Tailscale |
| 16 | [Strategy Pipelines](16-strategy-pipelines.md) | strategy | Delivery teams | Creating event-triggered DAG workflows across projects |
| 17 | [Narrative Flow UI](17-narrative-flow-ui.md) | bridge | Contributors | Visualization of methodology execution as interactive narratives |
| 18 | [Strategy Context Continuity](18-strategy-context-continuity.md) | strategy | Agent operators | Maintaining context across strategy steps and sub-agent calls |
| 19 | [Multi-Project Genesis Agent](19-prd020-multi-project-genesis.md) | multi-project | Agent operators, project leads | Genesis persistent coordinator, project discovery, cross-project events |
| 20 | [Resource Sharing](20-resource-sharing.md) | multi-project | Agent operators | Copying methodologies and strategies across projects |
| 21 | [Copy API Integration](21-copy-api-integration.md) | multi-project | Contributors | HTTP and MCP interfaces for resource copying |
| 22 | [Testkit: Getting Started](22-testkit-getting-started.md) | testkit | Method designers | Building and running methodology tests with the testkit |
| 23 | [Testkit Reference](23-testkit-reference.md) | testkit | Method designers | Full API reference for assertions, builders, harnesses, and providers |
| 24 | [Testkit: Migration](24-testkit-migration.md) | testkit | Contributors | Migrating existing tests to the testkit framework |
| 25 | [Testkit: Diagnostics](25-testkit-diagnostics.md) | testkit | Method designers | Compilation diagnostics, trace evaluation, and simulation |
| 26 | [Pacta: Getting Started](26-pacta-getting-started.md) | pacta | Everyone | The Pact contract, providers, createAgent, your first agent |
| 27 | [Pacta: Assembling Agents](27-pacta-assembling-agents.md) | pacta | Contributors, agent operators | Compose agents from typed parts — middleware, reasoning, context |
| 28 | [Pacta: Implementing Providers](28-pacta-providers.md) | pacta | Contributors | AgentProvider interface, capabilities, streaming, building your own |
| 29 | [Pacta: Testing with Playground](29-pacta-testing-with-playground.md) | pacta | Contributors, agent operators | RecordingProvider, VirtualToolProvider, scenarios, EvalReport |

## Guide Frontmatter Spec

Every guide uses YAML frontmatter to declare machine-readable metadata. This enables LLM agents to route to the right guide, detect staleness, and understand prerequisite chains without reading guide bodies.

```yaml
---
guide: 10                          # Guide number (matches filename prefix)
title: "Bridge Orchestration"      # Short title (no "Guide N —" prefix)
domain: bridge                     # Conceptual domain (see domains below)
audience:                          # Who should read this
  - agent-operators
summary: >-                        # One-line description for index/search
  Using the bridge MCP tools for multi-method sessions with sub-agents.
prereqs: [1, 2, 8]                 # Guide numbers that should be read first
touches:                           # Source paths this guide documents (for staleness checks)
  - packages/bridge/src/
  - packages/mcp/src/bridge-tools.ts
---
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `guide` | `number` | yes | Guide number, matches the filename `NN-*.md` prefix |
| `title` | `string` | yes | Short title without the `Guide N —` prefix |
| `domain` | `enum` | yes | Conceptual domain this guide belongs to (see below) |
| `audience` | `string[]` | yes | Target reader roles |
| `summary` | `string` | yes | One-line description, used in index tables and search |
| `prereqs` | `number[]` | no | Guide numbers that should be read before this one |
| `touches` | `string[]` | no | Source paths this guide documents — used by staleness checks to detect when the guide may need updating after code changes |

### Domains

| Domain | Scope | Guides |
|--------|-------|--------|
| `concepts` | Core theory — what methods and methodologies are | 1, 2 |
| `registry` | Method/methodology specs, compilation, discovery | 3, 4, 5, 7, 11 |
| `governance` | Project cards, councils, retros, installation | 6, 9, 12, 13 |
| `bridge` | Session server, orchestration, dashboard, prompting | 8, 10, 14, 15, 17 |
| `strategy` | Pipeline execution, triggers, context continuity | 16, 18 |
| `multi-project` | Genesis, project discovery, resource sharing | 19, 20, 21 |
| `testkit` | Test framework, assertions, diagnostics | 22, 23, 24, 25 |
| `pacta` | Modular Agent SDK — pacts, providers, composition, testing | 26, 27, 28, 29 |

### Audience Values

| Value | Who |
|-------|-----|
| `everyone` | Any reader — no prerequisites assumed |
| `method-designers` | People designing or compiling methods |
| `agent-operators` | People running or prompting methodology agents |
| `delivery-teams` | Teams using P2-SD or strategy pipelines for delivery |
| `project-leads` | People setting up or governing methodology-backed projects |
| `contributors` | Developers contributing to pv-method itself |

## Reading Paths

Choose the path that matches your role, then follow guide numbers in order. Each guide's `prereqs` field lists what to read first if you jump in mid-sequence.

- **Using the system?** 1 → 2 → 4 or 5 → 6
- **Running agents?** 1 → 2 → 8 → 10, then 15 if remote
- **Governing a project?** 1 → 2 → 6 → 12 → 13
- **Designing methods?** 1 → 2 → 3 → 7 → 11 → 22–25
- **Working with multi-project setups?** 1 → 2 → 10 → 19 → 20 → 21
- **Building strategy pipelines?** 1 → 2 → 10 → 16 → 18
- **Contributing to the bridge UI?** 10 → 14 → 17
- **Building or testing agents with Pacta?** 26 → 27 → 28 → 29
- **Just curious?** Guide 1 is self-contained — 5 minutes.

## Staleness Detection

The `touches` field in each guide's frontmatter lists the source paths the guide documents. When code changes land in those paths, the corresponding guides may need updating. To check:

```bash
# Find guides that touch files changed since a commit
git diff --name-only <commit> | while read f; do
  grep -rl "$f" docs/guides/*.md --include='*.md' -l 2>/dev/null
done | sort -u
```

Or compare `touches` paths against recent git history to flag potentially stale guides.
