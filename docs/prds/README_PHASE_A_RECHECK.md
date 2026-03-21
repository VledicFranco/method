# PRD 020 Phase A Re-Review Results

**Status:** Phase 1 ready to proceed with 3 critical clarifications

**Date:** 2026-03-20

**Bottom Line:** The revised PRD 020 is substantially improved. Genesis is cleanly deferred to Phase 2, cross-project isolation is explicit, and performance targets are concrete. However, 3 specification gaps must be resolved before Phase 1 implementation can begin. Estimated resolution time: 10-15 minutes.

---

## Quick Navigation

**If you have 2 minutes:**
→ Read [`PHASE_A_RECHECK_SUMMARY.txt`](./PHASE_A_RECHECK_SUMMARY.txt)

**If you have 10 minutes:**
→ Read [`PHASE_1_BLOCKERS_TO_RESOLVE.md`](./PHASE_1_BLOCKERS_TO_RESOLVE.md)

**If you have 30 minutes:**
→ Read [`RECHECK_PHASE_A_RESULTS.md`](./RECHECK_PHASE_A_RESULTS.md)

**If you need structured data:**
→ See [`ADVISOR_FINDINGS_MATRIX.yaml`](./ADVISOR_FINDINGS_MATRIX.yaml)

---

## Key Findings

### Verdict Summary

| Verdict | Count | Meaning |
|---------|-------|---------|
| FIXED | 25 | Fully addressed in updated PRD |
| PARTIAL | 10 | Partially addressed; implementation notes needed |
| OPEN | 3 | Critical blockers (see below) |
| OUTDATED | 8 | Deferred to Phase 2 (acceptable) |

### The 3 Critical Blockers (MUST RESOLVE)

1. **F-HARLAN-3:** Project config reload semantics not specified
   - Issue: If user edits `.method/project-config.yaml`, when does bridge reload it?
   - Resolution: Add "Configuration Reload Behavior" section to PRD 4.2
   - Recommended: Static load-once (restart required)
   - Time: 5 minutes

2. **F-HARLAN-7:** Event log durability not specified
   - Issue: Are events persisted to disk or in-memory only?
   - Resolution: Add "Event Log Durability" section to PRD 4.1
   - Recommended: In-memory for Phase 1; persistent YAML for Phase 2
   - Time: 5 minutes

