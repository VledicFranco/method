---
guide: 38
title: "fca-index: Getting Started"
domain: fca-index
audience:
  - developers
  - agent-operators
summary: >-
  Scan a project with fca-index, query for code context, and understand discovery vs production mode.
prereqs: []
touches:
  - packages/fca-index/src/
  - packages/fca-index/src/ports/context-query.ts
  - packages/fca-index/src/ports/coverage-report.ts
  - packages/fca-index/src/factory.ts
---

# Guide 38 — fca-index: Getting Started

## What is fca-index?

When an agent navigates a codebase, file-search heuristics — recursive greps, directory listings, manifest reads — consume 30–60% of the context window before any real work begins. In a 50-component FCA project, finding the right three components for a task can require 30+ file reads.

`@methodts/fca-index` solves this with a semantic index. After a one-time scan, a single typed query returns ranked component descriptors — paths, part file locations, and excerpts — without reading any source files. The agent selects which files to read from the results. Token cost drops below 20% of grep-based search.

## Prerequisites

- An FCA-compliant project. Components must follow the FCA directory and naming conventions — the scanner detects components by structure, not by config file.
- `VOYAGE_API_KEY` environment variable set. The Voyage AI API is required for embedding during scan and query. Get a key at voyageai.com.
- `better-sqlite3` native module. This installs automatically with `npm install @methodts/fca-index` if your platform has Node.js native build tools. On Windows, install Visual Studio Build Tools first.

## Installation

In a workspace:

```json
{
  "dependencies": {
    "@methodts/fca-index": "workspace:*"
  }
}
```

Or from npm:

```bash
npm install @methodts/fca-index
```

The CLI is available after build as `fca-index`:

```bash
npm run build
npx fca-index --help
```

A standalone MCP server is also bundled as `fca-index-mcp`, which any MCP-compatible client (Claude Code, etc.) can consume directly — no `@methodts/mcp` needed. See Guide 39 for `.mcp.json` config.

## Step 1: Scan your project

The scan reads the project's FCA structure, extracts documentation, scores coverage, and builds the SQLite + Lance index.

**CLI:**

```bash
export VOYAGE_API_KEY=your_key
fca-index scan /path/to/project
# Indexed 42 components
```

**Programmatic:**

```typescript
import { createDefaultFcaIndex } from '@methodts/fca-index';

const fca = await createDefaultFcaIndex({
  projectRoot: '/path/to/project',
  voyageApiKey: process.env.VOYAGE_API_KEY!,
});

const { componentCount } = await fca.scan();
console.log(`Indexed ${componentCount} components`);
```

The index is written to `.fca-index/` at the project root (configurable via `indexDir`). Re-run `scan` to refresh after code changes.

## Step 2: Query for context

Queries use natural language. The engine embeds your query and returns the most semantically similar components.

**CLI:**

```bash
fca-index query /path/to/project "session lifecycle management"
fca-index query /path/to/project "rate limiting middleware" --topK=3
fca-index query /path/to/project "port interfaces" --parts=port,interface
```

**Programmatic:**

```typescript
const result = await fca.query.query({
  query: 'session lifecycle management',
  topK: 5,
  parts: ['port', 'interface'],   // optional: filter by FCA part
  levels: ['L2', 'L3'],           // optional: filter by FCA level
  minCoverageScore: 0.5,          // optional: skip poorly-documented components
});

console.log(`Mode: ${result.mode}`);
for (const c of result.results) {
  console.log(`${c.path} (${c.level}) — relevance: ${c.relevanceScore.toFixed(2)}`);
  for (const p of c.parts) {
    console.log(`  ${p.part}: ${p.filePath}`);
  }
}
```

The result includes `mode` (`discovery` or `production`) and a ranked `results` array. Each result is a `ComponentContext` — not file contents. Read the files you care about after reviewing the results.

## Step 3: Check coverage

Coverage tells you how complete the index is and whether it is in discovery or production mode.

**CLI:**

```bash
fca-index coverage /path/to/project
# [mode: discovery]
# Coverage: 0.72 / threshold 0.80  ✗
#
# By part:
#   documentation    0.91 ██████████████████░░
#   interface        0.87 █████████████████░░░
#   port             0.34 ██████░░░░░░░░░░░░░░
#   ...

fca-index coverage /path/to/project --verbose
# + per-component breakdown, sorted by coverage score ascending
```

**Programmatic:**

```typescript
const report = await fca.coverage.getReport({
  projectRoot: '/path/to/project',
  verbose: true,
});

console.log(`Mode: ${report.mode}`);
console.log(`Overall: ${report.summary.overallScore.toFixed(2)}`);
console.log(`Meets threshold: ${report.summary.meetsThreshold}`);
```

## Understanding coverage scores

Coverage measures how completely each FCA component is documented across the eight structural parts:

| Part | What it checks |
|------|----------------|
| `interface` | Exported types and public API signatures |
| `boundary` | Module boundary declarations |
| `port` | Port interface definitions |
| `domain` | Domain logic documentation |
| `architecture` | Architecture decision records |
| `verification` | Test coverage and invariants |
| `observability` | Logging, metrics, tracing |
| `documentation` | README and co-located markdown |

By default, only `interface` and `documentation` are required for a component to reach `coverageScore = 1.0`. Change `requiredParts` in your config to raise the bar.

**Component score:** fraction of required parts present. `1.0` = all required parts found.

**Overall score:** weighted average across all components.

