---
title: Fractal Component Architecture (FCA)
scope: methodology
contents:
  - 01-the-component.md
  - 02-the-levels.md
  - 03-layers-and-domains.md
  - 04-functional-programming.md
  - 05-principles.md
  - 06-common-patterns.md
  - 07-applied-example.md
  - advice/
---

# Fractal Component Architecture (FCA)

A design methodology for complex systems based on a single structural pattern — the **component** — that repeats at every scale of software, from a pure function to a network of organizations.

## Core Thesis

Software at every scale is made of the same thing: bounded units that expose an interface, hide an architecture, accept dependencies through ports, and carry their own documentation. A pure function does this. A module does this. A package does this. A service does this. A platform does this.

Most design methodologies target one scale — microservices for the network layer, clean architecture for the application layer, SOLID for the class layer. FCA recognizes that these are all instances of the same pattern and names it once: the **component**. By applying component discipline at every level, each level reinforces the next. Pure functions make modules testable. Testable modules make packages composable. Composable packages make services reliable.

The key insight: **the discipline that open-source library authors apply — clear contracts, backwards compatibility, independent testing, provider patterns for external dependencies — is not a package-level practice. It is a universal structural discipline that applies fractally.** The reason most codebases rot is that they apply this discipline at one level (usually the package or service level) and skip it at every other level. FCA removes that inconsistency.

## Sections

| Section | Summary |
|---------|---------|
| [01 — The Component](01-the-component.md) | The eight structural parts: Interface, Boundary, Port, Domain, Architecture, Verification, Observability, Documentation |
| [02 — The Levels](02-the-levels.md) | L0 (Function) through L5 (System) — how each part manifests at every scale, the recursion, promotion and demotion |
| [03 — Layers and Domains](03-layers-and-domains.md) | The two decomposition axes — layers create components, domains create directories |
| [04 — Functional Programming](04-functional-programming.md) | Why purity at L0 matters, Effect systems as FCA at the function level |
| [05 — Principles](05-principles.md) | 10 concrete rules: interface discipline, ports, verification, co-location, observability, progressive disclosure |
| [06 — Common Patterns](06-common-patterns.md) | Port patterns, verification patterns, observability patterns, configuration patterns, documentation patterns, technology picks by level |
| [07 — Applied Example](07-applied-example.md) | Task management platform — the fractal demonstrated from L0 through L5 with concrete code |
| [Advice](advice/) | Domain-specific instantiation guidance — where naive FCA application requires attention |

## When to Apply

FCA adds overhead. It is not worth the cost for:
- Prototypes and experiments (build the monolith, extract components when boundaries stabilize)
- Single-use scripts and tools
- Projects with a single developer who will never hand off the code

It is worth the cost when:
- Multiple consumers will compose the same logic differently
- The system will be maintained across many sessions by agents or humans without full context
- Verification speed matters — independent component tests are faster than integration tests
- The team practices parallel development — component boundaries are natural parallelization seams
- You want to reason about backwards compatibility and migration paths
