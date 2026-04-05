# Market Research Intelligence — April 2026

## 1. AI Micro-Business Landscape

### Revenue Reality
- **Median profitable micro-SaaS:** $4.2K MRR (~$50K/year)
- **Top solo performers:** Pieter Levels ($3M+ ARR), Nick Dobos ($8.8M ARR), SiteGPT ($1.14M ARR)
- **70% of micro-SaaS founders earn under $1K MRR** — power-law distribution
- **44% of profitable SaaS businesses are solo-founded** (Stripe 2024 Indie Founder Report)
- **AI startups reach $10M ARR in 2.5 years** vs 6 years for traditional SaaS

### What Actually Works (2025-2026)
- **Voice AI agents** replacing call centers — 60-80% cost savings, 24/7
- **Industry-specific AI agents** (legal, healthcare, finance) — 3-5x higher retention than horizontal
- **Outcome-based pricing** ("we deliver X results") beats tool-based pricing ("use our AI tool")
- **E-commerce automation** — multi-marketplace product research, listing optimization, customer service

### Key Pattern
Profitable businesses sell **outcomes**, not access. "We process your claims" > "Here's a claims AI tool."

## 2. Claude API Economics

### Pricing (as of April 2026)
| Model | Input/1M | Output/1M | Notes |
|-------|----------|-----------|-------|
| Opus 4.6 | $5.00 | $25.00 | Complex reasoning only |
| Sonnet 4.6 | $3.00 | $15.00 | Primary workhorse |
| Haiku 4.5 | $1.00 | $5.00 | Classification/routing |

### Cost Optimization
| Technique | Savings |
|-----------|---------|
| Prompt caching (90% hit) | ~90% on input |
| Batch API | 50% on everything |
| Combined | Up to 95% |
| Model routing (Haiku→Sonnet→Opus) | 60-80% vs Opus-only |

### Practical Cost Range
- **Optimized agent stack:** $250-$1,000/month for moderate volume
- **Replaces:** $2,000-$5,000/month in equivalent human labor
- **Break-even:** Very achievable with even $2-3K MRR

## 3. MCP Ecosystem

### Scale
- **19,400+ MCP servers** listed (MCP.so alone)
- **8 million protocol downloads**, 85% MoM growth
- Major standardization: OpenAI, Anthropic, Hugging Face, LangChain, Microsoft

### Emerging Marketplaces
| Platform | Revenue Share | Status |
|----------|--------------|--------|
| MCPize | **85% to creators** | Active |
| MCP Marketplace | **85/15 split** | Active |
| Smithery | Building model | 100K+ skills |

### Revenue for MCP Creators
- **Top creators:** $3,000-$10,000+/month
- **Modest creators:** ~$500/month ($6K/year)
- **Less than 5%** of servers are monetized — massive headroom
- **MCP Registry ("app store") expected by end of 2026**

## 4. Methodology-as-a-Service — White Space

### What Exists
- **Pre-built agent templates** (Kore.ai, workflow builders) — practical but ad-hoc
- **Consulting** (Deloitte, McKinsey) — expensive, human-delivered, not executable
- **Open-source orchestration** (LangChain, CrewAI, Dify) — tools, not methodologies

### What Does NOT Exist
- Formal, theory-backed methodology specs executable by LLM agents
- MCP-based methodology delivery
- Methodology marketplace where domain experts publish and operators consume

### Market Signal
Everyone agrees governance/methodology is the differentiator for agent businesses.
Nobody is productizing it. **Method sits in this white space.**

## 5. Mexico — Persona Fisica (RESICO)

### Tax Advantages
- **ISR:** 1.0-2.5% on monthly income (up to 3.5M MXN/year)
- **IVA on exports:** 0% — service exports to international clients are zero-rated
- **No specific AI regulation** — federal AI law still in legislature
- **Digital platform withholding:** 2.5% (with RFC)
- **Filing:** Monthly by 17th, annual by April 30

### Deductible Expenses (Regimen 612 alternative)
Computer equipment, software, internet, coworking, professional services, training.

### Bottom Line
RESICO + international service exports = **1-2.5% effective tax rate, 0% VAT**.
One of the most favorable setups globally for a solo tech business.

## 6. GPU/Training Infrastructure

### Current Asset: RTX 4090
- 24GB GDDR6X — handles QLoRA fine-tuning of 7B models in 2-4 hours
- Break-even vs cloud A100 rental after ~3,500 hours
- Sufficient for all current SLM work (Monitor, Observer, Evaluator modules)

### When to Upgrade
- Only when models consistently exceed 24GB VRAM
- RTX 5090 (32GB, ~$3,844) only justified for 13B+ full fine-tuning
- Cloud GPU (decentralized: $0.16-0.44/hr for 4090) for burst parallel training

### Cost Structure
- Electricity for training: negligible at residential rates
- No cloud costs needed for current SLM pipeline (0.5B-7B models)

---

*Sources: Anthropic pricing docs, Stripe Indie Founder Report 2024, SAT RESICO guide,
MCPize developer docs, MCP.so directory stats, Deloitte Tech Trends 2026,
Spheron GPU benchmarks, KPMG Mexico fiscal guide 2026.*
