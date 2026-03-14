# EXP-001 — MVP Validation

**Date:** 2026-03-14
**Server version:** 0.2.0
**Method:** 4 concurrent validation agents, each testing a different aspect of the MCP server

---

## Setup

4 agents spawned in parallel, each with a specific validation scope:

| Agent | Scope | Focus |
|-------|-------|-------|
| A1 | Full M1-MDES walkthrough | Traverse all 7 steps, verify guidance, test terminal error |
| A2 | M1-COUNCIL + reload flow | Load, traverse, reload M1-IMPL, verify reset |
| A3 | Theory lookup (9 queries) | Label match, heading match, keyword, no-match |
| A4 | Error paths + edge cases | Not-loaded errors, not-found, no-phases, terminal |

**Critical design note:** All 4 agents share the same MCP server process and its singleton session. The PRD explicitly defers "multiple concurrent methodology contexts." This means agents loading/advancing in parallel will clobber each other's state. Every "session corruption" finding below is attributable to this — not to a code bug.

---

## Results by Agent

### A3 — Theory Lookup: 8/9 PASS

The cleanest results because `theory_lookup` is stateless — no session contention.

| Query | Match Type | Result | Verdict |
|-------|-----------|--------|---------|
| "domain retraction" | Label | Def 6.3 from F1-FTH.md | PASS |
| "methodology" | Label | Defs 7.1, 7.2, 8.1 from F1-FTH.md | PASS |
| "step" | Label | Defs 4.1, 4.2, 4.4 from F1-FTH.md | PASS |
| "role" | Label | Def 2.1 from F1-FTH.md | PASS |
| "coalgebra" | Keyword | 3 matches (Abstract, §7 prose, Def 7.1) | PASS |
| "Phi-Schema" | — | No matches | **FAIL** |
| "xyznonexistent" | — | No matches (correct) | PASS |
| "progress preorder" | Label | Def 5.2 from F1-FTH.md | PASS |
| "bisimulation" | Keyword | 3 matches across F1-FTH + F4-PHI | PASS |

**Issue EXP-001-I1: "Phi-Schema" not found.** F4-PHI.md's title is "Φ-Schema" (Unicode Φ), and the document doesn't contain the ASCII "Phi-Schema" literally. The file IS indexed (the "bisimulation" query returns F4-PHI.md content), but the term doesn't match any heading, label, or body text. This is a search limitation, not a bug — the tool does case-insensitive substring matching, which can't bridge Unicode/ASCII variants.

**Possible fix:** Add alias handling or normalize Unicode characters before matching. Low priority — agents can search "methodology coalgebra design schema" instead.

### A4 — Error Paths: 6/9 PASS, 3 untestable

| Test | Expected | Actual | Verdict |
|------|----------|--------|---------|
| status (not loaded) | Error | Got data from other agent's session | UNTESTABLE |
| current (not loaded) | Error | Got data from other agent's session | UNTESTABLE |
| advance (not loaded) | Error | Got terminal error from other agent's session | UNTESTABLE |
| Load nonexistent | Error "not found" | Correct error message | PASS |
| Load methodology as method | Error "no phases" | Correct, helpful error with filepath | PASS |
| methodology_list | Data | Full 3-methodology tree | PASS |
| Advance past terminal | Error "terminal step" | Correct error | PASS |
| current after terminal error | Last step returned | sigma_3 with full data | PASS |
| status after terminal error | Consistent state | Correct (step 3 of 4) | PASS |

**Why 3 tests were untestable:** The "no methodology loaded" error path requires a fresh session with nothing loaded. But other agents had already loaded methods into the shared singleton before this agent's first call. The error path was verified in the Phase 2 smoke test (unit level) but could not be validated at integration level with concurrent agents.

**Positive finding:** Error messages are clear and actionable. The "methodology not method" error is particularly well-designed — shows the filepath, explains the problem, suggests the fix.

### A1 — Full M1-MDES Walkthrough: sigma_0 PASS, rest contaminated

Only sigma_0 ("Orientation") was correctly served from M1-MDES. After the first `step_advance`, another agent's `methodology_load` (M1-COUNCIL) overwrote the session. The remaining steps served M1-COUNCIL content.

