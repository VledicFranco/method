---
type: co-design-record
surface: ManifestReaderPort
date: "2026-04-08"
owner: "@method/fca-index"
producer: "consuming project (filesystem / .fca-index.yaml)"
consumer: "@method/fca-index scanner domain (internal)"
direction: "filesystem → fca-index scanner (unidirectional)"
status: frozen
mode: new
---

# Co-Design Record — ManifestReaderPort + ProjectScanConfig

## Nature of This Surface

Unlike a standard two-package port, this surface has a special character:
- The "producing side" is the consuming project's filesystem (a config file, not code)
- The library owns both the port interface AND the default implementation
- The co-design contract is ProjectScanConfig — the shape both sides agree on

The consuming project's "implementation" is either:
(a) A `.fca-index.yaml` file matching ProjectScanConfig, or
(b) Absence of config → library auto-detects FCA conventions (also a contract)

## Interface

```typescript
export interface ManifestReaderPort {
  read(projectRoot: string): Promise<ProjectScanConfig>;
}

export interface ProjectScanConfig {
  projectRoot: string;            // runtime-derived, never in .fca-index.yaml
  sourcePatterns?: string[];      // default: ['src/**', 'packages/*/src/**', ...]
  excludePatterns?: string[];     // default: []
  requiredParts?: FcaPart[];      // default: ['interface', 'documentation']
  coverageThreshold?: number;     // default: 0.8
  embeddingModel?: string;        // default: 'voyage-3-lite'
  embeddingDimensions?: number;   // default: 512
  indexDir?: string;              // default: '.fca-index'
}
```

## Minimality Rationale

- `requiredParts` default is ['interface', 'documentation'] not all 8 parts — pragmatic starting
  point. Teams raise the bar by adding more required parts. Full 8-part coverage is aspirational.
- `embeddingModel` + `embeddingDimensions` exposed — Voyage-3-lite (512 dims) works for Lysica's
  conversation domain; code documentation may benefit from a different model. Field allows swap
  without a breaking change.
- `indexDir` configurable — some projects may want the index outside the project root (CI caching).
- No `packageName` or `description` fields — the library can read these from package.json; no need
  to duplicate in .fca-index.yaml.

## Producer

- **Side:** consuming project's filesystem
- **Artifact:** `.fca-index.yaml` (optional) at project root
- **Default behavior:** if absent, library uses FCA convention auto-detection
- **Auto-detected conventions:**
  - Source dirs: `src/`, `source/`, `packages/*/src/`, `packages/*/source/`
  - Documentation: `README.md` in any directory
  - Ports: files in `ports/` or `providers/` subdirectories
  - Verification: `*.test.ts` files co-located with source
  - Observability: `*.metrics.ts` files

## Consumer

- **Package:** `@method/fca-index` scanner domain
- **Usage:** `packages/fca-index/src/scanner/project-scanner.ts` (planned)
- **Injection:** Default implementation (`FileSystemManifestReader`) injected at the library's
  composition root. Tests inject a stub implementation.

## Gate Assertion

```typescript
// In packages/fca-index architecture gate test
// G-PORT: scanner domain must not import node:fs directly — use ManifestReaderPort

it('scanner does not import node:fs directly', () => {
  const violations = scanImports('packages/fca-index/src/scanner/**', {
    forbidden: [/^(node:)?fs/, /^(node:)?path/],
    // node:fs/path must be accessed via ManifestReaderPort or FileSystemPort implementations
  });
  expect(violations).toEqual([]);
});
```

## Agreement

- Frozen: 2026-04-08
- Port file: `packages/fca-index/src/ports/manifest-reader.ts`
- Config schema: `.fca-index.yaml` at consuming project root
- Changes to ProjectScanConfig require: new `/fcd-surface fca-index consuming-project` session
