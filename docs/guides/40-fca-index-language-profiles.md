---
guide: 40
title: "fca-index: Language Profiles"
domain: fca-index
audience:
  - developers
  - agent-operators
summary: >-
  Use built-in language profiles to scan polyglot repos, or author a custom
  LanguageProfile for a new language ecosystem.
prereqs:
  - "Guide 38 — fca-index getting started"
touches:
  - packages/fca-index/src/scanner/profiles/
  - packages/fca-index/src/scanner/fca-detector.ts
  - packages/fca-index/src/ports/manifest-reader.ts
since: v0.4.0
---

# Guide 40 — fca-index: Language Profiles

## Why language profiles?

Up to v0.3.x, `@methodts/fca-index` could only scan TypeScript projects —
the file/dir classification rules were hardcoded. v0.4.0 introduces a
declarative `LanguageProfile` shape that captures everything the scanner
needs to know about a single language ecosystem: file extensions, package
markers, file/dir → FCA part rules, and language-specific extractors.

Five built-in profiles ship with v0.4.0:

| Profile | Source ext. | L3 markers | Test files |
|---|---|---|---|
| `typescript` (default) | `.ts` | `package.json` | `*.test.ts`, `*.spec.ts` |
| `scala` | `.scala` | `build.sbt`, `*.sbt`, `pom.xml` | `*Spec.scala`, `*Test.scala` |
| `python` | `.py`, `.pyi` | `pyproject.toml`, `setup.py`, `setup.cfg` | `test_*.py`, `*_test.py`, `conftest.py` |
| `go` | `.go` | `go.mod`, `go.sum` | `*_test.go` |
| `markdown-only` | `.md`, `.mdx` | (none) | (none) |

You can mix any subset: a TS+Scala monorepo uses
`languages: ['typescript', 'scala']`, a docs-only RFC vault uses
`languages: ['markdown-only']`, and a Python service codebase uses
`languages: ['python']`.

## Selecting profiles

### Via `.fca-index.yaml`

The simplest route — list built-in profile names. Order matters when two
profiles match the same file (the earlier-listed profile wins).

```yaml
# .fca-index.yaml
languages:
  - typescript
  - scala
```

Both block list and inline flow forms are accepted:

```yaml
languages: [typescript, scala]
```

When `languages` is absent, the scanner uses `['typescript']` only —
preserving v0.3.x behavior.

Unknown profile names throw a `LanguageProfileError` at the start of the
next `scan` call; the error message lists the known built-ins.

### Programmatically

Pass `LanguageProfile[]` to `createFcaIndex` or `createDefaultFcaIndex`.
Use this when you have a custom profile (see "Authoring a custom profile"
below) or want to override what `.fca-index.yaml` declares:

```typescript
import { createDefaultFcaIndex, scalaProfile, typescriptProfile } from '@methodts/fca-index';

const fca = await createDefaultFcaIndex({
  projectRoot: '/path/to/repo',
  voyageApiKey: process.env.VOYAGE_API_KEY!,
  languages: [typescriptProfile, scalaProfile],
});

await fca.scan();
```

If both `.fca-index.yaml` and `FcaIndexConfig.languages` are set, the
programmatic profiles come first and the YAML-resolved ones are appended.

## Authoring a custom `LanguageProfile`

The `LanguageProfile` shape is the SDK extension point. Built-in profiles
use exactly the same shape — there's no special path for new languages.
Worked example: defining a Scala profile from scratch.

