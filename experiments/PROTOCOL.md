# Experiment Protocol — pv-method Research

How we run experiments, log results, coordinate parallel work, and distill findings.
Mandatory reading for any agent or human doing research in this repository.

---

## 1. Experiment Naming

Convention: `exp-{descriptive-slug}`

The slug describes **what the experiment tests**, not a sequential number.
ov-research EXP-NNN IDs go in the experiment README as a cross-reference — they
are not used as directory names here.

Examples:
- `exp-cognitive-baseline` — cognitive vs flat agent strategy-shift comparison
- `exp-slm` — SLM compilation validation (RFC 002)
- `exp-metacognitive-error` — can Monitor detect reasoning errors?
- `exp-workspace-efficiency` — token savings from salience-based eviction

---

## 2. Required Files Per Experiment

Every experiment directory must have:

```
exp-{slug}/
  README.md          ← Hypothesis, status, methodology, findings, cross-references
  results/           ← Tracked JSON/YAML output from runs (committed to git)
```

Optional but common:
```
  scripts/           ← Runnable scripts (Python, TypeScript)
  __tests__/         ← Unit tests for experiment infrastructure
  configs/           ← Training/run configurations (YAML)
  src/               ← TypeScript source modules
```

### README.md Template

```markdown
# exp-{slug}: {Title}

**Hypothesis:** {What we're testing — falsifiable claim}
**Status:** {open | in-progress | closed-validated | closed-refuted | closed-partial}
**PRD:** {docs/prds/NNN-slug.md or "none"}
**RFC:** {docs/rfcs/NNN-slug.md or "none"}
**ov-research:** {EXP-NNN cross-reference or "not yet distilled"}
**Started:** {YYYY-MM-DD}

## Methodology
{How the experiment runs — conditions, variables, measurements}

## Runs
| Run | Date | Config | Key Result | Verdict |
|-----|------|--------|------------|---------|

## Findings
{Summarized findings after runs complete}

## Gate Status
{If phased, gate pass/fail status}
```

---

## 3. Run Logging

Every experiment run produces a log entry in `experiments/log/`.

**One YAML file per run** — this is merge-conflict-free. Two agents running
experiments simultaneously create separate files, never touching the same path.

### File naming

`{YYYY-MM-DD}-{experiment}-{run-id}.yaml`

Example: `2026-03-28-exp-slm-run3.yaml`

### Entry format

```yaml
experiment: exp-slm
run_id: run3
date: 2026-03-28
agent: "Claude Opus 4.6 (1M context), Lysica session"
config:
  model: SmolLM2-135M-Instruct
  corpus: 10K causally consistent
  steps: 3000
metrics:
  parse_accuracy: 1.0
  semantic_accuracy: 0.986
  adversarial_accuracy: 0.708
  training_time_s: 683
  peak_vram_mb: 2951
verdict: pass
gate: "Gate 3 — Single Module Compilation"
notes: "Causal data fix: 39% → 98.6%. Data quality > training duration."
```

### Required fields

| Field | Required | Notes |
|-------|----------|-------|
| experiment | yes | Directory name |
| run_id | yes | Unique within experiment |
| date | yes | ISO date |
| agent | yes | Who ran it (model + session context) |
| config | yes | Key parameters (not full config — link to config file) |
| metrics | yes | Quantitative results |
| verdict | yes | pass / fail / partial / inconclusive |
| gate | if applicable | Which gate this run evaluates |
| notes | if applicable | One-line insight or diagnosis |

---

## 4. Artifact Management

Large binary files (trained models, ONNX exports, checkpoints, large trace dumps)
go in `experiments/artifacts/`, namespaced per experiment:

```
experiments/artifacts/
  .gitkeep
  exp-slm/
    models/                ← Trained checkpoints, ONNX exports
  exp-cognitive-baseline/
    traces/                ← Large trace dumps
```

**This directory is gitignored.** Contents are local-only, disposable, and
reproducible from the experiment scripts.

Experiments reference artifacts by relative path:
```
../../artifacts/exp-slm/models/run3/model.onnx
```

Or keep a local symlink/path in their config files.

