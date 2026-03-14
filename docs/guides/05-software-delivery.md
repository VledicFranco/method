# Guide 5 — Software Delivery (P2)

P2-SD is the methodology for delivering software. It covers the full loop from PRD to production-ready code, organized in discrete sessions with formal quality gates.

## The Delivery Pipeline

```
PRD (input)
  ↓ M7-PRDS — section the PRD into plannable units
PRDSections + SectionMap
  ↓ M6-ARFN — refine architecture for new requirements
ArchDoc (focused spec files)
  ↓ M5-PLAN — produce PhaseDoc per section
PhaseDoc
  ↓ M1-IMPL or M2-DIMPL — implement the code
Delivered code + SessionLog
  ↓ M3-PHRV — review against spec and architecture
ReviewReport
  ↓ M4-DDAG — audit for cross-phase drift (every ~3 phases)
DriftReport
```

Each arrow is one δ_SD invocation. The pipeline emerges from sequential invocations — P2-SD doesn't orchestrate the full loop in one run. Each invocation classifies the current challenge by task type and routes to the appropriate method.

## The 7 Methods

### M7-PRDS — PRD Sectioning

**Input:** Full PRD document + architecture docs
**Output:** SectionMap — ordered PRDSections with dependency graph

Takes a monolithic PRD and decomposes it into plannable sections. Each section is self-contained with explicit scope boundaries and acceptance criteria. Dependencies between sections form a DAG; the delivery ordering is a topological sort.

**Why it exists:** M5-PLAN takes a PRDSection as input, not a full PRD. Without explicit sectioning, boundary-drawing happens implicitly during planning — producing inconsistent scope and missed features.

### M6-ARFN — Architecture Refinement

**Input:** PRD + existing architecture + codebase
**Output:** Updated ArchDoc (set of focused spec files)

When a new PRD arrives, the architecture may need updating. M6-ARFN identifies architectural impacts, evaluates design options with documented trade-offs, and produces/updates focused architecture spec files (system-context.md, interfaces.md, domains.md, etc.).

**Key axiom (Ax-4 — Horizontal documentation):** Architecture is documented as multiple focused files, each covering one concern. No monolithic ARCHITECTURE.md. Each file is 3-12 KB and independently evolvable.

**Why it exists:** Every other method in P2-SD consumes ArchDoc as input, but nothing else produces it.

### M5-PLAN — Phase Planning

**Input:** PRDSection + ArchDoc + phase history
**Output:** PhaseDoc — scoped, severity-rated task list

Produces the handoff artifact that M1-IMPL and M2-DIMPL consume: a structured task list with acceptance criteria, file scopes, and severity ratings.

### M1-IMPL — Single-Agent Implementation

**Input:** PhaseDoc + ArchDoc
**Output:** Implemented code + SessionLog

The core implementation method. Two phases:
- **Phase A (Confidence Raising):** Audit spec against source, find discrepancies, fix HIGH/CRITICAL issues, reach 85% confidence before proceeding
- **Phase B (Execution):** Orient → diff → implement → validate → record

Phase A has a re-entry loop: if confidence is below threshold after fixing, loop back and audit again. Bounded by the number of discrepancies.

**8 roles** including auditor, implementor, orchestrator, reviewer, drift-auditor, and three sub-agent types. The most role-rich method in the system.

### M2-DIMPL — Distributed Implementation

**Input:** PhaseDoc + ArchDoc (multi-task scope)
**Output:** Implemented code + SessionLog with gate verdicts

Parallel orchestration with quality gates. Dispatches impl-sub-agents for independent tasks, evaluates each via:
- **Gate A:** Per-task quality review (compilation, test regression, scope discipline) with bounded patch-on-fail loop
- **Gate B:** Session-level security and architecture review

**Key difference from M2-ORCH (P1-EXEC):** M2-DIMPL is re-entrant — Gate A failures trigger patch sub-agents. M2-ORCH is single-pass — failure is terminal.

### M3-PHRV — Phase Review

