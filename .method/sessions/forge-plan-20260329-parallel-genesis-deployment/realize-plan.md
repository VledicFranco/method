# Realization Plan — PRDs 025 + 038 + 029 (Genesis Dedup)

## Objective

Execute three independent workstreams in parallel:
- **Track A** (PRD 038 P1-P2): Instance profiles + 1Password secrets
- **Track B** (PRD 025 P1-P5): Universal Genesis ambient agent UI
- **Track C** (PRD 029 genesis dedup): Genesis session recovery dedup

PRD 039 (Bridge Cluster) is gated behind 038 P1 + OQ-1 validation — excluded from this plan.

## FCA Partition

| Commission | Track | Domain | PRD Phase | Title | Depends On | Wave |
|------------|-------|--------|-----------|-------|------------|------|
| C-1 | A | scripts/ + server-entry | 038 P1 | Instance profiles + test fixtures | — | 1 |
| C-2 | B | frontend/genesis + stores | 025 P1 | State extraction + universal rendering | — | 1 |
| C-3 | C | backend/genesis | 029 | Genesis session recovery dedup | — | 1 |
| C-4 | A | scripts/ | 038 P2 | 1Password secrets integration | C-1 | 2 |
| C-5 | B | frontend/genesis + pages | 025 P2 | Page awareness hooks | C-2 | 2 |
| C-6 | B | frontend/genesis | 025 P3 | Responsive layout (mobile/desktop) | C-2 | 2 |
| C-7 | B | frontend/genesis + pages | 025 P4 | UI control actions | C-5 | 3 |
| C-8 | B | frontend/genesis | 025 P5 | Polish + edge cases | C-6, C-7 | 4 |

## Waves

### Wave 0 — Shared Surface Preparation (orchestrator applies)

No shared surface changes needed. The three tracks touch disjoint file sets:
- Track A: `scripts/`, `.method/instances/`, `test-fixtures/`, `server-entry.ts:265-274` (/health handler)
- Track B: `frontend/src/domains/genesis/`, `frontend/src/shared/stores/`, `frontend/src/App.tsx`
- Track C: `packages/bridge/src/domains/genesis/spawner.ts`, `server-entry.ts:485-500` (startup recovery section)

No port, type, or config changes cross tracks. Wave 0 is empty.

### Wave 1 — Foundation (3 parallel commissions)

```
┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│ C-1: Instance        │  │ C-2: Genesis State   │  │ C-3: Genesis Dedup  │
│ Profiles (038 P1)    │  │ Extraction (025 P1)  │  │ (029)               │
│ Track A · backend    │  │ Track B · frontend   │  │ Track C · backend   │
└──────────┬──────────┘  └──────────┬──────────┘  └───────────────────────┘
           │                       │
           ▼                       ├──────────────┐
┌──────────────────────┐ ┌─────────▼────────┐ ┌──▼──────────────────┐
│ C-4: 1Password       │ │ C-5: Page        │ │ C-6: Responsive     │
│ Secrets (038 P2)     │ │ Awareness (025P2)│ │ Layout (025 P3)     │
│ Track A · backend    │ │ Track B · front   │ │ Track B · frontend  │
└──────────────────────┘ └────────┬─────────┘ └──────────┬──────────┘
                                  │                      │
                         ┌────────▼─────────┐            │
                         │ C-7: UI Control  │            │
                         │ Actions (025 P4) │            │
                         │ Track B · front  │            │
                         └────────┬─────────┘            │
                                  │                      │
                         ┌────────▼──────────────────────▼┐
                         │ C-8: Polish + Edge Cases       │
                         │ (025 P5) · Track B · frontend  │
                         └────────────────────────────────┘
```

### Wave 2 — Enrichment (3 parallel commissions)

- **C-4** (Track A): 1Password secrets — depends on C-1 (profile-loader exists)
- **C-5** (Track B): Page awareness — depends on C-2 (genesis store exists)
- **C-6** (Track B): Responsive layout — depends on C-2 (genesis components in App.tsx)

C-5 and C-6 are in the same track but touch different files:
- C-5 touches all page components (adding `useGenesisPageContext`) + genesis store
- C-6 touches only genesis domain components (FAB, ChatPanel CSS/layout)

No file overlap → safe to parallelize within Track B.

### Wave 3 — UI Control

- **C-7** (Track B): Action hooks — depends on C-5 (page context wiring exists)

### Wave 4 — Polish

- **C-8** (Track B): Edge cases — depends on C-6 + C-7

## Commission Cards

### C-1: Instance Profiles (PRD 038 Phase 1)

