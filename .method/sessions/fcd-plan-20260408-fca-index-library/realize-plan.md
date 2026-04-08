# Realization Plan — PRD 053: @method/fca-index

**Date:** 2026-04-08
**PRD:** docs/prds/053-fca-index-library.md
**Plan session:** .method/sessions/fcd-plan-20260408-fca-index-library/

---

## PRD Summary

**Objective:** Build `@method/fca-index` — a universal L3 library that indexes FCA-compliant
projects using hybrid SQLite + Lance embedding store over co-located documentation. Enables
agents to retrieve relevant code context with a single typed query at < 20% of current
grep-based token cost.

**Success criteria:** SC-1 (token ≤ 20% baseline), SC-2 (80% query precision), SC-3 (coverage
score correlation r ≥ 0.85), SC-4 (mode safety), SC-5 (scan ≤ 60s), SC-6 (all gates green).

---

## FCA Partition

| Commission | Domain | Wave | Title | Depends On | Consumed Ports |
|------------|--------|------|-------|------------|----------------|
| C-1 | scanner | 1 | FCA part detection + scanning | Wave 0 | ManifestReaderPort, FileSystemPort |
| C-2 | index-store | 1 | SQLite + Lance + embedding client | Wave 0 | EmbeddingClientPort, IndexStorePort (iface) |
| C-3 | query | 2 | ContextQueryPort implementation | C-2 | IndexStorePort (impl from C-2) |
| C-4 | coverage | 2 | CoverageReportPort implementation | C-2 | IndexStorePort (impl from C-2) |
| C-5 | cli | 3 | CLI commands + composition root | C-1, C-3, C-4 | ManifestReaderPort, ContextQueryPort, CoverageReportPort |
| C-6 | wiring + testkit + gates | 3 | Factory, testkit, gate tests, integration | C-1, C-2, C-3, C-4 | All ports |

---

## Wave 0 — Shared Surfaces (Orchestrator-Owned)

**Status: APPLIED.** All Wave 0 artifacts written during the design + planning session.

### External Port Interfaces (frozen — all 3 co-designed)

| Port | File | Record |
|------|------|--------|
| ContextQueryPort | `packages/fca-index/src/ports/context-query.ts` | `.method/sessions/fcd-surface-fca-index-mcp/record.md` |
| ManifestReaderPort + ProjectScanConfig | `packages/fca-index/src/ports/manifest-reader.ts` | `.method/sessions/fcd-surface-fca-index-project/record.md` |
| CoverageReportPort | `packages/fca-index/src/ports/coverage-report.ts` | `.method/sessions/fcd-surface-fca-index-cli/record.md` |

### Internal Port Interfaces (frozen inline — plan Phase 2)

| Port | File | Consumers |
|------|------|-----------|
| FileSystemPort | `packages/fca-index/src/ports/internal/file-system.ts` | scanner (C-1) |
| EmbeddingClientPort | `packages/fca-index/src/ports/internal/embedding-client.ts` | index-store (C-2) |
| IndexStorePort + IndexEntry + IndexQueryFilters + IndexCoverageStats | `packages/fca-index/src/ports/internal/index-store.ts` | query (C-3), coverage (C-4) |

### Testkit Recording Doubles (external consumers)

| Double | File | Used By |
|--------|------|---------|
| RecordingContextQueryPort | `packages/fca-index/src/testkit/recording-context-query-port.ts` | @method/mcp tests |
| RecordingCoverageReportPort | `packages/fca-index/src/testkit/recording-coverage-report-port.ts` | @method/mcp tests |

### Package Scaffold

| Artifact | File | Notes |
|----------|------|-------|
| Public API barrel | `packages/fca-index/src/index.ts` | Re-exports external port types; createFcaIndex() added in C-6 |
| Architecture gate stubs | `packages/fca-index/src/architecture.test.ts` | 4 stubs pass trivially; C-6 fills in real assertions |

### Verification

```bash
# After Wave 0: TypeScript must compile with zero errors
npx tsc --noEmit
```

---

## Wave 1 — Core Domains (Parallel)

### C-1: scanner domain