3. **F-ORION-5:** Partial project initialization failures not handled
   - Issue: If `.method/` creation fails for one project, does bridge abort or continue?
   - Resolution: Add "Initialization Failure Handling" section to PRD 4.1
   - Recommended: Log and skip (don't abort; allow recovery via rescan)
   - Time: 5 minutes

**Total time to resolve: 10-15 minutes**

---

## Advisor Confidence Levels

| Advisor | Role | Confidence | Blockers |
|---------|------|-----------|----------|
| Thane | Systems Architect | HIGH ✅ | 0 |
| Nika | Contract Semanticist | HIGH ✅ | 0 |
| Harlan | Specification Engineer | MEDIUM ⚠️ | 2 (config reload, event durability) |
| Reva | UX & Mental Model Specialist | HIGH ✅ | 0 |
| Orion | Reliability Engineer | MEDIUM ⚠️ | 1 (init failures) |

**Consensus:** Phase 1 is ready once Harlan and Orion's blockers are resolved.

---

## What Improved in Updated PRD

✅ **Genesis cleanly deferred to Phase 2** — no scope bloat
✅ **Cross-project isolation explicit** — project_id tagging, session binding, isolation tests
✅ **Performance targets concrete** — <500ms discovery, <100ms queries, <200MB memory
✅ **Behavioral contracts precise** — "OBSERVE and REPORT ONLY" for Genesis
✅ **Error handling documented** — corrupted .git/, symlinks, event log cap
✅ **Mental models clarified** — git boundary = project, ROOT_DIR explicit

---

## What Wasn't Improved (Deferred to Phase 2)

| Feature | Phase |
|---------|-------|
| Genesis agent spawning & session management | Phase 2 |
| Genesis budget enforcement | Phase 2 |
| Resource copying UI | Phase 2 |
| Portfolio event dashboard | Phase 2 |
| Genesis status visibility | Phase 2 |
| First-boot UX | Phase 2 |

These are **not blockers** because they're properly scoped to Phase 2.

---

## Recommended Next Steps

### 1. Author Resolves Blockers (10-15 min)

Add 3 sections to PRD 020:

**Section 4.2 — Configuration Reload Behavior:**
```
Bridge loads .method/project-config.yaml once at startup.
Edits require bridge restart: npm run bridge:stop && npm run bridge
Future enhancement (Phase 2+): Add POST /projects/:id/reload-config for manual reload.
```

**Section 4.1 — Event Log Durability:**
```
Phase 1: Events are in-memory only, capped at 10K, FIFO pruned on overflow.
Events are lost on bridge restart (acceptable for Phase 1).
Phase 2: Persistent YAML log will be added when Genesis requires event history.
```

**Section 4.1 — Initialization Failure Handling:**
```
If .method/ creation fails for one project (permission denied, disk full):
- Bridge logs warning with project_id and error reason
- Project is registered but marked initialization_status: "failed"
- Bridge continues startup with remaining projects (does not abort)
- User can fix issues and run POST /projects/rescan to retry
```

### 2. Steering Council Reviews & Approves (30 min)

- Review the 3 clarifications
- Confirm Phase 2 scope (Genesis, UI, resource copying)
- Sign off on Phase 1 implementation plan

### 3. Begin Phase 1 Implementation (2-3 weeks)

Deliverables:
- ProjectDiscovery service (recursive .git scan)
- ProjectRegistry (in-memory)
- Event aggregation with project_id tagging
- API endpoints (GET /projects, POST /projects/rescan, GET /projects/:id/events)
- Unit tests (isolation, performance, error handling)
- E2E test (portfolio discovery flow)

---

## Document Structure

| Document | Purpose | Audience | Read Time |
|----------|---------|----------|-----------|
| `PHASE_A_RECHECK_SUMMARY.txt` | High-level overview of all findings | Steering council, project leads | 5 min |
| `PHASE_1_BLOCKERS_TO_RESOLVE.md` | Detailed explanation of 3 blockers + recommended solutions | Author, architects | 15 min |
| `RECHECK_PHASE_A_RESULTS.md` | Full advisor summaries, findings by advisor | Reviewers, implementers | 30 min |
| `ADVISOR_FINDINGS_MATRIX.yaml` | Structured data: all findings, verdicts, evidence | CI/CD, dashboards | — |

---

## Files to Update in PRD 020

**File:** `docs/prds/020-multi-project-bridge.md`

**Sections to add:**

1. **Section 4.2** (after project-config.yaml schema):
   - Subsection: "Configuration Reload Behavior"

2. **Section 4.1** (after "Event Aggregation"):
   - Subsection: "Event Log Durability"

3. **Section 4.1** (after "Startup sequence"):
   - Subsection: "Initialization Failure Handling"

See `PHASE_1_BLOCKERS_TO_RESOLVE.md` for exact prose templates.

---

## FAQ

**Q: Does Phase 1 block on any other issues?**

A: No. The 3 blockers above are the only critical gaps. Other findings are either:
- Already addressed (FIXED: 25 items)
- Partially addressed with clear paths forward (PARTIAL: 10 items)
- Appropriately deferred to Phase 2 (OUTDATED: 8 items)

**Q: How confident are advisors that Phase 1 will succeed once blockers are resolved?**

A: Very confident. All 5 advisors give HIGH confidence after blockers are resolved:
- Thane, Nika, Reva already at HIGH
- Harlan upgrades to HIGH once config reload and event durability are specified
- Orion upgrades to HIGH once init failure handling is specified

**Q: Can Phase 1 implementation start before blockers are resolved?**

A: No. These 3 items directly impact implementation decisions:
- Config reload affects bridge startup logic and file watching strategy
- Event durability affects storage architecture
- Init failure handling affects error recovery and degraded mode

**Q: What's the timeline?**

A:
- Resolve blockers: 10-15 min (author)
- Steering council review: 30 min
- Phase 1 implementation: 2-3 weeks
- Total: 3-4 weeks to Phase 1 completion

**Q: Is Genesis really Phase 2?**

A: Yes. Genesis (spawning, polling, initialization) is cleanly deferred. Phase 1 provides the foundation (ProjectRegistry + event API) that Genesis will consume in Phase 2.

---

## Contact

Questions about this re-review? See the main report:
- **Lead Reviewers:** Thane (architecture), Nika (semantics), Harlan (specs), Reva (UX), Orion (reliability)
- **Report Author:** Phase A Orchestrator
- **Date:** 2026-03-20
