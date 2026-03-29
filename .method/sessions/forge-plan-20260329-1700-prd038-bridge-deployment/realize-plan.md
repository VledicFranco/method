# Realization Plan — PRD 038: Bridge Deployment

## PRD Summary

**Objective:** Enable the bridge to be operated as a managed, multi-instance service — isolated test bridges on demand, secrets auto-resolved from 1Password, and (contingently) a portable single-artifact install.

**Phases:**
- P1: Instance Profiles — profile-based isolation, `--instance` flag, test fixtures
- P2: 1Password Secrets — `.env.tpl` with `op://` references, `op run` in start script
- P3: Portable Packaging — **CONTINGENT** (deferred until multi-machine need is validated)

**Acceptance Criteria:** AC-1 through AC-7 (active). AC-8, AC-9 (contingent, Phase 3).

## FCA Partition

PRD 038 touches **zero bridge FCA domains** (sessions, strategies, tokens, etc. are untouched). All changes are in infrastructure (scripts/), the bridge composition root (server-entry.ts, 1 line), configuration artifacts, and documentation.

| Commission | Domain | Phase | Title | Depends On | Wave |
|------------|--------|-------|-------|------------|------|
| C-1 | scripts/ (infrastructure) | P1 | Instance profile system | — | 1 |
| C-2 | bridge (composition root) | P1 | Bridge instance identity | — | 1 |
| C-3 | scripts/ (infrastructure) | P2 | 1Password secrets integration | C-1 | 2 |
| C-4 | docs/ | P1-P2 | Documentation updates | C-1, C-2, C-3 | 3 |
| C-5 | scripts/ + bridge/ | P3 | Portable packaging | C-1, C-3 | DEFERRED |

**C-5 is deferred.** PRD Section 3.4: "Phase 3 is contingent — ships only when a concrete multi-machine need materializes." Not planned for execution. Will require its own decomposition (crosses scripts/ and bridge/ — needs split into two commissions when activated).

## Waves

### Wave 0 — Shared Surface Preparation

**No code changes required.**

The only cross-commission contract is the `INSTANCE_NAME` environment variable:
- **Set by:** C-1's `profile-loader.js` (reads from `.method/instances/<name>.env`)
- **Read by:** C-2's `server-entry.ts` (includes in `/health` response)
- **Type:** `string`, default `"default"`
- **Interface:** Environment variable — no TypeScript type, port, or config file needed

This is a behavioral contract via `process.env`, not a code surface. Both commissions can implement independently against this spec.

### Wave 1 — Instance Infrastructure (parallel)

- **C-1:** Instance profile system (scripts/)
- **C-2:** Bridge instance identity (bridge composition root)

C-1 and C-2 touch disjoint file sets. No shared surfaces.

### Wave 2 — Secrets Layer

- **C-3:** 1Password secrets integration (scripts/)

Depends on C-1: modifies `scripts/start-bridge.js` (which C-1 also modifies). Same domain, sequential.

### Wave 3 — Documentation

- **C-4:** Documentation updates (docs/, CLAUDE.md)

Depends on C-1, C-2, C-3: documents the final implementation of all active phases.

## Commission Cards

### C-1: Instance Profile System

- **Domain:** scripts/ (infrastructure — outside FCA layer stack)
- **Phase:** P1
- **Wave:** 1
- **Scope:**
  - **Allowed paths:**
    - `scripts/lib/profile-loader.js` (new)
    - `scripts/start-bridge.js` (modified)
    - `scripts/kill-port.js` (modified)
    - `scripts/__tests__/instance-profiles.test.js` (new)
    - `.method/instances/production.env` (new)
    - `.method/instances/test.env` (new)
    - `test-fixtures/bridge-test/**` (new)
    - `package.json` (root — add npm scripts)
  - **Forbidden paths:**
    - `packages/*/src/ports/*`
    - `packages/*/src/shared/*`
    - `packages/*/src/domains/**`
    - `packages/*/src/index.ts`
    - `packages/*/tsconfig.json`
    - `packages/bridge/src/server-entry.ts` (owned by C-2)
    - `registry/**`
    - `.method/project-card.yaml`
    - `.method/council/**`
    - `docs/**`