**Input:** Completed phase artifacts (source, session log, PhaseDoc, ArchDoc)
**Output:** ReviewReport with verdict (PASS / CONDITIONAL / FAIL)

Post-implementation review. Every finding must have a file:line citation (Ax-1). Every acceptance criterion is either met or has an explicit gap finding (Ax-2). The verdict is deterministic given the findings (Ax-3):
- **PASS:** All criteria met, no architecture violations
- **CONDITIONAL:** All criteria met or gaps are MEDIUM/LOW only
- **FAIL:** At least one CRITICAL or HIGH gap

**Read-only** — M3-PHRV does not fix anything. Findings are input to the next planning or evolution cycle.

### M4-DDAG — Drift Audit

**Input:** N most recent phases + ArchDoc
**Output:** DriftReport with drift vectors and remediations

Cross-phase drift detection. Individual phases may pass review while the codebase drifts from its architecture over time. M4-DDAG detects accumulation patterns invisible to per-phase review.

**Key axiom (Ax-3 — Cross-phase grounding):** A drift vector requires evidence from at least 2 different phases. A single-phase divergence is a finding (M3-PHRV), not drift (M4-DDAG).

Typically invoked every ~3 phases.

## Worked Example

A team building an API gateway using P2-SD:

**Week 1:** Product delivers PRD-001 covering authentication, rate limiting, and logging.

→ `δ_SD: task_type = section` → **M7-PRDS** produces SectionMap:
  - Section 1: Authentication (depends on nothing)
  - Section 2: Rate Limiting (depends on Section 1 — needs auth context)
  - Section 3: Logging (depends on nothing)
  - Delivery order: [1, 3, 2] (auth and logging parallel, rate limiting after auth)

**Week 2:** Architecture needs updating for the new PRD.

→ `δ_SD: task_type = architecture` → **M6-ARFN** produces:
  - Updated `interfaces.md` (new auth endpoints)
  - New `rate-limiting.md` (token bucket design)
  - Updated `observability.md` (structured logging schema)

**Week 3:** Plan Section 1 (Authentication).

→ `δ_SD: task_type = plan` → **M5-PLAN** produces PhaseDoc with 5 tasks:
  - Task 1: JWT validation middleware
  - Task 2: Token refresh endpoint
  - Task 3: Session storage (Redis)
  - Task 4: Auth error responses
  - Task 5: Auth integration tests

**Week 3-4:** Implement Section 1. Tasks are independent with disjoint file scopes.

→ `δ_SD: task_type = implement, multi_task_scope = true` → **M2-DIMPL**:
  - Dispatches 5 sub-agents in parallel
  - Gate A: each sub-agent's work reviewed for compilation, tests, scope discipline
  - Task 3 (Redis) fails Gate A → patch sub-agent fixes connection handling → re-evaluation → PASS
  - Gate B: security review checks auth chain for all handlers
  - Integration: full compile + test suite on integrated codebase → PASS

**Week 4:** Review completed phase.

→ `δ_SD: task_type = review` → **M3-PHRV** produces ReviewReport:
  - 5 acceptance criteria evaluated: 4 MET, 1 GAP (MEDIUM — error response format inconsistent)
  - Architecture aligned: no violations
  - Verdict: **CONDITIONAL** (only MEDIUM gaps)

**Week 5-8:** Sections 2 and 3 follow the same cycle: plan → implement → review.

**Week 9:** 3 phases completed since last audit.

→ `δ_SD: task_type = audit` → **M4-DDAG** produces DriftReport:
  - Drift vector: error response format inconsistent across sections (MODERATE)
    - Section 1: `{ "error": "message" }`
    - Section 3: `{ "code": 400, "detail": "message" }`
  - Remediation: standardize error format, add to architecture spec
  - No STRUCTURAL drift detected

The remediation becomes input to the next M6-ARFN cycle (update `error-responses.md`), which feeds into the next M5-PLAN cycle. The loop continues.

## Next

[Guide 6](06-project-cards.md) explains how to parameterize P2-SD (or any methodology) for your specific project using project cards.
