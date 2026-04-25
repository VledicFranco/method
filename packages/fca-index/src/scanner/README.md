# Scanner Domain — @methodts/fca-index

The scanner domain walks a project's source tree and produces `ScannedComponent[]` — a list
of FCA components with their detected parts, coverage scores, and documentation text.

## FCA Part Detection — Profile-Driven (v0.4.0+)

Since v0.4.0, the rules that decide which file or subdirectory satisfies which FCA part
are NOT hardcoded — they come from one or more `LanguageProfile`s passed to the scanner.

```
ProjectScanner ─uses─▶ FcaDetector ─dispatches─▶ LanguageProfile.filePatterns
                                                  LanguageProfile.subdirPatterns
                                                  LanguageProfile.componentRule
```

A `LanguageProfile` (defined in `profiles/types.ts`) carries five things:

| Field | Purpose |
|---|---|
| `sourceExtensions` | File extensions for source files (e.g. `['.ts']`, `['.scala']`). Drives boundary detection + L1 single-file detection. |
| `packageMarkers` | Files whose presence at a directory root marks it as L3 (e.g. `package.json`, `build.sbt`). |
| `filePatterns` | Ordered `RegExp → FcaPart` rules applied to every file. First match across all active profiles wins per file. |
| `subdirPatterns` | `dirName → FcaPart` rules. A direct child directory whose name matches contributes the corresponding part. |
| `componentRule` | `interfaceFile?` (e.g. `index.ts`, `package.scala`, `__init__.py`, `doc.go`) and `minSourceFiles` for component qualification. |
| `extractInterfaceExcerpt?` / `extractDocBlock?` | Optional language-specific extractors used by `DocExtractor`. Defaults to a generic first-600-chars excerpt when absent. |

Active profiles are passed as the optional 4th constructor argument to `ProjectScanner`
(and 2nd argument to `FcaDetector`/`DocExtractor`). When omitted, the default is
`[typescriptProfile]` — preserving v0.3.x behavior bit-for-bit.

### TypeScript profile rules (default — same as v0.3.x)

| File / Subdir | FCA Part |
|---|---|
| `README.md`, `*.md` (excluding `*.test.md`) | `documentation` |
| `index.ts` (with `export` keyword) | `interface` |
| `*.test.ts`, `*.spec.ts`, `*.contract.test.ts` | `verification` |
| `architecture.ts` | `architecture` |
| `*.metrics.ts`, `*.observability.ts` | `observability` |
| `*port.ts` (incl. `*.port.ts`, `*-port.ts`) | `port` |
| `*-domain.ts` | `domain` |
| `ports/` subdirectory | `port` |
| `observability/` subdirectory | `observability` |
| `arch/` subdirectory | `architecture` |
| `domain/` subdirectory | `domain` |
| Any subdirectory containing source files | `boundary` |

For other built-in profiles (Scala, Python, Go, markdown-only) and for authoring custom
profiles, see **Guide 40 — fca-index Language Profiles**.

## ScannedComponent Type

```typescript
interface ScannedComponent {
  /** Deterministic ID: sha256(projectRoot + ':' + relativePath), hex prefix 16 chars. */
  id: string;

  /** Absolute path to the project root. */
  projectRoot: string;

  /** Path relative to projectRoot. E.g. 'src/domains/sessions'. */
  path: string;

  /** FCA structural level of this component. */
  level: FcaLevel;

  /** Detected FCA parts with file locations and excerpts. */
  parts: Array<{ part: FcaPart; filePath: string; excerpt: string }>;

  /** Coverage score in [0, 1]: detected required parts / total required parts. */
  coverageScore: number;

  /** All part excerpts concatenated with '\n\n' — used for embedding downstream. */
  docText: string;

  /** ISO 8601 timestamp when this component was scanned. */
  indexedAt: string;
}
```

## Level Detection Logic

Level is decided per directory using the union of all active profiles:

1. **L3** — directory contains any active profile's `packageMarkers` entry
   (e.g. `package.json` for TS, `build.sbt` / `*.sbt` for Scala, `pyproject.toml` /
   `setup.py` / `setup.cfg` for Python, `go.mod` / `go.sum` for Go).
2. **L2** — directory is named `src/` AND contains an interface file from any active profile
   (`index.ts`, `package.scala`, `__init__.py`, `doc.go`).
3. **L1** — directory contains exactly 1 source file (any active extension) and no subdirectories.
4. **L2** — otherwise (default for well-structured components).

## How to Use ProjectScanner

```typescript
import { ProjectScanner } from './project-scanner.js';
import { FcaDetector } from './fca-detector.js';
import { CoverageScorer } from './coverage-scorer.js';
import { typescriptProfile, scalaProfile } from './profiles/index.js';
import type { FileSystemPort } from '../ports/internal/file-system.js';

// Provide a FileSystemPort implementation (e.g., NodeFileSystem for production)
const fs: FileSystemPort = new NodeFileSystem();

// Default — TypeScript only
const scanner = new ProjectScanner(
  fs,
  new FcaDetector(fs),                     // implicit [typescriptProfile]
  new CoverageScorer(),
);

// Polyglot — TypeScript + Scala
const polyglot = new ProjectScanner(
  fs,
  new FcaDetector(fs, [typescriptProfile, scalaProfile]),
  new CoverageScorer(),
  [typescriptProfile, scalaProfile],
);

const components = await polyglot.scan({
  projectRoot: '/path/to/project',
  sourcePatterns: ['src/**', 'modules/**'],
  requiredParts: ['interface', 'documentation'],
  excludePatterns: [],
});
```

In production, use the `createFcaIndex` / `createDefaultFcaIndex` factories from the
package root — they handle the wiring and resolve `languages: [...]` from
`.fca-index.yaml` automatically.

### ProjectScanConfig

| Field | Default | Description |
|---|---|---|
| `projectRoot` | (required) | Absolute path to project root |
| `sourcePatterns` | TS-only: `['src/**', 'packages/*/src/**']`; polyglot: also `'modules/**', 'apps/**'` | Glob patterns for source trees |
| `excludePatterns` | `[]` | Patterns to exclude (in addition to TS test/dts excludes) |
| `requiredParts` | `['interface', 'documentation']` | Parts required for 100% coverage |
| `coverageThreshold` | `0.8` | Production mode graduation threshold |
| `languages` | `undefined` | Names of built-in profiles to apply (e.g. `['typescript', 'scala']`). Defaults to `['typescript']` when absent. |

## Testing

Scanner code uses `InMemoryFileSystem` for unit tests — no real filesystem access required.
On-disk fixtures live under `packages/fca-index/tests/fixtures/sample-fca-{lang}/` and are
exercised by `fixtures-scan.test.ts` against the real `NodeFileSystem`.

```typescript
import { InMemoryFileSystem } from './test-helpers/in-memory-fs.js';

const fs = new InMemoryFileSystem({
  '/project/src/index.ts': 'export interface Foo {}',
  '/project/src/README.md': '# Foo\n\nDescription.',
});
```

See `fca-detector.test.ts`, `doc-extractor.test.ts`, `coverage-scorer.test.ts`,
`project-scanner.test.ts`, `profiles/profiles.test.ts`, `polyglot-scan.test.ts`, and
`fixtures-scan.test.ts` for full coverage.

## Architecture Constraint (G-PORT-SCANNER)

Scanner domain code MUST NOT import `node:fs` or `node:path` directly.
All filesystem access goes through `FileSystemPort`. This is enforced by `G-PORT-SCANNER`
in `src/architecture.test.ts`.
