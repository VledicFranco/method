# exp-fcd-automation: FCD Automation Pipeline Integration Test

**Hypothesis:** The 8 FCD strategy YAML files parse correctly, load into bridge:test, and the strategy subsystem wiring (SubStrategySource + HumanApprovalResolver) is wired at startup without errors. The structural invariants (architecture gates) defined for PRD-044 pass at 8/8.

**Status:** closed-validated

**PRD:** docs/prds/044-fcd-automation-pipeline.md

**RFC:** none

**ov-research:** not yet distilled

**Started:** 2026-03-31

## Methodology

This experiment validates the structural correctness of the FCD Automation Pipeline (PRD-044) deliverables from Waves 0–3 without executing the full pipeline end-to-end. End-to-end execution is intentionally excluded because the pipeline contains `human_approval` gate nodes that require human-in-the-loop responses — this is by design, not a deficiency.

**Validation approach:**

1. **YAML parse validation** — Each of the 8 `s-fcd-*.yaml` files is loaded via `js-yaml` to confirm syntactic correctness. This catches YAML formatting errors before the bridge ever sees the files.

2. **Architecture gate validation** — Run `packages/bridge/src/shared/architecture.test.ts` which includes PRD-044-specific structural invariants (G-PRD044-SUBSTRATEGY, G-PRD044-EVENTBUS) plus the baseline FCA invariants (G-PORT, G-BOUNDARY, G-LAYER).

3. **Bridge load validation** — Start `bridge:test` (port 3457, isolated test fixture state) and query `GET /api/strategies/definitions` to confirm all 8 FCD strategy definitions appear in the loaded registry. This validates the full parsing and registration path through the bridge's strategy loading subsystem.

**Variables:**
- Independent: presence and content of 8 `s-fcd-*.yaml` files
- Dependent: parse success, architecture gate pass count, strategy load count in bridge

**Measurements:** binary pass/fail per gate + count of FCD strategies loaded

## Runs

| Run | Date | Config | Key Result | Verdict |
|-----|------|--------|------------|---------|
| integration-run-1 | 2026-03-31 | bridge:test port 3457, 8 FCD YAMLs | 8/8 parse OK, 8/8 arch gates, 8/8 strategies loaded | pass |

## Findings

All structural acceptance criteria for PRD-044 Wave 4 pass:

- **AC-1:** All 8 YAML files parse without js-yaml errors (8/8 OK)
- **AC-2:** Architecture gates pass 8/8 (5 suites, 8 individual tests)
- **AC-3 bonus:** bridge:test lists all 8 s-fcd-* strategies via `/api/strategies/definitions`

The bridge loaded 12 total strategies: 4 pre-existing (S-CORE-TEST-WATCH, S-PERF-FILE-WATCH, plus 2 others) and 8 new FCD strategies. No parse errors on any FCD file. The SubStrategySource and HumanApprovalResolver wiring logged without error at startup.

Note: 1Password CLI was present but not authenticated in the test environment. Bridge started successfully via direct environment injection from `.env` — the `.env` fallback path is functionally equivalent and used in CI environments.

## Gate Status

| Gate | Check | Status |
|------|-------|--------|
| AC-1: YAML parse | 8/8 s-fcd-*.yaml parse via js-yaml | PASS |
| AC-2: Arch gates | 8/8 architecture.test.ts assertions | PASS |
| AC-5: Bridge load | 8/8 s-fcd-* in /api/strategies/definitions | PASS |