- **Branch:** `feat/prd038-c1-instance-profiles`
- **Parallel with:** C-2
- **Deliverables:**
  - `scripts/lib/profile-loader.js` — shared module: .env file parsing (KEY=VALUE, comments, empty lines), profile resolution by name, Windows path normalization (backslashes → forward slashes per DR-06)
  - `scripts/start-bridge.js` — add `--instance <name>` flag, import profile-loader, merge profile env with process.env (explicit env vars take precedence)
  - `scripts/kill-port.js` — add `--instance <name>` flag, import profile-loader to resolve port from profile, target correct PID file
  - `.method/instances/production.env` — default production profile (PORT=3456, INSTANCE_NAME=production), commented
  - `.method/instances/test.env` — test profile (PORT=3457, INSTANCE_NAME=test, ROOT_DIR to test fixtures, GENESIS_ENABLED=false, MAX_SESSIONS=3), commented
  - `test-fixtures/bridge-test/` — 2-3 small git repos with `.method/project-card.yaml` files and a strategy file for integration testing
  - Root `package.json` — add `bridge:test` and `bridge:stop:test` npm scripts
  - `scripts/__tests__/instance-profiles.test.js` — 5 test scenarios
- **Documentation:** None (C-4 handles all docs)
- **Acceptance criteria:**
  - `--instance test` loads test.env, bridge starts on port 3457 → AC-1
  - No `--instance` flag uses current defaults (port 3456) → AC-2
  - `--instance nonexistent` exits code 1 with clear error → AC-3
  - Explicit env vars take precedence over profile values
  - Start production + test simultaneously, stop test only, production still running → AC-4
- **Dependencies:** None
- **Estimated tasks:** 7
- **Status:** pending

### C-2: Bridge Instance Identity

- **Domain:** bridge (composition root — `packages/bridge/src/server-entry.ts`)
- **Phase:** P1
- **Wave:** 1
- **Scope:**
  - **Allowed paths:**
    - `packages/bridge/src/server-entry.ts` (modified — 1 line)
    - `packages/bridge/src/__tests__/health-instance-name.test.ts` (new)
  - **Forbidden paths:**
    - `packages/bridge/src/ports/*`
    - `packages/bridge/src/shared/*`
    - `packages/bridge/src/domains/**`
    - `packages/bridge/src/index.ts`
    - `packages/bridge/package.json`
    - `scripts/**`
    - `registry/**`
    - `.method/project-card.yaml`
    - `docs/**`
- **Branch:** `feat/prd038-c2-instance-identity`
- **Parallel with:** C-1
- **Deliverables:**
  - `packages/bridge/src/server-entry.ts` — read `INSTANCE_NAME` from `process.env` (default `"default"`), add `instance_name` field to `/health` response object
  - `packages/bridge/src/__tests__/health-instance-name.test.ts` — verify `/health` returns `instance_name` field (DR-14 compliance)
- **Documentation:** None (C-4 handles all docs)
- **Acceptance criteria:**
  - When `INSTANCE_NAME=test` is set, `GET /health` response includes `instance_name: "test"` → AC-1
  - When `INSTANCE_NAME` is not set, `GET /health` returns `instance_name: "default"` → AC-2
- **Dependencies:** None
- **Estimated tasks:** 3
- **Status:** pending

### C-3: 1Password Secrets Integration

