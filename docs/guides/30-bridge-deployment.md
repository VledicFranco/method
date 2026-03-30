---
guide: 30
title: "Bridge Deployment"
domain: bridge
audience: [agent-operators]
summary: >-
  Instance profiles, 1Password secrets, multi-instance isolation, and multi-machine topology.
prereqs: [10, 15]
touches:
  - scripts/start-bridge.js
  - scripts/kill-port.js
  - scripts/lib/profile-loader.js
  - .method/instances/
  - .env.tpl
---

# Guide 30 — Bridge Deployment

How to run multiple bridge instances with isolated state, manage secrets through 1Password, and operate the bridge across machines in a Tailscale mesh.

## 1. Instance Profiles

An instance profile is a `.env` file in `.method/instances/` that configures an isolated bridge process. Each profile defines environment variables like port, root directory, and instance name. Profiles let you run multiple bridges on the same machine without conflicts.

### What a profile looks like

```bash
# .method/instances/test.env
INSTANCE_NAME=test
PORT=3457
ROOT_DIR=test-fixtures/bridge-test
EVENT_LOG_PATH=/tmp/method-test-events.jsonl
GENESIS_ENABLED=false
MAX_SESSIONS=3
```

The format is simple `KEY=VALUE`. Comments start with `#`. Blank lines are skipped. Values can be single- or double-quoted (quotes are stripped). Variable expansion (`$VAR`) is not supported.

Path values (`ROOT_DIR`, `EVENT_LOG_PATH`) have Windows backslashes normalized to forward slashes automatically, so profiles work cross-platform.

### Creating a custom profile

Create a new file at `.method/instances/<name>.env` with the variables you want to override. Only the variables you set are overridden — everything else falls back to process environment defaults.

Example: a staging profile that runs on port 3458 with a separate project root:

```bash
# .method/instances/staging.env
INSTANCE_NAME=staging
PORT=3458
ROOT_DIR=/home/user/staging-repos
EVENT_LOG_PATH=/tmp/method-staging-events.jsonl
```

### Starting and stopping instances

```bash
# Start a named instance
npm run bridge -- --instance staging

# Stop a named instance (resolves port from profile)
node scripts/kill-port.js --instance staging
```

The start script loads the profile, merges its env vars with the process environment (explicit env vars always win), then launches the bridge. The stop script reads the profile to determine the target port, then sends a graceful shutdown request to that port.

### The test instance

A pre-configured test profile ships at `.method/instances/test.env`. It runs on port 3457, scans `test-fixtures/bridge-test/` for projects (instead of real repos), disables genesis orchestration, and caps sessions at 3. Convenience scripts:

```bash
npm run bridge:test          # Start test instance
npm run bridge:stop:test     # Stop test instance
```

Use this to validate bridge changes without affecting the production instance.

### Isolation guarantees

Each instance is isolated across these dimensions:

| What | How |
|------|-----|
| Port | `PORT` env var — each instance listens on a different port |
| Identity | `INSTANCE_NAME` — surfaced in `/health` response so you can tell instances apart |
| Project discovery | `ROOT_DIR` — each instance scans a different directory tree |
| Event persistence | `EVENT_LOG_PATH` — separate JSONL event log per instance |
| PID tracking | PID file path includes the port (`method-bridge-<PORT>.pids`), so the stop script targets the right process |

### Built-in profiles

| File | Port | Purpose |
|------|------|---------|
| `production.env` | 3456 | Default configuration — matches bare `npm run bridge` behavior |
| `test.env` | 3457 | Integration testing — fixture repos, no genesis, 3 max sessions |

## 2. 1Password Setup

The bridge supports resolving secrets at startup through the 1Password CLI (`op`). This keeps API keys out of `.env` files and out of version control.

### Prerequisites