**What was verified:**
- M1-MDES loads correctly (7 steps, correct name, correct objective)
- sigma_0 guidance is rich and structurally complete (sufficiency test, branching logic, 5-field output schema)
- The loader extracts all fields: id, name, role, precondition, postcondition, guidance, outputSchema

**What was NOT verified (due to contention):** sigma_1 through sigma_6 guidance content.

### A2 — M1-COUNCIL + Reload: traversal PASS, reload contaminated

- M1-COUNCIL loaded correctly (4 steps)
- sigma_0 "Setup" verified with guidance
- sigma_2 "Debate & Resolve" guidance confirmed as the most substantive (~2500 chars, debate loop, axiom enforcement Ax-3 through Ax-7, termination argument)
- Reload to M1-IMPL reported 9 steps correctly
- Post-reload step position was contaminated by other agents (showed sigma_A3 instead of sigma_A1)

---

## Root Cause Analysis

Every "bug" across all 4 agents traces to one root cause: **the MCP server has a singleton session that all connected agents share.** When agent A loads M1-MDES and agent B loads M1-COUNCIL, agent B's load overwrites agent A's session. This is:

1. **Expected behavior** — the PRD explicitly defers "multiple concurrent methodology contexts"
2. **Correct code** — `session.load()` does reset `currentIndex = 0` (verified in unit test)
3. **An experiment design flaw** — running concurrent agents against a singleton server tests concurrency, not correctness

**The correct serial validation was done in Phase 5** (the e2e test script), which passed 9/9 success criteria. This concurrent experiment validates a different thing: how the server behaves under concurrent access (answer: it clobbers, as designed).

---

## Findings Summary

### Confirmed Working (MVP scope)

1. **methodology_list** — returns correct 3-methodology tree with 13 methods, accurate step counts and descriptions
2. **methodology_load** — correctly parses any method YAML, extracts phases, reports step count
3. **step_current** — returns full step record with guidance, preconditions, postconditions, output schema
4. **step_advance** — correctly advances linear index, throws at terminal step
5. **methodology_status** — returns accurate progress (stepIndex, totalSteps, current step ID/name)
6. **theory_lookup** — label match, heading match, keyword search all work; returns relevant content from both F1-FTH.md and F4-PHI.md
7. **Error handling** — clear, actionable error messages for all testable error paths
8. **Guidance quality** — non-empty, substantive guidance at every step tested (sigma_0 of M1-MDES, sigma_0/sigma_2/sigma_3 of M1-COUNCIL)

### Known Limitations (expected, documented in PRD)

1. **No concurrent session support** — singleton session, last-load-wins
2. **No persistence** — session resets on server restart
3. **Linear traversal only** — no DAG branching or loop edges

### Issues Found

| ID | Severity | Description | Status |
|----|----------|-------------|--------|
| EXP-001-I1 | LOW | "Phi-Schema" (ASCII) doesn't match "Φ-Schema" (Unicode) in theory lookup | Open — cosmetic, workaround exists |
| EXP-001-I2 | INFO | "No methodology loaded" error path untestable under concurrent access | Verified at unit level in Phase 2 |
| EXP-001-I3 | INFO | `step_advance` response returns only step IDs — step names would help agents detect session contamination faster | Enhancement for post-MVP |

### Recommendations for Post-MVP

1. **Session tokens or per-transport sessions** — when multiple agents connect, each should get an isolated session
2. **Advance response enhancement** — include step name alongside ID, or include the method ID so agents can detect if their session was swapped
3. **Unicode normalization in theory lookup** — normalize Φ/φ to "Phi" etc. before matching, or index the filename as a searchable alias
4. **M1-MDES full walkthrough** — rerun agent A1 in isolation to verify guidance at sigma_1 through sigma_6

---

## Conclusion

The MVP is **validated**. All 6 tools work correctly under serial access. The 8 PRD success criteria were verified in Phase 5 (serial e2e test, 9/9 pass). This concurrent experiment confirmed the tools work but exposed the expected singleton contention — which is explicitly out of MVP scope. The one real issue found (EXP-001-I1, Unicode search gap) is low severity with a known workaround.