```yaml
id: C-1
title: "FCA part detection, documentation extraction, coverage scoring, project scanner"
domain: scanner
wave: 1
scope:
  allowed_paths:
    - packages/fca-index/src/scanner/**
    - packages/fca-index/tests/fixtures/**          # fixture FCA project for scanner tests
  forbidden_paths:
    - packages/fca-index/src/ports/**               # orchestrator-owned — never touch
    - packages/fca-index/src/index-store/**
    - packages/fca-index/src/query/**
    - packages/fca-index/src/coverage/**
    - packages/fca-index/src/cli/**
    - packages/fca-index/src/testkit/**
    - packages/fca-index/src/index.ts
    - packages/fca-index/package.json
depends_on: []                                      # Wave 0 ports available
parallel_with: [C-2]
consumed_ports:
  - name: ManifestReaderPort
    status: frozen
    record: .method/sessions/fcd-surface-fca-index-project/record.md
  - name: FileSystemPort
    status: frozen
    record: packages/fca-index/src/ports/internal/file-system.ts
produced_ports: []
deliverables:
  - packages/fca-index/src/scanner/fca-detector.ts
  - packages/fca-index/src/scanner/doc-extractor.ts
  - packages/fca-index/src/scanner/coverage-scorer.ts
  - packages/fca-index/src/scanner/project-scanner.ts
  - packages/fca-index/src/scanner/fca-detector.test.ts
  - packages/fca-index/src/scanner/doc-extractor.test.ts
  - packages/fca-index/src/scanner/coverage-scorer.test.ts
  - packages/fca-index/src/scanner/project-scanner.test.ts
  - packages/fca-index/src/scanner/README.md
  - packages/fca-index/tests/fixtures/sample-fca-l2-domain/     # fixture: minimal L2 domain
  - packages/fca-index/tests/fixtures/sample-fca-l3-package/    # fixture: L3 with ports/
documentation_deliverables:
  - packages/fca-index/src/scanner/README.md — document FCA detection heuristics table
acceptance_criteria:
  - "fca-detector correctly classifies README.md → documentation, index.ts exports → interface,
    ports/*.ts → port, *.test.ts → verification, *.metrics.ts → observability"  # → SC-3
  - "doc-extractor produces excerpts ≤ 600 chars for README (first paragraph) and
    interface (exported signatures)"  # → SC-2
  - "coverage-scorer computes score = presentRequiredParts / totalRequiredParts"  # → SC-3
  - "project-scanner walks fixture project and produces IndexEntry[] with correct parts,
    paths, and coverage scores"  # → SC-3
  - "All scanner unit tests pass. G-PORT gate: no node:fs imports in scanner/"  # → SC-6
estimated_tasks: 5
branch: feat/053-fca-index-c1-scanner
status: pending
```

---

### C-2: index-store domain

```yaml
id: C-2
title: "SQLite schema, Lance vector store, IndexStorePort implementation, VoyageEmbeddingClient"
domain: index-store
wave: 1
scope:
  allowed_paths:
    - packages/fca-index/src/index-store/**
  forbidden_paths:
    - packages/fca-index/src/ports/**
    - packages/fca-index/src/scanner/**
    - packages/fca-index/src/query/**
    - packages/fca-index/src/coverage/**
    - packages/fca-index/src/cli/**
    - packages/fca-index/src/testkit/**
    - packages/fca-index/src/index.ts
    - packages/fca-index/package.json
depends_on: []
parallel_with: [C-1]
consumed_ports:
  - name: EmbeddingClientPort
    status: frozen
    record: packages/fca-index/src/ports/internal/embedding-client.ts
  - name: IndexStorePort (interface)
    status: frozen
    record: packages/fca-index/src/ports/internal/index-store.ts
produced_ports:
  - name: IndexStorePort
    implementations: [SqliteLanceIndexStore, InMemoryIndexStore]
deliverables:
  - packages/fca-index/src/index-store/sqlite-store.ts      # SQLite schema + CRUD
  - packages/fca-index/src/index-store/lance-store.ts       # Lance vector table
  - packages/fca-index/src/index-store/embedding-client.ts  # VoyageEmbeddingClient
  - packages/fca-index/src/index-store/index-store.ts       # SqliteLanceIndexStore (IndexStorePort)
  - packages/fca-index/src/index-store/in-memory-store.ts   # InMemoryIndexStore (test double)
  - packages/fca-index/src/index-store/sqlite-store.test.ts
  - packages/fca-index/src/index-store/lance-store.test.ts
  - packages/fca-index/src/index-store/index-store.contract.test.ts   # contract test (both impls)
  - packages/fca-index/src/index-store/README.md
documentation_deliverables:
  - packages/fca-index/src/index-store/README.md — SQLite schema, Lance table schema, embedding strategy
acceptance_criteria:
  - "IndexStorePort contract test passes against both SqliteLanceIndexStore and InMemoryIndexStore"
  - "upsertComponent + queryBySimilarity roundtrip: upserted entry appears in similarity results"
  - "queryByFilters applies level/parts/minCoverageScore filters correctly"
  - "getCoverageStats returns correct weightedAverage and byPart fractions"
  - "G-PORT gate: no node:fetch or HTTP client imports in index-store/"         # → SC-6
  - "VoyageEmbeddingClient handles rate-limit with exponential backoff (unit test with stub)"
estimated_tasks: 6
branch: feat/053-fca-index-c2-index-store
status: pending
```

