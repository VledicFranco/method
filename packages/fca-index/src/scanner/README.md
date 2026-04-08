# Scanner Domain — @method/fca-index

The scanner domain walks a project's source tree and produces `ScannedComponent[]` — a list of
FCA components with their detected parts, coverage scores, and documentation text.

## FCA Part Detection Heuristics

Each file in a component directory is matched against these rules, in order.
**First matching rule wins** — a file satisfies at most one part.

| File Pattern | FCA Part |
|---|---|
| `README.md`, `*.md` (excluding test files) | `documentation` |
| `index.ts` with `export` keywords | `interface` |
| `ports/` subdirectory (any `.ts` file) | `port` |
| `*port.ts`, `*.port.ts`, `*-port.ts` | `port` |
| `*.test.ts`, `*.spec.ts`, `*.contract.test.ts` | `verification` |
| `observability/` subdirectory | `observability` |
| `*.metrics.ts`, `*.observability.ts` | `observability` |
| `arch/` subdirectory | `architecture` |
| `architecture.ts` | `architecture` |
| `domain/` subdirectory | `domain` |
| `*-domain.ts` | `domain` |
| Any `.ts` file in a subdirectory | `boundary` |

Subdirectory-based rules (ports/, observability/, arch/, domain/) are evaluated using the first
`.ts` file found in that subdirectory as the representative `filePath`.

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

Each candidate directory is assigned an FCA level using these rules (checked in order):

1. **L3** — directory contains a `package.json` file (is a package)
2. **L2** — directory is named `src/` AND contains `index.ts`
3. **L1** — directory contains exactly 1 TypeScript file and no subdirectories
4. **L2** — otherwise (default for well-structured components)

## How to Use ProjectScanner

ProjectScanner requires constructor injection of three dependencies:

```typescript
import { ProjectScanner } from './project-scanner.js';
import { FcaDetector } from './fca-detector.js';
import { CoverageScorer } from './coverage-scorer.js';
import type { FileSystemPort } from '../ports/internal/file-system.js';

// Provide a FileSystemPort implementation (e.g., NodeFileSystem for production)
const fs: FileSystemPort = new NodeFileSystem();

const scanner = new ProjectScanner(
  fs,
  new FcaDetector(fs),
  new CoverageScorer(),
);

const components = await scanner.scan({
  projectRoot: '/path/to/project',
  sourcePatterns: ['src/**', 'packages/*/src/**'],  // glob patterns
  requiredParts: ['interface', 'documentation'],     // for coverage scoring
  excludePatterns: [],
});
```

### ProjectScanConfig

| Field | Default | Description |
|---|---|---|
| `projectRoot` | (required) | Absolute path to project root |
| `sourcePatterns` | `['src/**', 'packages/*/src/**']` | Glob patterns for source trees |
| `excludePatterns` | `[]` | Patterns to exclude |
| `requiredParts` | `['interface', 'documentation']` | Parts required for 100% coverage |
| `coverageThreshold` | `0.8` | Production mode graduation threshold |

## Testing

Scanner code uses `InMemoryFileSystem` for unit tests — no real filesystem access required.

```typescript
import { InMemoryFileSystem } from './test-helpers/in-memory-fs.js';

const fs = new InMemoryFileSystem({
  '/project/src/index.ts': 'export interface Foo {}',
  '/project/src/README.md': '# Foo\n\nDescription.',
});
```

See `fca-detector.test.ts`, `doc-extractor.test.ts`, `coverage-scorer.test.ts`, and
`project-scanner.test.ts` for full test coverage.

## Architecture Constraint (G-PORT-SCANNER)

Scanner domain code MUST NOT import `node:fs` or `node:path` directly.
All filesystem access goes through `FileSystemPort`. This is enforced by `G-PORT-SCANNER`
in `src/architecture.test.ts`.
