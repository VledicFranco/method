# Commission Mandate — Feature Set C: Compliance Suggestion Engine

**Session:** fcd-commission-fca-feature-set-c
**Date:** 2026-04-09
**Iteration:** 0

## Task Summary

Implement the compliance suggestion engine: scan index for missing FCA parts,
generate stub templates, expose via CLI `suggest` command.
Surface co-designed and frozen: .method/sessions/fcd-surface-compliance-suggestion/record.md
See `tmp/agent-protocol-fca-index-features.md` sections C.0–C.3 for full spec.

## Domain
Primary: `packages/fca-index/src/compliance/` (new domain)
Also touches: `src/ports/compliance-suggestion.ts`, `src/cli/`, `src/factory.ts`, `src/index.ts`

## Build Commands
- build: `npm run build`
- test: `npm test`
- lint: `npx tsc --noEmit`

## Consumed Ports

| Port | Status | Notes |
|------|--------|-------|
| `ComplianceSuggestionPort` | PASS — frozen 2026-04-09 | `ports/compliance-suggestion.ts` |
| `IndexStorePort` (getByPath + getCoverageStats) | WARN-LEGACY | Already extended in Feature Set B |

## Produced Ports
- `ComplianceSuggestionPort` (produced by `ComplianceEngine`)

## Tasks

- [x] Task C1: Create `src/compliance/template-generator.ts`
- [x] Task C2: Create `src/compliance/compliance-engine.ts`
- [x] Task C3: Create `src/compliance/index.ts`
- [x] Task C4: Create `src/cli/commands/suggest.ts`
- [x] Task C5: Update `src/cli/index.ts` — add `suggest` subcommand
- [x] Task C6: Update `src/factory.ts` — add `compliance: ComplianceSuggestionPort`
- [x] Task C7: Update `src/index.ts` — export new types
- [x] Task C8: Update `src/architecture.test.ts` — G-BOUNDARY-COMPLIANCE gate
- [x] Task C9: Add `src/compliance/compliance-engine.test.ts` — 24 unit tests
- [x] Quality gates: build clean, 233 tests pass, architecture gates 6/6