---

## Wave 2 — Query and Coverage (Parallel, both depend on C-2)

### C-3: query domain

```yaml
id: C-3
title: "ContextQueryPort implementation — hybrid similarity + filter retrieval"
domain: query
wave: 2
scope:
  allowed_paths:
    - packages/fca-index/src/query/**
  forbidden_paths:
    - packages/fca-index/src/ports/**
    - packages/fca-index/src/scanner/**
    - packages/fca-index/src/index-store/**
    - packages/fca-index/src/coverage/**
    - packages/fca-index/src/cli/**
    - packages/fca-index/src/testkit/**
    - packages/fca-index/src/index.ts
    - packages/fca-index/package.json
depends_on: [C-2]
parallel_with: [C-4]
consumed_ports:
  - name: IndexStorePort
    status: frozen
    record: packages/fca-index/src/ports/internal/index-store.ts
    implementation: InMemoryIndexStore (from C-2) for unit tests
  - name: EmbeddingClientPort
    status: frozen
    record: packages/fca-index/src/ports/internal/embedding-client.ts
    note: QueryEngine needs to embed the query string before calling IndexStorePort
produced_ports:
  - name: ContextQueryPort
    implementation: QueryEngine
deliverables:
  - packages/fca-index/src/query/query-engine.ts         # ContextQueryPort implementation
  - packages/fca-index/src/query/result-formatter.ts     # IndexEntry → ComponentContext + IndexMode
  - packages/fca-index/src/query/query-engine.test.ts    # unit tests with InMemoryIndexStore
  - packages/fca-index/src/query/query-engine.golden.test.ts  # 20-query golden set (SC-2)
  - packages/fca-index/src/query/README.md
documentation_deliverables:
  - packages/fca-index/src/query/README.md — hybrid retrieval strategy, IndexMode determination
acceptance_criteria:
  - "query() returns results sorted by relevanceScore descending"
  - "topK filter limits result count"
  - "parts/levels/minCoverageScore filters are applied (unit test with known fixture data)"
  - "mode is 'production' when overallScore >= threshold, 'discovery' otherwise"
  - "20-query golden test set: ≥ 16/20 queries include the correct domain in top-5"   # → SC-2
  - "ContextQueryError(INDEX_NOT_FOUND) thrown when index is empty for projectRoot"   # → SC-4
estimated_tasks: 4
branch: feat/053-fca-index-c3-query
status: pending
```

---

### C-4: coverage domain

