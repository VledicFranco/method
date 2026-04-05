# Research Agenda — pv-method

Prioritized research backlog. See `PROTOCOL.md §5` for the claim protocol.
See `ROADMAP.md` for the strategic research program (RFC 001/002/003 → ARC-AGI).

---

## Active Research Lines

### Line 1: SLM Compilation (RFC 002)
Can small models trained on typed DSLs replace frontier LLM calls in cognitive modules?
**Status:** Gate 5 PASS. 3-module SLM cycle validated. Observer ablation resolved T01 regression.

### Line 2: Cognitive Architecture Validation (RFC 001)
Does the 8-module cognitive cycle with default-interventionist monitoring outperform flat ReAct agents?
**Status:** Parity at 73% (SLM cognitive = flat, monolithic workspace). Partitioned workspace + full cognitive stack at 44% (R-23). Gap closing: T02 recovered to parity, T04 first pass. Next: partition tuning (R-25) to close remaining 29pp.

### Line 3: Workspace Partitions (RFC 003)
Does typed workspace partitioning enable complex cognition beyond single-workspace limits?
**Status:** Phase 1 IMPLEMENTED (PRD 044, commit bc2cca0). Goal drift confirmed (R-16). Partitioned workspace fixes T01 (0/3→3/3 at 30 cycles), 30-67% token reduction. T06 still fails (reasoning-bound). T02/T04 regressed at 30 cycles — needs 15-cycle retest and pin flag integration.

### Line 4: ARC-AGI Integration
Can our cognitive architecture (modules + SLMs + partitions) improve abstract reasoning on ARC-AGI-3?
**Status:** Planning. SDK identified (`pip install arc-agi`). Architecture maps to ARC-AGI-3 requirements.

### Line 5: Anticipatory Monitoring + Unified Memory + Verification (RFC 006, PRD 048)
Does the full cognitive stack match or exceed flat baseline?
**Status:** ARCHITECTURE IS TASK-DEPENDENT. N=5 replication revealed cognitive helps T01/T03 (+20pp) and hurts T02/T04 (-80pp). R-28 cognitive 37% vs R-29 flat 57%. Best per-task: T01 60%, T02 20% (cog) vs 100% (flat), etc.
**Key findings:** (1) Cognitive architecture validates the mechanisms (Cowan memory, working memory, verification) but adds overhead that hurts simple tasks. (2) Sonnet 4 handles T02/T04 natively — cognitive distracts. (3) Cognitive wins on structural/multi-file tasks. (4) The right architecture depends on task features. Motivates PRD 050 (meta-cognitive router).

### Line 6: Meta-Cognitive Routing (PRD 050/051)
Can a meta-level router select the right architecture per task, achieving composite pass rate > max(flat, cognitive)?
**Status:** VALIDATED. R-31b: 18/30 (60%) — beats flat 57% and cognitive 37%. Router SLM (Qwen2.5-0.5B-LoRA, 100% holdout) served via HTTP bridge on chobits. 6/6 routing decisions correct at N=5. T04 recovered 20%→100% via correct routing. Bootstrap flywheel proven twice (KPI Checker + Router SLM, ~45 min each).
**Remaining gap:** T03 inconsistent (0-20%), T06 still 0% regardless of architecture — reasoning-bound, needs Opus comparison.

---

## Backlog — Planned

| ID | Experiment | Question | Priority | Dependencies |
|----|-----------|----------|----------|-------------|
| — | Opus comparison | Run unified-memory N=5 with Opus ReasonerActor — isolate model quality from architecture. Tests whether T06 (0% regardless) and T03 (0-20%) are reasoning-bound. | **P0** | Credits/budget |
| — | T03/T06 deep-dive | Diagnose why T03 is inconsistent (0-20%) and T06 always 0%. Longer cycles? Different model? Task reformulation? | P1 | Opus comparison |
| — | exp-arc-agi | ARC-AGI-3 baseline: flat vs cognitive vs SLM cognitive vs meta-cognitive routing | P1 | SDK setup, adapter code |
| — | Structured output | **P(parse) = 1.0 hypothesis** — re-run exp-spl-design with StructuredAgentProvider | P1 | StructuredAgentProvider (merged) |
| — | Router SLM v2 | Retrain on 6-task corpus (N=5 per task) to improve per-task calibration. Current model trained on 4-task corpus. | P2 | Expanded corpus |
| — | Observer v3 training | Train Observer on tool-result inputs for every-cycle mode | P3 | Chobits, corpus design |

