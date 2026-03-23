---
guide: 13
title: "Installation and the .method/ Directory"
domain: governance
audience: [project-leads]
summary: >-
  The .method/ directory structure, manifest, installation specs, committed vs ephemeral artifacts.
prereqs: [1, 2, 6]
touches:
  - .method/
  - .method/manifest.yaml
---

# Guide 13 — Installation and the .method/ Directory

Every project that adopts the method system gets a `.method/` directory. This is the home for methodology execution artifacts — project cards, retrospectives, council state, delivery logs. It sits alongside your source code and `docs/`, but serves a different purpose: `docs/` holds human knowledge (architecture specs, PRDs, RFCs), while `.method/` holds methodology runtime state.

Think of it like `.git/` or `.github/` — a project-level configuration directory that tooling reads and writes. The difference is that most of `.method/` is human-readable YAML, and some of it is committed to version control while some is ephemeral.

## What is .method/?

The `.method/` directory contains everything the method system needs to operate on your project:

- **Project card** — your project's identity, constraints, and delivery rules
- **Manifest** — what methodologies and protocols are installed
- **Retrospectives** — structured feedback from every methodology session
- **Council artifacts** — steering council state (if you use governance)
- **Delivery artifacts** — phase docs, session logs, reviews, audit reports
- **Strategies** — strategy YAML files for the event trigger system (see bridge configuration)

Without `.method/`, agents fall back to abstract methodology guidance with no project-specific constraints. The directory is what makes a methodology *yours*.

## The Manifest

The manifest (`.method/manifest.yaml`) is the source of truth for what's installed. It lists every methodology and protocol active on the project, their versions, and what artifacts they contribute.

```yaml
manifest:
  project: pv-method
  last_updated: "2026-03-14"

  installed:
    - id: P2-SD
      type: methodology
      version: "2.0"
      card: project-card.yaml
      card_version: "1.3"
      instance_id: I2-METHOD
      artifacts:
        - project-card.yaml
        - CHANGELOG.yaml
        - delivery/phases/
        - delivery/sessions/
        - delivery/reviews/
        - delivery/audits/

    - id: P1-EXEC
      type: methodology
      version: "1.1"
      note: "Execution substrate — routes challenges to COUNCIL/ORCH/TMP"
      artifacts: []

    - id: RETRO-PROTO
      type: protocol
      version: "1.0"
      status: promoted
      artifacts:
        - retros/

    - id: STEER-PROTO
      type: protocol
      version: "0.1"
      status: draft
      artifacts:
        - council/TEAM.yaml
        - council/AGENDA.yaml
        - council/LOG.yaml
        - council/inbox/
        - council/outbox/
        - council/sub-councils/

    - id: CMEM-PROTO
      type: protocol
      version: "0.1"
      status: draft
      extends: M1-COUNCIL
      artifacts:
        - council/memory/
        - council/memory/INDEX.yaml
```

Each entry has:

| Field | Purpose |
|-------|---------|
| `id` | Registry identifier (e.g., P2-SD, RETRO-PROTO) |
| `type` | `methodology` or `protocol` |
| `version` | Version of the methodology/protocol installed |
| `card` | Path to the project card (methodologies only) |
| `instance_id` | Instance identifier from the project card |
| `artifacts` | Files and directories this entry contributes to `.method/` |
| `status` | Protocol maturity stage (protocols only) |

The manifest is committed to git. When you install or remove a methodology or protocol, update the manifest.

## Installation Specs

Every methodology and protocol in the registry declares an `installation` section that lists the artifacts it needs in `.method/`. This is the contract: if you install this methodology, create these directories and files.

**P2-SD** requires delivery directories:

| Artifact | Type | Committed? | Purpose |
|----------|------|-----------|---------|
| `delivery/phases/` | directory | no | PhaseDoc files from M5-PLAN |
| `delivery/sessions/` | directory | no | Session logs from M1-IMPL/M2-DIMPL |
| `delivery/reviews/` | directory | yes | Review reports from M3-PHRV |
| `delivery/audits/` | directory | no | Drift reports from M4-DDAG |

**RETRO-PROTO** requires one directory:

| Artifact | Type | Committed? | Purpose |
|----------|------|-----------|---------|
| `retros/` | directory | yes | One YAML per method execution per session |

