# @method/fca-index — FCA Index Library

L3 hybrid-index library for FCA-compliant TypeScript projects. Indexes co-located component documentation using SQLite (metadata + filters) and LanceDB (vector embeddings), enabling token-efficient semantic search over a codebase's architecture.

## Purpose

Agents working in large FCA codebases spend significant tokens on context gathering — reading files and directories to find relevant code. This library eliminates that overhead by pre-indexing every FCA component's documentation and exposing a semantic query surface.

Two operating modes:
- **Discovery mode** — coverage < threshold (default 0.8). Results include coverage scores so agents know which components are well-documented.
- **Production mode** — coverage ≥ threshold. Index is fully trusted; queries return clean results.

## Public API

```typescript
import { createFcaIndex, createDefaultFcaIndex } from '@method/fca-index';

// Production use — wires NodeFileSystem, SqliteLanceIndexStore, VoyageEmbeddingClient
const index = await createDefaultFcaIndex({ projectRoot, voyageApiKey });

// Scan project and populate index
await index.scan();

// Semantic query — returns ranked ComponentContext[]
const result = await index.query.query({ query: 'session lifecycle management', topK: 5 });

// Full component text — interface excerpt + docText + part file locations  
const detail = await index.detail.getDetail({ projectRoot, componentPath: 'src/domains/sessions' });

// Coverage report — overall score, per-part breakdown, per-component scores
const report = await index.coverage.getCoverageReport({ projectRoot });

// Compliance suggestions — FCA stubs for missing parts
const suggestion = await index.compliance.getSuggestion({ projectRoot, componentPath: '...' });
```

## CLI

```bash
fca-index scan <projectRoot> [--verbose]          # Index all components
fca-index query <projectRoot> <query> [--topK=5]   # Semantic search
fca-index coverage <projectRoot> [--verbose]       # Coverage report (exits 1 if below threshold)
fca-index detail <projectRoot> <componentPath>     # Full component text
fca-index suggest <projectRoot> <componentPath>    # FCA compliance stubs (--apply to write)
```

## Configuration — .fca-index.yaml

```yaml
excludePatterns:
  - packages/playground/**
  - experiments/**
sourcePatterns:
  - packages/*/src/**
coverageThreshold: 0.8
indexDir: .fca-index
```

## Architecture

```
src/
  scanner/      — FCA component detection and coverage scoring
  query/        — Semantic search via embedding + vector store
  coverage/     — Coverage reporting and threshold enforcement
  compliance/   — FCA stub generation for missing parts
  index-store/  — SQLite (metadata) + Lance (vectors) hybrid store
  cli/          — CLI entry point and command runners
  ports/        — Frozen port interfaces (ContextQueryPort, ManifestReaderPort, ...)
  testkit/      — Recording doubles for testing consumers
```
