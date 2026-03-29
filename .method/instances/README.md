# Instance Profiles

Instance profiles configure isolated bridge instances. Each profile is a `.env` file in this directory, loaded via the `--instance` flag.

## Usage

```bash
node scripts/start-bridge.js --instance test     # loads .method/instances/test.env
npm run bridge -- --instance production           # loads .method/instances/production.env
npm run bridge:test                               # shortcut for --instance test
```

Without `--instance`, the bridge starts with default settings (port 3456, no profile).

## Profile Format

Standard `.env` syntax: `KEY=VALUE` lines. Comments (`#`) and blank lines are supported. Quoted values (single or double) have quotes stripped.

```env
# Instance identifier — surfaces in GET /health response
INSTANCE_NAME=staging

# HTTP port (must be unique per running instance)
PORT=3458

# Project discovery root (relative to repo root or absolute)
ROOT_DIR=test-fixtures/bridge-test

# Event log path (absolute or relative)
EVENT_LOG_PATH=/tmp/method-staging-events.jsonl

# Feature flags
GENESIS_ENABLED=false
MAX_SESSIONS=5
```

## Isolation Dimensions

Each instance is isolated along these axes:

| Dimension | Env Var | Default |
|-----------|---------|---------|
| Network port | `PORT` | 3456 |
| Identity | `INSTANCE_NAME` | "default" |
| Project discovery root | `ROOT_DIR` | repo root |
| Event log location | `EVENT_LOG_PATH` | default log path |
| Agent orchestration | `GENESIS_ENABLED` | true |
| Session limit | `MAX_SESSIONS` | 5 |

## Creating a Custom Profile

1. Create `.method/instances/<name>.env`
2. Set at minimum `INSTANCE_NAME` and `PORT` (unique port avoids conflicts)
3. Start with `node scripts/start-bridge.js --instance <name>`

## Precedence

Explicit environment variables (set before launch) take precedence over profile values. This lets you override a single setting without editing the profile:

```bash
PORT=4000 node scripts/start-bridge.js --instance test
# PORT will be 4000, everything else from test.env
```

## Existing Profiles

- **production.env** — Default bridge (port 3456). Matches behavior without `--instance`.
- **test.env** — Isolated test instance (port 3457). Uses fixture repos, disables genesis.
