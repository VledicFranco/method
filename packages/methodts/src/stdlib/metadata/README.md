# stdlib/metadata/ — Methodology Registry Metadata

Per-methodology metadata records for the stdlib registry. Each file contains version, compilation status, capability declarations, and authorship information for a registered methodology.

## Files

| File | Methodology | Description |
|------|-------------|-------------|
| `p0-meta.ts` | P0-META | Metadata for the root meta-methodology |
| `p-gh.ts` | P-GH | GitHub operations methodology metadata |
| `p1-exec.ts` | P1-EXEC | Execution methodology metadata |
| `p2-sd.ts` | P2-SD | Software development methodology metadata |
| `p3-dispatch.ts` | P3-DISP | Dispatch methodology metadata |
| `p3-gov.ts` | P3-GOV | Governance methodology metadata |

## MetadataRecord Shape

Each file exports a `MetadataRecord` with:
- `id`: canonical methodology ID
- `version`: semver string
- `compilationStatus`: `draft` | `compiled` | `production`
- `capabilities`: list of capability tags (e.g., `filesystem`, `network`, `git`)
- `gates`: required gate IDs for registry validation
