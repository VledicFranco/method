# compliance/ — FCA Compliance Suggestion Domain

Analyzes indexed components for missing FCA parts and generates stub file content that would bring them to full documentation coverage.

## Purpose

Given a component path, the compliance engine:
1. Looks up the component in the SQLite index to find which FCA parts are present and missing
2. Delegates to `TemplateGenerator` to produce stub content for each missing part
3. Returns a `ComplianceSuggestion` with ready-to-write file content

No embedding calls — this domain is pure SQLite lookup + template generation. Fast and offline-capable.

## Usage

```typescript
const suggestion = await complianceEngine.getSuggestion({
  projectRoot: '/path/to/project',
  componentPath: 'packages/my-service/src',
});

// suggestion.missingParts[].suggestedFile — where to write
// suggestion.missingParts[].templateContent — what to write
```

## Templates Generated Per FCA Part

| Part | File written | Content |
|------|-------------|---------|
| `interface` | `index.ts` | JSDoc + export stub |
| `documentation` | `README.md` | Purpose, ports, usage sections |
| `port` | `ports.ts` | Typed provider interface |
| `boundary` | `boundary.ts` | Explicit export list |
| `domain` | `{name}-domain.ts` | Domain concept description + invariants |
| `architecture` | `ARCHITECTURE.md` | Layer placement + internal structure |
| `verification` | `{name}.test.ts` | Vitest test skeleton |
| `observability` | `observability.ts` | Structured logging stubs |

## CLI

```bash
fca-index suggest <projectRoot> <componentPath>          # Dry-run preview
fca-index suggest <projectRoot> <componentPath> --apply  # Write stubs to disk
fca-index suggest <projectRoot> <componentPath> --json   # JSON output
```

The `--apply` flag writes each stub only if the target file does not already exist (no overwrites).