1. Install the [1Password CLI](https://developer.1password.com/docs/cli/get-started/)
2. Sign in: `op signin`
3. Verify it works: `op whoami`

### The `.env.tpl` file

The template file `.env.tpl` is committed to git. It contains secret _references_, not secrets:

```bash
# .env.tpl — committed to git, contains references only
# Vault: Private | Items: "Method Bridge - Anthropic API Key", "Method Bridge - Voyage API Key"
ANTHROPIC_API_KEY=op://Private/Method Bridge - Anthropic API Key/password
VOYAGE_API_KEY=op://Private/Method Bridge - Voyage API Key/password
```

Each value uses the `op://vault/item/field` reference syntax. The items live in the **Private** vault under names `Method Bridge - Anthropic API Key` and `Method Bridge - Voyage API Key`. At runtime, the bridge startup script detects `.env.tpl` and (if `op` is available) spawns the bridge via:

```bash
op run --env-file=.env.tpl -- node packages/bridge/dist/server-entry.js
```

The `op run` command resolves every `op://` reference to its actual secret value and injects the result as environment variables into the child process. Secrets never touch disk.

### Fallback behavior

If `.env.tpl` exists but `op` is not installed or not signed in, the startup script prints a warning and falls back to loading a plain `.env` file (if present). This means you can use `.env.tpl` on machines with 1Password and a plain `.env` on machines without it.

## 3. Secrets Resolution Order

The full resolution chain in `scripts/start-bridge.js`:

```
1. --instance <name>     Load .method/instances/<name>.env
                         (provides isolation: port, root dir, instance name)
                              │
                              ▼
2. .env.tpl + op CLI     If .env.tpl exists AND op is on PATH:
                         spawn via op run --env-file=.env.tpl
                         (resolves op:// references → real secrets)
                              │
                         If .env.tpl exists but op is NOT available:
                         warn and fall through to step 3
                              │
                              ▼
3. .env file             If .env exists: parse and merge
                         (profile values take precedence over .env values)
                              │
                              ▼
4. Bare start            No secrets configured — uses process environment only
```

Steps 1 and 2-3 compose: the instance profile provides infrastructure variables (port, root dir), while `.env.tpl` or `.env` provides secrets (API keys). Both are merged before the bridge process starts. For any given key, precedence is:

1. Explicit process env vars (highest)
2. Instance profile values
3. `.env` file values (lowest)

When using `op run` (step 2), the secrets are injected by the `op` process itself, so they take the same precedence as explicit env vars.

## 4. Multi-Machine Topology

The bridge is designed to run on a primary development machine and be accessed from other machines over a Tailscale WireGuard mesh.

### Current topology

```
mission-control (main dev machine)
  ├── pv-method bridge (:3456)    ← production instance
  ├── pv-silky portal  (:4430)    ← auth proxy (passkey)
  └── Tailscale node

laptop / phone / other machines
  └── Tailscale node
      └── Browser → portal (:4430) → bridge (:3456)
```

The bridge runs on `mission-control`. Remote devices access it through the portal, which handles passkey authentication and reverse-proxies to the bridge. See Guide 15 (Remote Access via Tailscale) for the full remote access setup.

### Running instances on different machines

Instance profiles are machine-local — they define how a bridge starts on _that_ machine. If you clone the repo on a second Tailscale machine, you can create a custom profile for it:

```bash
# On the remote machine
# .method/instances/remote.env
INSTANCE_NAME=remote-worker
PORT=3456
ROOT_DIR=/home/user/projects
```

Each machine runs its own bridge with its own profile. The Tailscale mesh makes all machines reachable by hostname.

### Portable packaging

The bridge can be bundled into a single tarball for installation on remote machines without cloning the full monorepo:

```bash
node scripts/pack-bridge.js
```

This runs an esbuild bundle of the bridge server and MCP server, packages them with the frontend, instance profile templates, and `.env.tpl`, and produces `method-bridge-{version}.tgz`.

On the target machine:

```bash
npm install -g method-bridge-{version}.tgz
method-bridge --help                     # Print usage
method-bridge --instance production      # Start with a profile
```

The CLI entry point (`packages/bridge/bin/method-bridge.js`) parses `--instance`, `--port`, and `--help` flags. It includes an inlined profile loader so it works independently of the monorepo.

### Clustering

Multiple bridges across machines can form a coordinated cluster with automatic peer discovery, capacity-aware work routing, and event federation. See Guide 31 (Bridge Cluster) for the full setup.
