---
guide: 6
title: "Project Cards and Instantiation"
domain: governance
audience: [project-leads]
summary: >-
  How to write a project card to parameterize a methodology for your project.
prereqs: [1, 2]
touches:
  - .method/project-card.yaml
---

# Guide 6 — Project Cards & Instantiation

Abstract methodologies like P2-SD define universal processes. Your project has specific constraints: tech stack, tool protocols, governance rules, code conventions. A **project card** bridges the gap.

## What is a Project Card?

A YAML file in your project repo that declares what's specific to your project. A mature card is typically 200-300 lines (pv-method's is ~283). No formal theory required — just project knowledge.

```yaml
project_card:
  id: I2-METHOD
  project: pv-method
  methodology: P2-SD
  methodology_version: "2.0"

  context:
    language: "TypeScript 5.7"
    build_command: "npm run build"
    test_command: "npm test"

  delivery_rules:
    - id: DR-01
      rule: "Registry YAML files are production artifacts — preserve compilation status"
      applies_to: [M1-IMPL, M2-DIMPL]
    - id: DR-03
      rule: "Core package has zero transport dependencies"
      applies_to: [M1-IMPL, M2-DIMPL]

  role_notes:
    impl_sub_agent:
      note: "Two artifact types: TypeScript source and methodology YAML. Both need care."
```

That's it. The card tells the agent: "When running P2-SD methods on this project, also enforce these constraints."

## Where to Put It

```
your-project/
  .method/
    project-card.yaml     ← primary location
```

- Lives in the **project repo**, not in the method registry
- Committed to git (versioned configuration, not ephemeral)
- Your CLAUDE.md should reference it: "Project card at .method/project-card.yaml"

If your project uses multiple methodologies:
```
.method/
  project-card-P2-SD.yaml
  project-card-P1-EXEC.yaml
```

## How to Write One

### 1. Identity

Name your project and bind it to a methodology:

```yaml
project_card:
  id: I1-T1X               # Instance ID
  project: t1-cortex        # Project name
  methodology: P2-SD        # Which methodology
  methodology_version: "2.0" # Which version
```

### 2. Context

Declare your tech stack. These values propagate to every method that touches code:

```yaml
  context:
    language: "Scala 3"
    build_command: "sbt compile"
    test_command: "sbt test"
    language_server: "Metals"
    language_server_protocol: "MCP"
```

### 3. Delivery Rules

The core of the card. Each rule is a prose constraint that names which methods and roles it affects:

```yaml
  delivery_rules:
    - id: DR-01
      rule: "All symbol navigation must use Metals MCP, not text search"
      applies_to: [M1-IMPL, M2-DIMPL]
      affects_roles: [impl_sub_agent]
      protocol: metals_mcp_mandatory

    - id: DR-05
      rule: "QA must produce independent findings before seeing impl self-review"
      applies_to: [M2-DIMPL]
      affects_roles: [qa_sub_agent]
      protocol: structural_dissent
```

**Tips for writing good rules:**
- Be specific: "Use Metals MCP for symbol navigation" not "Use appropriate tools"
- Name the methods it applies to — a rule that applies to everything usually applies to nothing
- Name the roles it affects — this helps the agent know when to apply it
- If the rule requires a specific artifact (worksheet, checklist), name it
- If the rule is conditional (every 3 phases), add a trigger

### 4. Essence

The project's identity — purpose, invariant, and optimization priorities. The steering council guards these:

```yaml
  essence:
    purpose: "What this project is and why it exists"
    invariant: "The one thing that must never be violated"
    optimize_for:
      - "Priority 1 > Priority 2 > Priority 3"
```

The essence is checked before every council decision (see [Guide 12](12-steering-council.md)).

### 5. Governance

How autonomy and oversight work for this project:

```yaml
  governance:
    autonomy: M2-SEMIAUTO
    session_cadence: "weekly or on-demand"
    veto_authority: product_owner
    max_autonomous_decisions: 3
    essence_escalation: always
    council_path: ".method/council/"
```

