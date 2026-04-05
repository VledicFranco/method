---
type: fcd-review-report
target: ".method/sessions/fcd-design-20260405-cost-governor/prd.md"
date: "2026-04-05"
reviewers: [surface-compliance, reliability, security]
advisors_dispatched: 3
findings_total: 58
findings_critical: 12
findings_high: 21
fix_now_applied: 29
port_compliance: FAIL_REMEDIATED
---

# FCD Review Report — PRD 051 Cost Governor

## Summary

Adversarial review of the Cost Governor PRD (first draft) surfaced 58 findings across 3 advisor agents. **Port compliance: FAIL** on initial submission — 4 critical port-location/layer/convention violations and 3 critical credential-safety gaps. All Fix Now items were applied to the PRD in place; the revised PRD is ready for `/fcd-plan`.

## Advisors Dispatched

| Advisor | Findings | CRITICAL | HIGH | MEDIUM | LOW |
|---|---|---|---|---|---|
| Surface Compliance | 20 | 4 | 4 | 7 | 5 |
| Reliability | 23 | 5 | 9 | 6 | 3 |
| Security | 15 | 3 | 8 | 4 | 0 |
| **Total** | **58** | **12** | **21** | **17** | **8** |

A 4th advisor (PRD Quality / Test Coverage) was scoped but not dispatched — the 3 advisors produced sufficient signal to proceed with remediation.

## Top Port-Priority Findings (CRITICAL)

### Surface Compliance
- **F-SC-01** Domain-scoped `ports/` subdirs conflict with top-level `packages/bridge/src/ports/` convention. 
- **F-SC-02** `shared/canonical-types/` directory doesn't exist; entities belong in `@method/types` (L0).
- **F-SC-03** "cost-governor at L2" layer misclaim — it's an L4 bridge domain.
- **F-SC-04** Throttler in pacta consuming bridge-owned RateGovernor reverses layer direction.

### Reliability
- **F-R-1** Slot-leak on provider throw/abort/crash (no watchdog, no AsyncDisposable discipline).
- **F-R-2** JSONL silent data loss (no fsync policy, no per-line skip, no rotation).
- **F-R-3** Empty-history estimator could return 0 USD → bypass throttling → cost runaway.
- **F-R-4** Account saturation = indefinite block (timeoutMs was optional).
- **F-R-5** Token-bucket clock drift on NTP jumps / laptop sleep.

### Security
- **F-S-1** `ProviderHandle.credentials` raw map leaks via `util.inspect`, spread, structuredClone, template literals. `toJSON()` alone insufficient.
- **F-S-2** `CLAUDE_ACCOUNTS_JSON` single-blob env var = all-credentials-in-one-leak surface.
- **F-S-3** `accountId` in cost events leaks to operator-configured webhook connectors.

## Synthesis Consensus

All 12 CRITICAL findings converged on **FIX NOW** — none were downgradable. They split into:
- **7 structural** (ports, layers, canonical types, discriminated unions, sealed credentials) → PRD edits.
- **5 operational-invariant specs** (slot lifecycle, JSONL durability, estimator safety, clock math, event sanitization) → new "Operational Invariants & Recovery" section.

21 HIGH findings: 17 Fix Now (spec additions), 4 deferred to waves.
17 MEDIUM + 8 LOW: 8 deferred to risks/notes, rest rolled into spec additions.

## Fix Now Items Applied (29)

### Port & Surface Structural (11)
1. Moved 4 port files to `packages/bridge/src/ports/` top-level.
2. Canonical types → `@method/types` (L0).
3. Layer reclassified: cost-governor is L4 bridge domain.
4. Throttler Option A: pacta defines base `RateGovernor`, bridge extends via `BridgeRateGovernor`.
5. `SealedCredentials` opaque type with custom `[util.inspect.custom]`/`Symbol.toPrimitive`/`toJSON` all returning `[REDACTED]`.
6. `AccountConfig` → discriminated union by `providerClass`.
7. `AccountRouter.register()` removed; factory `createAccountRouter(configs)` construction.
8. Port minimality: removed `estimateSignature`, `countBySignature`; added DTOs (`AccountSummary`); defined `AccountRoutingPlan`.
9. `CostEvent` discriminated union with 9 typed payloads + `@sensitive` annotations.
10. S9 marked as hard blocker for Wave 2 in Surface Summary table.
11. Branded types `SlotId`, `AccountId`.

### Operational Invariant Specs (12)
12. Slot lifecycle: maxLifetimeMs, required timeoutMs, watchdog, AsyncDisposable, G-SLOT-PARITY AST gate.
13. JSONL durability: HMAC-per-line, monthly rotation, 90d rollup, 0600 perms, advisory lock, capability `AppendToken`.
14. Estimator safety: floor charges, minimum bucket charge, confidence warning in dry-run.
15. Token-bucket clock safety: monotonic clock, snapshots, resume-from-sleep detection.
16. Retry cost reconciliation: 1.5× up-front reservation + refund matrix + provider attempt reporting.
17. Rate-limit classification: structured parse first, corpus test, version check.
18. Env var purge at boot: delete `ANTHROPIC_*` after AccountRouter loads.
19. Per-account preflight + health probes + circuit breaker (promoted to Wave 3).
20. Event coalescing (per-account per-10s window); correlationId in all events.
21. Auth posture: all `/cost-governor/*` routes admin-scope; tiered utilization; hashed accountIds for non-admin.
22. MCP `strategy_dry_run` opt-in `revealAccountPlan` flag.
23. Tri-layer G-CREDENTIALS (AST + canary + regex).

### Migration & Safety (6)
24. S9 migration audit: grep `.code`, `.name`, `.message.includes`, `JSON.stringify(err)`; dual-emit for 2 versions.
25. V6 expanded to tri-layer validation.
26. V8 new: Observations integrity + recovery.
27. V9 new: Slot-leak detection.
28. Wave 2 spike expanded: HOME vs env precedence, Windows HOME, claude-cli version matrix, 429 corpus.
29. Wave 0 + 2 blockers made explicit in Surface Summary and Wave descriptions.

## Deferred Items (16)

Documented in PRD's "Deferred Items" section — acknowledged but not blocking:
- F-SC-18, F-R-16, F-R-18, F-R-20, F-R-22, F-S-12, F-S-13.
- F-SC-16/17 branding — partially applied (SlotId, AccountId done).
- F-SC-19 gate naming alignment — done inline.
- F-R-15 bucket snapshot across restart — done (Wave 3).

## Verdict

**Port compliance: PASS** (after remediation). All CRITICAL and HIGH Fix Now items applied to PRD in place.

**Next steps:**
1. `/fcd-plan` against revised PRD to generate commissions.
2. `/fcd-surface` session for S9 Provider Error Taxonomy (blocks Wave 2).
3. Wave 2 spike plan (HOME override precedence) as prerequisite work.

## Artifacts

- Revised PRD: `.method/sessions/fcd-design-20260405-cost-governor/prd.md`
- This report: `.method/sessions/fcd-review-20260405-prd051/report.md`
