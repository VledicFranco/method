---
title: "PRD 038: Bridge Deployment — Instance Isolation, Secrets, and Packaging"
status: draft
date: "2026-03-29"
tier: "standard"
depends_on: []
enables: []
blocked_by: []
complexity: "medium"
domains_affected: [scripts, configuration, bridge-server-entry]
---

# PRD 038: Bridge Deployment — Instance Isolation, Secrets, and Packaging

## 1. Problem Statement

The bridge is functionally broad — 137+ projects, universal event bus, strategy pipelines, genesis orchestration — but its deployment model is stuck at "manually set up one instance on one machine." Three concrete gaps:

1. **No instance isolation.** The bridge runs as a single process on port 3456. Agents testing bridge changes risk colliding with the 24/7 production bridge. There is no mechanism to spin up an isolated test instance with separate state, port, event log, and session checkpoints. This directly blocks safe development: any bridge PR that touches session logic, routes, or the event bus cannot be integration-tested without stopping the production bridge.

2. **Secrets are manual.** `.env` is gitignored (correctly), containing `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY`. Each new machine or git clone requires manually copying these two values. This is a sub-minute task for one machine but becomes friction when managing multiple clones across multiple machines. 1Password 8 is installed on all machines but the CLI integration (`op`) is not wired — the credential sync infrastructure exists but isn't connected.

3. **No portable install path.** Installing the bridge on a new machine means: clone the full monorepo, `npm install`, `npm run build`, build the frontend, manually create `.env`, and run. There's no single-artifact install. Guide 15 documents manual start as a known limitation.

**Note:** PRD 029 (Bridge Resilience) introduces crash recovery that reads session checkpoints from disk. Multi-instance operation interacts with this — the isolation model in this PRD accounts for checkpoint path separation (Section 3.2). PRD 029 does not need to land first, but implementors should verify checkpoint isolation works correctly when both are present.

## 2. Objective

Enable the bridge to be operated as a managed, multi-instance service:

- **Agents can spin up isolated test bridges** on demand without touching the production instance
- **Secrets resolve automatically** from 1Password on any machine where the human is authenticated — a convenience improvement that eliminates a small but recurring friction point
- **A fresh machine can install and run the bridge** from a single bundled artifact with minimal setup

## 3. Architecture & Design

### 3.1 — Layer Positioning

Changes are primarily in the **infrastructure/scripts layer** with one minor modification to the bridge composition root:

```
Human / Agent
  └── scripts/start-bridge.js       ← MODIFIED (instance profiles, op run)
  └── scripts/kill-port.js          ← MODIFIED (instance-aware stop)
  └── scripts/lib/profile-loader.js ← NEW (shared profile + env loading logic)
  └── .method/instances/*.env       ← NEW (profile definitions)
  └── .env.tpl                      ← NEW (1Password secret references)
  └── scripts/pack-bridge.js        ← NEW (packaging script)
      └── packages/bridge/src/server-entry.ts  ← MODIFIED (1 line: INSTANCE_NAME in /health)
          └── packages/bridge/bin/method-bridge.js ← NEW (CLI entry point, composition root)
```

The `server-entry.ts` modification is minimal: reading `INSTANCE_NAME` from env and including it in the `/health` response. This is a composition-root-level change (like the existing `PORT` or `ROOT_DIR` reads), not domain logic.

**DR-15 note:** `packages/bridge/bin/method-bridge.js` is a composition root entry point (like `server-entry.ts`) and therefore exempt from DR-15's port requirement by the same reasoning — it wires dependencies, it doesn't contain domain logic.

### 3.2 — Instance Isolation Model

Each bridge instance is isolated along five dimensions:

| Dimension | Mechanism | Already works? |
|-----------|-----------|----------------|
| **Port** | `PORT` env var | Yes |
| **Process tracking** | PID file keyed by port (`method-bridge-{PORT}.pids`) | Yes |
| **Event state** | `EVENT_LOG_PATH` env var | Yes |
| **Project scope** | `ROOT_DIR` env var | Yes |
| **Session checkpoints** | Derived from `ROOT_DIR` (checkpoints write to `{ROOT_DIR}/.method/sessions/`) | Yes (if ROOT_DIR differs) |
| **Instance identity** | New `INSTANCE_NAME` env var → surfaced in `/health` | New |

