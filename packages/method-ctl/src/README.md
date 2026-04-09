# method-ctl — Cluster Management CLI

`method-ctl` is the unified CLI for managing a running bridge cluster. It connects to a bridge HTTP endpoint and provides status, node, and project management commands.

## Commands

| Command | Description |
|---------|-------------|
| `status` | Show cluster health, active sessions, and current methodology execution state |
| `nodes` | List cluster peers with resource utilization and reachability |
| `projects` | List discovered projects, active sessions per project, and event counts |

## Usage

```bash
method-ctl status
method-ctl nodes --format=json
method-ctl projects --bridge=http://localhost:3456
```

## Configuration

Default bridge address: `http://localhost:3456`. Override with:
- `--bridge=<url>` flag
- `METHOD_BRIDGE_URL` environment variable

Output format: `--format=table` (default) or `--format=json`.

## Architecture

`method-ctl` is a thin CLI wrapper — it parses argv, loads config, and dispatches to command handlers in `commands/`. No domain logic lives here. Commands make HTTP requests to the bridge REST API and format the responses.
