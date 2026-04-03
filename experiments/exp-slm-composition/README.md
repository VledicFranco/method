# exp-slm-composition: SLM Composition and Bootstrapping

**Hypothesis:** Specialized SLMs can be composed into pipelines (CLMs) that perform
complex tasks currently requiring frontier LLMs, and meta-SLMs can bootstrap the
creation of new SLMs to make composition experiments practical.

**RFC:** `docs/rfcs/005-slm-composition.md`
**Depends on:** `exp-slm` (Phase 3 Gate 3 PASS, Phase 5 R-14 through R-22)
**Status:** Phase 0 — Infrastructure
**Cross-reference:** ov-research EXP-TBD

---

## Research Questions

1. Can an SLM learn to translate TypeScript interfaces → PEG grammars? (B-1)
2. Can an SLM classify training pair causal consistency? (B-2)
3. Does the bootstrap flywheel actually reduce SLM creation time? (B-G4)
4. Can a 2-stage CLM with validation gates achieve >= 85% accuracy? (C-G1)
5. Where is the composition depth ceiling? (Q3 from RFC 004)

## Phases

### Phase 0 — Infrastructure & Seed Data (current)

- [ ] Inventory existing type→grammar pairs as seed data
- [ ] Design grammar corpus augmentation strategy
- [ ] Set up composition runtime scaffold (stage routing, validation gates)
- [ ] Define evaluation harness for meta-SLMs

### Phase 1 — B-1: Type→Grammar SLM

- [ ] Build corpus generator: TS interface → PEG grammar pairs
- [ ] Augment seed data (3 existing pairs) with synthetic type variations
- [ ] Train Qwen2.5-Coder-0.5B LoRA r=16 on Type→Grammar task
- [ ] Validate: grammar compilability rate (target >= 90%)
- [ ] Validate: downstream SLM quality from generated grammars (target >= 85%)
- [ ] Gate B-G1 / B-G2 decision

### Phase 2 — B-2: Causal Validator SLM

- [ ] Design causal rule DSL (or determine if NL rules are necessary)
- [ ] Build corpus: (input, output, rules) → valid/invalid pairs
- [ ] Source negative examples from Phase 3's diagnostic runs (Run 1-2 random data)
- [ ] Train classifier SLM
- [ ] Validate: precision >= 90% on known-bad pairs (Gate B-G3)

### Phase 3 — Bootstrap Integration

- [ ] Wire B-1 + B-2 into automated pipeline
- [ ] Measure end-to-end SLM creation time (Gate B-G4: target < 2 days)
- [ ] Create at least 2 new SLMs using the bootstrap pipeline
- [ ] Compare bootstrapped SLMs to hand-crafted baseline

### Phase 4 — Composition Runtime

- [ ] Build CLM execution engine (sequential composition + validation gates)
- [ ] Implement gate escalation (retry → frontier fallback)
- [ ] Per-stage metrics: accuracy, latency, error propagation
- [ ] Test 2-stage CLM on DSL pipeline task (Gate C-G1)

### Phase 5 — Composition Experiments

- [ ] Target 1: DSL Pipeline CLM (self-improving SLM factory)
- [ ] Target 2: Domain-scoped code CLM (FCA scaffolding)
- [ ] Error compounding analysis: gated vs ungated, varying N
- [ ] Cost comparison vs frontier LLM (Gate C-G3)

## Seed Data Inventory

Existing type→grammar pairs from `exp-slm`:

| TypeScript Interface | PEG Grammar | Codec | Location |
|---------------------|-------------|-------|----------|
| `MonitorReport` | `monitor-v2.peggy` | `dsl-codec.ts` | `exp-slm/phase-2-dsl/grammars/` |
| `ObserverReport` (signals) | (inline in codec) | `observer-dsl-codec.ts` | `exp-slm/phase-4-integration/src/` |
| `EvaluatorReport` (signals) | (inline in codec) | `evaluator-dsl-codec.ts` | `exp-slm/phase-4-integration/src/` |

Existing generative proof point:

| Task | Input | Output | Accuracy | Location |
|------|-------|--------|----------|----------|
| JSON Schema → TypeScript | JSON Schema | TS type definition | 99.6% exact match | Phase 3 Run 10 |

## Hardware

- Primary: RTX 2080 Ti (11GB VRAM) — local
- Secondary: RTX 4090 (24GB VRAM) — chobits (Tailscale)
- Model: Qwen2.5-Coder-0.5B, LoRA r=16 (production config from Phase 3)

## Key Risks

1. **Seed data scarcity:** Only 3 type→grammar pairs. Augmentation strategy is critical.
2. **Grammar design is creative:** May exceed SLM capability at 0.5B. Abandonment
   condition: < 80% compilable grammars after 3 training iterations.
3. **Error compounding:** Composition may not beat single frontier LLM call until
   gate classifiers reach 99%+ accuracy.