Session checkpoints (PRD 029) are stored under `{ROOT_DIR}/.method/sessions/`. When two instances use different `ROOT_DIR` values, their checkpoints are fully isolated. The startup recovery system (PRD 029 C-3) reads checkpoints from the instance's own `ROOT_DIR` and will not discover sessions belonging to another instance.

An instance profile is a `.env` file in `.method/instances/` that sets these variables:

```env
# .method/instances/test.env
INSTANCE_NAME=test
PORT=3457
ROOT_DIR=/c/Users/atfm0/Repositories/method-3/test-fixtures/bridge-test
EVENT_LOG_PATH=/tmp/method-test-events.jsonl
GENESIS_ENABLED=false
MAX_SESSIONS=3
```

**Test instance ROOT_DIR:** The test profile should point to a small fixture directory containing 2-3 git repos with `.method/` directories, pre-populated with test project cards and strategies. An empty `ROOT_DIR` (like `/tmp/method-test`) would discover zero projects and be unable to test most bridge functionality (strategies, genesis, project routes, resource copying). Phase 1 deliverables include creating this fixture directory.

The start script loads a profile when `--instance <name>` is passed. Without `--instance`, the bridge starts with the current behavior (production defaults on port 3456).

### 3.3 — Secrets Resolution Model

```
.env.tpl (committed, contains op:// references)
    │
    ├── op run --env-file=.env.tpl -- node server-entry.js
    │   └── 1Password resolves references → injects real values into process env
    │
    └── Fallback: .env (gitignored, manual — existing behavior)
```

The start script checks, in order:
1. If `--instance <name>` is passed → load `.method/instances/<name>.env`
2. If `.env.tpl` exists and `op` is on PATH → use `op run --env-file=.env.tpl`
3. If `.env` exists → load it directly (current behavior)
4. Otherwise → start without secrets (existing behavior)

This is additive. The existing `.env` workflow is untouched.

### 3.4 — Packaging Model

The bridge monorepo has workspace dependencies (`@method/methodts`, `@method/pacta`, etc.) that are not published to npm. A bare `npm pack` would produce a tarball with unresolvable workspace references. Instead, the packaging script uses `esbuild` to bundle `server-entry.js` and all workspace dependencies into a single file, then packages the bundle with the pre-built frontend.

**MCP server bundling:** Agents spawned by the bridge need MCP tools. The MCP server (`@method/mcp`) is a separate process that Claude Code spawns from `.mcp.json` in the agent's workdir. It has its own workspace dependencies (`@method/methodts`). The tarball must include a bundled MCP server entry point and a correctly-pathed `.mcp.json` template so that spawned agents on the target machine can access methodology tools.

Packaging steps:

1. `npm run build` — compile all TypeScript (bridge + MCP + methodts)
2. Build frontend (`packages/bridge/frontend/`)
3. Bundle bridge: `esbuild packages/bridge/dist/server-entry.js --bundle --platform=node --outfile=dist-bundle/server-entry.js --external:better-sqlite3` — single-file bundle with all `@method/*` workspace deps inlined
4. Bundle MCP server: `esbuild packages/mcp/dist/index.js --bundle --platform=node --outfile=dist-bundle/mcp-server.js` — single-file bundle of the MCP server with methodts inlined
5. Generate `.mcp.json` template pointing to `dist-bundle/mcp-server.js` (relative to install location)
6. Assemble tarball: `dist-bundle/` (bridge + MCP), `frontend/dist/`, `bin/method-bridge.js`, `.env.tpl`, `.method/instances/` templates, `.mcp.json` template, `package.json`
7. Output: `method-bridge-{version}.tgz`

On the target machine:
```bash
npm install -g method-bridge-{version}.tgz
method-bridge                        # start with defaults
method-bridge --instance production  # start with a profile
```

The `method-bridge` CLI generates a `.mcp.json` in the configured `ROOT_DIR` pointing to the bundled MCP server, so spawned agents can discover methodology tools.

The tarball is published to GitHub Releases on the private `VledicFranco/method` repo.

**Phase 3 is contingent** — it ships only if multi-machine operation proves necessary. Phases 1-2 are independently valuable and do not depend on Phase 3.

## 4. Alternatives Considered

### Alternative 1: Docker for Everything (Including Production)

