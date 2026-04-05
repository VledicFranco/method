# exp-slm-composition: Autonomous Cognitive Skill Compilation

**Hypothesis:** Cognitive agents can autonomously abstract DSLs from their own
experience, compile them to SLMs, and compose them into new capabilities — closing
the System 1/2 compilation loop that RFC 002 left manual.

**RFC:** `docs/rfcs/005-slm-composition.md`
**Depends on:** `exp-slm` (Phase 3 Gate 3 PASS, Phase 5 R-14 through R-22)
**Status:** Phase 3 complete — Gates A-G1, A-G2, C-G1, C-G2 all PASS
**Cross-reference:** ov-research EXP-TBD

---

## Research Questions

1. Can an SLM learn to translate structured type descriptions → PEG grammars,
   across languages? (Level 1 abstraction, Gate A-G1)
2. Can the Reflector extract structural invariants from typed traces? (Level 2, A-G3)
3. Does the bootstrap flywheel reduce SLM creation time below 2 days? (Gate B-G2)
4. Can composed SLM pipelines with validation gates achieve >= 85%? (Gate C-G1)
5. Can an agent autonomously compile a skill without human intervention? (Gate D-G1)

## Phases

### Phase 0 — Corpus Sourcing & Infrastructure (DONE)

- [x] Inventory TypeScript interfaces across workspace repos
- [x] Build Peggy-in-the-loop validator (compile + parse test for grammar quality)
- [x] Design corpus augmentation strategy on top of real pairs
- [ ] Scrape GitHub for projects pairing PEG/Peggy grammars with typed languages
- [ ] Harvest JSON Schema, Protobuf, and other typed schema → grammar pairs

### Phase 1 — B-1: Schema→Grammar SLM (DONE — Gates A-G1 + A-G2 PASS)

- [x] Harvest 12 seed type→grammar pairs from workspace repos
- [x] Build synthetic corpus generator (2K pairs, ~55% validation pass rate)
- [x] Train Qwen2.5-Coder-0.5B LoRA r=16 on Schema→Grammar (3000 steps, RTX 4090)
- [x] Gate A-G1: grammar compilability = **100%** (50/50 holdout, target >= 90%)
- [x] Gate A-G1 generalization: **5/5 real unseen production interfaces** compile
- [x] Gate A-G2: downstream SLM parse accuracy = **100%** (50/50, target >= 85%)
- [x] Gate A-G2: downstream SLM semantic match = **100%** (50/50)
- [x] B-1 v2: improved corpus (3K pairs, compound names, snake_case, JSON Schema format)
- [x] B-1 v2 novel TS: **96.7%** (29/30 full pipeline, up from 76.7%)
- [x] Language generalization: **100%** (5/5 JSON Schema → grammar, up from 20%)

### Phase 2 — Bootstrap Pipeline

- [ ] B-2: Causal Validator SLM (precision >= 90% on known-bad pairs)
- [ ] B-3: Trace Distiller SLM
- [ ] Wire B-1 + B-2 + B-3 into automated pipeline
- [ ] Measure SLM creation time (Gate B-G2: target < 2 days)
- [ ] Create >= 2 new SLMs using the bootstrap pipeline
- [ ] Compare bootstrapped SLMs to hand-crafted baseline

### Phase 3 — Composition Runtime (DONE — Gates C-G1 + C-G2 PASS)

- [x] Build CLM execution engine (sequential + validation gates)
- [x] Gate escalation: retry → frontier fallback (abort/skip implemented, frontier stub)
- [x] Per-stage metrics: accuracy, latency, error propagation
- [x] Gate C-G1: 2-stage CLM e2e accuracy = **100%** (50/50 holdout + 5/5 real, target >= 85%)
- [x] Gate C-G2: gate effectiveness = **100%** (all corrupted grammars caught, target >= 50%)

### Phase 4 — Autonomous Compilation Loop

- [ ] Compilation trigger: ACT-R activation threshold in Memory module
- [ ] Reflector extension: extract structural invariants from traces
- [ ] DSL Inducer module: Level 2 trace→grammar (initially frontier LLM)
- [ ] MetaComposer routing: dynamically wire compiled SLMs
- [ ] Gate D-G1: agent compiles >= 1 pattern autonomously
- [ ] Gate D-G3: compiled SLM improves with additional traces

### Phase 5 — Application Domain Experiments

- [ ] EXP-A: Coding expertise — does compiled coding SLM beat fresh agent?
- [ ] EXP-B: Scientific formalization — induce scaling law from exp-slm runs
- [ ] EXP-C: Coordination — induce dependency algebra from multi-agent traces

## Seed Data Inventory

### Existing type→grammar pairs (from exp-slm)

| Type Definition | PEG Grammar | Codec | Location |
|----------------|-------------|-------|----------|
| `MonitorReport` (TS) | `monitor-v2.peggy` | `dsl-codec.ts` | `exp-slm/phase-2-dsl/` |
| `ObserverReport` (TS) | (inline) | `observer-dsl-codec.ts` | `exp-slm/phase-4-integration/` |
| `EvaluatorReport` (TS) | (inline) | `evaluator-dsl-codec.ts` | `exp-slm/phase-4-integration/` |

### Corpus sourcing targets

| Source | Expected yield | Type |
|--------|---------------|------|
| Workspace repos (`../`) | 50-100 TS interfaces | Real pairs (need grammar creation) |
| GitHub (Peggy + TS projects) | 100-500 pairs | Real pairs (existing grammars) |
| JSON Schema ecosystem | 200+ schemas | Real pairs (schema → grammar is mechanical) |
| Protobuf/gRPC projects | 100+ message types | Real pairs |
| Synthetic augmentation | 5-10x multiplier | Augmented pairs |

## Hardware

- Training: RTX 4090 (24GB VRAM) — chobits (Tailscale). Preferred for all training.
- Inference/eval: RTX 2080 Ti (11GB VRAM) — local (mission-control)
- Model: Qwen2.5-Coder-0.5B, LoRA r=16 (production config from Phase 3)
- See `docs/arch/gpu-inference-cluster.md` for chobits training setup

## Resolved Risks

1. ~~**Level 1 feasibility:** Schema→Grammar may exceed 0.5B capability.~~ **RESOLVED:**
   100% compilability on both synthetic holdout and real unseen interfaces. 0.5B is sufficient.
2. ~~**Corpus scarcity:**~~ **RESOLVED:** 2K synthetic pairs from 12 seed interfaces
   already achieve perfect scores. Large corpus optional for refinement, not required.

## Open Risks

3. **Error compounding in composition:** Gate classifier accuracy is the binding
   constraint. If gates < 95%, composition ceiling is N ≈ 3-4 stages.
4. **Level 2 Reflector extension:** Extracting structural invariants from traces is
   the hardest research question. May require new cognitive module design.
5. **Language generalization:** B-1 trained on TypeScript only. JSON Schema and
   Protobuf inputs untested. May need multi-language corpus or separate models.