```yaml
id: C-1
prd: 038
phase: Phase 1
title: "Instance profiles, test fixtures, /health instance_name"
domain: scripts/ + server-entry (infra)
wave: 1
scope:
  allowed_paths:
    - "scripts/lib/**"
    - "scripts/start-bridge.js"
    - "scripts/kill-port.js"
    - ".method/instances/**"
    - "test-fixtures/bridge-test/**"
    - "packages/bridge/src/server-entry.ts"  # /health handler only
    - "packages/bridge/src/health-instance-name.test.ts"
    - "package.json"  # add bridge:test, bridge:stop:test scripts
  forbidden_paths:
    - "packages/bridge/src/ports/**"
    - "packages/bridge/src/shared/**"
    - "packages/bridge/src/domains/**"
    - "packages/bridge/frontend/**"
depends_on: []
parallel_with: [C-2, C-3]
deliverables:
  - "scripts/lib/profile-loader.js — CommonJS, env parsing + path normalization"
  - "scripts/lib/profile-loader.test.js — 4 unit scenarios"
  - "scripts/lib/instance-lifecycle.integration.test.js — 1 integration scenario"
  - "scripts/start-bridge.js — add --instance flag"
  - "scripts/kill-port.js — add --instance flag"
  - ".method/instances/production.env"
  - ".method/instances/test.env"
  - "test-fixtures/bridge-test/ — 2-3 fixture repos"
  - "server-entry.ts — INSTANCE_NAME in /health"
  - "health-instance-name.test.ts"
documentation_deliverables:
  - ".method/instances/README.md — profile format, how to create custom profiles"
  - "test-fixtures/bridge-test/README.md — what fixtures are, how they're used"
  - "scripts/lib/README.md — shared script utilities"
acceptance_criteria:
  - "AC-1: --instance test loads profile, starts on port 3457 → PRD 038 AC-1"
  - "AC-2: No --instance uses defaults, backward compat → PRD 038 AC-2"
  - "AC-3: Invalid instance name exits with clear error → PRD 038 AC-3"
  - "AC-4: Stop test instance, production continues → PRD 038 AC-4"
estimated_tasks: 8
branch: "feat/prd038-c1-instance-profiles"
status: pending
```

### C-2: Genesis State Extraction + Universal Rendering (PRD 025 Phase 1)

```yaml
id: C-2
prd: 025
phase: Phase 1
title: "Extract genesis state to Zustand store, render universally"
domain: frontend/genesis + frontend/shared/stores
wave: 1
scope:
  allowed_paths:
    - "packages/bridge/frontend/src/domains/genesis/**"
    - "packages/bridge/frontend/src/shared/stores/genesis-store.ts"
    - "packages/bridge/frontend/src/shared/pages/Dashboard.tsx"  # remove genesis local state
    - "packages/bridge/frontend/src/App.tsx"  # add GenesisProvider + FAB + Panel
  forbidden_paths:
    - "packages/bridge/src/**"
    - "scripts/**"
    - "packages/bridge/frontend/src/domains/sessions/**"
    - "packages/bridge/frontend/src/domains/strategies/**"
depends_on: []
parallel_with: [C-1, C-3]
deliverables:
  - "frontend/src/shared/stores/genesis-store.ts — Zustand store (GenesisState interface)"
  - "frontend/src/domains/genesis/GenesisFAB.tsx — refactor to use store"
  - "frontend/src/domains/genesis/GenesisChatPanel.tsx — refactor to use store"
  - "frontend/src/shared/pages/Dashboard.tsx — remove genesis local state"
  - "frontend/src/App.tsx — add GenesisProvider, FAB, ChatPanel outside Routes"
documentation_deliverables:
  - "frontend/src/domains/genesis/README.md — update with store-based architecture"
acceptance_criteria:
  - "Genesis FAB + chat visible on every page → PRD 025 SC-1"
  - "Chat conversation survives navigation → PRD 025 SC-2"
  - "Zero cross-domain imports → PRD 025 SC-8"
  - "Playwright: navigation persistence screenshot"
estimated_tasks: 6
branch: "feat/prd025-c2-genesis-state-extraction"
status: pending
```

### C-3: Genesis Session Recovery Dedup (PRD 029)

```yaml
id: C-3
prd: 029
phase: P1.6
title: "Genesis dedup — adopt recovered genesis session instead of re-spawning"
domain: backend/genesis
wave: 1
scope:
  allowed_paths:
    - "packages/bridge/src/domains/genesis/spawner.ts"
    - "packages/bridge/src/domains/genesis/spawner.test.ts"
    - "packages/bridge/src/server-entry.ts"  # genesis spawn section only (~lines 485-500)
  forbidden_paths:
    - "packages/bridge/src/ports/**"
    - "packages/bridge/src/shared/**"
    - "packages/bridge/src/domains/sessions/**"
    - "packages/bridge/frontend/**"
    - "scripts/**"
depends_on: []
parallel_with: [C-1, C-2]
deliverables:
  - "spawner.ts — add dedup check: scan recovered sessions for metadata.genesis === true"
  - "spawner.test.ts — 2 scenarios: (1) no recovered genesis → spawn new, (2) recovered genesis → adopt"
  - "server-entry.ts — pass recovery report to spawnGenesis for dedup check"
documentation_deliverables:
  - "docs/arch/genesis.md — update spawn lifecycle with dedup behavior"
acceptance_criteria:
  - "Genesis dedup: recovered genesis-tagged session adopted, not re-spawned → PRD 029 R5"
  - "No recovered genesis: normal spawn behavior preserved"
estimated_tasks: 3
branch: "feat/prd029-c3-genesis-dedup"
status: pending
```

