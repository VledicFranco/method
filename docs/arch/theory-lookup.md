# Theory Lookup

## Responsibilities

`packages/core/src/theory.ts` searches the formal theory markdown files (`theory/F1-FTH.md`, `theory/F4-PHI.md`) for terms and definitions, returning relevant excerpts.

## Parsing Strategy

Parse theory files into a two-level hierarchy on first access, cache in memory:

### Level 1 — Sections
Split on `## ` headings. Each section has:
- `heading`: e.g., `"6. Method"`
- `body`: full text from heading to next heading

### Level 2 — Definitions
Within each section, split on definition/proposition labels. Regex patterns:
- `**Definition \d+\.\d+ \((.+?)\)\.**`
- `**Proposition \d+\.\d+\.**`
- `**Observation\.**`
- `**Definition \d+\.\d+ \((.+?)\)\.**` (also in F4-PHI)

Each sub-section has:
- `label`: e.g., `"Domain Retraction"` (extracted from parenthetical)
- `content`: text from label to next label or section boundary

```typescript
type TheorySection = {
  source: string;       // "F1-FTH.md"
  heading: string;      // "6. Method"
  label: string | null; // "Domain Retraction" or null for unlabeled content
  content: string;      // the text
};
```

## Search Hierarchy

Given a search term, try matches in priority order:

1. **Definition label match** (case-insensitive): term matches a definition label (e.g., `"domain retraction"` → Definition 6.3). Returns the definition sub-section only.
2. **Heading match** (case-insensitive substring): term appears in a section heading (e.g., `"methodology"` → section 7). Returns the full section.
3. **Keyword search** (case-insensitive): term appears in body text. Returns the smallest enclosing unit — definition sub-section if within one, otherwise the full section. Returns up to 3 most relevant matches.

## Return Type

```typescript
type TheoryResult = {
  source: string;   // filename
  section: string;  // heading
  label?: string;   // definition label if applicable
  content: string;  // matched content
};

export function lookupTheory(theoryPath: string, term: string): TheoryResult[]
```

Returns empty array if no matches — the MCP layer converts this to an error response.

## Unicode Normalization (P2)

### `normalizeForSearch(text: string): string`

A helper function applied to both the search term and the indexed content before all three search passes (label match, heading match, keyword search). Original content is preserved in results — normalization only affects matching.

### Character Map

Greek letters are replaced with their ASCII names:

| Unicode | Replacement |
|---------|------------|
| `Φ`, `φ` | `Phi` |
| `Σ`, `σ` | `Sigma` |
| `Γ`, `γ` | `Gamma` |
| `δ` | `delta` |
| `μ` | `mu` |
| `π` | `pi` |
| `ρ` | `rho` |
| `ν` | `nu` |

Mathematical symbols are replaced with text equivalents:

| Unicode | Replacement |
|---------|------------|
| `≼` | `preceq` |
| `→` | `->` |
| `∈` | `in` |

### Behavior

- The function applies all replacements, then lowercases the result
- Both the indexed theory content and the incoming search term pass through `normalizeForSearch` before comparison
- Results return the original (un-normalized) content so the agent sees the proper symbols
- The normalization is invisible to callers of `lookupTheory` — it is an internal search optimization

## Caching

The parsed section/definition structure is cached in a module-level `Map<string, TheorySection[]>` keyed by file path. Parsed once on first `lookupTheory` call, reused for all subsequent calls. No cache invalidation — theory files don't change during a server session.

## Rationale

- **Smallest enclosing unit**: definition-level granularity when possible avoids dumping 100-line sections when the agent asked for one definition. Section-level fallback for broad queries.
- **Cache on first access**: avoids parsing 800+ lines on server startup if theory lookup is never called.
- **No fuzzy matching**: the theory files use consistent labeling. Exact match on labels and substring match on headings covers the realistic query space. Unicode normalization (P2) addresses the gap identified in EXP-001-I1 — agents searching for Greek symbols or mathematical notation by ASCII name now get matches without requiring fuzzy logic. If further gaps emerge beyond Unicode, fuzzy matching can be added later.
