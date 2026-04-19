---
title: "PRD 023: FCA Bridge Refactor — Domain-Co-located Architecture"
status: implemented
---

# PRD 023: FCA Bridge Refactor — Domain-Co-located Architecture

**Status:** Implemented (PR #46 — Phases 0-10, 12 complete + last-mile types/routes extraction)
**Date:** 2026-03-23
**Owner:** Steering Council
**Methodology:** P2-SD v2.0
**Depends on:** All existing bridge functionality (PRDs 005, 008, 010, 012, 014, 017, 018, 019, 020)
**Complexity:** High — structural reorganization of the largest package, zero API behavioral change
**Design reference:** `docs/fractal-component-architecture/` (Fractal Component Architecture methodology)
**Review:** 4-advisor adversarial review, 4-synthesizer consensus. Action plan: `tmp/action-plan-prd023-fca-bridge-refactor-2026-03-23.md`
**Scope:** Reorganize `@methodts/bridge` from artifact-type directories to domain-co-located directories following FCA Principle 8 (co-locate all artifacts), with server domains under `src/domains/` and client domains under `frontend/src/domains/`

---

## 1. Problem Statement

### The bridge organizes by artifact type, not by domain

`@methodts/bridge` is the largest package in the monorepo: 26 root source files, 95 nested source files, 74 frontend files, and 50 test files. It contains 8 distinct domains whose artifacts are scattered across four parallel directory trees:

```
packages/bridge/
  src/                          # 121 server files — all domains mixed
    __tests__/                  # 50 test files — all domains in one flat directory
    strategy/                   # 11 files — only domain with its own directory
    triggers/                   # 13 files — only other domain with a directory
    ...                         # Everything else at root level
  frontend/src/
    components/domain/          # 18 components — all domains in one directory
    hooks/                      # 9 hooks — all domains in one directory
    pages/                      # 10 pages — all domains in one directory
    lib/types.ts                # 406 lines — ALL types for ALL domains in one file
```

### Consequences

1. **To understand a domain, read from 5 directories.** The strategy domain has files in `src/strategy/`, `src/__tests__/`, `frontend/src/hooks/useStrategies.ts`, `frontend/src/components/domain/StrategyCard.tsx`, `frontend/src/pages/Strategies.tsx`, and `frontend/src/lib/types.ts`. A developer modifying strategy behavior touches all five locations.

2. **Types are a monolith.** `frontend/src/lib/types.ts` (406 lines) defines types for sessions, triggers, strategies, projects, events, tokens, and websockets in one file. Every domain's types are coupled to every other domain's types.

3. **Tests are unnavigable.** 50 test files in one `__tests__/` directory. Finding the tests for the trigger debounce logic requires scanning filenames. No test is co-located with the code it verifies.

4. **Configuration is scattered.** Each domain reads env vars from different locations — some in `index.ts` (1096 lines), some in route files, some in infrastructure files. No domain has a config schema.

5. **Adding a domain touches the whole tree.** Creating a new domain requires: add server files in `src/`, add types in `frontend/src/lib/types.ts`, add hooks in `frontend/src/hooks/`, add components in `frontend/src/components/domain/`, add pages in `frontend/src/pages/`, add tests in `src/__tests__/`. Six locations for one concept.

### What this PRD delivers

A structural reorganization of `@methodts/bridge` into domain-co-located directories. Server domain code goes to `src/domains/`, client domain code goes to `frontend/src/domains/`, and shared types live in `src/domains/*/types.ts` (importable by both runtimes as type-only). **Zero API behavioral change** — the same endpoints, same UI, same tests, same functionality. File locations and import paths change. Some phases involve structural extraction (splitting chimera files, rewriting the composition layer) which are internal reorganizations, not API changes.

---

## 2. Target Architecture

### Build-Compatible Domain Layout

The original FCA Option C (unified `domains/` directory with `server/` + `client/` subdirectories) is incompatible with the existing dual-build setup: the server uses `tsc` with `rootDir: "src"`, and the frontend uses Vite rooted at `frontend/`. Instead, domain code stays inside each build root:

- **Server domain code:** `src/domains/{name}/` (inside existing `rootDir: "src"`)
- **Client domain code:** `frontend/src/domains/{name}/` (inside existing Vite root)
- **Shared types:** `src/domains/{name}/types.ts` (pure type declarations — no runtime code, importable by both builds via `import type`)

This preserves both build configurations without changes to `rootDir`, Vite root, or module resolution. The co-location is per-domain within each runtime, with shared types as the bridge.

### Server Domain Structure

```
src/domains/{domain-name}/
  types.ts                     # Shared types (pure declarations, no runtime code)
  config.ts                    # Configuration schema + defaults (Zod)
  index.ts                     # Domain interface (re-exports)
  {implementation}.ts          # Domain logic
  {implementation}.test.ts     # Co-located verification
  routes.ts                    # HTTP route handlers (thin)
```

### Client Domain Structure

```
frontend/src/domains/{domain-name}/
  {Page}.tsx                   # Page components (PascalCase preserved)
  {Component}.tsx              # Domain-specific UI components
  use{Name}.ts                 # Data hooks (camelCase preserved)
```

### Import Resolution

- **Server imports:** relative paths only. No `@domains/*` path aliases. Relative imports work with tsc, tsx, and Node.js without additional configuration.
- **Client imports:** `@/` alias continues to point to `frontend/src/`. Add `@domains/` alias in Vite config pointing to `frontend/src/domains/`. Client files import shared types from server via `import type` with a path alias configured in the frontend tsconfig.
- **Cross-domain client imports:** permitted for exported components (e.g., sessions page importing `SessionTokenBadge` from tokens domain). The dependency direction should be documented.

### Shared Types Constraint

Domain `types.ts` files must contain **only TypeScript type declarations** — interfaces, type aliases, enums. No runtime values (`const`, functions, classes). This ensures compatibility across server (`moduleResolution: Node16`) and client (`moduleResolution: bundler`) builds, since type-only imports are erased at compile time regardless of resolution strategy.

### Full Bridge Layout

```
packages/bridge/

  src/
    domains/
      sessions/                        # Session Pool domain (absorbs channels + transcripts)
        types.ts                       # SessionSummary, SessionDetail, SpawnRequest, ChannelMessage, etc.
        config.ts                      # MAX_SESSIONS, SETTLE_DELAY_MS, DEAD_SESSION_TTL_MS, etc.
        index.ts
        pool.ts
        pool.test.ts
        pty-session.ts
        print-session.ts
        spawn-queue.ts
        spawn-queue.test.ts
        channels.ts                    # Absorbed from standalone — session infrastructure
        channels.test.ts
        pty-watcher.ts                 # Per-session PTY observer
        pattern-matchers.ts
        scope-hook.ts
        auto-retro.ts
        diagnostics.ts
        adaptive-settle.ts
        adaptive-settle.test.ts
        parser.ts
        transcript-reader.ts           # Absorbed from standalone — session artifacts
        transcript-reader.test.ts
        routes.ts                      # POST/GET/DELETE /sessions, SSE stream, channels, transcripts
        sse-stream.ts

      strategies/
        types.ts                       # StrategyDefinition, NodeStatus, ExecutionState, etc.
        config.ts                      # STRATEGY_ENABLED, STRATEGY_MAX_PARALLEL, etc.
        index.ts
        executor.ts
        executor.test.ts
        parser.ts
        gates.ts
        gates.test.ts
        artifact-store.ts
        artifact-store.test.ts
        retro-generator.ts
        retro-writer.ts
        routes.ts
        llm-provider.ts               # Port: interface LlmProvider
        claude-code-provider.ts        # Port implementation

      triggers/
        types.ts                       # TriggerConfig, TriggerEvent, TriggerRegistration, etc.
        config.ts                      # TRIGGERS_ENABLED, TRIGGERS_STRATEGY_DIR, etc.
        index.ts
        router.ts
        router.test.ts
        parser.ts
        debounce.ts
        debounce.test.ts
        startup-scan.ts
        glob-match.ts
        sandbox-eval.ts
        routes.ts
        watchers/
          git-commit.ts
          file-watch.ts
          schedule.ts
          webhook.ts
          pty-watcher.ts
          channel-event.ts

      registry/
        types.ts                       # RegistryTree, MethodDetail, ManifestEntry
        index.ts
        project-registry.ts
        resource-copier.ts             # Copy methodology/strategy logic
        routes.ts
        routes.test.ts

      projects/
        types.ts                       # ProjectMetadata, ProjectEvent, EventFilter
        config.ts
        index.ts
        discovery-service.ts
        discovery-service.test.ts
        routes.ts                      # Note: split from chimera project-routes.ts
        events/
          persistence.ts               # Port: interface EventPersistence
          yaml-persistence.ts
          yaml-persistence.test.ts
          jsonl-persistence.ts
          project-event.ts

      tokens/
        types.ts                       # SessionTokenUsage, AggregateTokenUsage, SubscriptionUsage
        config.ts                      # CLAUDE_SESSIONS_DIR, CLAUDE_OAUTH_TOKEN, USAGE_POLL_INTERVAL_MS
        index.ts
        tracker.ts
        tracker.test.ts
        usage-poller.ts
        usage-poller.test.ts
        routes.ts                      # GET /api/tokens, /api/tokens/:id, /api/usage

      methodology/
        types.ts
        index.ts
        store.ts
        store.test.ts
        routes.ts

      genesis/
        types.ts
        index.ts
        spawner.ts
        spawner.test.ts
        polling-loop.ts
        polling-loop.test.ts
        cursor-manager.ts
        cursor-manager.test.ts
        tools.ts
        tools.test.ts
        initialization.ts
        routes.ts

    shared/
      utils.ts                         # Formatting helpers
      test-fixtures/                   # Shared test fixtures (YAML, JSONL)
      websocket/                       # Transport infrastructure (not a domain)
        hub.ts
        route.ts
      validation/
        isolation-validator.ts
      config/
        config-reloader.ts
        file-watcher.ts

    ports/
      pty-provider.ts                  # interface PtyProvider (abstracts node-pty)
      file-system.ts                   # interface FileSystemProvider (abstracts fs)
      yaml-loader.ts                   # interface YamlLoader (abstracts js-yaml)

    server-entry.ts                    # L4 composition: import domains, wire ports, health routes, start Fastify
    frontend-route.ts                  # SPA serving

  frontend/src/
    domains/
      sessions/
        Sessions.tsx                   # Page (PascalCase preserved)
        SessionCard.tsx
        SpawnSessionModal.tsx
        PromptBar.tsx
        TerminalViewer.tsx
        useSessions.ts                 # Hook (camelCase preserved)

      strategies/
        Strategies.tsx
        StrategyDetail.tsx
        ExecutionView.tsx
        StrategyCard.tsx
        StrategyDefinitionPanel.tsx
        ExecuteDialog.tsx
        MiniDag.tsx
        StrategyDag.tsx
        CostOverlay.tsx
        useStrategies.ts
        useExecutionStatus.ts
        nodes/
          GateNode.tsx
          MethodologyNode.tsx
          ScriptNode.tsx
        edges/
          AnimatedEdge.tsx
        lib/
          dagre-layout.ts
          dag-types.ts

      triggers/
        Triggers.tsx
        TriggerCard.tsx
        TriggerDetail.tsx
        useTriggers.ts

      registry/
        Registry.tsx
        RegistryTree.tsx
        MethodDetail.tsx
        CopyMethodologyModal.tsx
        useRegistry.ts
        useResourceCopy.ts

      projects/
        ProjectListView.tsx
        EventStreamPanel.tsx
        useProjects.ts
        useEventStream.ts

      tokens/
        Analytics.tsx
        TokenAggregateCards.tsx
        SubscriptionMeters.tsx
        SessionTokenBadge.tsx
        useTokens.ts

      genesis/
        GenesisFAB.tsx
        GenesisChatPanel.tsx

    shared/
      components/
        Button.tsx
        Card.tsx
        Badge.tsx
        Tabs.tsx
        Tooltip.tsx
      data/
        MetricCard.tsx
        ProgressBar.tsx
        StatusBadge.tsx
        TimelineEvent.tsx
      layout/
        NavBar.tsx
        PageShell.tsx
        SlideOverPanel.tsx
        AttentionBanner.tsx
      pages/
        Dashboard.tsx              # Composition page (imports from 4+ domains)
        Governance.tsx             # Placeholder
        Settings.tsx               # Placeholder
      websocket/
        useWebSocket.ts
        ws-manager.ts
        ws-store.ts
    lib/
      api.ts
      cn.ts
      formatters.ts
      constants.ts
    stores/
      preference-store.ts
      ui-store.ts
    styles/
      vidtecci.css
    App.tsx                        # React router: imports pages from domains/ and shared/pages/
    main.tsx

  documentation/
    README.md
    guides/
      README.md
      session-management.md
      strategy-pipelines.md
      event-triggers.md
    decisions/
      README.md
      001-pty-over-child-process.md
      002-adaptive-settle-delay.md
      003-split-prompt-delivery.md
      004-domain-co-location.md
```

---

## 3. Domain Inventory

### Domains (8)

| Domain | Server files | Client files | Key types | Routes |
|--------|-------------|-------------|----------|--------|
| **sessions** | pool, pty-session, print-session, spawn-queue, channels, pty-watcher, pattern-matchers, scope-hook, auto-retro, diagnostics, adaptive-settle, parser, transcript-reader, sse-stream | Sessions, SessionCard, SpawnSessionModal, PromptBar, TerminalViewer, useSessions | SessionSummary, SpawnRequest, ChannelMessage | POST/GET/DELETE /sessions, SSE, channels, transcripts |
| **strategies** | executor, parser, gates, artifact-store, retro-*, llm-provider, claude-code-provider | Strategies, StrategyDetail, ExecutionView, StrategyCard, DefinitionPanel, ExecuteDialog, MiniDag, StrategyDag, CostOverlay, nodes/*, edges/* | StrategyDefinition, NodeStatus, ExecutionState | /strategies/*, /api/strategies/* |
| **triggers** | router, parser, debounce, startup-scan, 6 watchers, glob-match, sandbox-eval | Triggers, TriggerCard, TriggerDetail, useTriggers | TriggerConfig, TriggerEvent | /triggers/* |
| **registry** | project-registry, resource-copier | Registry, RegistryTree, MethodDetail, CopyMethodologyModal, useRegistry | RegistryTree, ManifestEntry | /api/registry/* |
| **projects** | discovery-service, events/persistence, events/yaml, events/jsonl, events/project-event | ProjectListView, EventStreamPanel, useProjects, useEventStream | ProjectMetadata, ProjectEvent | /api/genesis/projects/*, /api/events |
| **tokens** | tracker, usage-poller | Analytics, TokenAggregateCards, SubscriptionMeters, SessionTokenBadge, useTokens | SessionTokenUsage, SubscriptionUsage | /api/tokens, /api/usage |
| **methodology** | store | (none yet) | — | /api/methodology/* |
| **genesis** | spawner, polling-loop, cursor-manager, tools, initialization | GenesisFAB, GenesisChatPanel | — | /api/genesis/* |

### Absorbed into other domains

| Former "domain" | Absorbed into | Rationale |
|----------------|--------------|-----------|
| channels | sessions | Session infrastructure — pool creates/stores/exposes channels. No independent routes or UI. |
| transcripts | sessions | Session artifacts — transcript reader consumed by terminal viewer. |
| health | composition layer (`server-entry.ts`) | Two route handlers reading `pool.poolStats()`. Not enough for a domain. |
| websocket | `shared/` (server + client) | Transport infrastructure consumed by all real-time domains. Not a business domain. |

### Non-domain server files

| File | Target | Rationale |
|------|--------|-----------|
| utils.ts | shared/ | Formatting helpers used cross-domain |
| frontend-route.ts | composition layer | SPA serving |
| validation/isolation-validator.ts | shared/validation/ | Cross-domain validation |
| config/config-reloader.ts | shared/config/ | Cross-domain config reload |
| config/file-watcher.ts | shared/config/ | Cross-domain file watching |

### Test fixtures

| Fixture | Target |
|---------|--------|
| `__tests__/fixtures/session.jsonl` | `shared/test-fixtures/` or `src/domains/sessions/` |
| `__tests__/fixtures/transcript.jsonl` | `shared/test-fixtures/` or `src/domains/sessions/` |

---

## 4. Migration Strategy

### Principles

1. **One domain per commit.** Each phase produces a commit that compiles and passes tests.
2. **Zero API behavioral change.** No endpoint, response, or UI behavior changes. Internal file splits (chimera decomposition, composition layer rewrite) are structural, not functional.
3. **Update all imports project-wide.** When a file moves, every importer is updated in the same commit — not just files in the moving domain.
4. **Preserve file names.** Files move without renaming. `Sessions.tsx` → `frontend/src/domains/sessions/Sessions.tsx`, not `sessions-page.tsx`. PascalCase for components, camelCase for hooks, kebab-case for server files. Naming convention changes are out of scope.
5. **Re-export during transition.** When types are extracted from `lib/types.ts` to a domain `types.ts`, the old location re-exports from the new location. This allows gradual consumer updates.

### Phase order

Ordered by **dependency depth** — leaf domains first, hub domains last. This minimizes import churn: when a leaf domain moves, few files import from it. When the hub domain (sessions) moves last, all its dependencies are already in their final locations.

**Phase 0 — Scaffold**
- Create `src/domains/`, `src/shared/`, `src/ports/` directories
- Create `frontend/src/domains/`, `frontend/src/shared/` directories
- Add `@domains/` alias to `frontend/vite.config.ts` pointing to `frontend/src/domains/`
- Verify `tsc --noEmit` and `vite build` pass with no file moves

**Phase 1 — `tokens` domain** (leaf — no other domain imports from it)
- Move `token-tracker.ts` → `src/domains/tokens/tracker.ts`
- Move `usage-poller.ts` → `src/domains/tokens/usage-poller.ts`
- Extract token API routes from `index.ts` → `src/domains/tokens/routes.ts`
- Move `useTokens.ts` → `frontend/src/domains/tokens/useTokens.ts`
- Move `TokenAggregateCards.tsx`, `SubscriptionMeters.tsx`, `SessionTokenBadge.tsx` → `frontend/src/domains/tokens/`
- Move `Analytics.tsx` → `frontend/src/domains/tokens/Analytics.tsx`
- Extract token/usage types from `lib/types.ts` → `src/domains/tokens/types.ts` (re-export from old location)
- Create `src/domains/tokens/config.ts` with Zod schema for CLAUDE_SESSIONS_DIR, CLAUDE_OAUTH_TOKEN, USAGE_POLL_INTERVAL_MS

**Phase 2 — `methodology` domain** (leaf — own routes, minimal connections)
- Move `methodology/methodology-store.ts` → `src/domains/methodology/store.ts`
- Move `methodology/methodology-routes.ts` → `src/domains/methodology/routes.ts`
- Create `src/domains/methodology/types.ts`, `src/domains/methodology/index.ts`

**Phase 3 — `registry` domain** (leaf — read-only, no cross-domain server imports)
- Move `registry/project-registry.ts` → `src/domains/registry/project-registry.ts`
- Move `registry-routes.ts` → `src/domains/registry/routes.ts`
- Move `resource-copier.ts` → `src/domains/registry/resource-copier.ts`
- Move `RegistryTree.tsx`, `MethodDetail.tsx`, `CopyMethodologyModal.tsx` → `frontend/src/domains/registry/`
- Move `useRegistry.ts`, `useResourceCopy.ts` → `frontend/src/domains/registry/`
- Move `Registry.tsx` → `frontend/src/domains/registry/Registry.tsx`
- Extract registry types from `lib/types.ts` + `lib/registry-types.ts` → `src/domains/registry/types.ts`

**Phase 4 — `genesis` domain** (depends on sessions + projects, but few importers)
- Move `genesis/spawner.ts`, `genesis/polling-loop.ts`, `genesis/cursor-manager.ts`, `genesis/tools.ts`, `genesis/initialization.ts` → `src/domains/genesis/`
- Move `genesis-routes.ts` → `src/domains/genesis/routes.ts`
- Move `GenesisFAB.tsx`, `GenesisChatPanel.tsx` → `frontend/src/domains/genesis/`

**Phase 5 — `projects` domain** (mid-tier — events, discovery)
- Split `project-routes.ts` into domain-specific routes. Genesis endpoints go to `src/domains/genesis/routes.ts` (if not already moved). Project/event endpoints go to `src/domains/projects/routes.ts`. Event log singletons extracted to `src/domains/projects/events/`. **This phase involves file splitting, not just moving.**
- Move `multi-project/discovery-service.ts` → `src/domains/projects/discovery-service.ts`
- Move `events/` directory → `src/domains/projects/events/`
- Move `ProjectListView.tsx`, `EventStreamPanel.tsx` → `frontend/src/domains/projects/`
- Move `useProjects.ts`, `useEventStream.ts` → `frontend/src/domains/projects/`
- Extract project/event types from `lib/types.ts` → `src/domains/projects/types.ts`

**Phase 6 — `strategies` domain** (large, depends on sessions for spawning)
- Move entire `strategy/` directory → `src/domains/strategies/`
- Move `StrategyCard.tsx`, `StrategyDefinitionPanel.tsx`, `ExecuteDialog.tsx`, `MiniDag.tsx` → `frontend/src/domains/strategies/`
- Move `domain/strategies/` (xyflow DAG viz) → `frontend/src/domains/strategies/`
- Move `useStrategies.ts` → `frontend/src/domains/strategies/useStrategies.ts`
- Move `Strategies.tsx`, `StrategyDetail.tsx`, `ExecutionView.tsx` → `frontend/src/domains/strategies/`
- Extract strategy types from `lib/types.ts` → `src/domains/strategies/types.ts`

**Phase 7 — `triggers` domain** (depends on sessions via events/channels)
- Move entire `triggers/` directory → `src/domains/triggers/`
- Move `TriggerCard.tsx`, `TriggerDetail.tsx` → `frontend/src/domains/triggers/`
- Move `useTriggers.ts` → `frontend/src/domains/triggers/useTriggers.ts`
- Move `Triggers.tsx` → `frontend/src/domains/triggers/Triggers.tsx`
- Extract trigger types from `lib/types.ts` → `src/domains/triggers/types.ts`

**Phase 8 — `sessions` domain** (hub — absorbs channels + transcripts, moved last)
- Move `pool.ts`, `pty-session.ts`, `print-session.ts`, `spawn-queue.ts` → `src/domains/sessions/`
- Move `channels.ts` → `src/domains/sessions/channels.ts`
- Move `pty-watcher.ts`, `pattern-matchers.ts`, `scope-hook.ts`, `auto-retro.ts`, `diagnostics.ts`, `adaptive-settle.ts`, `parser.ts` → `src/domains/sessions/`
- Move `transcript-reader.ts`, `transcript-route.ts` logic → `src/domains/sessions/`
- Move `live-output-route.ts` SSE logic → `src/domains/sessions/sse-stream.ts`
- Extract session routes from `index.ts` → `src/domains/sessions/routes.ts`
- Move `Sessions.tsx` → `frontend/src/domains/sessions/Sessions.tsx`
- Move `SpawnSessionModal.tsx`, `PromptBar.tsx` → `frontend/src/domains/sessions/`
- Extract `TerminalViewer` from Sessions.tsx → `frontend/src/domains/sessions/TerminalViewer.tsx`
- Move `useSessions.ts` → `frontend/src/domains/sessions/useSessions.ts`
- Extract session types from `lib/types.ts` → `src/domains/sessions/types.ts`
- Move all co-located test files with their source

**Phase 9 — `shared/` extraction**
- Move `ws-hub.ts`, `ws-route.ts` → `src/shared/websocket/`
- Move `useWebSocket.ts`, `ws-manager.ts`, `ws-store.ts` → `frontend/src/shared/websocket/`
- Move `utils.ts` → `src/shared/utils.ts`
- Move `validation/`, `config/` → `src/shared/`
- Move `components/ui/`, `components/data/`, `components/layout/` → `frontend/src/shared/`
- Move `lib/api.ts`, `lib/cn.ts`, `lib/formatters.ts`, `lib/constants.ts` → `frontend/src/shared/lib/` (update `@/` imports)
- Move `stores/` → `frontend/src/shared/stores/`
- Move `Dashboard.tsx`, `Governance.tsx`, `Settings.tsx` → `frontend/src/shared/pages/` (composition pages)
- Verify `lib/types.ts` is now empty (all types moved to domains) — delete it
- Delete `lib/registry-types.ts`
- Move test fixtures from `__tests__/fixtures/` → `src/shared/test-fixtures/`

**Phase 10 — Composition layer cleanup**
- By this point, `index.ts` has been hollowed out by phases 1-8 extracting routes and logic. This phase verifies that only composition wiring remains, renames it to `server-entry.ts`, and confirms the route table matches. Health routes (`GET /health`, `GET /pool/stats`) stay in the composition layer — they're two lines reading `pool.poolStats()`.
- Update `App.tsx` to import pages from `frontend/src/domains/` and `frontend/src/shared/pages/`.

**Phase 11 — Cross-domain port extraction**
- Create `src/ports/pty-provider.ts` — interface abstracting node-pty
- Create `src/ports/file-system.ts` — interface abstracting fs
- Create `src/ports/yaml-loader.ts` — interface abstracting js-yaml
- Update session pool to accept PtyProvider port
- Update token tracker and transcript reader to accept FileSystemProvider port

**Phase 12 — Documentation**
- Add `README.md` to domain directories with 5+ files (sessions, strategies, triggers, projects, registry, genesis — ~6 READMEs)
- Add `types.ts` and `config.ts` with Zod schemas to domains that have configuration
- Do NOT add READMEs to subdirectories (`watchers/`, `events/`, `nodes/`, etc.) — they add no value beyond what the directory name conveys

---

## 5. Build Configuration

### TypeScript (server)

No `rootDir` change needed — `src/domains/` is inside `rootDir: "src"`. The existing `include: ["src"]` already covers `src/domains/`. Server imports use **relative paths only** — no path aliases. This works with tsc, tsx, and Node.js without configuration.

### Vite (client)

Add `@domains/` alias for client domain imports:

```typescript
// frontend/vite.config.ts
resolve: {
  alias: {
    '@': resolve(__dirname, 'src'),             // existing
    '@domains': resolve(__dirname, 'src/domains'),  // new
  }
}
```

Client code imports domain components via `@domains/sessions/Sessions` or `@domains/tokens/useTokens`. The `@/` alias continues to work for `shared/`, `lib/`, `stores/`.

### Shared types across builds

Client code imports server-side domain types via `import type`:

```typescript
// In frontend tsconfig.json, add path:
"paths": {
  "@server-types/*": ["../../src/domains/*/types"]
}
```

Since these are `import type` only (erased at compile time), module resolution differences between Node16 and bundler don't matter — no runtime code is shared.

### Test runner

Update test script for co-located tests (cross-platform compatible):

```json
{
  "test": "node --import tsx --test src/domains/*/**.test.ts src/shared/**/*.test.ts",
  "test:integration": "node --import tsx --test src/domains/**/*.integration.test.ts"
}
```

Validate glob expansion on Windows during Phase 0. If globbing is unreliable, use `--test-path-pattern` regex instead.

### Frontend type-checking

No change needed. The frontend `tsconfig.json` has `include: ["src"]`, which covers `frontend/src/domains/`. Client code is type-checked by the existing `tsc -p frontend/tsconfig.json --noEmit` step.

---

## 6. Success Criteria

1. **All existing tests pass.** Zero test failures after each phase.
2. **TypeScript compiles.** `tsc --noEmit` succeeds for both server and client after each phase.
3. **Frontend builds.** `vite build` produces a working bundle after each phase.
4. **Domain self-containment.** After all phases, a domain's server code, types, config, and tests are in `src/domains/{name}/`. Its client code is in `frontend/src/domains/{name}/`.
5. **Types file eliminated.** `frontend/src/lib/types.ts` is deleted — all types live in domain `types.ts` files.
6. **Index.ts hollowed out.** The 1096-line `index.ts` is replaced by `server-entry.ts` containing only composition wiring.
7. **Test co-location.** Every `*.test.ts` is in the same directory as the file it tests. No `__tests__/` directories remain.
8. **File names preserved.** No file is renamed during migration. PascalCase for components, camelCase for hooks.
9. **Composition pages identified.** Dashboard and other cross-domain pages live in `frontend/src/shared/pages/`.
10. **Bundle size stable.** Vite build output does not regress by more than 10%.

---

## 7. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Import path churn** — every file that imports from a moved file needs updating | HIGH | LOW | Each phase updates all importers project-wide. TypeScript catches broken imports at compile time. |
| **Git blame loss** — `git blame` won't trace through file moves | MEDIUM | LOW | Use `git log --follow`. Each commit message names the domain. No files are renamed (only moved), so blame follows with `--follow`. |
| **Pool↔Triggers wiring complexity** — circular dependency between sessions and triggers via channels/events | MEDIUM | MEDIUM | Channels absorbed into sessions eliminates one leg. Remaining pool↔triggers wiring is via event callbacks in the composition layer (`server-entry.ts`). Document explicitly. |
| **project-routes.ts chimera** — multi-domain file requires splitting | MEDIUM | LOW | Phase 5 explicitly splits this file. Acknowledged as structural change, not pure move. |
| **Merge conflicts during migration** — other branches add files to old locations | MEDIUM | MEDIUM | Migrate one domain per PR. Keep PRs small and merge quickly. |
| **Cross-domain client imports** — sessions page imports from tokens domain | LOW | LOW | Permitted by convention. Dependency direction is documented. Components used by 3+ domains move to `shared/`. |
| **Dual type systems during transition** — files import from both old and new locations | HIGH | LOW | Re-export from old location during transition. Each phase moves types and updates consumers. Transient state resolves by Phase 9. |

---

## 8. Out of Scope

- **API behavioral changes.** This PRD restructures files and imports. No endpoint, response, or UI behavior changes.
- **File renaming.** PascalCase → kebab-case or other naming convention changes are a separate decision.
- **Package extraction.** Domains stay within `@methodts/bridge`. Extracting to separate packages is future work.
- **Core package refactoring.** `@methodts/core`'s provider pattern violations are separate work.
- **Effect library adoption.** FCA recommends Effect for L0 port formalization, but that's a separate PRD.
- **Renaming `src/` to `source/`.** Deferred — affects all packages.
- **Client-side testing framework.** No `vitest` or client test infrastructure is added. Client tests are future work.

---

## 9. Relationship to Other PRDs

| PRD | Relationship |
|-----|-------------|
| **PRD 005** (Bridge) | This PRD reorganizes the bridge's internal structure. All bridge functionality is preserved. |
| **PRD 019** (Frontend) | Frontend components move from `frontend/src/components/domain/` to `frontend/src/domains/`. Code is unchanged. |
| **PRD 020** (Multi-Project) | Project discovery, event persistence, and genesis files move to their respective domains. |
| **PRD 017-018** (Strategies + Triggers) | Strategy and trigger files move to their respective domains. |
| **FCA** | This PRD implements FCA Principle 8 (co-locate all artifacts) adapted for dual-build-root monorepos. |

---

## 10. Implementation Status & Deferred Work

**PR:** #46 (`feat/prd-023-fca-bridge-refactor`) — 15 commits, ~270 files changed
**Quality Review:** Kael (Quality Samurai) — 8.0/10 pre-last-mile, READY TO SHIP
**Review artifact:** `tmp/kael-quality-review-prd023-2026-03-23.md`

### Completed

| Phase | Commit | What |
|-------|--------|------|
| 0 | `9b19e80` | Scaffold: `src/domains/`, `src/shared/`, `src/ports/`, `frontend/src/domains/`, `frontend/src/shared/`, vite + tsconfig aliases |
| 1 | `76f28d9` | Tokens domain: tracker, usage-poller, 2 tests, 5 frontend files |
| 2 | `7e9a244` | Methodology domain: store, routes, 1 test |
| 3 | `ff8f54e` | Registry domain: project-registry, resource-copier, routes, 5 tests, 6 frontend files |
| 4 | `cdd3827` | Genesis domain: spawner, polling-loop, cursor-manager, tools, init, routes, 4 tests, 2 frontend files |
| 5 | `0d5ac47` | Projects domain: project-routes.ts (787 lines) moved intact, events/, multi-project/, 11 tests, 4 frontend files |
| 6 | `21e3d5c` | Strategies domain: strategy/ dir (10 files), 5 tests, 8 frontend files + DAG viz tree (9 files) |
| 7 | `6cebd0b` | Triggers domain: triggers/ dir (15 files), 1 test, 4 frontend files |
| 8 | `ead9cdc` | Sessions domain (hub): 15 source files, 13 tests, 4 frontend files |
| 9 | `184e264` | Shared extraction: websocket, utils, validation, config, UI/data/layout components, lib, stores, composition pages |
| 10 | `aaf9705` | Composition: `index.ts` → `server-entry.ts`, package.json + scripts updated, empty dirs removed |
| 12 | `bc65078` | Documentation: 6 domain READMEs with FCA frontmatter |
| cleanup | `6ebf7ea` | Quality review fixes: BridgeHealthCards moved, .gitkeep cleanup |
| last-mile | `868d5e9` | Types decomposition: `lib/types.ts` (406 lines) split into 5 domain type files, `registry-types.ts` moved |
| last-mile | `32cbf1a` | Session route extraction: 15 route handlers → `domains/sessions/routes.ts`, server-entry.ts 1080→489 lines |

### Deferred Work

Two items remain. Each is a self-contained follow-up task.

#### D1: Domain Config Extraction (M5 from quality review)

**Problem:** All 18 environment variables are read centrally in `server-entry.ts` lines 34-48. Each domain should own its configuration via a `config.ts` file with a Zod schema.

**What to do:**

For each domain that reads env vars, create `src/domains/{name}/config.ts`:

```typescript
import { z } from 'zod';