### C-4: 1Password Secrets Integration (PRD 038 Phase 2)

```yaml
id: C-4
prd: 038
phase: Phase 2
title: "1Password CLI op run integration + .env fallback"
domain: scripts/
wave: 2
scope:
  allowed_paths:
    - "scripts/start-bridge.js"
    - "scripts/lib/secrets-resolution.test.js"
    - ".env.tpl"
    - ".gitignore"
  forbidden_paths:
    - "packages/**"
depends_on: [C-1]
parallel_with: [C-5, C-6]
deliverables:
  - "scripts/start-bridge.js — op detection (try execSync('op --version')), op run launch path"
  - "scripts/lib/secrets-resolution.test.js — 3 scenarios"
  - ".env.tpl — placeholder op:// references"
documentation_deliverables: []
acceptance_criteria:
  - "op available + .env.tpl → spawns via op run → PRD 038 AC-5"
  - "op unavailable → falls back to .env with warning → PRD 038 AC-6"
  - "No .env.tpl, no .env → starts without secrets → PRD 038 AC-7"
estimated_tasks: 4
branch: "feat/prd038-c4-1password-secrets"
status: pending
```

### C-5: Page Awareness (PRD 025 Phase 2)

```yaml
id: C-5
prd: 025
phase: Phase 2
title: "useGenesisPageContext hook, wire into all pages"
domain: frontend/genesis + all frontend page domains
wave: 2
scope:
  allowed_paths:
    - "packages/bridge/frontend/src/domains/genesis/**"
    - "packages/bridge/frontend/src/shared/stores/genesis-store.ts"
    - "packages/bridge/frontend/src/shared/pages/**"
    - "packages/bridge/frontend/src/domains/sessions/**"
    - "packages/bridge/frontend/src/domains/strategies/**"
    - "packages/bridge/frontend/src/domains/triggers/**"
    - "packages/bridge/frontend/src/domains/projects/**"
    - "packages/bridge/frontend/src/domains/registry/**"
    - "packages/bridge/frontend/src/domains/tokens/**"
  forbidden_paths:
    - "packages/bridge/src/**"
    - "scripts/**"
depends_on: [C-2]
parallel_with: [C-4, C-6]
deliverables:
  - "useGenesisPageContext hook"
  - "Wire into all pages: Dashboard, Sessions, Strategies, Triggers, Registry"
  - "Playwright: test context updates on navigation"
acceptance_criteria:
  - "Genesis store reflects correct page context → PRD 025 SC-3"
  - "Playwright screenshot proves context awareness"
estimated_tasks: 5
branch: "feat/prd025-c5-page-awareness"
status: pending
```

### C-6: Responsive Layout (PRD 025 Phase 3)

```yaml
id: C-6
prd: 025
phase: Phase 3
title: "Mobile full-screen chat, desktop side panel"
domain: frontend/genesis
wave: 2
scope:
  allowed_paths:
    - "packages/bridge/frontend/src/domains/genesis/**"
  forbidden_paths:
    - "packages/bridge/src/**"
    - "packages/bridge/frontend/src/shared/**"
    - "packages/bridge/frontend/src/domains/sessions/**"
    - "scripts/**"
depends_on: [C-2]
parallel_with: [C-4, C-5]
deliverables:
  - "GenesisFAB.tsx — mobile: smaller, non-draggable"
  - "GenesisChatPanel.tsx — mobile: full-screen; desktop: side panel"
  - "Keyboard avoidance (visualViewport API)"
  - "Playwright: mobile (375x667) + desktop (1280x800) screenshots"
acceptance_criteria:
  - "Mobile: chat is full-screen, input above keyboard → PRD 025 SC-4"
  - "Desktop: chat is side panel, page interactive → PRD 025 SC-5"
estimated_tasks: 6
branch: "feat/prd025-c6-responsive-layout"
status: pending
```

### C-7: UI Control Actions (PRD 025 Phase 4)

