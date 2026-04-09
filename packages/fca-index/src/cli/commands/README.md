# CLI Command Runners — @method/fca-index

Pure command runner functions. Each runner receives an injected port + parsed options, performs its operation, writes to stdout/stderr, and exits with the appropriate code. No argument parsing lives here — that's handled by `cli/index.ts`.

## Commands

| Runner | CLI Subcommand | Description |
|--------|---------------|-------------|
| `runScanCommand` | `fca-index scan` | Full project scan via `Indexer`. Reports component count and coverage delta. |
| `runQueryCommand` | `fca-index query <text>` | Semantic search. Prints ranked `ComponentContext` results as JSON. |
| `runCoverageCommand` | `fca-index coverage` | Prints `CoverageReport` as JSON. Exits 1 if `meetsThreshold` is false. |
| `runDetailCommand` | `fca-index detail <path>` | Prints full `ComponentDetail` (interface + docText + part file locations) as JSON. |
| `runSuggestCommand` | `fca-index suggest <path>` | Prints FCA compliance stubs. `--apply` writes files to disk. Exits 1 on error. |

## Design

Commands are pure functions — they don't hold state and don't touch global singletons. This makes them independently testable: inject an `InMemoryIndexStore` and capture stdout in tests.

Exit codes follow Unix conventions:
- `0` — success
- `1` — logical failure (coverage below threshold, suggest failed, component not found)
- `2` — usage error (invalid arguments — caught by the CLI argument parser before reaching these runners)