## Backlog — In Progress

*None. R-20→R-31b arc complete. Meta-cognitive routing validated end-to-end.*

---

## Completed

| ID | Experiment | Result | Date |
|----|-----------|--------|------|
| R-31b | exp-slm phase-5 | **Meta-cognitive routing 18/30 (60%) — BEATS FLAT 57% AND COGNITIVE 37%.** Router SLM (Qwen2.5-0.5B-LoRA) served via HTTP bridge on chobits, 6/6 routing correct. T04 recovered 20%→100% via SLM routing to flat. Composite advantage validated. | 2026-04-05 |
| R-31 | exp-slm phase-5 | First SLM routing pass (partial, 3/30 runs). Regex bug: objective summary fell back to full taskDescription for T01. Fixed in router-slm.ts — prefer short `goal.objective` over noisy taskDescription. | 2026-04-05 |
| R-30b | exp-slm phase-5 | **Rule-based router N=5: 56%.** Misrouted T04 (single-file edit pattern not matching), sent to cognitive → 20%. Motivates SLM replacement (R-31b). | 2026-04-05 |
| R-30 | exp-slm phase-5 | Rule-based router first pass (partial). Regex bug for bare filenames (`module-a.ts`) caused T01 misrouting. Fixed: `/[\w/-]+\.(ts\|js\|...)\b/` pattern. | 2026-04-05 |
| R-29 | exp-slm phase-5 | **Flat N=5 honest baseline: 57%.** T02/T04 100% stable, T01 40%, T03 0%. Reveals R-15 N=3 (73%) was inflated. Gap to cognitive is 20pp not 36pp. | 2026-04-05 |
| R-28 | exp-slm phase-5 | **Cognitive N=5 honest: 37%.** T01 60%, T02 20%, T03 20%, T04 20%, T05 100%, T06 0%. N=3 variance masked true rates. Motivates router approach. | 2026-04-05 |
| R-27b | exp-slm phase-5 | **T04 100%! Programmatic verification works.** Verify→fail→correct loop. 5/5 tasks at or above flat baseline (best rates). PRD 049 SLM validated. N=3. | 2026-04-05 |
| R-27 | exp-slm phase-5 | **PRD 048 Verification Loop: 8/18 (44%).** VERIFY fires but 0 programmatic checks — LLM fallback unreliable. Validates need for SLM. | 2026-04-05 |
| R-26e | exp-slm phase-5 | **Unified memory (Cowan) + Planner + WM: best T01 100%, T02 100%, T03 67%, T04 67%.** Architecture validated — 4/5 tasks match or exceed flat. Remaining gap: LLM write quality. | 2026-04-04 |
| R-26d | exp-slm phase-5 | **T04 67% — best ever.** Subgoal checklist seeding fixes read-loop. KPI regex bug prevented T06 fix. | 2026-04-04 |
| R-26c | exp-slm phase-5 | **T03 67% — exceeds flat 33%.** Formal Planner module wired. Subgoals in unified store. | 2026-04-04 |
| R-26b | exp-slm phase-5 | **T01 100% — exceeds flat 67%.** Dynamic budget + KPI satisfaction gating + tuned spreading. | 2026-04-04 |
| R-26 | exp-slm phase-5 | **Unified memory 50%. T02 100% — exceeds flat 67%.** CognitiveMemoryStore validates Cowan model. | 2026-04-04 |
| R-23 | exp-slm phase-5 | **Full RFC 006 stack 8/18 (44%).** Phase-aware eval + solvability + Memory v3 + per-module working memory. T02 recovered 0→67% (matches flat). T04 first pass ever (0→33%). Closed algebra validated. | 2026-04-04 |
| R-22c | exp-slm phase-5 | **+ Memory v3: 6/18 (33%).** Episodic recall enables T06 (0→67%). T04 still 0% — proves gap is working memory, not retrieval. | 2026-04-04 |
| R-22b | exp-slm phase-5 | **Smoothed solvability: 5/18 (28%).** Tuning didn't change outcomes — partition context is the bottleneck. | 2026-04-03 |
| R-22 | exp-slm phase-5 | **Phase-aware + solvability: 5/18 (28%).** Fixed premature termination (R-20/R-21), back to partition baseline. Solvability too volatile — needed smoothing. | 2026-04-03 |
| R-21 | exp-slm phase-5 | **LLM frontier evaluator 3/18 (17%).** Accurate assessments but high confidence makes termination worse. Better signal → worse outcome. Proves termination logic is the bottleneck, not evaluator quality. Motivates RFC 006. | 2026-04-03 |
| R-20 | exp-slm phase-5 | **Rule-based goal-state 4/18 (22%).** Universal premature termination at cycle 10. Discrepancy flatlines at 0.300. Rule-based function can't measure progress. | 2026-04-03 |
| R-18 | exp-slm phase-5 | Partitioned 15cyc: 4/15 (27%) vs flat 11/15 (73%). **Regression is NOT from over-cycling — partitions cause T02/T04 failure at both 15 and 30 cycles.** Compositional gap identified: no goal satisfaction detection. | 2026-04-03 |
| R-17 | exp-slm phase-5 | Partitioned workspace (PRD 044): T01 0/3→3/3 at 30 cycles. 30-67% token reduction. T06 still 0/3 (reasoning-bound). T02/T04 regressed at 30 cycles (over-exploration). | 2026-03-31 |
| R-16 | exp-slm phase-5 | **Goal drift confirmed.** T06 0/3 at 30 cycles. Workspace saturated with file contents (3-5K tokens). RFC 003 Trigger 1 FIRED. | 2026-03-31 |
| R-15 | exp-slm phase-5 | Observer ablation: cycle0 fixes T01 (33%→100%). T03 task-inherent (20%). Flat baseline 73%, 28K tokens. Benchmark fix: 9/10 ALL GATES PASS. | 2026-03-31 |
| R-14 | exp-slm phase-5 | **Gate 5 PASS.** 3-module SLM cognitive cycle 73% vs 72% baseline. 0.15% fallback. T02/T04 +28pp. 22% token reduction vs flat. | 2026-03-31 |
| R-13 | exp-cognitive-baseline | Phase 0 pin flag validated. T04: 0%→100%. Overall: 60%→72% (+12pp). No causal regression. | 2026-03-31 |
| R-09 | exp-slm | Gate 4 Part 2 FULL PASS. Stagnation-augmented Monitor SLM 100% (10/10). 90.3% token reduction. | 2026-03-30 |
| R-08 | exp-slm | Multi-module: Observer v2 ALL PASS + ONNX. Evaluator v2 ALL PASS. 3/3 modules gate-passing. | 2026-03-30 |
| R-11 | exp-slm | Gate 4 Part 2 PARTIAL PASS (3/4). Stagnation gap confirmed. | 2026-03-30 |
| R-14b | exp-cognitive-baseline | Full T01-T05 matrix N=5. Flat 80% vs cognitive 60%. T04 constraint blindness (0%). | 2026-03-30 |
| R-15b | exp-cognitive-baseline | Threshold ablation. t2 and t4 tie at 85.7%. t2 chosen for comparability. | 2026-03-30 |
| R-12 | exp-cognitive-baseline | Monitor strategy ablation. Constrain-force necessary. Reframe degrades. | 2026-03-30 |
| R-07 | exp-advanced-patterns | All patterns combined: 22% success. Context pollution. Selective activation needed. | 2026-03-29 |
| R-06 | exp-interventionist-cost | Always-on free. EVC worse than baseline. | 2026-03-29 |
| R-05 | exp-workspace-efficiency | PriorityAttend 27.3% savings, 91% success. | 2026-03-29 |
| R-04 | exp-metacognitive-error | v2 Monitor 11x better at subtle errors. FPR tradeoff. | 2026-03-29 |
| R-01 | exp-slm | Gate 4 Part 1 PASS. Calibration ECE 0.02, ONNX 100% match. 7-point scaling curve. | 2026-03-29 |
| R-00 | exp-slm | Gates 0-3 PASS. DSL 100% parse/semantic. SLM 98.6% semantic. | 2026-03-28 |
