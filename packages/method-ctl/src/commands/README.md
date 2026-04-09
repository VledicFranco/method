# commands/ — method-ctl Command Handlers

Command handler functions for the `method-ctl` CLI. Each handler makes HTTP requests to the bridge REST API and formats the response for stdout.

## Handlers

| File | Command | Description |
|------|---------|-------------|
| `status.ts` | `method-ctl status` | Fetches bridge health + cluster overview |
| `nodes.ts` | `method-ctl nodes` | Lists cluster peers with resources and reachability |
| `projects.ts` | `method-ctl projects` | Lists discovered projects and active sessions |

## Design

Handlers are pure async functions: `(config, format) → Promise<void>`. No global state, no process.exit — errors propagate to the CLI entry point which handles exit codes. This makes handlers independently testable.

Output formatting (table vs JSON) is handled at the handler level based on the `format` parameter — not in the CLI entry point — so each command can have format-specific column layouts.