- **Domain:** scripts/ (infrastructure)
- **Phase:** P2
- **Wave:** 2
- **Scope:**
  - **Allowed paths:**
    - `.env.tpl` (new)
    - `scripts/start-bridge.js` (modified — add `op` detection and `op run` launch path)
    - `scripts/__tests__/secrets-resolution.test.js` (new)
    - `.gitignore` (verified — `.env` ignored, `.env.tpl` NOT ignored)
  - **Forbidden paths:**
    - `packages/*/src/**`
    - `packages/*/package.json`
    - `scripts/lib/profile-loader.js` (owned by C-1, frozen after Wave 1)
    - `scripts/kill-port.js` (frozen after Wave 1)
    - `registry/**`
    - `.method/project-card.yaml`
    - `docs/**`
- **Branch:** `feat/prd038-c3-secrets-integration`
- **Parallel with:** None
- **Deliverables:**
  - `.env.tpl` — 1Password `op://` reference template (committed). PLACEHOLDER paths until OQ-1 is resolved. Header comment explaining the file is committed and contains references, not secrets.
  - `scripts/start-bridge.js` — add `op` detection (`which op` / `where op`), `op run --env-file=.env.tpl` launch path. Resolution order: (1) instance profile, (2) `.env.tpl` via `op run` if available, (3) `.env` file, (4) bare. Log which path was taken.
  - `scripts/__tests__/secrets-resolution.test.js` — 3 test scenarios
  - `.gitignore` — verify `.env` is ignored, `.env.tpl` is NOT ignored
- **Documentation:** None (C-4 handles all docs)
- **Acceptance criteria:**
  - When `op` is on PATH and `.env.tpl` exists → spawns via `op run` → AC-5
  - When `op` is not available → falls back to `.env` with warning → AC-6
  - When neither `.env.tpl` nor `.env` exists → starts without secrets, logs warning → AC-7
- **Dependencies:** C-1 (start-bridge.js modifications must land first)
- **Blocker:** OQ-1 — exact 1Password vault/item paths needed for `.env.tpl`. Can implement with PLACEHOLDER paths and resolve before merge.
- **Estimated tasks:** 4
- **Status:** pending

### C-4: Documentation Updates

- **Domain:** docs/ (documentation)
- **Phase:** P1-P2 (cross-phase, documents everything)
- **Wave:** 3
- **Scope:**
  - **Allowed paths:**
    - `CLAUDE.md` (updated — commands, key dirs, sub-agent guidelines)
    - `docs/arch/bridge.md` (updated — INSTANCE_NAME config, instance profiles section)
    - `docs/guides/15-remote-access.md` (updated — known limitations, pointer to new guide)
    - `docs/guides/XX-bridge-deployment.md` (new — deployment guide)
    - `../CLAUDE.md` (parent workspace — add bridge:test commands, --instance note)
  - **Forbidden paths:**
    - `packages/**`
    - `scripts/**`
    - `registry/**`
    - `.method/project-card.yaml`
    - `.method/council/**`
    - `.method/instances/**` (owned by C-1)
    - `test-fixtures/**`
- **Branch:** `feat/prd038-c4-documentation`
- **Parallel with:** None
- **Deliverables:**
  - `CLAUDE.md` — Commands section: add `bridge:test`, `bridge:stop:test`, `--instance <name>`, `npm run pack` (Phase 3 note). Key Directories: add `.method/instances/`. Sub-Agent Guidelines: add test instance instructions.
  - `docs/arch/bridge.md` — Configuration table: add `INSTANCE_NAME` env var. New "Instance Profiles" section: profile loading order, isolation dimensions.
  - `docs/guides/15-remote-access.md` — Update known limitations, add pointer to new deployment guide.
  - `docs/guides/XX-bridge-deployment.md` — New guide. Sections: instance profiles, 1Password setup, packaging (Phase 3 stub), multi-machine topology.
  - Parent `../CLAUDE.md` — Workspace Structure > Method Bridge: add `bridge:test`, `bridge:stop:test`, `--instance` note.
