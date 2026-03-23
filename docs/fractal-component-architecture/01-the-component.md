---
title: The Component
scope: section
---

# The Component

A **component** is the fundamental unit of FCA. It is the self-similar motif that repeats at every scale. Every component, regardless of its level, has exactly eight structural parts:

| Part | What it is | Faces |
|------|-----------|-------|
| **Interface** | What consumers interact with. Hides complexity. Defines a contract. | Outward |
| **Boundary** | What the component cannot see through. Enforces encapsulation. | Outward |
| **Port** | Where external dependencies are injected through the boundary. | Outward |
| **Domain** | What the component is about. Concepts that cohere ontologically. | Inward |
| **Architecture** | How the component self-organizes its domain internally. | Inward |
| **Verification** | How the component is proven correct in isolation. | Both |
| **Observability** | What the component is doing right now and what it has done. | Both |
| **Documentation** | Co-located explanation of the component, at the same level. | Both |

Three parts face outward (how the world sees the component), two face inward (how the component organizes itself), and three span both directions (they serve internal integrity and external confidence).

Observability is distinct from both verification and documentation. Verification is **active** — you run it to prove correctness. Documentation is **static** — it explains intent and design. Observability is **passive and continuous** — it emits while the component operates, revealing behavior, performance, and opportunities that neither tests nor docs can capture.

A component is well-formed when:
- Its **interface** is the only way consumers interact with it.
- Its **boundary** prevents consumers from reaching into its architecture.
- Its **ports** are the only way external dependencies enter.
- Its **domain** is ontologically coherent — everything inside describes the same part of the world.
- Its **architecture** is invisible to consumers — it can be reorganized without changing the interface.
- Its **verification** runs in isolation — no other component needs to be running.
- Its **observability** emits structured signals without requiring the observer to understand the architecture.
- Its **documentation** is self-contained — no external file is needed to understand it.