**Approach:** Containerize the bridge with a Dockerfile. All instances (production + test) run as Docker containers.

**Pros:** Full environment isolation, reproducible across machines, no Node.js version concerns.

**Cons:** Production bridge needs direct filesystem access to 137+ repos for project discovery, file watchers, and git polling. Mounting the entire repo tree into a container adds volume mount complexity and filesystem event latency. Docker Desktop on Windows has known performance issues with bind mounts.

**Why rejected:** Docker solves portability but degrades the production bridge's core functionality. The bridge's value comes from deep local filesystem integration. Keep production native, use Docker later for ephemeral test instances only (future PRD).

### Alternative 2: SOPS / git-crypt for Secrets

**Approach:** Encrypt `.env` with SOPS (Mozilla) or git-crypt, commit the encrypted file, decrypt at runtime with age/GPG keys.

**Pros:** Secrets travel with the repo. No external dependency beyond a decryption key.

**Cons:** Requires distributing decryption keys to every machine — moves the secret distribution problem rather than solving it. Key rotation requires re-encrypting all files. No central audit trail of secret access. The human already has 1Password on all machines.

**Why rejected:** 1Password already handles credential sync, access control, and audit logging. Adding another key management layer would be redundant and less secure.

### Alternative 3: Hardcoded Multi-Port Start Script

**Approach:** Modify `start-bridge.js` to accept a `--port` flag and derive all paths from the port number (e.g., event log at `/tmp/bridge-{port}-events.jsonl`).

**Pros:** Simpler — no profile files, just a port number.

**Cons:** Doesn't handle per-instance config differences beyond the port (e.g., different `MAX_SESSIONS`, `GENESIS_ENABLED`, `ROOT_DIR`). Test instances need different config than production. Convention-based path derivation is fragile — can't override individual settings.

**Why rejected:** Instance profiles are marginally more complex but dramatically more flexible. The `.env` file format is already understood by the ecosystem.

## 5. Scope

### In-Scope

- Instance profile system (`.method/instances/*.env`, `--instance` flag)
- 1Password CLI integration (`.env.tpl` with `op://` references, `op run` in start script)
- Instance identity in `/health` response (`instance_name` field)
- Packaging script (`scripts/pack-bridge.js`) producing installable tarball via `esbuild` bundle
- Instance-aware stop script (stop by instance name)
- Default profile templates (production, test) with test fixture directory
- Convenience npm scripts (`bridge:test`, `bridge:stop:test`)
- Documentation updates (CLAUDE.md, Guide 15, new deployment guide, arch doc, parent CLAUDE.md)

### Out of Scope

- Docker containerization (future PRD if needed)
- Cloud deployment (AWS, GCP, Azure)
- systemd / launchd / Windows Service auto-start
- CI/CD pipeline for automated builds/releases
- pv-silky portal packaging (separate project)
- Multi-user authentication on the bridge itself
- Automatic `op` CLI installation

### Non-Goals

- Replacing the existing `npm run bridge` workflow — this adds capabilities, doesn't change defaults
- Making the bridge "production-grade" for public distribution — this is private infrastructure
- Automating Tailscale setup on new machines

## 6. Implementation Phases

### Phase 1: Instance Profiles

**Deliverables:**

Files:
- `scripts/lib/profile-loader.js` — new — shared module for .env file parsing and profile resolution. Uses CommonJS module format for compatibility with existing start scripts. Handles: simple KEY=VALUE parsing (no variable expansion needed — profiles are simple config), comment lines (`#`), empty lines, Windows path normalization (backslashes → forward slashes for `ROOT_DIR` and `EVENT_LOG_PATH` values, per DR-06). Used by both `start-bridge.js` and the Phase 3 CLI entry point — single source of truth, no duplication. If profile-loader grows beyond env parsing and path normalization, consider promoting it to a bridge utility module under FCA governance.
- `scripts/start-bridge.js` — modified — add `--instance <name>` flag, import `profile-loader.js`, merge profile env with process.env (explicit env vars take precedence over profile values)
- `scripts/kill-port.js` — modified — add `--instance <name>` flag, import `profile-loader.js` to resolve port from profile, target correct PID file
- `.method/instances/production.env` — new — default production profile (PORT=3456, INSTANCE_NAME=production, standard config). Includes comments explaining each variable.
- `.method/instances/test.env` — new — default test profile (PORT=3457, INSTANCE_NAME=test, ROOT_DIR pointing to test fixtures, GENESIS_ENABLED=false, MAX_SESSIONS=3). Includes comments.
- `test-fixtures/bridge-test/` — new — minimal fixture directory containing 2-3 small git repos with `.method/project-card.yaml` files and a strategy file, enabling meaningful integration testing of project discovery, strategy loading, and resource copying.
- `packages/bridge/src/server-entry.ts` — modified — read `INSTANCE_NAME` env var (default `"default"`), include `instance_name` field in `/health` response
- Root `package.json` — modified — add `bridge:test` script (`node scripts/start-bridge.js --instance test`) and `bridge:stop:test` script (`node scripts/kill-port.js --instance test`)