```yaml
id: C-4
title: "CoverageReportPort implementation — coverage computation + mode detection"
domain: coverage
wave: 2
scope:
  allowed_paths:
    - packages/fca-index/src/coverage/**
  forbidden_paths:
    - packages/fca-index/src/ports/**
    - packages/fca-index/src/scanner/**
    - packages/fca-index/src/index-store/**
    - packages/fca-index/src/query/**
    - packages/fca-index/src/cli/**
    - packages/fca-index/src/testkit/**
    - packages/fca-index/src/index.ts
    - packages/fca-index/package.json
depends_on: [C-2]
parallel_with: [C-3]
consumed_ports:
  - name: IndexStorePort
    status: frozen
    record: packages/fca-index/src/ports/internal/index-store.ts
    implementation: InMemoryIndexStore (from C-2) for unit tests
produced_ports:
  - name: CoverageReportPort
    implementation: CoverageEngine
deliverables:
  - packages/fca-index/src/coverage/coverage-engine.ts    # CoverageReportPort implementation
  - packages/fca-index/src/coverage/mode-detector.ts      # IndexMode from CoverageStats + config
  - packages/fca-index/src/coverage/coverage-engine.test.ts
  - packages/fca-index/src/coverage/README.md
documentation_deliverables:
  - packages/fca-index/src/coverage/README.md — mode determination logic, coverage arithmetic
acceptance_criteria:
  - "getReport(verbose=false) returns summary-only CoverageReport (no components array)"
  - "getReport(verbose=true) returns summary + ComponentCoverageEntry[] sorted by coverageScore asc"
  - "CoverageSummary.byPart fractions match IndexCoverageStats.byPart"
  - "meetsThreshold=true when overallScore >= threshold, false otherwise"
  - "CoverageReportError(INDEX_NOT_FOUND) thrown when index is empty"
  - "Threshold boundary test: overallScore exactly equals threshold → meetsThreshold=true"
estimated_tasks: 3
branch: feat/053-fca-index-c4-coverage
status: pending
```

---

## Wave 3 — CLI + Wiring (Parallel, both depend on Wave 2)

### C-5: cli domain

```yaml
id: C-5
title: "CLI commands: scan, coverage, query — plus composition root"
domain: cli
wave: 3
scope:
  allowed_paths:
    - packages/fca-index/src/cli/**
  forbidden_paths:
    - packages/fca-index/src/ports/**
    - packages/fca-index/src/scanner/**
    - packages/fca-index/src/index-store/**
    - packages/fca-index/src/query/**
    - packages/fca-index/src/coverage/**
    - packages/fca-index/src/testkit/**
    - packages/fca-index/src/index.ts
    - packages/fca-index/package.json
depends_on: [C-1, C-3, C-4]
parallel_with: [C-6]
consumed_ports:
  - name: ManifestReaderPort
    status: frozen
    record: .method/sessions/fcd-surface-fca-index-project/record.md
  - name: ContextQueryPort
    status: frozen
    record: .method/sessions/fcd-surface-fca-index-mcp/record.md
    implementation: QueryEngine (from C-3)
  - name: CoverageReportPort
    status: frozen
    record: .method/sessions/fcd-surface-fca-index-cli/record.md
    implementation: CoverageEngine (from C-4)
  - name: FileSystemPort
    status: frozen
    record: packages/fca-index/src/ports/internal/file-system.ts
  - name: IndexStorePort
    status: frozen
    record: packages/fca-index/src/ports/internal/index-store.ts
produced_ports: []
deliverables:
  - packages/fca-index/src/cli/index.ts            # CLI entry point (commander.js)
  - packages/fca-index/src/cli/scan-command.ts     # fca-index scan [--project <root>]
  - packages/fca-index/src/cli/coverage-command.ts # fca-index coverage [--verbose]
  - packages/fca-index/src/cli/query-command.ts    # fca-index query "<text>"
  - packages/fca-index/src/cli/scan-command.test.ts
  - packages/fca-index/src/cli/coverage-command.test.ts
  - packages/fca-index/src/cli/README.md
documentation_deliverables:
  - packages/fca-index/src/cli/README.md — command reference + composition wiring
acceptance_criteria:
  - "fca-index scan --project <root> completes without error on method-2 monorepo"   # → SC-5
  - "fca-index coverage --verbose renders CoverageReport summary + byPart table to stdout"
  - "fca-index query '<text>' renders top-5 ComponentContext results to stdout"
  - "G-BOUNDARY gate: cli/ imports only from ports/ — not from scanner/, query/, coverage/"  # → SC-6
  - "All CLI commands print useful error when index not found (no crash)"
estimated_tasks: 5
branch: feat/053-fca-index-c5-cli
status: pending
```

---

### C-6: package wiring + testkit extensions + architecture gates + integration

