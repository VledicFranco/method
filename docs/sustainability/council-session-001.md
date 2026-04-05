# Council Session 001 — Autonomous Business for Method Sustainability

```yaml
type: council-decision
topic: "Autonomous micro-businesses to fund Method development"
date: "2026-04-05"
cast: [Mercado, Corteza, Centavo, Protocolo, Norma, Semilla, Interfaz, Voz]
surface_advocate: "Interfaz"
ports_identified: []
```

## Problem Statement

Design autonomous micro-businesses powered by the Method system that generate enough
recurring revenue to cover: (1) Claude API credits for development and research,
(2) hardware for SLM training, and (3) surplus for expanding research capacity.

**Constraints:**
- Operator: Franco, Puebla Mexico, Persona Fisica con Actividades Empresariales (RESICO)
- Dependencies on Method must be transitive or decoupled — businesses stand alone
- Validate fast — prioritize speed to first revenue
- Minimize operational burden — businesses should run with minimal human intervention

## Decision: SAT Compliance Bot as Primary Business

**Working title: "DeclaraSAT"**

A monthly declaration autopilot for Mexican freelancers (personas fisicas). Reads bank
statements, auto-classifies transactions, computes ISR/IVA obligations, and delivers a
pre-filled summary for the user's contador to review and file. WhatsApp-first communication.

### Why This Business

| Factor | Assessment |
|--------|------------|
| Market size | 13M+ personas fisicas in Mexico, recurring monthly pain |
| Unit economics | 97% gross margin at $399 MXN/month (~$20 USD) |
| Distribution | Contador referral network — Franco has a partner, zero CAC |
| Operational risk | Monthly cadence (not real-time), contador = human safety net |
| Regulatory | Informational service, not tax advice — clean under LFPDPPP |
| Method coupling | **Zero** — standalone product, Method is the workshop not a component |
| Flywheel | Transaction data → classification SLM → lower costs + sellable model |
| Validation speed | 4-6 weeks to MVP with PDF upload approach |

### Arguments Against (Acknowledged)

- **Slower to validate than pure digital products** — requires tax logic, CFDI awareness, privacy notice
- **16% IVA on domestic sales** — reduces effective revenue vs. export businesses
- **Contador channel dependency** — initial growth hinges on one partner's network
- **Existing competitors** — Heru, Enconta, ContaFácil, Konta exist, but they're general accounting platforms, not focused on the monthly declaration workflow

### MVP Scope (v1)

1. **PDF bank statement upload** — no Belvo/open banking API in v1 (simpler, fewer regulatory deps)
2. **Transaction extraction + classification** — Haiku via batch API, confidence thresholds (< 85% flagged for review)
3. **Monthly ISR/IVA pre-calculation** — deterministic tax math for RESICO and Regimen 612
4. **WhatsApp summary delivery** — reminder on the 10th, summary with classification breakdown
5. **CFDI-compatible export** — format the contador can use directly
6. **Privacy notice + terms of service** — LFPDPPP compliance, "not tax advice" disclaimer

### What v1 Is NOT

- Does not file with SAT directly
- Does not replace the contador
- Does not connect to bank APIs (PDF upload only)
- Does not handle payroll or employee obligations

### Unit Economics

| Component | Cost/user/month |
|-----------|----------------|
| Transaction classification (Haiku batch, ~200 txns) | ~$0.03 |
| Summary generation (Sonnet, 1 call) | ~$0.02 |
| WhatsApp Business API (1-2 msgs) | ~$0.05 |
| CFDI via PAC (Facturama/SW) | ~$0.50 |
| **Total variable cost** | **~$0.60** |
| **Revenue** (399 MXN ≈ $20 USD, net of 16% IVA) | **~$17.24** |
| **Gross margin** | **~97%** |

### Revenue Targets

| Milestone | Users | Monthly Revenue (USD) | Timeline |
|-----------|-------|-----------------------|----------|
| API credits covered | 25 | ~$430 | Month 2-3 |
| Comfortable + savings | 50 | ~$860 | Month 4-6 |
| Hardware fund | 150 | ~$2,590 | Month 8-12 |
| RESICO ceiling (~3.5M MXN/yr) | ~14,500 | ~$250K/yr | Transition trigger |

### Distribution Strategy

| Phase | Timeline | Channel | Target Users |
|-------|----------|---------|-------------|
| Seed | Month 1-2 | Franco's contador partner refers clients | 15-25 |
| Expand | Month 2-4 | Partner introduces 2-3 more contadores, 20% referral commission | 50-100 |
| Organic | Month 4-8 | Spanish content marketing (blog, TikTok/YT Shorts) on "declaraciones SAT" keywords | 100-300 |
| Verticals | Month 8+ | Platform integrations (Mercado Libre sellers, rideshare drivers) | 300+ |

### Contador Partnership Structure