Tests:
- `scripts/lib/profile-loader.test.js` — new — co-located with profile-loader.js — 4 unit scenarios
  1. `--instance test` loads test.env and sets PORT=3457 (AC-1)
  2. No `--instance` flag uses current defaults, backward compat (AC-2)
  3. `--instance nonexistent` exits with code 1 and clear error message (AC-3)
  4. Explicit env vars take precedence over profile values (e.g., `PORT=9999 node scripts/start-bridge.js --instance test` uses port 9999)
- `scripts/lib/instance-lifecycle.integration.test.js` — new — co-located, tagged `@integration` (excluded from default `npm test`, run via `npm run test:integration`) — 1 scenario
  5. Start production + test instances simultaneously, stop test only, verify production still running (AC-4)
- `packages/bridge/src/health-instance-name.test.ts` — new — co-located — 1 scenario
  1. When `INSTANCE_NAME=test` is set, `GET /health` response includes `instance_name: "test"` (DR-14 compliance)

Configuration:
- `INSTANCE_NAME` — string — `"default"` — human-readable instance identifier, surfaced in `/health`

**Dependencies:** None — this is the foundation phase.

**Checkpoint:** `npm run build` passes, `npm test` passes. `npm run bridge:test` starts on port 3457 and `GET /health` returns `instance_name: "test"`. `npm run bridge:stop:test` stops only the test instance.

### Phase 2: 1Password Secrets Integration

**Prerequisites:** OQ-1 must be resolved before implementation begins (exact `op://` vault paths needed).

**Deliverables:**

Files:
- `.env.tpl` — new — 1Password reference template (committed to git). Contains `op://` references with comments documenting the exact vault/item/field path. **PLACEHOLDER paths shown below — replace with actual paths from OQ-1:**
  ```
  # 1Password secret references — resolved at runtime by `op run`
  # Vault: [PLACEHOLDER — resolve OQ-1]
  ANTHROPIC_API_KEY=op://[vault]/[item]/[field]
  VOYAGE_API_KEY=op://[vault]/[item]/[field]
  ```
- `scripts/start-bridge.js` — modified — add `op` detection (`which op` / `where op`), `op run --env-file=.env.tpl` launch path. Resolution order: (1) instance profile, (2) `.env.tpl` via `op run` if `op` is available, (3) `.env` file, (4) bare. Log which path was taken.
- `.gitignore` — verified — `.env` remains ignored, `.env.tpl` is NOT ignored

Tests:
- `scripts/lib/secrets-resolution.test.js` — new — co-located — 3 scenarios
  1. When `op` is on PATH and `.env.tpl` exists → spawns via `op run` (AC-5)
  2. When `op` is not available → falls back to `.env` with warning (AC-6)
  3. When neither `.env.tpl` nor `.env` exists → starts without secrets, logs warning (AC-7)

**Dependencies:** Phase 1 must complete first (profile loading happens before secret resolution in the start script).

**Checkpoint:** On a machine with 1Password CLI enabled, `node scripts/start-bridge.js` resolves secrets from 1Password without a `.env` file. On a machine without `op`, falls back to `.env` with a logged warning.

### Phase 3: Portable Packaging (Contingent)

**Status:** Contingent — ships only when a concrete multi-machine need materializes. Fully specified to enable rapid implementation when the need is validated. Do not implement until triggered.

**Deliverables:**