```yaml
id: C-7
prd: 025
phase: Phase 4
title: "useGenesisAction hook — navigate, highlight, toast, spawnSession"
domain: frontend/genesis + all frontend pages
wave: 3
scope:
  allowed_paths:
    - "packages/bridge/frontend/src/domains/genesis/**"
    - "packages/bridge/frontend/src/shared/stores/genesis-store.ts"
    - "packages/bridge/frontend/src/shared/pages/**"
    - "packages/bridge/frontend/src/domains/*/pages/**"
  forbidden_paths:
    - "packages/bridge/src/**"
    - "scripts/**"
depends_on: [C-5]
parallel_with: []
deliverables:
  - "useGenesisAction hook"
  - "Action types: navigate, highlight, toast, spawnSession"
  - "Wire action consumers into pages"
  - "Playwright: action dispatch test"
acceptance_criteria:
  - "Genesis can navigate user to a different page"
  - "Playwright screenshot proves action dispatch"
estimated_tasks: 5
branch: "feat/prd025-c7-ui-control-actions"
status: pending
```

### C-8: Polish + Edge Cases (PRD 025 Phase 5)

```yaml
id: C-8
prd: 025
phase: Phase 5
title: "Auto-reconnect, retry, graceful degradation, transcript export"
domain: frontend/genesis
wave: 4
scope:
  allowed_paths:
    - "packages/bridge/frontend/src/domains/genesis/**"
    - "packages/bridge/frontend/src/shared/stores/genesis-store.ts"
    - "packages/bridge/frontend/src/shared/websocket/**"
  forbidden_paths:
    - "packages/bridge/src/**"
    - "scripts/**"
depends_on: [C-6, C-7]
parallel_with: []
deliverables:
  - "WebSocket auto-reconnect on drop"
  - "Chat message retry on network failure"
  - "Graceful degradation (bridge down → disconnected state)"
  - "Session transcript export (download as markdown)"
  - "Playwright: end-to-end flow"
acceptance_criteria:
  - "Playwright: full e2e (spawn → chat → navigate → resume)"
estimated_tasks: 5
branch: "feat/prd025-c8-genesis-polish"
status: pending
```

## Shared Surface Changes

None. The three tracks touch disjoint file sets. `server-entry.ts` is touched by C-1 (/health handler, ~line 265) and C-3 (startup genesis section, ~line 485) — different regions, no conflict.

## Acceptance Gates

| Gate | Source | Commissions |
|------|--------|-------------|
| PRD 038 AC-1 through AC-7 | PRD 038 | C-1, C-4 |
| PRD 025 SC-1 through SC-8 | PRD 025 | C-2, C-5, C-6, C-7, C-8 |
| PRD 029 R5 (genesis dedup) | PRD 029 | C-3 |

## Verification Report

| Gate | Status |
|------|--------|
| Single-domain commissions | PASS — each commission touches one domain (or scripts infra) |
| No wave domain conflicts | PASS — C-5/C-6 in wave 2 touch different files within frontend |
| DAG acyclic | PASS — linear chains A and B, standalone C |
| Surfaces enumerated | PASS — no cross-track shared surfaces |
| Scope complete | PASS — all commissions have allowed + forbidden paths |
| Criteria traceable | PASS — all commission ACs trace to PRD criteria |
| PRD coverage | PASS — all PRD phases mapped to commissions |
| Task bounds | PASS — 3 to 8 tasks per commission |

Overall: 8/8 gates pass

## Risk Assessment

- **Critical path:** Track B (4 waves: C-2→C-5/C-6→C-7→C-8). Track A completes in 2 waves. Track C completes in 1 wave.
- **Largest wave:** Wave 1 (3 parallel commissions) and Wave 2 (3 parallel commissions)
- **Surface changes:** 0 (all tracks disjoint)
- **Max concurrent agents:** 3 (Wave 1), then 3 (Wave 2), then 1, then 1

## Status Tracker

```
Total: 8 commissions, 4 waves (C-1+C-4 merged into single agent)
Completed: 8 / 8
Status: REALIZED (2026-03-29)

Wave 1: C-1+C-4 ✅  C-2 ✅  C-3 ✅   [PR #118, #120, #119]
Wave 2: C-5 ✅  C-6 ✅               [PR #122, #121]
Wave 3: C-7 ✅                          [PR #123]
Wave 4: C-8 ✅                          [PR #126]

All acceptance gates pass. Report: realize-report.md
```

## Execution

To execute: `/forge-commission --orchestrate .method/sessions/forge-plan-20260329-parallel-genesis-deployment/realize-plan.md`

Or manually launch Wave 1 as 3 background agents:
```
Agent A: /commission C-1 (feat/prd038-c1-instance-profiles)
Agent B: /commission C-2 (feat/prd025-c2-genesis-state-extraction)
Agent C: /commission C-3 (feat/prd029-c3-genesis-dedup)
```
