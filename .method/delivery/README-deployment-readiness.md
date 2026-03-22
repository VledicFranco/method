# PRD 020 Phase 2 — Deployment Readiness Documentation

**Date:** 2026-03-21
**Status:** CONDITIONAL MERGE (after 11 blockers resolved)
**Strategist:** Multi-advisor synthesis
**Repository:** pv-method
**Branch:** feat/prd020-phase2

---

## DOCUMENTS IN THIS DELIVERY

This folder contains the complete deployment readiness assessment for PRD 020 Phase 2. All documents are interrelated and should be read in order:

### 1. **prd020-phase2-executive-summary.md** (START HERE)
**10-minute read. Decision maker summary.**

- DECISION MATRIX: FIX NOW | PHASE 3 DEFERRED | OPS CONSTRAINTS | REJECTED
- The 11 blocking findings (with impact)
- Phase 3 scope (24 deferred findings)
- Operational runbook (11 constraints)
- Risk assessment
- Recommended timeline
- Release notes

**For:** Steering council, project managers, CTO decision

---

### 2. **prd020-phase2-deployment-readiness.md** (COMPREHENSIVE)
**40-minute read. Full strategic analysis.**

- Detailed 4-bucket assessment (FIX NOW, PHASE 3, OPS, REJECT)
- Each FIX NOW blocker with tasks and effort
- Each PHASE 3 finding with mitigation for Phase 2
- Full operational runbook (constraints, monitoring, daily/weekly/monthly checklists)
- Rationale for REJECT decisions
- Final sign-off and timeline

**For:** Engineering leadership, QA lead, Ops team planning

---

### 3. **prd020-phase2-merge-blockers-checklist.md** (DETAILED TASKS)
**60-minute read. Engineer task list with code snippets.**

- 11 blockers with detailed fix checklist (tasks + code examples)
- Pre-merge validation steps
- Test commands to run
- Quality gates for sign-off
- Estimated effort per blocker (total 16-18 hours)
- Approach options (e.g., F-A-9 has 2 options)

**For:** Bridge engineers, QA engineers, sprint planning

---

### 4. **prd020-phase2-fix-tracking.csv**
**Quick reference. Effort estimation and ownership.**

- 47 findings with finding_id, severity, category, bucket, effort, owner, status
- Sortable by bucket, effort, owner
- Direct import to project management tools (Jira, Asana, etc.)

**For:** Project managers, sprint planning, resource allocation

---

## RECOMMENDED READING PATH

### For CTO / Steering Council (30 min):
1. Executive Summary (10 min)
2. Final Assessment section of Deployment Readiness doc (5 min)
3. skim the FIX NOW table (15 min)

**Output:** Merge approval decision with confidence level

---

### For Engineering Lead (2 hours):
1. Executive Summary (10 min)
2. Full Deployment Readiness doc (40 min)
3. Merge Blockers Checklist — Task 1 through 6 of each blocker (70 min)

**Output:** Sprint planning, task breakdown, effort estimation, team allocation

---

### For Individual Engineer (per blocker):
1. Executive Summary — "The 11 Blocking Findings" table (2 min)
2. Find your assigned blocker in Merge Blockers Checklist (30 min per blocker)
3. Follow task checklist step-by-step (30 min per task × 3-5 tasks = 1.5-2.5 hours per blocker)

**Output:** Completed tasks, PR ready for review

---

### For QA Lead (1 hour):
1. Executive Summary (10 min)
2. Merge Blockers Checklist — find blocks F-THANE-4, F-NIKA-6, F-THANE-6, F-HARLAN-* (30 min)
3. Fix Tracking CSV — filter by OWNER=QA (10 min)
4. Deployment Readiness doc — OPS CONSTRAINTS section (10 min)

**Output:** Test plan, monitoring checklist, acceptance criteria

---

### For Ops / Deployment (30 min):
1. Executive Summary — "Operational Runbook" and "Release Notes" (20 min)
2. Deployment Readiness doc — "OPS RUNBOOK" section (10 min)
3. Fix Tracking CSV (5 min)

**Output:** Deployment constraints, monitoring rules, restart procedures

---

## QUICK REFERENCE