- **Model:** Referral commission (contrato de comision mercantil)
- **Terms:** 20% of subscription revenue for first 3 months per referred client
- **Why not equity:** Preserves RESICO eligibility (no society/partnership restrictions)
- **Value to contador:** Clients' books arrive pre-organized, reduces their workload

### Regulatory Requirements (Day 1)

1. **Aviso de privacidad** — LFPDPPP-compliant privacy notice before collecting any financial data
2. **Disclaimer** — "Este servicio no constituye asesoria fiscal. Consulte a su contador."
3. **CFDI issuance** — Monthly invoice to each customer via PAC
4. **SAT compliance** — Franco's own monthly declarations (dog-fooding the product)
5. **Data handling** — Explicit consent for bank statement processing, data minimization, secure storage

### Flywheel Effects

```
Operate SAT bot → collect labeled transaction data
  → train classification SLM (replaces Haiku calls)
    → API cost drops to ~$0/user/month
      → margin approaches 100%
        → fund more research
          → better SLMs
            → sellable models (Rail 1 activates)
```

**SLM activation trigger:** After ~1,000 users generating ~200K+ labeled transactions,
train a 0.5B Mexican business transaction classifier on the RTX 4090. Estimated training
time: 2-4 hours. Replaces Haiku batch calls entirely.

## Killed Proposals (with reasoning)

| Proposal | Reason Killed | Phase 2 Potential |
|----------|--------------|-------------------|
| Methodology MCP Server | Direct coupling to Method internals | Yes — when Method is public |
| Strategy Templates Marketplace | Customers need Method to use product | Yes — when Method is public |
| Method Studio Bundle | 4+ surfaces, direct coupling | Yes — derivative of public Method |
| Certification Badge | Requires Method adoption | Yes — after ecosystem exists |
| Agent Dojo | Direct coupling, sandbox complexity | Yes — after cognitive arch matures |
| Dependency Audit | Commodity (Dependabot, Snyk free tiers) | No — market is saturated |
| Contract Review (Mexico) | Slow validation, legal accuracy hard to verify | Yes — after SAT bot proves Mexico channel |

## Deferred: Rail 1 (SLM Packs + Async Code Review)

### SLM Packs — Demand Validation Result

**Online research (April 2026) concluded: the broad market does not yet exist.**

- No functioning LLM model marketplace (CivitAI equivalent doesn't exist for LLMs)
- Developer culture is DIY — fine-tuning tools (Unsloth, Axolotl) are too easy
- Hobbyist market expects free; enterprise has willingness to pay but longer sales cycles
- Open-source base models keep improving at zero-shot, eroding fine-tune delta
- Only defensible niche: runtime-specific SLMs (Method cognitive modules) — zero competition but requires Method adoption first

**Decision:** SLM packs do not launch independently. They activate via one of two paths:
1. **Method goes public** → sell cognitive module SLMs to Method users
2. **SAT bot flywheel** → Mexican transaction classifier becomes a sellable model on HuggingFace

### Async Code Review — Deprioritized

Viable product but lacks a distribution channel comparable to the contador network.
Revisit after establishing developer audience through blog/content presence.

## Surface Implications (from Surface Advocate)

- **New ports needed inside Method:** Zero
- **Existing ports modified:** None
- **Entity types affected:** None
- **Co-design sessions needed:** None

**Architecture:**
```
Method (development infrastructure)
  └── spawns agents that build/maintain the SAT bot
  └── strategy pipelines for testing, deployment, monitoring

SAT Bot (standalone deployed product)
  ├── Web app + WhatsApp interface
  ├── Transaction classifier (Haiku → eventually local SLM)
  ├── Tax calculator (deterministic)
  ├── Report generator (GlyphJS or PDF)
  └── Delivery (WhatsApp / email)
```

**Clean boundary.** Method is the workshop. The SAT bot is the product that leaves the
workshop. No coupling. If Method changes, the bot doesn't break. If the bot needs
changes, Method's research isn't disrupted.

## Open Questions

1. **Brand name** — "DeclaraSAT" is working title. Check domain availability, SAT trademark risk.
2. **Tech stack** — Standalone web app (Next.js?) + WhatsApp Business API, or simpler (WhatsApp-only MVP)?
3. **Belvo timeline** — When does open banking integration justify the regulatory/integration cost?
4. **Contador agreement** — Formalize referral commission terms with Franco's partner
5. **Competitive moat** — How to differentiate from Heru/Konta if they add similar features?

## Next Steps

1. [ ] Validate product concept with Franco's contador partner (does this solve a real problem for their clients?)
2. [ ] Check "DeclaraSAT" domain/trademark availability
3. [ ] Design MVP tech stack and deployment architecture
4. [ ] Draft privacy notice and terms of service
5. [ ] Build v1 (target: 4-6 weeks)
6. [ ] Seed launch with contador's client base
