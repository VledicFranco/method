# PRD 020 Phase A Re-Review Results
## Advisor Re-Check Against Revised PRD 020

**Date:** 2026-03-20
**Status:** Phase 1 ready with 3 critical clarifications required
**Consensus:** YES to Phase 1 implementation after specification gaps resolved

---

## Executive Summary

The updated PRD 020 is **substantially improved**:
- Genesis cleanly deferred to Phase 2 (no scope creep)
- Cross-project isolation is explicit and testable
- Performance targets are concrete (discovery <500ms, queries <100ms)
- Behavioral contracts are precise (Genesis "observe and report only")

**Critical gaps blocking Phase 1 implementation (3 items):**
1. **Project config reload semantics** — hot reload, manual trigger, or static load?
2. **Event log durability** — persistent YAML or in-memory only?
3. **Partial project initialization failure handling** — abort, skip+log, or retry?

**Estimated time to resolve:** 10-15 minutes of clarification prose.

---

## Verdict Tally

| Verdict | Count | Status |
|---------|-------|--------|
| FIXED | 25 | Fully addressed |
| PARTIAL | 10 | Partially addressed; implementation notes needed |
| OPEN | 3 | Unresolved blockers |
| OUTDATED | 8 | No longer relevant (Phase 2 deferred) |

**Confidence Distribution:**
- Thane (Systems Architect): HIGH ✅
- Nika (Contract Semanticist): HIGH ✅
- Harlan (Specification Engineer): MEDIUM ⚠️ (waiting on 2 clarifications)
- Reva (UX Specialist): HIGH ✅
- Orion (Reliability Engineer): MEDIUM ⚠️ (waiting on 1 clarification)

---

## Critical Blockers (Must Resolve)

### 1. F-HARLAN-3: Project Config Reload Not Specified
**Finding:** If human edits `.method/project-config.yaml`, when does bridge reload it?

**Status:** OPEN - BLOCKER

**Evidence Gap:** Section 4.2 says "If present: bridge loads and validates..." but no mention of reload semantics. Complete silence on hot reload, manual reload trigger, change detection, or re-initialization.

**Decision Required:**
- Option A: **Hot reload on file change** — monitor `.method/project-config.yaml` for edits, automatically reload
- Option B: **Manual reload endpoint** — add `POST /projects/:id/reload-config` endpoint
- Option C: **Static load-once** — bridge loads on startup, restart required to pick up edits (current assumption)

**Recommendation:** Option C (static load-once) is simplest for Phase 1. Document clearly to prevent user confusion.

---

### 2. F-HARLAN-7: Event Log Durability Undefined
**Finding:** Are events persisted to disk? In-memory only? Recovery on restart?

**Status:** OPEN - BLOCKER

**Evidence Gap:** Section 4.1 says "accumulated at root level (.method/genesis-events.yaml or in-memory store)" — two options mentioned, zero decision made. No YAML serialization format, no durability guarantees, no recovery strategy.

**Decision Required:**
- Option A: **Persistent to `.method/genesis-events.yaml`** — YAML format, survives bridge restart, human can inspect/edit
- Option B: **In-memory only** — events lost on bridge restart; caveat: suitable for Phase 1 if Genesis (Phase 2) is only consumer

**Recommendation:** Option A (persistent YAML) is safer. Document exact schema (timestamp format, project_id tagging, event type enum).

---

### 3. F-ORION-5: Partial Project Initialization Failure Not Handled
**Finding:** If `.method/` creation fails for one project (permission denied, disk full), does bridge abort or continue?

**Status:** OPEN - needs clarification

**Evidence Gap:** Section 4.1 says "For each found: register as project, create .method/ if missing" — no failure handling documented.

**Decision Required:**
- Option A: **Abort on first failure** — bridge startup fails if any project init fails (safest, prevents silent errors)
- Option B: **Log and skip** — bridge continues with partially initialized portfolio (allows degraded operation)
- Option C: **Retry with exponential backoff** — complex; defer to Phase 2 if needed

**Recommendation:** Option B (log and skip) — allows bridge to start even if one project has permission issues. Document clearly: "Projects with inaccessible .method/ directories are registered but marked as degraded."

---

## Important Gaps (Non-Blocking, but Recommended for Phase 1)

### Minor Gaps by Advisor

| Advisor | Finding | Gap | Recommendation |
|---------|---------|-----|-----------------|
| Thane | F-THANE-2 | No default project-config.yaml template | Document exact YAML template in Phase 1 implementation guide |
| Thane | F-THANE-3 | Phase 1 validation is basic | Add unit tests for project-config schema validation and id consistency |
| Thane | F-THANE-4 | No end-to-end portfolio discovery test | Add explicit e2e test: spawn bridge, verify all projects discovered, all configs valid |
| Nika | F-NIKA-5 | Event aggregation backpressure reactive only | Document 10K cap + FIFO pruning behavior; defer proactive backpressure to Phase 2 |
| Harlan | F-HARLAN-2 | Event log filtering schema basic | Document available filters (project_id, since_cursor); defer advanced filtering (type, date range) to Phase 2 |

