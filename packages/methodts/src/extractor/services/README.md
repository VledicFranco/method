# extractor/services/ — Extractor Service Implementations

Concrete `Extractor` implementations for common data sources. Each extractor reads structured data from an external source and returns it as world state facts.

## Services

| Service | Description |
|---------|-------------|
| `command.ts` | Runs a shell command; parses stdout as structured data |
| `filesystem.ts` | Reads files; extracts structured data from file contents (JSON, YAML, text) |
| `git.ts` | Reads git metadata: current branch, commit hash, diff stats, log entries |
| `http.ts` | Makes HTTP requests; extracts structured data from JSON responses |

## Usage

Extractors are declared in methodology step definitions and called by the runtime before step execution to populate domain facts in the `RunContext`. They are injected via the `ExtractorService` port — never instantiated directly in domain code.
