# Commission: prd-044-completion
**Date:** 2026-03-31
**Branch:** feat/prd-044-completion
**Iteration:** 0 / 5

## Task Spec
Complete PRD-044 — three gaps between "merged" and "fully done per spec".

## Domain
Single-wave commission touching three files in two packages:
1. `packages/bridge/src/shared/architecture.test.ts` — Gap 1: add G-PRD044-GLYPHREPORT gate
2. `packages/bridge/src/domains/strategies/strategy-parser.ts` — Gap 2: add 6 PRD-044 type re-exports
3. `packages/bridge/frontend/src/domains/reports/README.md` — Gap 3: domain README (new file)

## Consumed Ports
| Port | Status | Notes |
|------|--------|-------|
| `architecture.test.ts` helpers (`collectTsFiles`, `extractImports`) | PASS | Already in file |
| `@methodts/methodts/strategy/dag-types.js` (6 types) | PASS | All 6 confirmed present |
| reports domain files | PASS | Documentation only |

## Produced Ports
- Extends `strategy-parser.ts` re-export surface (Gap 2) — no new port

## Tech Debt
- `collectTsFiles` extended to scan `.tsx` in addition to `.ts` — enables G-PRD044-GLYPHREPORT to check frontend component files, not just type files.

## Tasks
- [ ] Gap 1: Add G-PRD044-GLYPHREPORT gate + extend collectTsFiles to .tsx
- [ ] Gap 2: Add 6 type re-exports to strategy-parser.ts
- [ ] Gap 3: Create reports/README.md
- [ ] Acceptance: run arch gate, npm run build

## Acceptance Gates
| Gate | Command | Expected |
|------|---------|----------|
| Architecture gates | `node --import tsx --test "packages/bridge/src/shared/architecture.test.ts"` | 9 assertions, 0 fail |
| Bridge build | `npm run build` | exit 0 |