Three autonomy modes: INTERACTIVE (human confirms everything), SEMIAUTO (council decides clear cases, escalates ambiguity), FULLAUTO (council decides everything within budget).

### 6. Architecture & Source Layout

Where docs and code live. Helps agents navigate your project:

```yaml
  architecture:
    docs_root: "docs/"
    architecture_path: "docs/arch/"
    prd_path: "docs/prds/"

  source_layout:
    monorepo: true
    packages:
      - name: "@method/core"
        path: "packages/core/"
        status: deprecated
        purpose: "DEPRECATED — legacy YAML loader, replaced by MethodologySource port"
      - name: "@method/mcp"
        path: "packages/mcp/"
        purpose: "MCP server — wires core to tools"
```

> **Deprecation note:** `@method/core` is deprecated for methodology data loading.
> Methodology operations now go through the `MethodologySource` port backed by `StdlibSource`
> (wrapping the `@method/methodts` stdlib catalog). New project cards should reference the
> port pattern instead. See `docs/arch/methodology-source.md` for the architecture.

### 7. Card Version

Tracks the card's own version, independent of the methodology version:

```yaml
  card_version: "1.4"
```

Bump this when you add delivery rules, update essence, or change governance settings. The manifest may reference this version.

### 8. Role Notes

Per-role guidance for your project. Supplements the abstract method's role description:

```yaml
  role_notes:
    orchestrator:
      default_mode: true
      note: "Source Verification Worksheet required before dispatch."
    reviewer:
      note: "Structural dissent protocol — independent assessment first."
```

## How the Agent Uses It

At session start:

1. Agent reads CLAUDE.md → discovers card path
2. Agent reads the card → loads context, delivery_rules, role_notes
3. Agent identifies which method is being run (e.g., M1-IMPL)
4. Agent filters delivery_rules to `applies_to: [M1-IMPL]`
5. Agent applies matching role_notes for its current role
6. Agent executes: **abstract method guidance + card constraints**

Card constraints are **additive** — they supplement the abstract method, not replace it. If a card rule conflicts with the abstract method, the card rule takes precedence (project-specific overrides general).

## How It Evolves

The card and the methodology evolve independently:

**Project changes build tool:**
```yaml
  # Before
  build_command: "sbt compile"
  # After
  build_command: "mill compile"
```
Every method that references compilation picks up the change. No methodology change needed.

**Methodology adds a new method:**
P2-SD v3.0 adds M8-PERF (performance testing). Your card is unchanged — M8-PERF gets default behavior. When you want project-specific constraints for it, add delivery rules with `applies_to: [M8-PERF]`.

**New project adopts the methodology:**
Copy the card template, fill in your project's details. The abstract methodology is unchanged. The new card starts small and grows as the project matures — not ~500 lines of handwritten role files.

## Instance Tracking

The method registry tracks which projects have instantiated which methodologies:

```
registry/instances/
  I1-T1X.yaml      ← t1-cortex, P2-SD v2.0, 20 rules, active
  I2-METHOD.yaml    ← pv-method, P2-SD v2.0, 14 rules, active
```

Each entry records: project, methodology, version, card location, status. Status lifecycle:

- **active** — card and methodology are in sync
- **stale** — methodology upgraded, instance not regenerated
- **migrating** — card being updated for new methodology version
- **retired** — project no longer uses this methodology

The agent checks at session start: if card.methodology_version doesn't match the current methodology version, it warns about staleness.

## What the Card Doesn't Do

- **Runtime execution decisions** — P1-EXEC's delta_EXEC still picks COUNCIL/ORCH/TMP at runtime. The card doesn't influence this.
- **Method design** — the card parameterizes methods, not designs them. M1-MDES designs methods.
- **Formal domain extensions** — the card's delivery rules are prose. M4-MINS can derive formal extensions (sorts, predicates, axioms) from the rules, but this derivation isn't automated yet.

## Next

[Guide 7](07-compilation-gates.md) explains the 7 compilation gates that every method must pass — what each checks and how to fix failures.