---

## Deferred to Phase 2 (Not Blockers)

These findings were originally flagged but are appropriately deferred:

| Feature | Advisors | Rationale |
|---------|----------|-----------|
| Genesis agent (spawning, session management) | Thane, Nika | Deferred to Phase 2; Phase 1 provides foundation (event API) |
| Genesis budget enforcement + 80% escalation | Nika, Orion | Phase 2 responsibility when Genesis is spawned |
| Genesis restart/crash recovery | Nika | Phase 2 scope; not applicable to Phase 1 (no Genesis) |
| Resource copying UI | Reva | Phase 2; API endpoints exist, UI deferred |
| Portfolio event aggregation dashboard | Reva | Phase 2; Phase 1 provides event filtering via API |
| Project semantic organization (tags/categories) | Reva | Valid Phase 2+ feature request; not essential for Phase 1 |
| Genesis status visibility in dashboard | Reva | Phase 2 responsibility when Genesis is spawned |
| First-boot UX/onboarding | Reva | Phase 2; Phase 1 can provide JSON status endpoint |

---

## Detailed Advisor Summaries

### THANE (Systems Architect): HIGH CONFIDENCE ✅

**Findings Check:**
- F-THANE-1: Phase 1 overscoped — **FIXED** (Genesis deferred)
- F-THANE-2: project-config.yaml init underspecified — **PARTIAL** (schema provided; template docs missing)
- F-THANE-3: Validation blind spot — **PARTIAL** (basic validation; cross-schema validation deferred)
- F-THANE-4: No e2e discovery test — **PARTIAL** (isolation tests present; e2e test missing)
- F-THANE-5: Genesis rules not concrete — **FIXED** ("OBSERVE and REPORT ONLY" now explicit)
- F-THANE-6: Performance metrics missing — **FIXED** (startup <2s, discovery <500ms, queries <100ms)

**Overall:** Phase 1 scope is tight and achievable. No critical blockers from Thane's perspective.

---

### NIKA (Contract Semanticist): HIGH CONFIDENCE ✅

**Findings Check:**
- F-NIKA-1: Report-only constraint violated — **FIXED** (Genesis tools are read-only; execution control deferred to human)
- F-NIKA-2: Genesis semantics confused — **FIXED** (observer role is explicit; no coordinator responsibilities)
- F-NIKA-3: Persistent agent budgeting — **OUTDATED** (Genesis Phase 2; not applicable to Phase 1)
- F-NIKA-4: Genesis violates methodology intent — **FIXED** (Genesis is meta-orchestration, not delivery agent)
- F-NIKA-5: Event aggregation backpressure — **PARTIAL** (10K cap adequate; proactive backpressure deferred)
- F-NIKA-6: Cross-project isolation not validated — **FIXED** (project_id tagging enforced; isolation tests specified)
- F-NIKA-7: Human interaction model undefined — **PARTIAL** (Phase 2 scope; Genesis → human flow sketched)
- F-NIKA-8: Genesis restart failure unhandled — **OUTDATED** (Phase 2 responsibility)

**Overall:** Semantics and contracts are now clear. Phase 1 is contract-compliant.

---

### HARLAN (Specification Engineer): MEDIUM CONFIDENCE ⚠️

**Findings Check:**
- F-HARLAN-1: Discovery timing ambiguous — **FIXED** (one-time on startup; optional manual rescan via POST /projects/rescan)
- F-HARLAN-2: Event filtering schema undefined — **PARTIAL** (project_id + cursor filtering specified; advanced filtering deferred)
- F-HARLAN-3: Project config reload not specified — **OPEN** (BLOCKER — must choose: hot reload, manual trigger, or static load)
- F-HARLAN-4: Session→project binding implicit — **FIXED** (explicit in API design; project_id embedded in metadata)
- F-HARLAN-5: Gitignore precedence undefined — **FIXED** (per-project wins in conflicts)
- F-HARLAN-6: Genesis access control missing — **OUTDATED** (Phase 2 responsibility)
- F-HARLAN-7: Event log durability undefined — **OPEN** (BLOCKER — must choose: persistent YAML or in-memory)
- F-HARLAN-8: Genesis budget enforcement missing — **OUTDATED** (Phase 2 responsibility)

**Overall:** Two critical specification gaps block Phase 1. Once resolved (10 min), Phase 1 can proceed.

---

### REVA (UX & Mental Model Specialist): HIGH CONFIDENCE ✅

