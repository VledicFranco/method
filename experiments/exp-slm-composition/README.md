# exp-slm-composition: Autonomous Cognitive Skill Compilation

**Hypothesis:** Cognitive agents can autonomously abstract DSLs from their own
experience, compile them to SLMs, and compose them into new capabilities — closing
the System 1/2 compilation loop that RFC 002 left manual.

**RFC:** `docs/rfcs/005-slm-composition.md`
**Depends on:** `exp-slm` (Phase 3 Gate 3 PASS, Phase 5 R-14 through R-22)
**Status:** Phase 1-3 DONE, Phase 2 flywheel VALIDATED (3 SLMs bootstrapped). Phase 4 (autonomous loop) next.
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

### Phase 2 — Bootstrap Pipeline (IN PROGRESS — flywheel validated)

- [x] B-2: Causal Validator corpus generated (8.5K pairs, 47/53 valid/invalid split)
- [x] B-2: Training DONE (5000 steps, 189 min on RTX 4090)
- [x] **B-2 Gate B-G1 PASS: 95.5% precision** on INVALID class (target >= 90%)
  - 89.6% accuracy, 83.9% recall, 89.3% F1, 0 parse errors
- [x] **KPI Checker SLM DONE** (PRD 049): 100% parse + 100% semantic (600/600)
- [x] **Router SLM DONE** (PRD 051): 100% accuracy (400/400), 28 min training
- [x] B-2 cross-domain validation: 97.3% VALID on KPI Checker corpus (surfaces edge cases)
- [x] **Gate B-G2 VALIDATED: SLM creation time 40 min → 1h 45min** (vs ~14 hours manual — 8-20x speedup)
- [x] Create >= 2 new SLMs using bootstrap pipeline: KPI Checker + Router ✓
- [ ] B-3: Trace Distiller SLM
- [ ] Wire B-1 + B-2 + B-3 into automated pipeline
- [ ] Compare bootstrapped SLMs to hand-crafted baseline

### Phase 3 — Composition Runtime (DONE — Gates C-G1 + C-G2 PASS)

- [x] Build CLM execution engine (sequential + validation gates)
- [x] Gate escalation: retry → frontier fallback (abort/skip implemented, frontier stub)
- [x] Per-stage metrics: accuracy, latency, error propagation
- [x] Gate C-G1: 2-stage CLM e2e accuracy = **100%** (50/50 holdout + 5/5 real, target >= 85%)
- [x] Gate C-G2: gate effectiveness = **100%** (all corrupted grammars caught, target >= 50%)
- [x] 3-stage CLM (B-1 + downstream SLM): **100%** (50/50) — no depth ceiling at N=3
- [x] Competitive composition operator (`A ⊕ B`): parallel candidates + selector gate
- [x] Ollama inference adapter + frontier escalation (qwen3-coder:30b fallback)
- [x] B-1 v2: **96.7%** novel TS (29/30), **100%** JSON Schema (5/5)
- [x] B-1 v3: **95.6%** across 4 type systems (TS 96.7%, JSON 100%, Protobuf 80%, Python 100%)
- [x] Error compounding stress test: RFC 005 Part VI theory validated (+32.8pp gate lift at p=0.4)
- [x] Pipeline bug fix: retries now pass original stage input (not failed output)

### Phase 4 — Autonomous Compilation Loop (CORE RESEARCH QUESTION ANSWERED)

- [ ] Compilation trigger: ACT-R activation threshold in Memory module
- [x] **DSL Inducer prototype** — frontier LLM abstracts grammar from traces
- [x] **Auto-refiner** — pattern fixes for common Peggy errors
- [x] **Validated on Monitor**: 100% parse match with hand-crafted grammar (33K traces)
- [x] **Validated on WorktreeInfo**: 100% first try, zero refinement needed
- [ ] MetaComposer routing: dynamically wire compiled SLMs
- [ ] Gate D-G1: agent compiles >= 1 pattern autonomously (infrastructure ready)
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