**STEER-PROTO** requires council artifacts:

| Artifact | Type | Committed? | Human input? | Purpose |
|----------|------|-----------|-------------|---------|
| `council/TEAM.yaml` | file | yes | yes | Persistent council member definitions |
| `council/AGENDA.yaml` | file | yes | yes | Forward-looking work items |
| `council/LOG.yaml` | file | yes | no | Append-only session decision record |
| `council/inbox/` | directory | yes | no | Messages from other project councils |
| `council/outbox/` | directory | yes | no | Messages to other project councils |
| `council/sub-councils/` | directory | yes | no | Artifacts from spawned sub-council sessions |

The "human input needed" column matters: TEAM.yaml and AGENDA.yaml require you to define council members and initial priorities. LOG.yaml starts empty and is populated by sessions.

**CMEM-PROTO** (Council Memory Protocol) adds persistent cross-session character memory, extending M1-COUNCIL:

| Artifact | Type | Committed? | Human input? | Purpose |
|----------|------|-----------|-------------|---------|
| `council/memory/` | directory | yes | no | Persistent character memory store |
| `council/memory/INDEX.yaml` | file | yes | no | Memory index and retrieval metadata |

## How to Adopt a Methodology

Step by step, here's how to install the method system on a new project.

### Step 1: Create the .method/ directory

```
mkdir .method
```

### Step 2: Write the project card

This is the main work. The project card declares your project's identity, tech stack, delivery rules, and role-specific guidance. See [Guide 6](06-project-cards.md) for the full walkthrough.

```yaml
# .method/project-card.yaml
project_card:
  id: I3-MYAPP
  project: my-app
  methodology: P2-SD
  methodology_version: "2.0"

  essence:
    purpose: "What this project is and why it exists"
    invariant: "The one thing that must never be violated"
    optimize_for:
      - "Priority 1: what matters most"

  context:
    language: "TypeScript 5.7"
    build_command: "npm run build"
    test_command: "npm test"

  delivery_rules:
    - id: DR-01
      rule: "Your first project-specific constraint"
      applies_to: [M1-IMPL]
```

The card IS the methodology instance. It parameterizes the abstract methodology for your specific project.

### Step 3: Create artifact directories

Based on what you're installing, create the required directories. For P2-SD + RETRO-PROTO (the common setup):

```
mkdir -p .method/delivery/phases
mkdir -p .method/delivery/sessions
mkdir -p .method/delivery/reviews
mkdir -p .method/delivery/audits
mkdir -p .method/retros
```

Add `.gitkeep` files to empty directories you want tracked:

```
touch .method/delivery/phases/.gitkeep
touch .method/delivery/sessions/.gitkeep
touch .method/delivery/reviews/.gitkeep
touch .method/delivery/audits/.gitkeep
```

### Step 4: Write the manifest

List everything you installed:

```yaml
# .method/manifest.yaml
manifest:
  project: my-app
  last_updated: "2026-03-14"

  installed:
    - id: P2-SD
      type: methodology
      version: "2.0"
      card: project-card.yaml
      instance_id: I3-MYAPP
      artifacts:
        - project-card.yaml
        - delivery/phases/
        - delivery/sessions/
        - delivery/reviews/
        - delivery/audits/

    - id: RETRO-PROTO
      type: protocol
      version: "1.0"
      status: promoted
      artifacts:
        - retros/
```

### Step 5: Configure .gitignore

Add entries for ephemeral artifacts:

```gitignore
# Methodology execution ephemera
.method/delivery/sessions/
.method/delivery/phases/
.method/delivery/audits/
```

Do **not** ignore `.method/retros/`, `.method/delivery/reviews/`, or `.method/council/` — those are evidence.

### Step 6: Reference from CLAUDE.md

Add a line to your project's CLAUDE.md so agents discover the card:

```
This project uses P2-SD methodology. Project card at .method/project-card.yaml.
```

## Committed vs Ephemeral

Not everything in `.method/` belongs in version control. The rule is simple: **evidence is committed, scratch work is ignored**.