### Merge Decision
```
VERDICT: CONDITIONAL MERGE

Requirements:
✓ All 11 FIX NOW items resolved
✓ All 992 tests passing
✓ Performance benchmarks validated (<2s discovery, <100ms polling)
✓ Ops team acknowledges runbook
✓ Phase 3 backlog created (24 items with PRD-031 refs)

Timeline: 16-18 engineering hours + 4-6 QA hours
Estimated completion: 2026-03-28 (7 days)

Risk: LOW (with ops constraints) → MEDIUM (without monitoring)
```

---

### The 11 Blockers at a Glance

| # | ID | Problem | Impact | Fix Time |
|---|----|---------| -------|----------|
| 1 | F-A-1 | Genesis tools not registered | Can't execute any tool | 2h |
| 2 | F-A-3 | Polling loop never started | Genesis idle, no observations | 3h |
| 3 | F-P-1 | Event log unbounded | OOM crash after 24h | 2h |
| 4 | F-P-2 | Cursor map memory leak | 28MB+ stale cursors in 1mo | 1h |
| 5 | F-NIKA-1 | Genesis can call mutations | Violates isolation | 1h |
| 6 | F-THANE-2 | project-config not init'd | Discovered projects unusable | 1.5h |
| 7 | F-THANE-4 | No E2E discovery test | Phase 1 unvalidated | 2h |
| 8 | F-NIKA-6 | No isolation test | Cross-project leaks unknown | 1h |
| 9 | F-THANE-6 | No perf metrics | PRD criteria unvalidated | 1.5h |
| 10 | F-A-5 | Cursor not versioned | Phase 3 migration impossible | 0.5h |
| 11 | F-A-9 | Abort returns fake success | Race conditions in Genesis | 1.5h |

---

### Phase 3 Backlog Snapshot (24 items)

**Performance (7 items):** cursor batching, file watcher granularity, discovery cache, dashboard memory, error recovery, config, decoupling

**Architecture (6 items):** architecture docs, behavioral spec, methodology positioning, event log lifecycle, metrics, isolation tests

**Safety (5 items):** config validation, path traversal, atomic swaps, error consistency, test coverage

**Testing (6 items):** E2E integration, race conditions, abort mechanism, load tests, multi-project, cursor cleanup

**Mitigation:** Max 20 projects per instance, ops monitoring, release notes with known limitations

---

### Ops Constraints for Phase 2 Deployment

**Resource Limits:**
- Max 20 projects per bridge instance
- Max 10,000 events in memory (ring buffer)
- Max 1,000 cursors in memory (LRU)
- Memory alert >500MB, restart >800MB

**Usage Rules:**
- Dashboard tabs: 8-hour lifetime (restart daily)
- Discovery calls: once per minute max
- YAML edits: batch in <500ms windows
- Genesis spawns: once per 30s max

**Monitoring:**
- Daily: memory, event log size, cursor count, Genesis errors
- Weekly: discovery perf (<2s for 10 projects), load test, file watcher latency
- Monthly: event archive review, polling frequency, error patterns

---

## SIGN-OFF CHECKLIST

### Before Merge
- [ ] All 11 FIX NOW tasks completed (per merge-blockers-checklist.md)
- [ ] All tests pass: `npm run test`
- [ ] Integration tests pass: `npm run test -- packages/bridge/src/__tests__/integration`
- [ ] Performance benchmarks pass: `npm run test -- packages/bridge/src/__tests__/performance`
- [ ] Bridge team lead: code review + sign-off
- [ ] QA team lead: test plan + acceptance criteria + sign-off
- [ ] Steering council: merge approval decision

### Before GA Release
- [ ] Ops team: runbook acknowledged + monitoring setup
- [ ] Release notes: known limitations + Phase 3 scope documented
- [ ] Phase 3 backlog: 24 items with PRD-031 ownership assigned
- [ ] Alpha/Beta deployment: monitored for 1 week (metrics baseline)
- [ ] GA readiness: all monitoring alerts active

---

## CONTACT & ESCALATION

**Questions about decisions?**
→ See "Strategist Decision" section in deployment-readiness.md

**Questions about specific blockers?**
→ See the full task description in merge-blockers-checklist.md

**Questions about Phase 3 backlog?**
→ Filter fix-tracking.csv by `Bucket=PHASE 3`

**Questions about ops constraints?**
→ See "OPS RUNBOOK" section in deployment-readiness.md

---

**Delivery Date:** 2026-03-21
**Strategist Report:** Complete
**Status:** Ready for engineering handoff

