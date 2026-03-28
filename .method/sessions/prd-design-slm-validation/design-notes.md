# PRD Design Notes — slm-validation

## Tier: Standard
## Phase: 6 (Finalized)

### Layer 1: WHY
- Q1 (Problem): RFC 002 proposes SLMs as System 1/2 compilation mechanism but has zero empirical evidence. Cognitive cycles pay frontier LLM cost for every module, including routine ones.
- Q2 (Who): Pacta cognitive agent users — every cycle is 2-6x ReAct cost. Routine cycles that could be cheap are expensive.
- Q3 (Evidence): PRD 030 Gate A measured 1.13x overhead for sequential composition. Compounds with full 8-phase cycles. No SLM prototype exists to prove cost reduction.
- Q4 (Cost of inaction): (a) Build production SLM infra on unproven thesis → waste weeks, or (b) RFC stays theoretical indefinitely. Validation de-risks both.
- Q5 (Urgency): PRD 030 fully implemented. Architecture stable. 2x RTX 2080 Ti available (GPU 1 idle). Real trace data exists from cognitive cycle runs.

### Layer 2: WHAT
- Q6 (Solution): 4-phase validation pipeline from RFC 002. Local training on GPU 1 via HF/trl/peft. Monitor module first target.
- Q7 (Alternatives): (1) Retrieval-based caching — rejected: caches instances not patterns. (2) Few-shot with cheap API model — rejected: still per-call cost, no DSL constraint advantage. (3) Skip validation, build production — rejected: RFC has explicit abandonment criteria.
- Q8 (Out of scope): Production SLM deployment, automated training pipelines, multi-task transfer, DSL marketplace, cloud GPU training.
- Q9 (Success): Phase 1: parse ≥95%, semantic ≥85%, ECE ≤0.15. Phase 2: task success ≥baseline-5%, cost ↓≥30%. Phase 3: ≥2/3 modules compile, cost ↓≥50%.
- Q10 (Acceptance criteria): Hard gates per phase from RFC. Abandonment criteria explicit.

### Layer 3: HOW
- Q11 (Dependencies): PRD 030 (complete), RFC 002, Python/HF ecosystem, CUDA 13.2 on 2x RTX 2080 Ti
- Q12 (Risks): SLM calibration too poor for reliable escalation. DSL design doesn't converge. Training data synthetic bias. Monitor too simple to generalize findings.
- Q13 (Rollout): Phased with hard gates. Each phase is go/no-go.
- Q14 (Monitoring): Experiment metrics in experiments/exp-slm/ — accuracy, calibration, cost per cycle.
- Q15 (Rollback): No production impact. Abandonment = archive experiment code.

### Layer 4: CONSTRAINTS
- Q16 (Appetite): Complete — 6-8 weeks for all 4 phases (0-3).
- Q17 (NFRs): Training must fit on single 2080 Ti (11GB VRAM). Inference latency <50ms. No cloud dependencies.
- Q18 (Cross-cutting): Observability via existing TraceSink. Docs in arch/.

### Decisions
- Code location: experiments/exp-slm/ (isolated, easy to delete if abandoned)
- First module target: Monitor (simplest I/O, highest compilation potential)
- Training stack: Python (HF transformers + trl + peft), TypeScript (DSL parser + Pacta integration)
- Base model candidates: SmolLM2-135M, SmolLM2-360M, Qwen2.5-0.5B
- Hardware: GPU 1 (RTX 2080 Ti, 11GB, currently idle)