export const TokensConfig = z.object({
  sessionsDir: z.string().default(join(homedir(), '.claude', 'projects')),
  oauthToken: z.string().nullable().default(null),
  pollIntervalMs: z.number().default(600000),
});

export type TokensConfig = z.infer<typeof TokensConfig>;

export function loadTokensConfig(): TokensConfig {
  return TokensConfig.parse({
    sessionsDir: process.env.CLAUDE_SESSIONS_DIR,
    oauthToken: process.env.CLAUDE_OAUTH_TOKEN ?? null,
    pollIntervalMs: parseInt(process.env.USAGE_POLL_INTERVAL_MS ?? '600000', 10),
  });
}
```

**Domains that need config.ts:**

| Domain | Env vars to move |
|--------|-----------------|
| `sessions` | `MAX_SESSIONS`, `SETTLE_DELAY_MS`, `DEAD_SESSION_TTL_MS`, `STALE_CHECK_INTERVAL_MS`, `BATCH_STAGGER_MS`, `MIN_SPAWN_GAP_MS`, `CLAUDE_BIN` |
| `tokens` | `CLAUDE_SESSIONS_DIR`, `CLAUDE_OAUTH_TOKEN`, `USAGE_POLL_INTERVAL_MS` |
| `triggers` | `TRIGGERS_ENABLED`, `TRIGGERS_STRATEGY_DIR` |
| `genesis` | `GENESIS_ENABLED`, `GENESIS_POLLING_INTERVAL_MS`, `CURSOR_CLEANUP_INTERVAL_MS` |
| `strategies` | `STRATEGY_ENABLED` |
| `(composition)` | `PORT`, `ROOT_DIR`, `FRONTEND_ENABLED` — these stay in `server-entry.ts` |

**Steps:**
1. Create `src/domains/{name}/config.ts` for each domain above
2. Update `server-entry.ts` to call `load{Name}Config()` instead of inline `process.env` reads
3. Pass config objects to constructors/register functions
4. Verify: `tsc --noEmit`, tests, `vite build`
5. Commit per domain (5 commits) or batched (1 commit)

**Acceptance:** `server-entry.ts` contains zero `process.env` reads except `PORT`, `ROOT_DIR`, and `FRONTEND_ENABLED`. Each domain's config has a Zod schema with defaults matching the current env var defaults in CLAUDE.md.

#### D2: Cross-Domain Port Extraction (Phase 11)

**Problem:** Three external dependencies are used directly across domains without abstraction: `node-pty` (sessions), `fs` (tokens, projects, genesis), `js-yaml` (projects, strategies). FCA Principle 3 requires port interfaces for external dependencies.

**What to do:**

Create port interfaces in `src/ports/`:

**`src/ports/pty-provider.ts`:**
```typescript
export interface PtyProvider {
  spawn(file: string, args: string[], options: PtySpawnOptions): PtyProcess;
}
export interface PtyProcess {
  onData: (callback: (data: string) => void) => void;
  onExit: (callback: (exitCode: number) => void) => void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  pid: number;
}
export interface PtySpawnOptions {
  name?: string;
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
}
```

**`src/ports/file-system.ts`:**
```typescript
export interface FileSystemProvider {
  readFile(path: string, encoding: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<{ mtimeMs: number; isFile(): boolean; isDirectory(): boolean }>;
}
```

**`src/ports/yaml-loader.ts`:**
```typescript
export interface YamlLoader {
  load(content: string): unknown;
  dump(value: unknown): string;
}
```

**Steps:**
1. Create the 3 port interfaces above
2. Update `src/domains/sessions/pool.ts` to accept `PtyProvider` as a constructor parameter instead of importing `node-pty` directly
3. Update `src/domains/tokens/tracker.ts` and `src/domains/sessions/transcript-reader.ts` to accept `FileSystemProvider`
4. Create production implementations in each domain (thin wrappers around the real libraries)
5. In `server-entry.ts`, instantiate the production implementations and inject them
6. Verify: `tsc --noEmit`, tests, `vite build`

**Acceptance:** No domain file directly imports `node-pty`, `fs`, or `js-yaml`. All external I/O goes through port interfaces. Tests can substitute providers without mocking modules.

### Learnings (from retro)

- **Single agent with full context outperforms many small agents** for sequential refactoring work. The Phases 1-9 agent had 447 tool uses and maintained perfect context about import changes across phases.
- **4-gate quality protocol works:** `tsc --noEmit` (server), `tsc --noEmit` (frontend), `node --test`, `vite build`. Run after every phase. Trust `tsc` over LSP diagnostics.
- **Leaf-first phase ordering** (tokens → methodology → registry → genesis → projects → strategies → triggers → sessions) minimizes import churn — when the hub domain moves last, all its dependencies are already in final locations.
- **Types decomposition and route extraction are predictable last-mile items** that should be budgeted upfront in structural refactoring PRDs, not discovered during review.