Files:
- `scripts/pack-bridge.js` — new — orchestrates build + esbuild bundle + pack
  - Runs `npm run build` (all packages: bridge, mcp, methodts)
  - Runs frontend build
  - Runs `esbuild` to bundle `server-entry.js` with all workspace deps into `dist-bundle/server-entry.js`
  - Runs `esbuild` to bundle `packages/mcp/dist/index.js` into `dist-bundle/mcp-server.js`
  - Generates `.mcp.json` template pointing to `dist-bundle/mcp-server.js`
  - Assembles tarball contents: `dist-bundle/` (bridge + MCP), `frontend/dist/`, `bin/`, `.env.tpl`, `.mcp.json` template, instance templates
  - Produces `method-bridge-{version}.tgz`
- `packages/bridge/package.json` — modified — add `bin` field pointing to `bin/method-bridge.js`, add `files` field as explicit allowlist of tarball contents
- `packages/bridge/bin/method-bridge.js` — new — CLI entry point (composition root). Imports `profile-loader.js` (from `scripts/lib/`, bundled at pack time). Parses `--instance`, `--port`, `--help` flags. `--help` prints usage and exits without starting the server. Spawns the bundled `server-entry.js`.
- Root `package.json` — modified — add `pack` script: `node scripts/pack-bridge.js`, add `esbuild` as devDependency

Tests:
- `scripts/pack-bridge.test.js` — new — co-located — 2 scenarios
  1. `npm run pack` produces a `.tgz` file that contains `dist-bundle/server-entry.js`, `frontend/dist/index.html`, and `.env.tpl`; does NOT contain `.env`, `node_modules/`, or `src/` (AC-8)
  2. The tarball can be installed via `npm install --prefix /tmp/test-bridge-install` (not global) and `method-bridge --help` exits cleanly with usage text (AC-9)

**Dependencies:** Phase 1 and Phase 2 must complete first (the CLI entry point reuses profile + secrets logic via profile-loader.js).

**Checkpoint:** `npm run pack` produces a tarball. Installing it in a temp directory and running `method-bridge --help` prints usage without starting a server.

## 7. Success Criteria

### Functional

| Metric | Target | Measurement Method | Current Baseline |
|--------|--------|-------------------|-----------------|
| Test instance startup time | <5s from `npm run bridge:test` to `/health` returning 200 | Time from script invocation to first successful health check | N/A (no instance system) |
| Secret resolution latency | <2s overhead from `op run` vs direct start | Compare startup time with and without `op run` | N/A (no `op` integration) |
| Zero-config backward compat | `npm run bridge` works identically to pre-PRD behavior | Run existing workflow, verify same port, same behavior | Works today |

### Non-Functional

| Metric | Target | Measurement Method | Current Baseline |
|--------|--------|-------------------|-----------------|
| Instance isolation | Two instances on different ports run simultaneously with independent health checks, event logs, and session checkpoints | Start production + test, verify independent state | Single instance only |
| Graceful fallback | Missing `op` CLI doesn't block bridge startup | Start bridge without `op` on PATH, verify it falls back to `.env` | N/A |

### Architecture

| Gate | Impact | Details |
|------|--------|---------|
| G-PORT | None | No new ports. `INSTANCE_NAME` is a passthrough env var, not a port interface. |
| G-BOUNDARY | Minimal | `server-entry.ts` modified (1 line in /health). No domain logic changes. |
| G-LAYER | None | No layer changes. Scripts are outside the layer stack. |

## 8. Acceptance Criteria

### AC-1: Instance profile loads correctly

**Given** a file `.method/instances/test.env` with `PORT=3457` and `INSTANCE_NAME=test`
**When** `npm run bridge:test` is executed
**Then** the bridge starts on port 3457
**And** `GET http://localhost:3457/health` returns `{ instance_name: "test", ... }`

**Test location:** `scripts/lib/profile-loader.test.js` scenario 1
**Automatable:** yes

### AC-2: Default behavior preserved

**Given** no `--instance` flag is passed
**When** `npm run bridge` is executed (existing workflow)
**Then** the bridge starts on port 3456 (default)
**And** `GET http://localhost:3456/health` returns `{ instance_name: "default", ... }`

**Test location:** `scripts/lib/profile-loader.test.js` scenario 2
**Automatable:** yes

### AC-3: Invalid instance name fails clearly

**Given** no file exists at `.method/instances/nonexistent.env`
**When** `node scripts/start-bridge.js --instance nonexistent` is executed
**Then** the process exits with code 1
**And** stderr contains the message "Instance profile not found: .method/instances/nonexistent.env"