**What goes in artifacts/ vs results/:**
- `results/` — small JSON/YAML metrics, evaluation reports, findings. **Committed.**
- `artifacts/` — large binaries (models, checkpoints, embeddings, corpora >10MB). **Gitignored.**

---

## 5. Parallel & Distributed Research

Multiple agents can work on experiments simultaneously. The coordination mechanism
is the AGENDA.md claim protocol.

### Experiment-level parallelism

Different agents work on different experiments. Each experiment is a self-contained
directory — no file overlap, no coordination needed beyond AGENDA.md claims.

### Within-experiment parallelism

Multiple agents on the same experiment must use separate run directories:
```
results/run-001/
results/run-002/
```

Or separate numbered runs with distinct config files. Never write to the same
results file simultaneously.

### Claim protocol (AGENDA.md)

Before starting work on a research item:

1. Read `AGENDA.md`, find an item with status `open`
2. Change status to `claimed`, add your session ID and date
3. Commit and push (to signal the claim to other agents)
4. Do the work. Update status to `in-progress` if the work spans sessions.
5. On completion: status → `done`, write log entry, update experiment README
6. On abandonment (blocked, out of time): status → `open` (release the claim)

**If you see a `claimed` item:** skip it. The claiming agent is working on it.
If the claim is stale (>3 days with no progress), you may reclaim it.

### Log entries are conflict-free

Each run creates a new file in `log/`. Two agents committing simultaneously
never touch the same file. This is the primary coordination mechanism for
recording results.

---

## 6. Gate Protocol

Experiments with hard gates (pass/fail checkpoints between phases) document
them in the experiment README.

### Gate evaluation

1. Run the gate's evaluation script
2. Record metrics in a log entry (verdict: pass/fail)
3. Update the experiment README gate status table
4. If fail: document diagnosis, decide whether to retry or abandon

### Gate decisions

- **Pass:** proceed to next phase
- **Fail with retry:** adjust config/data, re-run (new run ID)
- **Fail with abandon:** update status to `closed-refuted` or `closed-partial`,
  document what was learned

---

## 7. Distillation to ov-research

When an experiment closes (validated, refuted, or partial), distill findings
to the ov-research vault.

### When to distill

- Experiment status changes to `closed-*`
- A finding is referenceable across more than one project or experiment
- A finding constrains a design decision (even if the experiment is still open)

### How to distill

1. Read `ov-research/METHOD.md` — follow its check-in protocol exactly
2. Create or update files in `ov-research/knowledge/{domain}/`
3. Use the Finding/Implication/Status format from METHOD.md §2
4. Reference this experiment in the `sources:` field
5. Append a KNOWLEDGE-LOG.md entry with the actual findings (not filenames)
6. Update the experiment README: `ov-research: EXP-NNN — distilled`

### What gets distilled (and what doesn't)

**Distill:** Findings that generalize. "SLMs learn typed DSLs with 100% parse
accuracy" is a reusable insight. "Run 3 used config X with learning rate Y" is not.

**Don't distill:** Run-specific details, infrastructure notes, debugging logs,
intermediate results. Those stay in the experiment's results/ and log entries.

---

## 8. CLAUDE.md Integration

When working in pv-method and asked about research, experiments, or related work:

- **Experiment infrastructure:** `experiments/PROTOCOL.md`
- **Research backlog:** `experiments/AGENDA.md`
- **Run history:** `experiments/log/*.yaml`
- **Active experiments:** `experiments/exp-*/README.md`
- **Distilled findings (cross-project):** `ov-research/knowledge/` (separate repo)
- **Cognitive composition research:** `ov-research/knowledge/slm-compilation/` + `ov-research/experiments/EXP-023-*`

---

## Principles

1. **Experiments are reproducible.** Scripts + configs + documented methodology = anyone can re-run.
2. **Results are committed, artifacts are not.** JSON metrics: git. Model checkpoints: local.
3. **Parallel by default.** Log entries are per-file. Claims prevent duplicate work. No shared mutable state.
4. **Distillation is explicit.** Moving findings to ov-research is a documented step, not assumed.
5. **Failures are valuable.** A refuted hypothesis is a closed experiment with documented findings. Don't delete — close and distill.
