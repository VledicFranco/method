---
type: co-design-record
surface: CoverageReportPort
date: "2026-04-08"
owner: "@method/fca-index"
producer: "@method/fca-index"
consumers: ["CLI (method-ctl / fca-index binary)", "@method/mcp"]
direction: "fca-index → CLI, fca-index → mcp (unidirectional to both)"
status: frozen
mode: new
---

# Co-Design Record — CoverageReportPort

## Interface

```typescript
export interface CoverageReportPort {
  getReport(request: CoverageReportRequest): Promise<CoverageReport>;
}

export interface CoverageReportRequest {
  projectRoot: string;
  verbose?: boolean;  // false = summary only; true = summary + per-component breakdown
}

export interface CoverageReport {
  projectRoot: string;
  mode: IndexMode;
  generatedAt: string;           // ISO 8601
  summary: CoverageSummary;
  components?: ComponentCoverageEntry[];  // only when verbose=true
}

export interface CoverageSummary {
  totalComponents: number;
  overallScore: number;          // 0-1 weighted average
  threshold: number;
  meetsThreshold: boolean;
  fullyDocumented: number;
  partiallyDocumented: number;
  undocumented: number;
  byPart: Record<FcaPart, number>;  // per-part average presence
}

export interface ComponentCoverageEntry {
  path: string;
  level: FcaLevel;
  coverageScore: number;
  presentParts: FcaPart[];
  missingParts: FcaPart[];
}
```

## Minimality Rationale

- One method `getReport()` — both consumers have the same retrieval code path.
- `verbose` flag rather than two methods — avoids interface duplication; consumers opt in
  to per-component detail. MCP tool uses verbose=false (summary in tool response, low token
  cost). CLI uses verbose=true (developer wants to see which files to fix).
- `byPart` in summary — critical for both consumers. Agents need to know which FCA parts
  are systematically missing. CLI renders this as a sorted table of compliance gaps.
- No pagination on `components` — if the codebase is large, the verbose mode returns all
  entries sorted by coverageScore ascending. Consumers can limit display client-side.
  If this becomes a problem at scale, a follow-up co-design session will add pagination.

## Consumers

### CLI
- **Command:** `fca-index coverage [--verbose]` or `method-ctl index coverage`
- **Usage file:** `packages/fca-index/src/cli/coverage-command.ts` (planned)
- **Injection:** `CoverageReportPort` implementation constructed in CLI entry point

### @method/mcp
- **Tool:** `coverage_check` (new MCP tool)
- **Usage file:** `packages/mcp/src/context-tools.ts` (planned — same file as context_query)
- **Injection:** same `CoverageReportPort` instance as `ContextQueryPort` (same library instance)

## Producer

- **Package:** `@method/fca-index`
- **Implementation:** `packages/fca-index/src/coverage/coverage-engine.ts` (planned)
- **Reads from:** the SQLite index (coverage scores computed during scan, not at report time)

## Gate Assertions

```typescript
// G-BOUNDARY: CLI imports CoverageReportPort from @method/fca-index public API only
it('CLI does not import @method/fca-index internals', () => {
  const violations = scanImports('packages/fca-index/src/cli/**', {
    forbidden: ['packages/fca-index/src/coverage', 'packages/fca-index/src/scanner',
                'packages/fca-index/src/index-store'],
    allowed: ['../ports', '@method/fca-index'],
  });
  expect(violations).toEqual([]);
});

// G-BOUNDARY: mcp coverage_check tool imports from @method/fca-index public API only
it('mcp coverage_check does not import @method/fca-index internals', () => {
  const violations = scanImports('packages/mcp/src/context-tools.ts', {
    forbidden: ['packages/fca-index/src/coverage', 'packages/fca-index/src/scanner'],
    allowed: ['@method/fca-index'],
  });
  expect(violations).toEqual([]);
});
```

## Agreement

- Frozen: 2026-04-08
- Port file: `packages/fca-index/src/ports/coverage-report.ts`
- Changes require: new `/fcd-surface fca-index cli` session