**Test location:** `scripts/lib/profile-loader.test.js` scenario 3
**Automatable:** yes

### AC-4: Instance stop targets correct instance

**Given** a bridge is running on port 3457 (test instance)
**And** a bridge is running on port 3456 (production instance)
**When** `npm run bridge:stop:test` is executed
**Then** the bridge on port 3457 stops
**And** the bridge on port 3456 continues running

**Test location:** `scripts/lib/profile-loader.test.js` scenario 5
**Automatable:** yes (spawn both, kill one, health-check both)

### AC-5: 1Password secrets resolve at startup

**Given** `.env.tpl` exists with valid `op://` references
**And** `op` CLI is on PATH and authenticated
**When** `node scripts/start-bridge.js` is executed
**Then** the bridge process receives the real API key from 1Password in its environment
**And** no `.env` file is needed

**Test location:** `scripts/lib/secrets-resolution.test.js` scenario 1
**Automatable:** yes (on machines with `op`)

### AC-6: Graceful fallback to .env

**Given** `op` is not on PATH
**And** `.env` exists with `ANTHROPIC_API_KEY=sk-ant-...`
**When** `node scripts/start-bridge.js` is executed
**Then** the bridge starts normally using values from `.env`
**And** a warning is logged: "op CLI not found — falling back to .env"

**Test location:** `scripts/lib/secrets-resolution.test.js` scenario 2
**Automatable:** yes

### AC-7: No secrets, no crash

**Given** neither `.env.tpl` nor `.env` exists
**And** `op` is not on PATH
**When** `node scripts/start-bridge.js` is executed
**Then** the bridge starts without API keys
**And** a warning is logged about missing secrets

**Test location:** `scripts/lib/secrets-resolution.test.js` scenario 3
**Automatable:** yes

### AC-8: Tarball packages correctly (Phase 3 — contingent)

**Given** the project has been built (`npm run build`)
**When** `npm run pack` is executed
**Then** a file `method-bridge-{version}.tgz` is created
**And** the tarball contains `dist-bundle/server-entry.js`, `dist-bundle/mcp-server.js`, `frontend/dist/index.html`, `.mcp.json`, and `.env.tpl`
**And** the tarball does NOT contain `.env`, `node_modules/`, or `src/`

**Test location:** `scripts/pack-bridge.test.js` scenario 1
**Automatable:** yes

### AC-9: Tarball installs and runs (Phase 3 — contingent)

**Given** `method-bridge-{version}.tgz` produced by `npm run pack`
**When** `npm install --prefix /tmp/test-bridge-install method-bridge-{version}.tgz` is run on a machine with Node.js 22+
**Then** `method-bridge --help` prints usage information and exits with code 0 (without starting a server)
**And** `method-bridge --instance test` starts a bridge on the configured port

**Test location:** `scripts/pack-bridge.test.js` scenario 2
**Automatable:** yes (uses temp directory, not global install)

## 9. Risks & Mitigations

| Risk | Severity | Likelihood | Impact | Mitigation |
|------|----------|-----------|--------|-----------|
| `op` CLI not available on all machines | Medium | High | Secrets can't resolve via 1Password | Graceful fallback to `.env` — the existing workflow always works. Log a clear message pointing the user to 1Password CLI setup. |
| Port collision between instances | Medium | Medium | Two instances fail to start or fight over a port | Profile validation at startup: check if the port is already in use before binding. Exit with a clear error naming the conflicting instance. |
| esbuild bundle misses runtime dependencies | High | Medium | Tarball installs but bridge crashes on start | Phase 3 test scenario 1 verifies tarball contents. Integration test (AC-9) verifies the bundle actually starts. esbuild's tree-shaking can be disabled for the bridge bundle (`--bundle --tree-shaking=false`) if needed. |
| 1Password vault item naming mismatch | Low | Medium | `op run` fails to resolve a reference | Document the exact vault/item/field names in `.env.tpl` comments. `op run` prints a clear error naming the unresolved reference. |
| Windows path issues in instance profiles | Medium | Low | `ROOT_DIR` with backslashes breaks on WSL/Git Bash | `profile-loader.js` normalizes backslashes to forward slashes in path-valued env vars (per DR-06). Not just documentation — active normalization. |
| PRD 029 session recovery cross-instance interference | Medium | Low | Startup recovery discovers sessions from another instance | Isolation is structural: different `ROOT_DIR` → different checkpoint directory. Verify in Phase 1 integration test. |

