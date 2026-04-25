---
type: prd
id: "057"
title: "@methodts/fca-index — Language profiles (v0.4.0)"
date: "2026-04-25"
status: in-progress
branch: feat/fca-index-language-profiles
tests: 286/286 (was 229/229 before this PRD)
domains: [fca-index/scanner, fca-index/cli/manifest-reader]
surfaces: [LanguageProfile, FilePatternRule, BUILT_IN_PROFILES, resolveLanguageProfiles]
depends_on: "053 (fca-index library)"
---

# PRD 057 — @methodts/fca-index Language Profiles

## Problem

`@methodts/fca-index` v0.3.0 ships with hardcoded TypeScript-only file/dir
classification rules in `src/scanner/`:

- `fca-detector.ts` matches `*.test.ts`, `index.ts`, `*port.ts`, etc.,
- `doc-extractor.ts` extracts JSDoc and TS export signatures,
- `project-scanner.ts` recognises `package.json` for L3, requires
  `index.ts` or 2+ `.ts` files for component qualification, and defaults
  source globs to `['src/**', 'packages/*/src/**']`.

Every consumer of fca-index is therefore restricted to TypeScript projects.
For polyglot monorepos (e.g. t1-cortex: TS + Scala) or non-TS-first
codebases (Python services, Go cmd-tools), the scanner is unable to enrich
the index — coverage scoring, port detection, and the doc embedding all
break down.

The downstream stack (index-store, query, coverage, MCP, CLI,
embedding-client) is text-shaped and language-neutral. The TS coupling is
entirely localised to the three scanner files. A purely additive enrichment
of `ProjectScanConfig` is sufficient to lift the language constraint.

## Constraints

- **Additive, non-breaking.** v0.4.0 is a minor version bump. v0.3.x users
  pay zero migration cost; the default profile reproduces v0.3.x behavior
  bit-for-bit.
- **Scanner-only refactor.** `index-store/`, `query/`, `coverage/`, `mcp/`,
  and `cli/` business logic stay untouched.
- **Frozen external ports.** `ContextQueryPort`, `CoverageReportPort`, and
  `ManifestReaderPort` declarations are unchanged. `ProjectScanConfig`
  gains an optional `languages?: string[]` field; existing consumers that
  ignore it observe the same behavior as v0.3.x.
- **YAML stays simple.** `.fca-index.yaml` references built-in profiles by
  name only (`languages: ['typescript', 'scala']`). The full
  `LanguageProfile` shape is an SDK-only escape hatch for custom profiles.
- **Five built-in profiles ship in v0.4.0.** No more, no fewer:
  `typescript`, `scala`, `python`, `go`, `markdown-only`.

## Surface — `LanguageProfile`

```typescript
export interface LanguageProfile {
  name: string;                                    // 'typescript' | 'scala' | ...
  sourceExtensions: string[];                      // ['.ts'] / ['.scala'] / ['.py', '.pyi']
  packageMarkers: string[];                        // ['package.json'] / ['build.sbt', '*.sbt']
  filePatterns: Array<{ pattern: RegExp; part: FcaPart; condition?: 'has-export' }>;
  subdirPatterns: Record<string, FcaPart>;         // { ports: 'port', observability: 'observability', ... }
  componentRule: { interfaceFile?: string; minSourceFiles: number };
  extractInterfaceExcerpt?: (content: string) => string;
  extractDocBlock?: (content: string) => string;
}
```

Status: **frozen 2026-04-25**.

## Success Criteria

| ID | Criterion | Measurement |
|----|-----------|-------------|
| SC-1 | **Backward compat** | All 229 v0.3.0 tests pass unchanged with the default (TypeScript) profile. |
| SC-2 | **Per-profile coverage** | Each of 5 built-in profiles has dedicated unit tests covering its file/dir/extractor rules. |
| SC-3 | **Polyglot scan** | A single scan with multiple profiles correctly attributes per-component level + parts to the owning profile. |
| SC-4 | **Architecture gates** | All 8 architecture gates remain green (G-PORT-SCANNER, G-PORT-QUERY, G-BOUNDARY-CLI, G-BOUNDARY-DETAIL, G-BOUNDARY-COMPLIANCE, G-BOUNDARY-MCP, G-LAYER, G-PORT-OBSERVABILITY). |
| SC-5 | **YAML config** | `.fca-index.yaml` accepts both inline (`languages: [a, b]`) and block list forms; unknown profile names throw `LanguageProfileError` at scan time. |
| SC-6 | **Real-world smoke** | t1-cortex polyglot scan with `languages: ['typescript', 'scala']` indexes both Scala modules (`modules/api`, `modules/apps/connectors`) and TS packages (`packages/cortex-app`, `packages/apps/atlas`). |

## Acceptance Gates

- AC-1: All 229 existing tests pass unchanged with the default (TypeScript) profile.
- AC-2: New per-profile unit tests pass for each built-in profile (TS, Scala, Python, Go, markdown-only).
- AC-3: Polyglot fixture test (TS + Scala + Python in one project root) — scanner detects components from all three.
- AC-4: All 8 architecture gates still green.
- AC-5: External frozen ports unchanged — `ContextQueryPort`, `CoverageReportPort`, `ManifestReaderPort` interface declarations unchanged.
- AC-6: `.fca-index.yaml` zod-style schema accepts `languages: ['typescript', 'scala', ...]`.
- AC-7: t1-cortex polyglot smoke validates real-world scan.
- AC-8: Documentation deliverables complete (this PRD, guide 40, scanner README, package README, getting-started Polyglot section, arch update).

## Scope

**In:**
- New module `src/scanner/profiles/` (types + 5 built-in profiles + registry + resolver).
- Refactor of `fca-detector.ts`, `doc-extractor.ts`, `project-scanner.ts` to be profile-driven.
- Additive `ProjectScanConfig.languages?: string[]` field + manifest-reader YAML parsing.
- Additive `FcaIndexConfig.languages?: LanguageProfile[]` SDK escape hatch.
- Public surface re-exports of `LanguageProfile`, `BUILT_IN_PROFILES`, `resolveLanguageProfiles`, `LanguageProfileError`, and the 5 built-in profile objects.
- Version bump to 0.4.0.
- Disk fixtures + per-profile test suite.
- Documentation: guide 40, scanner README rewrite, package README "Language support" section, getting-started Polyglot section, arch update.

**Out:**
- New built-in languages beyond the 5 listed (deferred to follow-up PRDs).
- Modifications to external ports (frozen).
- Modifications to `index-store/`, `query/`, `coverage/`, `mcp/` business logic.
- Ollama embedder support (separate task).
- Publishing to npm — version is bumped + ready; manual publish.

## Notes

- PRD slot 055 (the original mandate target) was already occupied by
  `055-smoke-test-suite.md`; this PRD lands at 057 (the next available slot
  past 056).
- Mandate originally cited a baseline of "158 existing tests"; the actual
  baseline at branch point was **229 tests** (the package has grown since
  PRD 053 originally landed). All 229 are preserved by the typescript
  profile path.
- Mandate originally cited "4 architecture gates"; the package now has **8**
  architecture gates. AC-4 covers all of them.

## Co-design provenance

This PRD landed via the `/com` skill with the LanguageProfile surface
pre-agreed with the user — no FCD `surface` session; treated as a frozen
internal SDK type. The `LanguageProfile` shape is a public addition that
follows the same "frozen field-set" discipline as the external ports.