| Artifact | Committed? | Why |
|----------|-----------|-----|
| `project-card.yaml` | Yes | Versioned configuration — the project's methodology identity |
| `manifest.yaml` | Yes | Tracks what's installed — changes are reviewed like config changes |
| `genesis-cursors.yaml` | Yes | Session genesis tracking |
| `retros/` | Yes | Evidence base for card and method evolution |
| `delivery/reviews/` | Yes | Review reports are evidence for quality tracking |
| `council/` (all files) | Yes | Governance state — continuity depends on persistence |
| `delivery/sessions/` | No | Per-agent scratch logs — disposable after the session |
| `delivery/phases/` | No | PhaseDoc files — regenerated per planning session |
| `delivery/audits/` | No | Drift reports — ephemeral unless the team wants persistent records |

The logic: retrospectives, reviews, and council decisions are the feedback loops that drive methodology evolution. If you delete them, you lose the evidence that tells you what's working and what isn't. Session logs and phase docs are working documents — they serve their purpose during execution and don't need to survive.

## Example: pv-method's .method/

Here is what pv-method's `.method/` directory looks like in practice:

```
.method/
  project-card.yaml          ← I2-METHOD, P2-SD v2.0, 14 delivery rules
  manifest.yaml              ← P2-SD + P1-EXEC + RETRO-PROTO + STEER-PROTO + CMEM-PROTO
  genesis-cursors.yaml       ← session genesis tracking
  strategies/                ← strategy YAML files for the event trigger system
  retros/
    retro-2026-03-14-001.yaml
    retro-2026-03-14-002.yaml
    retro-2026-03-14-003.yaml
    retro-meta-20260314.yaml
    retro-prd002-impl.yaml
    retro-prd003-p1-m1-impl.yaml
    ...                      ← 15+ retros accumulated
  council/
    TEAM.yaml                ← 5 persistent council members
    AGENDA.yaml              ← prioritized work items (P0/P1/P2)
    LOG.yaml                 ← append-only session decisions
    pending-deltas.yaml      ← proposed methodology deltas
    logs/                    ← individual session log files
    memory/                  ← persistent cross-session character memory (CMEM-PROTO)
    memory/INDEX.yaml        ← memory index
    rfcs/                    ← request-for-comment documents
    sub-councils/            ← specialist sub-council artifacts
    theory-council/          ← theory-focused sub-council artifacts
  delivery/
    phases/                  ← gitignored — ephemeral
    sessions/                ← gitignored — ephemeral
    reviews/                 ← committed — evidence
    audits/                  ← gitignored — ephemeral
```

The manifest declares five installed entries: P2-SD and P1-EXEC as methodologies, RETRO-PROTO, STEER-PROTO, and CMEM-PROTO as protocols. The retros directory has accumulated 15+ retrospective files from real methodology sessions — each one is structured YAML with observations, severity ratings, and improvement targets. The council directory has a standing 5-member team that meets weekly to steer priorities.

## How Installation Relates to the Project Card

The project card and the manifest serve different roles:

- The **project card** is the methodology instance — it declares your project's essence, constraints, and delivery rules. It's what makes P2-SD behave differently on your project than on any other project.
- The **manifest** is the installation record — it tracks what's installed, at what version, producing what artifacts.

The card *IS* the methodology. The manifest *describes* the installation. When an agent starts a session, it reads the card for constraints and guidance. It reads the manifest to understand the full installation landscape.

The card's `methodology` and `methodology_version` fields must match a manifest entry. If the card says `P2-SD v2.0` but the manifest says `P2-SD v1.0`, something is out of sync.

## Getting Started Checklist

For a new project adopting the method system:

- [ ] Create `.method/` directory
- [ ] Write `project-card.yaml` (see [Guide 6](06-project-cards.md))
- [ ] Create artifact directories per the installation specs above
- [ ] Write `manifest.yaml` listing installed methodologies and protocols
- [ ] Add `.gitkeep` files to empty directories that should be tracked
- [ ] Add ephemeral paths to `.gitignore`
- [ ] Add card reference to your project's CLAUDE.md
- [ ] (Optional) Set up STEER-PROTO: define TEAM.yaml and AGENDA.yaml
- [ ] Commit the `.method/` directory

After this, agents working on your project will discover the card, load your delivery rules, and produce retrospectives that accumulate in `.method/retros/`.

---

This guide will evolve as more projects adopt the method system and as new protocols add installation requirements.