**Findings Check:**
- F-REVA-1: Project discovery mental model ambiguous — **FIXED** (git boundary = project boundary is now explicit)
- F-REVA-2: Copy methodology UI location unspecified — **PARTIAL** (Phase 2 feature; API specified, UI deferred)
- F-REVA-3: Genesis status visibility afterthought — **PARTIAL** (Phase 2 scope; UX not designed)
- F-REVA-4: ROOT_DIR scope breaks mental models — **FIXED** (users can set ROOT_DIR explicitly)
- F-REVA-5: Portfolio event dashboard undefined — **PARTIAL** (Phase 2 scope; API filtering in Phase 1)
- F-REVA-6: Project copy UI doesn't solve semantic org — **OPEN** (but acceptable deferral; valid Phase 2+ request)
- F-REVA-7: Genesis token budget model vague — **PARTIAL** (numbers clear [50K/day, 80% threshold]; UI design Phase 2)
- F-REVA-8: First-boot experience undesigned — **PARTIAL** (technical flow documented; UX design Phase 2)

**Overall:** Phase 1 foundation is clear. UX enhancements are Phase 2+. No Phase 1 blockers.

---

### ORION (Reliability & Error Handling Engineer): MEDIUM CONFIDENCE ⚠️

**Findings Check:**
- F-ORION-1: Corrupted .git/ crashes discovery — **FIXED** (log warning and skip documented)
- F-ORION-2: Genesis token exhaustion mid-session — **OUTDATED** (Phase 2 responsibility)
- F-ORION-3: Project name collisions via symlinks — **FIXED** (real-path deduplication documented)
- F-ORION-4: Event log unbounded growth — **FIXED** (10K cap + FIFO pruning)
- F-ORION-5: Partial project init failures not handled — **OPEN** (BLOCKER — must document failure mode)
- F-ORION-6: Methodology version conflicts on copy — **OUTDATED** (Phase 2 responsibility)

**Overall:** One critical gap blocks Phase 1 confidence. Once clarified, Orion's concerns are addressed.

---

## Recommended Action Plan

### Immediate (10-15 min): Resolve 3 Blockers

**Author adds 3 subsections to PRD 020:**

1. **Section 4.1, after "Startup sequence", add: "Config Reload Behavior"**
   ```
   When human edits .method/project-config.yaml in a project:
   - Bridge loads project-config.yaml once at startup
   - Edits to project-config.yaml require bridge restart to take effect
   - Alternative: POST /projects/rescan rescans all projects and reloads all configs

   Rationale: Static load-once is simplest for Phase 1; hot reload can be Phase 2+ enhancement.
   ```

2. **Section 4.1, after "Event Aggregation", add: "Event Log Durability"**
   ```
   Events are accumulated in-memory during bridge runtime.
   Event log persistence (to .method/genesis-events.yaml) is Phase 2 responsibility (when Genesis is spawned).
   Phase 1 design: events are lost on bridge restart (acceptable for Phase 1; Genesis polling and event APIs are Phase 2).

   Alternative design: Persist to .method/genesis-events.yaml in Phase 1 with YAML schema:
   [example YAML schema with timestamp, project_id, type, content]

   Recommended: In-memory for Phase 1; persistent for Phase 2 when Genesis requires durability.
   ```

3. **Section 4.1, after "For each found...", add: "Initialization Failure Handling"**
   ```
   If .method/ directory creation fails for a project (e.g., permission denied, disk full):
   - Bridge logs warning with project ID and error reason
   - Project is registered but marked as "init_failed"
   - Bridge continues startup with remaining projects (does not abort)
   - Human can resolve permission/disk issues and run POST /projects/rescan to retry

   Rationale: Allows bridge to start even if one project has issues; prevents cascading failures.
   ```

### Short-term (After Clarifications): Steering Council Sign-Off

1. Review the 3 clarifications
2. Confirm Phase 2 scope (Genesis, UI, resource copying)
3. Approve Phase 1 implementation kick-off

### Phase 1 Implementation

With clarifications in place, proceed with confidence:
- ProjectDiscovery + ProjectRegistry services
- Event aggregation with project_id tagging
- API endpoints (GET /projects, POST /projects/rescan, GET /projects/:id/events)
- Unit tests for isolation, performance, error handling
- E2E test for portfolio discovery flow

**Timeline:** Estimate 2-3 weeks for Phase 1 delivery (based on scope).

---

## Key Improvements in Updated PRD 020

✅ **Genesis cleanly deferred to Phase 2** — scope is no longer bloated
✅ **Cross-project isolation explicit** — project_id tagging in event schema, session binding API
✅ **Performance targets concrete** — <500ms discovery, <100ms queries, <200MB memory
✅ **Behavioral contracts precise** — "OBSERVE and REPORT ONLY" for Genesis, human controls execution
✅ **Error handling documented** — corrupted .git/ handling, symlink deduplication, 10K event cap
✅ **Mental models clarified** — git boundary = project boundary, ROOT_DIR explicit

---

## Conclusion

**Phase 1 is ready to proceed** after 3 minor clarification sections are added to the PRD (estimated 10-15 minutes of writing).

The revised PRD 020 is substantially stronger than the original. Genesis deferral removes complexity, isolation is now testable, and performance targets are measurable. Implementation confidence is high once the 3 specification gaps are filled.

**Next action:** Author revises PRD with 3 clarifications → Steering Council approval → Begin Phase 1 implementation.
