# @methodts/method-ctl

Unified CLI for managing bridge clusters. Queries bridge HTTP endpoints and displays cluster health, node resources, and project distribution.

## Architecture

`method-ctl` is an L4 application in the FCA layer stack. It is a **pure HTTP client** — it does not import `@methodts/cluster` or `@methodts/bridge` at runtime. It works with JSON responses from bridge `/cluster/*` endpoints.

```
L4  method-ctl      CLI application — arg parsing, HTTP calls, output formatting
L3  (none)          No L3 dependency — pure HTTP client
```

Dependencies are minimal by design: `zod` for config validation, Node.js built-in `fetch` for HTTP calls, `process.argv` for argument parsing. No yargs, commander, axios, or got.

## Installation

```bash
# From the monorepo root:
npm run build

# Or link globally:
cd packages/method-ctl && npm link
```

## Usage

```bash
# Cluster overview
method-ctl status

# JSON output
method-ctl status --format json

# List all nodes with resources
method-ctl nodes

# Single node detail
method-ctl nodes mission-control

# Projects across all bridges
method-ctl projects

# Query a specific bridge
method-ctl status --bridge laptop:3456

# Help
method-ctl --help
```

## Commands

### `status`

Displays unified cluster health: node count, alive/suspect/dead/draining counts, total active sessions, and cluster generation. Shows a per-node table with status, sessions, CPU%, memory%, project count, and uptime.

### `nodes [name]`

Without a name: lists all nodes in a table with address, resource details, and uptime. With a name: shows detailed information for a single node including full resource breakdown and project list.

### `projects`

Aggregates projects from all cluster nodes. Shows which projects are on which nodes and their availability status (available/degraded based on hosting node health).

## Configuration

Config file: `~/.method/cluster.json`

```json
{
  "default_bridge": "localhost:3456",
  "known_bridges": [
    { "name": "mission-control", "address": "mission-control.emu-cosmological.ts.net:3456" }
  ],
  "output_format": "table"
}
```

If the config file does not exist, defaults to `localhost:3456` with table output. The CLI works without any configuration.

### Option priority

CLI flags override config file values:

1. `--bridge <address>` flag (highest priority)
2. `default_bridge` from config file
3. `localhost:3456` (fallback)

Same for `--format`: flag > config > `table`.

## Exit codes

- `0` — success
- `1` — error (connection failure, HTTP error, unknown command)

## Testing

```bash
npm test
```

Tests mock `globalThis.fetch` to avoid needing a running bridge. All output assertions verify stdout/stderr content.

## Related

- PRD 039 Phase 4 — specification
- `packages/cluster/` — L3 cluster protocol types (transport-agnostic)
- `packages/bridge/src/domains/cluster/` — bridge cluster domain (serves the endpoints this CLI queries)