**To improve coverage:**

1. Run `fca-index coverage --verbose` to see which components score lowest.
2. Add the missing FCA parts (typically a README, an interface file, or a port definition).
3. Re-run `fca-index scan` to rebuild the index.
4. Repeat until `overallScore >= coverageThreshold` (default 0.8) and the mode flips to `production`.

## Programmatic API with custom ports

`createFcaIndex()` is the ports-injected factory. Use it when you need custom wiring (tests, custom stores, custom embedders):

```typescript
import { createFcaIndex } from '@methodts/fca-index';
import { InMemoryIndexStore } from '@methodts/fca-index/index-store';
import { NodeFileSystem } from '@methodts/fca-index/cli';
import { DefaultManifestReader } from '@methodts/fca-index/cli';
import { VoyageEmbeddingClient } from '@methodts/fca-index/index-store';

const store = new InMemoryIndexStore();
const fs = new NodeFileSystem();
const manifestReader = new DefaultManifestReader(fs);
const embedder = new VoyageEmbeddingClient({
  apiKey: process.env.VOYAGE_API_KEY!,
  model: 'voyage-3-lite',
  dimensions: 512,
});

const fca = createFcaIndex(
  { projectRoot: '/path/to/project', coverageThreshold: 0.9 },
  { fileSystem: fs, embedder, store, manifestReader },
);
```

## Using InMemoryIndexStore for tests

For fast unit tests that don't need a real filesystem or embedding service:

```typescript
import { createFcaIndex } from '@methodts/fca-index';
import { InMemoryIndexStore } from '@methodts/fca-index/index-store';

const store = new InMemoryIndexStore();

// Pre-populate the store
await store.upsertComponent({
  id: 'abc123',
  projectRoot: '/project',
  path: 'src/domains/sessions/',
  level: 'L2',
  parts: [{ part: 'port', filePath: 'src/domains/sessions/ports.ts' }],
  coverageScore: 0.85,
  embedding: new Array(512).fill(0),
  indexedAt: new Date().toISOString(),
});

const fca = createFcaIndex(
  { projectRoot: '/project' },
  { fileSystem: mockFs, embedder: mockEmbedder, store, manifestReader: mockManifest },
);
```

For testing consumers of the external ports (not internals), use `RecordingContextQueryPort` from `@methodts/fca-index/testkit` — see `src/testkit/README.md`.

## Configuration

Create `.fca-index.yaml` at the project root to override defaults:

```yaml
# .fca-index.yaml
coverageThreshold: 0.9
requiredParts:
  - interface
  - documentation
  - port
embeddingModel: voyage-3-lite
embeddingDimensions: 512
indexDir: .fca-index
sourcePatterns:
  - src/**
  - packages/*/src/**
excludePatterns:
  - src/generated/**
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `coverageThreshold` | `number` | `0.8` | Minimum score for production mode |
| `requiredParts` | `FcaPart[]` | `['interface', 'documentation']` | Parts required for full coverage |
| `embeddingModel` | `string` | `'voyage-3-lite'` | Voyage AI model name |
| `embeddingDimensions` | `number` | `512` | Vector dimensions (must match model) |
| `indexDir` | `string` | `'.fca-index'` | Index storage directory (relative to project root) |
| `sourcePatterns` | `string[]` | `['src/**', 'packages/*/src/**', ...]` | Glob patterns for FCA source trees |
| `excludePatterns` | `string[]` | `[]` | Project-specific exclusions |
| `languages` _(v0.4.0+)_ | `string[]` | `['typescript']` | Built-in language profiles to apply. See "Polyglot projects" below. |

## Polyglot projects (v0.4.0+)

By default, the scanner detects TypeScript components only. To scan a project with multiple languages — say a TS frontend and a Scala backend in the same repo — list the language profiles in `.fca-index.yaml`:

```yaml
# .fca-index.yaml
languages:
  - typescript
  - scala
```

Or as an inline flow list:

```yaml
languages: [typescript, scala]
```

Five built-in profiles ship: `typescript` (default), `scala`, `python`, `go`, and `markdown-only`. Each profile carries language-specific file/dir → FCA part rules and component qualification logic. When multiple profiles are active, the scanner unions their rules — a directory qualifies as a component if any active profile considers it one, and each file is classified by the first profile rule that matches.

### Default `sourcePatterns` differ between TS-only and polyglot

When you don't set `sourcePatterns` in `.fca-index.yaml`, the scanner derives defaults from the active profile list:

| Active profiles | Default `sourcePatterns` |
|---|---|
| `[typescript]` (the v0.3.x default) | `['src/**', 'packages/*/src/**']` |
| Anything else (polyglot or non-TS) | `['src/**', 'packages/**/src/**', 'modules/**', 'apps/**']` |

The polyglot defaults use `packages/**/src/**` (recursive) so nested layouts like `packages/apps/<pkg>/src/**` (common in larger monorepos) are reached without custom config. The implicit `**/node_modules/**` exclude prevents the broader walk from descending into transitive dependencies.

If your repo has source roots outside these patterns (e.g. `services/<svc>/src/**`, `cmd/**`), set `sourcePatterns` explicitly:

```yaml
languages: [typescript, scala]
sourcePatterns:
  - src/**
  - services/*/src/**
  - cmd/**
```

For a worked example of authoring a custom `LanguageProfile`, the full per-language rule reference, file-classification ordering rules, and migration notes, see **Guide 40 — fca-index Language Profiles**.
