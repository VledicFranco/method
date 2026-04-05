# FCD Commission: Build Orchestrator Dashboard Wiring

**Issue:** VledicFranco/method#156
**Domain:** `build` (frontend + backend)
**Mode:** Solo
**Iteration:** 0 / 5

## Task Spec

Wire the Build Orchestrator frontend (23 components) to real backend routes.
Close all integration gaps between the mock-data-driven dashboard and the
100%-implemented REST API + WebSocket backend.

## Consumed Ports (all PASS)

| Port | File | Status |
|------|------|--------|
| EventBus | ports/event-bus.ts | PASS |
| FileSystemProvider | ports/file-system.ts | PASS |
| YamlLoader | ports/yaml-loader.ts | PASS |
| StrategyExecutorPort | ports/strategy-executor.ts | PASS |

## Produced Ports

None — no new cross-domain interfaces.

## Scope (issue §sections)

### CRITICAL — Frontend API wiring
- §1.1 BuildList: POST /api/builds/start
- §1.2 ConversationPanel: POST /api/builds/:id/message
- §1.3 GateActions: POST /api/builds/:id/gate/:gate/decide
- §1.4 ContextBar: POST /api/builds/:id/abort

### HIGH — Navigation & UX
- §2.1 BuildsPage: PageShell / breadcrumb navigation
- §2.2 BuildDetail: Render artifact manifest content

### MEDIUM — Backend gaps
- §3.1 index.ts: Wire Validator into createOrchestrator factory
- §3.2 validator.ts: Implement endpoint + custom assertion types
- §3.3 orchestrator.ts + index.ts: Phase-level event emission
- §3.4 config.ts: Explore strategy handling

### Additional data wiring
- §1.5 Resume button on paused/failed builds
- §1.6 Fetch conversation history from backend
- §1.7 Fetch evidence report from backend
- §1.8 Wire analytics view data

## Excluded (LOW — §4.x deferred)

Debate auto-trigger, surface complexity detection, commission-tagged review,
cross-build refinement aggregation, autonomy confidence scoring.