- **Documentation:** Self-documenting commission.
- **Acceptance criteria:**
  - All items in PRD Section 11 documentation matrix are addressed
  - New guide number assigned (next available after existing guides)
  - All new commands documented in CLAUDE.md
  - Parent workspace CLAUDE.md updated with instance commands
- **Dependencies:** C-1, C-2, C-3 (documents the final state of all active phases)
- **Estimated tasks:** 5
- **Status:** pending

## Shared Surface Changes

| Wave | File | Change | Reason |
|------|------|--------|--------|
| 0 | *(none)* | `INSTANCE_NAME` env var contract: string, default `"default"` | Behavioral contract between C-1 (sets) and C-2 (reads). No code surface — both read from `process.env`. |

No port interfaces, barrel exports, config schemas, or shared types are created or modified by this PRD. The only cross-commission dependency is an environment variable name.

## Acceptance Gates

| AC | Description | Commission | Automatable |
|----|-------------|------------|-------------|
| AC-1 | Instance profile loads, health shows instance_name | C-1, C-2 | Yes |
| AC-2 | Default behavior preserved (port 3456, instance_name "default") | C-1, C-2 | Yes |
| AC-3 | Invalid instance name exits with code 1 and clear error | C-1 | Yes |
| AC-4 | Instance stop targets correct instance only | C-1 | Yes |
| AC-5 | 1Password secrets resolve at startup via op run | C-3 | Yes (on machines with op) |
| AC-6 | Graceful fallback to .env when op missing | C-3 | Yes |
| AC-7 | No secrets, no crash — starts with warning | C-3 | Yes |
| AC-8 | Tarball packages correctly | C-5 (DEFERRED) | Yes |
| AC-9 | Tarball installs and runs | C-5 (DEFERRED) | Yes |

## Verification Report

| Gate | Status | Details |
|------|--------|---------|
| Single-domain | PASS | C-1: scripts/, C-2: bridge composition root, C-3: scripts/, C-4: docs/ — all single-domain |
| No wave conflicts | PASS | Wave 1: C-1 (scripts) + C-2 (bridge) — different domains. Waves 2-3: single commission each |
| DAG acyclic | PASS | C-1→C-3→C-4, C-2→C-4. No cycles |
| Surfaces enumerated | PASS | One surface: INSTANCE_NAME env var (behavioral, no code change needed) |
| Scope complete | PASS | All 4 commissions have non-empty allowed_paths + forbidden_paths |
| Criteria traceable | PASS | AC-1 through AC-7 mapped to C-1/C-2/C-3. Docs mapped to PRD Section 11 |
| PRD coverage | PASS | All P1-P2 success criteria covered. P3 (AC-8, AC-9) deferred per PRD |
| Task bounds | PASS | C-1: 7, C-2: 3, C-3: 4, C-4: 5 — all within 3-8 |

**Overall: 8/8 gates pass**

## Risk Assessment

- **Critical path length:** 3 waves (shallow — fast execution)
- **Largest wave:** Wave 1 (2 parallel commissions — modest breadth)
- **Surface change count:** 0 code surfaces (env var contract only)
- **New port count:** 0 (G-PORT: none per PRD architecture gates)
- **Open blocker:** OQ-1 (1Password vault paths) blocks C-3 from final `.env.tpl` values — can proceed with placeholders

**Risk profile: LOW.** Infrastructure-only changes, no domain logic touched, no ports or shared types created. The main risk is OQ-1 delaying C-3 merge.

## Status Tracker

Total: 4 active commissions, 3 waves (+ 1 deferred commission)
Completed: 0 / 4

| Commission | Status | Wave | Branch |
|------------|--------|------|--------|
| C-1 | pending | 1 | `feat/prd038-c1-instance-profiles` |
| C-2 | pending | 1 | `feat/prd038-c2-instance-identity` |
| C-3 | pending | 2 | `feat/prd038-c3-secrets-integration` |
| C-4 | pending | 3 | `feat/prd038-c4-documentation` |
| C-5 | deferred | — | *(not created)* |
