---
type: co-design-record
surface: "ComplianceSuggestionPort"
date: "2026-04-09"
owner: "fca-index"
producer: "fca-index (compliance domain)"
consumer: "cli (suggest command)"
direction: "fca-index → cli"
status: frozen
mode: "new"
---

# Co-Design Record — ComplianceSuggestionPort

## Context

Surface co-designed as part of Feature Set C (compliance suggestion engine) per the fca-index
features protocol at `tmp/agent-protocol-fca-index-features.md`.

## Decisions Made

### 1. Template strategy — one file per FcaPart
Each missing FcaPart maps to a specific suggested filename and template content:
- `interface`      → `index.ts` — JSDoc @interface stub + export {}
- `documentation`  → `README.md` — standard FCA sections (Purpose, Ports, Usage)
- `port`           → `ports.ts` — typed provider interface stub
- `boundary`       → `README.md` (appended) or `boundary.ts` — export list stub
- `domain`         → `domain.ts` — JSDoc description stub
- `architecture`   → `ARCHITECTURE.md` — FCA architecture stub
- `verification`   → `*.test.ts` (component name + .test.ts) — vitest stub
- `observability`  → `observability.ts` — structured logging stub

### 2. Output format — human-readable with `--json` flag
Default: print file header + content per missing part (diff-preview style).
With `--json`: print `ComplianceSuggestion` as JSON.

### 3. Dry-run vs. apply
Default (no flags): dry-run preview — shows what would be created.
`--apply` flag: actually writes the stub files to the component directory.
The `ComplianceSuggestion` is returned in both cases — the caller decides to write or not.

### 4. MCP exposure — out of scope
The CLI is the only consumer for this port. MCP exposure deferred until an agent consumer
needs it. This follows the consumer-usage minimality principle: do not add a surface
that has no current consumer.

### 5. Port owns the template content
The `ComplianceSuggestionPort` is responsible for generating template content. The CLI
merely formats and optionally writes the output. Business logic (what templates look like)
stays in the fca-index compliance domain, not in the CLI.

## Interface

```typescript
/**
 * ComplianceSuggestionPort — Port for generating FCA compliance improvement suggestions.
 *
 * A caller provides a component path; the producer looks it up in the index,
 * determines which FCA parts are missing, and returns stub content for each.
 * No embedding calls — pure SQLite lookup + template generation.
 *
 * Owner:     @methodts/fca-index (compliance domain)
 * Consumer:  CLI (fca-index suggest command)
 * Direction: fca-index → cli (unidirectional)
 * Co-designed: 2026-04-09
 * Status:    frozen
 */
export interface ComplianceSuggestionPort {
  /**
   * Generate compliance suggestions for a component.
   * Returns the component's current score and stub content for each missing FCA part.
   *
   * @throws ComplianceSuggestionError with code 'NOT_FOUND' if path is not indexed.
   * @throws ComplianceSuggestionError with code 'INDEX_NOT_FOUND' if project has no index.
   * @throws ComplianceSuggestionError with code 'SUGGESTION_FAILED' on internal errors.
   */
  suggest(request: ComplianceSuggestionRequest): Promise<ComplianceSuggestion>;
}

export interface ComplianceSuggestionRequest {
  /** Component path relative to projectRoot. Must match how it was indexed. */
  path: string;
  /** Absolute path to the project root. */
  projectRoot: string;
}

export interface ComplianceSuggestion {
  /** Component path relative to projectRoot. */
  componentPath: string;
  /** Coverage score in the index. Range 0–1. */
  currentScore: number;
  /** Stub content for each missing FCA part. Empty if component is fully documented. */
  missingParts: PartSuggestion[];
}

export interface PartSuggestion {
  /** The missing FCA part. */
  part: FcaPart;
  /**
   * Suggested filename (relative to the component directory).
   * e.g. 'README.md', 'index.ts', 'ports.ts'
   */
  suggestedFile: string;
  /**
   * Exact content to write into the suggested file.
   * All references to the component name are filled in.
   */
  templateContent: string;
}

export class ComplianceSuggestionError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_FOUND' | 'INDEX_NOT_FOUND' | 'SUGGESTION_FAILED',
  ) {
    super(message);
    this.name = 'ComplianceSuggestionError';
  }
}
```

## Producer
- **Domain:** fca-index compliance domain
- **Implementation:** `packages/fca-index/src/compliance/compliance-engine.ts`
- **Wiring:** Injected via `FcaIndex` facade from `factory.ts`; receives `IndexStorePort`

## Consumer
- **Domain:** CLI
- **Usage:** `packages/fca-index/src/cli/commands/suggest.ts`
- **Injection:** Passed from `cli/index.ts` after building the store

## Gate Assertion

```typescript
// G-BOUNDARY-COMPLIANCE: compliance-engine does not import cli/ or mcp/ directly
it('compliance/ does not import cli/ or @methodts/mcp', () => {
  const files = readSourceFiles(`${SRC}/compliance`);
  const violations = files.filter(
    (content) =>
      /from ['"]\.\.\/cli\//.test(content) || /@method\/mcp/.test(content),
  );
  expect(violations, 'compliance/ imports cli/ or @methodts/mcp').toHaveLength(0);
});
```

## Agreement
- Co-designed: 2026-04-09
- Frozen: 2026-04-09
- Changes require: new `/fcd-surface` session
