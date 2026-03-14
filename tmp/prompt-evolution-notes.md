# Orchestrator Prompt Evolution — PRD 002 → PRD 003

## What changed

| Aspect | PRD 002 prompt | PRD 003 prompt | Why |
|--------|---------------|---------------|-----|
| **Retrospectives** | Not mentioned | Mandatory per-method retrospectives with full schema | RETRO-PROTO trial — need data |
| **Execution binding** | Implicit (always M3-TMP) | Explicit — agent must state which P1-EXEC method per step | Execution binding spec requires it |
| **δ_SD coverage** | 5 arms (plan, implement x2, review, audit) | 7 arms (+ section, architecture) | P2-SD v2.0 added M7-PRDS, M6-ARFN |
| **Architecture step** | Hardcoded as "update 3 docs" | Evaluated via δ_SD (task_type = architecture → M6-ARFN) | Should use the methodology, not ad-hoc |
| **PRD sectioning** | Not considered (PRD was small) | Evaluated via δ_SD (task_type = section → M7-PRDS) | PRD 003 has 5 phases — may need sectioning |
| **DR-04 boundary** | "MCP is thin wrapper" (ambiguous) | Includes formatting/logic boundary definition | Card evolved from PRD 002 retro |
| **Review** | "Optional if time permits" | Part of the standard loop (2d) | Should always review |
| **Drift audit** | Not mentioned | Triggered if 3+ sections implemented | M4-DDAG is part of the loop |
| **Session log** | At end | After each method completes | More granular tracking |
| **Per-method retros** | N/A | One YAML per method executed | RETRO-PROTO schema |

## Expected retrospectives from PRD 003

Assuming the agent follows the full loop for 5 phases:
- Up to 5 M5-PLAN retros (one per phase planned)
- Up to 5 M1-IMPL or M2-DIMPL retros (one per phase implemented)
- Up to 5 M6-ARFN retros (if architecture updates needed)
- 1 M7-PRDS retro (if PRD is sectioned)
- Up to 5 M3-PHRV retros (if phases are reviewed)

Realistically for a single session: 3-8 retrospectives depending on how many phases the agent completes.

## What we're testing

1. **Does the agent naturally produce useful retrospectives?** The schema is in the prompt — do the retros contain real observations or rote compliance?
2. **Does δ_SD routing work in practice?** The agent must evaluate task_type for each phase — do the operationalization criteria produce correct routing?
3. **Does execution binding add value?** The agent must state M3-TMP/M1-COUNCIL/M2-ORCH per step — does this produce better outcomes?
4. **Does the project card constrain usefully?** DR-03, DR-04 (with new boundary), DR-07 — do these catch real issues?
5. **Does the per-method retro cadence work?** Is it too much overhead? Do later retros decay in quality?
