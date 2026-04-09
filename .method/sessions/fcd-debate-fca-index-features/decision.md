---
type: council-decision
topic: "fca-index next features — path to agent-native project exploration"
date: "2026-04-09"
cast: [Oryn, Sable, Vera, Rion, Lena]
surface_advocate: "Sable"
ports_identified:
  - ComponentDetailPort
  - ComplianceSuggestionPort
---

## Decision: Ship Feature Set A → B → C in topological order

### Feature Set A — Scan Hygiene + CI Gate (next commission, no new surfaces)

1. **Default excludePatterns for test directories**
   - Add `**/__tests__/**`, `**/*.test.ts`, `**/*.spec.ts` to default excludePatterns in `ProjectScanner`
   - Test dirs indexed as L2 components contaminate query results with low-signal noise

2. **Minimum docText threshold for vector indexing**
   - Components with `docText.length < threshold` (empirically determined, ~100 chars) stored in SQLite for coverage tracking but NOT in Lance for vector search
   - Undocumented components should appear in coverage reports but not in query results
   - Currently: `pacta/cognitive/partitions/*` with empty docText pollute every query

3. **Relative paths in coverage output**
   - Coverage report shows absolute paths — should be relative to projectRoot (BUG-2)
   - Internal fix to CoverageEngine output formatting

4. **Non-zero exit code for failed coverage gates**
   - `fca-index coverage .` exits 0 even when `meetsThreshold: false`
   - CI/CD pipelines need exit code 1 on failure to enforce the gate
   - One-line fix, zero surface risk

5. **Index freshness signal**
   - During `context_query`, detect if any matched component's `indexedAt` is older than the directory's last-modified time
   - Return `{ stale: true, stalePath: '...' }` in query response when detected
   - Additive to existing `ComponentContext` — no breaking change

### Feature Set B — Context Detail Tool (after A, one new surface)

- New MCP tool `context_detail` + CLI `fca-index detail <path>`
- Takes a component path, returns: interface excerpt, docText, all part locations (filePath per FCA part), indexedAt
- Enables agents to get full component text in one tool call instead of scan + file reads
- **Requires:** `/fcd-surface fca-index mcp ComponentDetailPort` before implementation

**New type:**
```typescript
interface ComponentDetail {
  path: string;
  level: FcaLevel;
  parts: Array<{ part: FcaPart; filePath: string; excerpt: string }>;
  docText: string;
  indexedAt: string;
}
```

### Feature Set C — Compliance Suggestion Engine (after B, two new surfaces)

- New CLI command `fca-index suggest <componentPath>`
- Reads component's current FCA state, outputs exact file stubs for missing parts
- Enables agents (and humans) to self-apply FCA compliance incrementally
- **Requires:** `/fcd-surface fca-index cli ComplianceSuggestionPort` before implementation

**New type:**
```typescript
interface ComplianceSuggestion {
  componentPath: string;
  currentScore: number;
  missingParts: Array<{
    part: FcaPart;
    suggestedFile: string;        // e.g. 'README.md' or 'index.ts'
    templateContent: string;     // exact file content to write
  }>;
}
```

---

## Arguments For This Order

- Feature set A is prerequisite for B and C — clean index makes detail retrieval and suggestions meaningful
- A has zero new surfaces — ships without co-design sessions
- Topological dependency order: scan accuracy → query quality → agent DX

## Arguments Against (Acknowledged)

- Agents are blocked on context gathering now (Vera's point) — but A makes existing `context_query` trustworthy faster than B would
- Compliance-first has merit (Rion's point) — but `suggest` command needs quality index to produce good stubs

---

## Surface Implications

**Feature set A — no new ports:**
No `/fcd-surface` sessions needed.

**Feature set B — 1 new port:**
- `ComponentDetailPort` between `fca-index query domain` → `@method/mcp` + CLI
- Action: `/fcd-surface fca-index mcp ComponentDetailPort`

**Feature set C — 2 new ports:**
- `ComplianceSuggestionPort` between compliance domain → CLI + optional MCP
- Action: `/fcd-surface fca-index cli ComplianceSuggestionPort`
- Action: `/fcd-surface fca-index mcp compliance-tool-interface` (if MCP-exposed)

---

## Open Questions

1. Minimum docText threshold value (50? 100? needs empirical check on method-2)
2. Freshness check granularity — per-file mtime vs. per-component directory
3. `context_detail` single path vs. batch (batch saves round trips in orchestrated agents)
4. `suggest` output format — per-stub files vs. single patch vs. interactive