## 10. Dependencies & Cross-Domain Impact

### Depends On
- None. PRD 029 (Bridge Resilience) has a soft interaction (session checkpoints), but this PRD works correctly regardless of whether PRD 029 has landed — the isolation model is based on `ROOT_DIR` separation which works with or without checkpoint recovery.

### Enables
- Future Docker containerization PRD (profiles and esbuild packaging provide the config + bundle layer Docker would consume)
- CI/CD for bridge releases (packaging script is the build step)
- **Bridge cluster PRD** — multi-machine orchestration with gossip-based membership, resource-aware work allocation, and a `method-ctl` management CLI. Instance profiles from this PRD become the per-node config layer. The cluster PRD would own: membership protocol (gossip/whisper so bridges on the Tailscale mesh discover each other), state sharing (load, capabilities, active sessions), work routing (target the best bridge for a task), remote management CLI (`method-ctl` — health, upgrade, drain, rebalance across known hosts), and event federation (events from one bridge visible to others). The CLI concept (maintaining a config of known bridge hosts, querying health, pushing upgrades) belongs in the cluster PRD as its user interface, not in this deployment PRD.

### Blocks / Blocked By
- None

### Cross-Domain Impact Matrix

| Domain | Change Type | Files Affected | Port Changes | Test Impact | Doc Impact |
|--------|------------|----------------|--------------|-------------|------------|
| scripts/ | Modified + New | `start-bridge.js`, `kill-port.js`, `lib/profile-loader.js`, `pack-bridge.js` | None | 3 new test files | CLAUDE.md commands section |
| .method/ | New directory | `instances/production.env`, `instances/test.env` | None | None | CLAUDE.md key dirs section |
| bridge (server-entry) | Minor modification | `server-entry.ts` (1 line: add `instance_name` to /health) | None | 1 new test (health response) | `docs/arch/bridge.md` config table |
| bridge (package.json) | Modified (Phase 3) | `package.json` (add `bin`, `files`), `bin/method-bridge.js` | None | None | None |
| root | Modified | `package.json` (add scripts), `.env.tpl` (new) | None | None | CLAUDE.md commands section |
| test-fixtures/ | New directory | `bridge-test/` with 2-3 fixture repos | None | Used by integration tests | None |

## 11. Documentation Impact

| Document | Action | Content to Add/Change |
|----------|--------|-----------------------|
| `CLAUDE.md` | Update | **Commands section:** Add `npm run bridge:test` (start test instance on port 3457), `npm run bridge:stop:test` (stop test instance), `npm run bridge -- --instance <name>` (start named instance), `npm run pack` (build distributable tarball — Phase 3). **Key Directories section:** Add `.method/instances/` — "Instance profile .env files for running multiple bridge instances on different ports with isolated state." **Sub-Agent Guidelines:** Add note: "To validate bridge changes, spin up a test instance with `npm run bridge:test` (port 3457, isolated state). Stop with `npm run bridge:stop:test`. The test instance uses fixture repos in `test-fixtures/bridge-test/` and does not interfere with the production bridge." |
| `docs/arch/bridge.md` | Update | **Configuration table:** Add `INSTANCE_NAME` env var (string, default `"default"`, human-readable instance identifier surfaced in `/health`). **New section "Instance Profiles":** Document the profile loading order: (1) `--instance <name>` loads `.method/instances/<name>.env`, (2) `.env.tpl` via `op run` if available, (3) `.env` file, (4) bare start. Document isolation dimensions (port, PID file, event log, ROOT_DIR/checkpoints, instance identity). |
| `docs/guides/15-remote-access.md` | Update | **Known Limitations section:** Update "Both processes need manual start" to note that the `method-bridge` CLI (Phase 3) provides a portable install path for remote machines. Add a paragraph: "For installing the bridge on a remote Tailscale machine without cloning the full repo, see Guide XX (Bridge Deployment)." |
| `docs/guides/XX-bridge-deployment.md` | Create | **New guide.** Sections: (1) Instance profiles — what they are, how to create custom profiles, how to start/stop instances by name, isolation guarantees. (2) 1Password setup — enabling `op` CLI in 1Password 8 settings, creating vault items for API keys, `.env.tpl` format and `op://` reference syntax, fallback behavior. (3) Packaging (Phase 3) — running `npm run pack`, what's in the tarball, installing on a target machine, publishing to GitHub Releases. (4) Multi-machine topology — Tailscale mesh, which machines run what, portal vs bridge relationship. |
| `.method/instances/production.env` | Create | Commented template: each variable with explanation of its purpose and default. Production values: PORT=3456, INSTANCE_NAME=production, ROOT_DIR pointing to the Repositories root. |
| `.method/instances/test.env` | Create | Commented template: PORT=3457, INSTANCE_NAME=test, ROOT_DIR pointing to test-fixtures/bridge-test, EVENT_LOG_PATH=/tmp/method-test-events.jsonl, GENESIS_ENABLED=false, MAX_SESSIONS=3. |
| `.env.tpl` | Create | 1Password `op://` references with inline comments documenting the vault/item/field path for each secret. Header comment explaining: "This file is committed to git. It contains references, not secrets. Values are resolved at runtime by `op run`." |
| Parent `CLAUDE.md` (`../CLAUDE.md`) | Update | **Workspace Structure > Method Bridge section:** Add `npm run bridge:test` and `npm run bridge:stop:test` to the command block. Add sentence: "Use `--instance <name>` to run isolated bridge instances on different ports (see `.method/instances/` for profiles)." |