```yaml
id: C-6
title: "createFcaIndex() factory, testkit builders, gate test implementation, integration test"
domain: wiring
wave: 3
scope:
  allowed_paths:
    - packages/fca-index/src/index.ts              # add createFcaIndex() export
    - packages/fca-index/src/factory.ts            # new: factory implementation
    - packages/fca-index/src/testkit/**            # extend with builders + InMemoryIndexStore re-export
    - packages/fca-index/src/architecture.test.ts  # fill in real gate assertions
    - packages/fca-index/package.json
    - packages/fca-index/tsconfig.json
    - packages/fca-index/tests/integration/**      # integration test
  forbidden_paths:
    - packages/fca-index/src/ports/**
    - packages/fca-index/src/scanner/**
    - packages/fca-index/src/index-store/**
    - packages/fca-index/src/query/**
    - packages/fca-index/src/coverage/**
    - packages/fca-index/src/cli/**
depends_on: [C-1, C-2, C-3, C-4]
parallel_with: [C-5]
consumed_ports:
  - name: All external ports (ContextQueryPort, ManifestReaderPort, CoverageReportPort)
    status: frozen
  - name: All internal ports (IndexStorePort, FileSystemPort, EmbeddingClientPort)
    status: frozen
produced_ports: []
deliverables:
  - packages/fca-index/src/factory.ts                          # createFcaIndex() wires all domains
  - packages/fca-index/src/index.ts                            # updated: export createFcaIndex
  - packages/fca-index/src/testkit/component-context-builder.ts
  - packages/fca-index/src/testkit/coverage-report-builder.ts
  - packages/fca-index/src/testkit/project-scan-config-builder.ts
  - packages/fca-index/src/testkit/index.ts                    # testkit barrel export
  - packages/fca-index/src/architecture.test.ts                # filled in: real scanImports assertions
  - packages/fca-index/package.json
  - packages/fca-index/tsconfig.json
  - packages/fca-index/tests/integration/full-scan.test.ts     # scan → query → verify SC-1, SC-5
documentation_deliverables:
  - Update packages/fca-index/src/index.ts JSDoc with createFcaIndex() usage example
acceptance_criteria:
  - "createFcaIndex({ projectRoot }) returns { contextQuery: ContextQueryPort,
    coverageReport: CoverageReportPort }"                                         # → SC-1
  - "Testkit: componentContextBuilder().withPath().withLevel().build() produces valid ComponentContext"
  - "All 4 architecture gates implemented and passing (G-PORT-SCANNER, G-PORT-QUERY,
    G-BOUNDARY-CLI, G-LAYER)"                                                     # → SC-6
  - "Integration test: scan method-2 monorepo, query 'session lifecycle', top-3 includes
    src/domains/sessions/"                                                         # → SC-2
  - "Integration test: full scan completes in ≤ 60 seconds"                       # → SC-5
  - "npm test passes with zero failures across all domains"
estimated_tasks: 6
branch: feat/053-fca-index-c6-wiring
status: pending
```

---

## Acceptance Gates (PRD → Commission Mapping)

| SC | Criterion | Commission |
|----|-----------|-----------|
| SC-1 | Token ≤ 20% baseline | C-6 integration test |
| SC-2 | Query precision ≥ 80% | C-3 golden test + C-6 integration |
| SC-3 | Coverage score correlation r ≥ 0.85 | C-1 + C-4 |
| SC-4 | Mode safety in discovery mode | C-3 + C-4 |
| SC-5 | Scan ≤ 60 seconds | C-5 + C-6 integration |
| SC-6 | All architecture gates green | C-6 |

---

## Status Tracker

```
Total: 6 commissions, 4 waves (Wave 0 applied + Waves 1–3)

Wave 0 (surfaces):         ✅ APPLIED
Wave 1 (C-1, C-2):         ⏳ pending  [parallel]
Wave 2 (C-3, C-4):         ⏳ pending  [parallel, unblocks after C-2]
Wave 3 (C-5, C-6):         ⏳ pending  [parallel, unblocks after Wave 2 + C-1]

Completed: 0 / 6
```

---

## Execution

```bash
# Execute a commission:
# /fcd-commission --plan .method/sessions/fcd-plan-20260408-fca-index-library/realize-plan.md --commission C-1

# Run tests after each commission:
npm test

# Verify TypeScript compiles:
npx tsc --noEmit
```

**Next:** Spawn C-1 and C-2 in parallel (Wave 1).