```typescript
import type { LanguageProfile } from '@methodts/fca-index';

const MAX_EXCERPT = 600;

export const scalaProfile: LanguageProfile = {
  // 1) Identity — lowercase, kebab-case, stable.
  name: 'scala',

  // 2) File extensions for source files in this language. Used for
  //    component qualification + boundary/L1 detection. Include the dot.
  sourceExtensions: ['.scala'],

  // 3) Files whose presence at a directory's root marks it as L3.
  //    Wildcards: a leading `*` is allowed for suffix matching
  //    (`*.sbt` → any file ending in `.sbt`). Other markers are exact
  //    filename matches.
  packageMarkers: ['build.sbt', '*.sbt', 'pom.xml'],

  // 4) Filename → FCA part rules. First match across all active
  //    profiles wins per file. Use a `^...$` regex to anchor when the
  //    pattern needs to match the entire basename.
  filePatterns: [
    { pattern: /^README\.md$/, part: 'documentation' },
    { pattern: /^(?!.*\.test\.md$).*\.md$/, part: 'documentation' },
    { pattern: /Spec\.scala$/, part: 'verification' },
    { pattern: /Test\.scala$/, part: 'verification' },
    { pattern: /^[Aa]rchitecture\.scala$/, part: 'architecture' },
    { pattern: /Metrics\.scala$/, part: 'observability' },
    { pattern: /Port\.scala$/, part: 'port' },
    { pattern: /Domain\.scala$/, part: 'domain' },
    { pattern: /^package\.scala$/, part: 'interface' },
  ],

  // 5) Subdirectory-name → FCA part rules. A child directory whose
  //    name matches a key marks the parent as having that part. The
  //    locator file is the first source-extension file found inside.
  subdirPatterns: {
    ports: 'port',
    observability: 'observability',
    arch: 'architecture',
    domain: 'domain',
  },

  // 6) Component qualification: a directory qualifies if either
  //    `interfaceFile` is present (case-sensitive) or it has at least
  //    `minSourceFiles` files matching `sourceExtensions`.
  componentRule: {
    interfaceFile: 'package.scala',
    minSourceFiles: 2,
  },

  // 7) Optional: pull the public-API excerpt from the interface file.
  //    Receives raw content; return the trimmed excerpt (the caller
  //    truncates to ≤600 chars).
  extractInterfaceExcerpt(content) {
    const lines = content.split('\n');
    const sigLines = lines.filter(line =>
      /^\s*(?:final\s+|sealed\s+|abstract\s+|case\s+|implicit\s+|private\s+|protected\s+|override\s+)*(?:trait|class|object|case\s+class|case\s+object|def|val|var|type)\s+/.test(line),
    );
    return sigLines.length > 0
      ? sigLines.join('\n').slice(0, MAX_EXCERPT).trimEnd()
      : content.slice(0, MAX_EXCERPT).trimEnd();
  },

  // 8) Optional: pull the leading documentation block from any source
  //    file (JSDoc / ScalaDoc / docstring / godoc). Return empty string
  //    when absent.
  extractDocBlock(content) {
    const match = content.match(/^\s*\/\*\*([\s\S]*?)\*\//);
    return match ? match[0].slice(0, MAX_EXCERPT).trimEnd() : '';
  },
};
```

Pass it to the factory just like a built-in:

```typescript
import { createDefaultFcaIndex } from '@methodts/fca-index';
import { scalaProfile } from './scala-profile.js';

const fca = await createDefaultFcaIndex({
  projectRoot,
  voyageApiKey,
  languages: [scalaProfile],
});
```

## Behavior in polyglot scans

When multiple profiles are active:

- **Component qualification** is a UNION — a directory qualifies if ANY
  active profile considers it a component (interface file present, or
  ≥ `minSourceFiles` of that profile's extensions).
- **Level detection** uses the UNION of all `packageMarkers` for L3
  decisions and the UNION of `sourceExtensions` for L1/source counts.
- **File classification** is FIRST-WINS by profile order: the earliest
  profile in the list whose `filePatterns` matches the file's basename
  attributes the part. After a part is attributed once for a component,
  later files that would match the same part are ignored (same as v0.3.x).
- **Default source globs** (when `sourcePatterns` is unset): for the
  TypeScript-only default, `['src/**', 'packages/*/src/**']` — same as
  v0.3.x. For multi-language or non-TS scans, broadens to
  `['src/**', 'packages/*/src/**', 'modules/**', 'apps/**']`. Override
  via `sourcePatterns:` in `.fca-index.yaml` for tighter control.

## Built-in profile reference

### `typescript` (default)

| Aspect | Value |
|---|---|
| Source ext. | `.ts` |
| L3 markers | `package.json` |
| Interface file | `index.ts` (with `export` keyword) |
| Verification | `*.test.ts`, `*.spec.ts`, `*.contract.test.ts` |
| Port | `*port.ts` (incl. `.port.ts`, `-port.ts`) |
| Observability | `*.metrics.ts`, `*.observability.ts` |
| Domain | `*-domain.ts` |
| Architecture | `architecture.ts` |
| Subdirs | `ports/`, `observability/`, `arch/`, `domain/` |
| Doc block | JSDoc `/** ... */` |
| Interface excerpt | exported `type|interface|function|class|abstract|const|enum|declare` lines |

### `scala`

| Aspect | Value |
|---|---|
| Source ext. | `.scala` |
| L3 markers | `build.sbt`, `*.sbt`, `pom.xml` |
| Interface file | `package.scala` |
| Verification | `*Spec.scala`, `*Test.scala`, `*IntegrationSpec.scala`, `*IT.scala` |
| Port | `*Port.scala` |
| Observability | `*Metrics.scala`, `*Observability.scala`, `*Telemetry.scala` |
| Domain | `*Domain.scala` |
| Architecture | `architecture.scala`, `Architecture.scala` |
| Subdirs | `ports/`, `observability/`, `arch/`, `domain/` |
| Doc block | ScalaDoc `/** ... */` |
| Interface excerpt | top-level `def`, `val`, `var`, `trait`, `class`, `object`, `case class`, `case object`, `type` |

### `python`

| Aspect | Value |
|---|---|
| Source ext. | `.py`, `.pyi` |
| L3 markers | `pyproject.toml`, `setup.py`, `setup.cfg` |
| Interface file | `__init__.py` |
| Verification | `test_*.py`, `*_test.py`, `tests.py`, `conftest.py` |
| Port | `*_port.py`, `port.py`, `ports.py` |
| Observability | `metrics.py`, `*_metrics.py`, `observability.py`, `telemetry.py` |
| Domain | `domain.py`, `*_domain.py` |
| Architecture | `architecture.py`, `arch.py` |
| Subdirs | `ports/`, `observability/`, `arch/`, `domain/` |
| Doc block | module-level `"""..."""` or `'''...'''` docstring |
| Interface excerpt | top-level `def`, `class`, `from … import`, `import`, `__all__` |

### `go`

| Aspect | Value |
|---|---|
| Source ext. | `.go` |
| L3 markers | `go.mod`, `go.sum` |
| Interface file | `doc.go` |
| Verification | `*_test.go` |
| Port | `port.go`, `ports.go`, `*_port.go` |
| Observability | `metrics.go`, `*_metrics.go`, `observability.go`, `telemetry.go` |
| Domain | `domain.go`, `*_domain.go` |
| Architecture | `architecture.go`, `arch.go` |
| Subdirs | `ports/`, `observability/`, `arch/`, `domain/` |
| Doc block | leading `// ...` lines (godoc) or leading `/* ... */` block |
| Interface excerpt | top-level `func`, `type`, `var`, `const` |

### `markdown-only`

| Aspect | Value |
|---|---|
| Source ext. | `.md`, `.mdx` |
| L3 markers | (none) |
| Interface file | `README.md` |
| Doc parts | `README.md`, `README.rst`, `*.md`, `*.mdx` |

Useful as one entry in a polyglot list to ensure README/docs always count
when other profiles miss them, or alone for docs-only repos.

## Migration from v0.3.x

No migration required. v0.3.x scans behave identically in v0.4.0 — the
implicit default is `['typescript']`, and the `typescript` profile reproduces
the v0.3.x rule set exactly.

To opt into polyglot, add a single line to `.fca-index.yaml`:

```yaml
languages: [typescript, scala]   # or any other combination
```

## See also

- Guide 38 — fca-index getting started
- Guide 39 — fca-index MCP tools
- PRD 057 — Language profiles (this change's PRD)
- `docs/arch/fca-index.md` — architecture overview, including the
  LanguageProfile surface