## 12. Open Questions

| # | Question | Owner | Deadline |
|---|----------|-------|----------|
| OQ-1 | What are the exact 1Password vault and item names for Anthropic and Voyage API keys? (Need exact `op://` paths for `.env.tpl`.) | Franco | Before Phase 2 implementation |
| ~~OQ-2~~ | ~~Should the test instance profile use a real ROOT_DIR or /tmp/method-test?~~ | — | **Resolved:** Test profile uses `test-fixtures/bridge-test/` containing fixture repos. See Section 3.2. |
| OQ-3 | Should `npm run pack` also bundle the registry YAML specs and theory files, or should the tarball be bridge-only? | Franco | Before Phase 3 implementation (contingent) |

## 13. Review Findings

This PRD underwent adversarial review (4 advisors: Skeptic, Architect, Implementor, Historian). 21 findings were produced. Key resolutions:

| Finding | Severity | Resolution |
|---------|----------|------------|
| F-A-5: `npm pack` can't bundle workspace deps | CRITICAL | Fixed: use `esbuild` to produce single-file bundle (Section 3.4) |
| F-A-1: Section 3.1 contradicts Phase 1 on server-entry.ts | HIGH | Fixed: acknowledge modification explicitly (Section 3.1) |
| F-A-3: No session checkpoint isolation | HIGH | Fixed: add checkpoint dimension to isolation model (Section 3.2) |
| F-S-2: Multi-machine claim unsubstantiated | HIGH | Fixed: reframe problem statement, mark Phase 3 contingent |
| F-I-2: Test plan / AC misalignment | HIGH | Fixed: align test scenarios 1:1 with acceptance criteria |
| F-I-5: No spec for `--instance` via npm run | HIGH | Fixed: add `bridge:test` and `bridge:stop:test` npm scripts |
| F-H-2: Empty ROOT_DIR useless for testing | HIGH | Fixed: resolve OQ-2, specify fixture directory |
| F-A-4: Profile loading duplication | MEDIUM | Fixed: shared `scripts/lib/profile-loader.js` module |
| F-I-1: No dotenv parser specified | MEDIUM | Fixed: simple KEY=VALUE in profile-loader.js (Section 6, Phase 1) |
| F-I-6: Windows path mitigation is "just docs" | MEDIUM | Fixed: active normalization in profile-loader.js (per DR-06) |
| F-H-3: No bridge-level test for /health change | MEDIUM | Fixed: add `health-instance-name.test.ts` (DR-14) |

Full review record: `.method/sessions/prd-design-bridge-deployment/review-findings.md`

## 14. Implementation Status

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1: Instance Profiles | Not started | |
| Phase 2: 1Password Secrets | Not started | Blocked on OQ-1 |
| Phase 3: Portable Packaging | Not started | Contingent — ships when multi-machine need is validated |
