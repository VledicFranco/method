---
guide: 11
title: "Protocols and Method Discovery"
domain: registry
audience: [method-designers]
summary: >-
  How informal practices become formal methods through the protocol R&D pipeline.
prereqs: [1, 2, 3]
touches:
  - registry/P0-META/
---

# Guide 11 — Protocols and Method Discovery

How informal practices become formal methods. The protocol system is the method system's R&D pipeline — it's how new methods and methodologies are discovered, validated, and promoted.

## The Problem Protocols Solve

The method system has a gap: how do new methods get created?

M1-MDES (Method Design) crystallizes **established domain knowledge** into a compiled method. But what about practices that aren't established yet? Patterns that emerged from execution but haven't been validated? Ideas that might work but need testing?

You can't compile something you don't understand yet. And you can't understand it without trying it. Protocols bridge this gap.

## What is a Protocol?

A protocol is a **structured practice that hasn't been formalized into a method or methodology yet.** It has:

- A defined schema (what artifacts it produces)
- An enforcement mechanism (what must happen)
- A trial period (testing with real usage)
- Promotion criteria (measurable conditions for graduation)

What it doesn't have (and doesn't need yet):

- A formal domain theory with sorts, predicates, and axioms
- A compiled step DAG with composability proofs
- G0-G6 gate certification
- A termination certificate

A protocol is **less formal than a method but more structured than a habit.** It's the middle ground between "we should probably do X" and "X is a compiled method with 7 gates passing."

## The Protocol Lifecycle

```
Informal practice observed
    ↓
Protocol drafted (schema + enforcement + trial criteria)
    ↓ trial stage
Real usage → data collection → evidence accumulation
    ↓ promotion criteria met?
    ├── YES → Promote to method (via M1-MDES) or methodology
    ├── PARTIALLY → Refine protocol, extend trial
    └── NO → Archive with learnings (the practice didn't work)
```

### Stage 1: Draft

Someone observes a useful practice — maybe from retrospective signals, maybe from a council discussion, maybe from copying what worked in another project. They write it up as a protocol YAML:

```yaml
protocol:
  id: RETRO-PROTO
  name: "Retrospective Protocol"
  version: "0.1"
  status: draft
  maturity: draft
```

