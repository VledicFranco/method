---
title: FCA Advice
scope: fractal-component-architecture
contents:
  - 01-multiagent-systems.md
---

# FCA Advice

Domain-specific guidance for applying FCA in contexts where the canonical 8-part model requires non-obvious instantiation decisions. Each advice document is backed by empirical evidence, formal reasoning, or both — and names its sources.

## What belongs here

Advice documents address the question: **"I'm applying FCA to domain X — what's different?"** They are not extensions to FCA's structural model (the 8 parts, 6 levels, and 10 principles remain unchanged). They are instantiation guidance for domains where naive application of FCA produces brittle or misleading architectures.

Each document follows this structure:

1. **Domain context** — what makes this domain different from vanilla software composition
2. **What maps cleanly** — FCA parts that apply directly without special treatment
3. **What requires attention** — parts where the domain's characteristics change how instantiation works
4. **Patterns** — concrete, independently adoptable patterns with evidence
5. **Anti-patterns** — domain-specific ways FCA application goes wrong
6. **References** — empirical evidence, formal theory, production case studies

## What does NOT belong here

- Changes to FCA's 8-part model or 10 principles — those go in the canonical sections
- Generic architecture advice unrelated to FCA application
- Patterns that apply identically to passive software components — those go in `06-common-patterns.md`

## Advice Documents

| Document | Domain | Key Insight |
|----------|--------|-------------|
| [01 — Multiagent Systems](01-multiagent-systems.md) | LLM agent teams, orchestrated pipelines | FCA's 8 parts hold for agents, but Interface compliance becomes probabilistic — composition algebra shifts from set-inclusion to measure-theoretic containment |