The draft defines the schema (what the practice produces), the enforcement mechanism (what's mandatory), and the promotion criteria (what evidence would justify formalizing it).

### Stage 2: Trial

The protocol is enforced on one project or methodology. Real agents use it. Data accumulates. The promotion criteria are measured:

```yaml
promotion_criteria:
  - metric: "retrospective_count"
    threshold: ">= 10"
  - metric: "evolution_triggered"
    threshold: ">= 1"
  - metric: "self_referential_test"
    threshold: ">= 1"
```

During trial, the protocol can be refined — it's a living document, not a frozen spec. Changes based on trial evidence are expected and encouraged.

### Stage 3: Promotion Decision

When the promotion criteria are met, a decision is made:

| Outcome | When | What happens |
|---------|------|-------------|
| **Promote to method** | The practice has clear steps, roles, and objectives | M1-MDES designs the method. Protocol schema becomes domain theory. Protocol steps become step DAG. G0-G6 gates verify the formalization. |
| **Promote to methodology** | The practice routes between multiple methods | The practice becomes Φ = (D_Φ, δ_Φ, O_Φ). Its transition function is formalized. |
| **Promote to universal requirement** | The practice should apply to all methodologies | An axiom (like Ax-RETRO) is added to every methodology's domain theory. |
| **Keep as protocol** | Formalization would add overhead without value | The protocol remains a protocol — structured but not compiled. Not everything needs to be a method. |
| **Archive** | Trial showed the practice doesn't work | Document the evidence and archive. Failed experiments are valuable data. |

## Example: RETRO-PROTO

The Retrospective Protocol is the first protocol to complete the full lifecycle:

| Stage | What happened | Evidence |
|-------|-------------|---------|
| **Draft** | Designed during council session. Schema defined: hardest_decision, observations, card_feedback, proposed_deltas. | Council convergence |
| **Trial** | Enforced on P2-SD. 11 retros collected across 2 projects in one day. | 4 gap candidates, 2 evolutions |
| **Promotion** | All 5 criteria met including self-referential test (protocol improved M3-PHRV through its own mechanism). | eval-all-sessions-20260314.yaml |
| **Result** | Promoted to universal requirement. Ax-RETRO added to P1-EXEC and P2-SD. | RETRO-PROTO-PROMOTION.yaml |

RETRO-PROTO was NOT promoted to a method or methodology. It was promoted to a **universal axiom** — the lightest possible formalization that still provides structural enforcement. It doesn't need a step DAG or domain theory — it needs one axiom (Ax-RETRO) and one artifact schema (the retro YAML).

## Example: STEER-PROTO

The Steering Protocol (drafted, not yet trialed) is the second protocol in the system:

| Stage | Status |
|-------|--------|
| **Draft** | Complete — 7 components defined (artifacts, session structure, essence guardianship, autonomy agreement, comms, member evolution, retro integration) |
| **Trial** | Not yet started — needs a project to trial it (pv-agi is the natural candidate, since it already has a steering council) |
| **Promotion** | Unknown — might become a methodology (P4-STEER), might stay as a protocol, might become a universal requirement |

## Protocols as the Discovery Mechanism

Here's the key insight: **protocols are how the method system discovers what it's missing.**

P0-META has arm 7 in δ_META for method discovery (M2-MDIS). M2-MDIS is now compiled (v1.0, all G0-G6 gates PASS) — it formalizes the protocol lifecycle that was already working informally. The protocol system validated the discovery pattern empirically (RETRO-PROTO, STEER-PROTO), and that evidence enabled M2-MDIS to be compiled as a proper method with domain theory, step DAG, and full compilation gates.

```
Informal practice observed in execution
    ↓ M2-MDIS sigma_0: recognize and validate the observation
Protocol drafted (schema + enforcement + trial criteria)
    ↓ M2-MDIS sigma_1-2: draft and trial
Trial produces evidence
    ↓ M2-MDIS sigma_3: evaluate against promotion criteria
    ↓ M2-MDIS sigma_4: promote (compile to method, axiom, or archive)
Compiled method enters the registry
    ↓ δ_META can now route to it
```

The protocol lifecycle IS the method discovery process, and M2-MDIS is its compiled formalization. Every protocol that gets promoted to a method is a successful M2-MDIS execution. The system is self-bootstrapping: the protocol mechanism validated the discovery pattern, which then enabled M2-MDIS itself to be compiled.

## When to Write a Protocol

Write a protocol when you observe a practice that:

1. **Recurs across sessions** — you keep doing the same thing, suggesting it's structurally useful
2. **Produces artifacts** — there's a concrete output that other processes consume
3. **Could be enforced** — there's a meaningful "must do" that improves outcomes when followed
4. **Isn't already a method** — check the registry first. If M3-PHRV already covers your practice, use it

Don't write a protocol for:

- A one-off procedure (just do it)
- A preference (put it in the project card as a delivery rule)
- Something that's already well-understood enough to compile directly (use M1-MDES)

## Protocol vs Delivery Rule vs Method

| Mechanism | Formality | Scope | Enforcement | Evolution |
|-----------|----------|-------|-------------|-----------|
| **Delivery rule** (in project card) | Prose | One project | Agent reads and follows | Card revision by project lead |
| **Protocol** | Schema + enforcement axiom | Universal (all projects) | Axiom in methodology domain theory | Trial → promotion |
| **Method** | Full 5-tuple, G0-G6 compiled | Universal | Step DAG with pre/post conditions | M3-MEVO |
| **Methodology** | Full 3-tuple, transition function | Universal | δ_Φ routing | M3-MEVO |

Delivery rules are project-specific and lightweight. Protocols are universal but not fully formal. Methods and methodologies are universal and fully formal. The pipeline flows left to right: a recurring delivery rule across projects might become a protocol; a validated protocol might become a method.

## Where Protocols Live

```
registry/P0-META/
  RETROSPECTIVE-PROTOCOL.yaml    ← promoted (universal axiom)
  STEERING-PROTOCOL.yaml         ← draft (awaiting trial)
  COUNCIL-MEMORY-PROTOCOL.yaml   ← draft v0.1 (persistent cross-session context for M1-COUNCIL)
  RETRO-ARTIFACTS.yaml           ← companion spec for RETRO-PROTO
  RETRO-PROTO-PROMOTION.yaml     ← promotion proposal (approved)
```

Protocols live in P0-META because they are part of the meta-method system — they govern how the method system itself evolves.

## The Self-Bootstrapping Property

The method system has a beautiful self-referential property:

1. **P0-META** governs method creation — but P0-META was created using M1-MDES (self-application)
2. **RETRO-PROTO** governs self-improvement — and improved itself through its own mechanism (self-referential test)
3. **Protocols** are the discovery mechanism for methods — and the protocol concept itself was discovered through practice (not designed from theory)

Each layer of the system was bootstrapped from the layer below it. Protocols are the latest bootstrap: they formalize the informal process by which formal methods are discovered.

This guide will evolve as more protocols complete the lifecycle and the discovery mechanism matures.
