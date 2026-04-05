# Realization Plan — PRD 047: Build Orchestrator

## PRD Summary

UI-driven autonomous FCD lifecycle orchestrator. 8-phase pipeline (explore → specify → design → plan → implement → review → validate → measure) driven by a Pacta cognitive agent, with conversational human gates in a dashboard UI. 4 frozen surfaces, 7 success criteria, validation experiment.

**Success criteria:**
1. Full 8-phase lifecycle coverage
2. ≤ 4 human interventions per feature
3. ≥ 60% autonomous failure recovery
4. ≤ 15% orchestrator cost overhead
5. Machine-evaluated validation per build
6. Human comprehension at gates (dashboard renders reasoning)
7. Method learning (≥ 3 refinements after 5 builds)

## FCA Partition Map

```
Domains (independent — can be commissioned in parallel):

Backend (bridge L4):
  bridge/build/           → NEW — orchestrator lifecycle, checkpoints, conversation, validator, refinement
  bridge/sessions/        → existing — session spawning (consumed via SessionPort)
  bridge/strategies/      → existing — strategy execution (consumed via MCP tools)

Frontend (bridge/frontend):
  frontend/domains/build/ → NEW — BuildsPage, BuildList, BuildDetail, PhaseTimeline, ConversationPanel, etc.

Shared surfaces (orchestrator-owned — modified between waves, not by commissions):
  packages/bridge/src/ports/          → CheckpointPort, ConversationPort interfaces
  packages/bridge/src/server-entry.ts → domain wiring
  packages/bridge/frontend/src/App.tsx → route registration
  packages/bridge/frontend/src/shared/ → shared UI components, stores, WebSocket
```

## Commissions

| ID | Wave | Domain | Title | Depends On | Parallel With | Est. Tasks |
|----|------|--------|-------|------------|---------------|------------|
| C-0 | 0 | orchestrator | Shared surfaces: types, ports, config, pact, gate assertions | — | — | 4 |
| C-1 | 1 | bridge/build | Core orchestrator: 8-phase loop + checkpoint + validator | C-0 | C-2 | 7 |
| C-2 | 1 | bridge/build | Conversation adapter + refinement engine | C-0 | C-1 | 5 |
| C-3 | 2 | bridge/build | Routes, domain registration, server-entry wiring, event emission | C-1, C-2 | — | 5 |
| C-4 | 3 | frontend/build | Dashboard: BuildsPage, BuildList, BuildDetail, PhaseTimeline, CriteriaTracker, EvidenceReport | C-3 | — | 8 |
| C-5 | 4 | frontend/build | Conversation UI: ConversationPanel, ChatMessage, StructuredCard, GateActions, WebSocket wiring | C-4 | C-6 | 7 |
| C-6 | 4 | frontend/build | Analytics UI: AnalyticsView, cross-build charts, refinement display | C-4 | C-5 | 5 |
| C-7 | 5 | bridge/build + skill | /build skill, agent init prompt, end-to-end integration test | C-5, C-6 | — | 5 |

## Wave 0 — Shared Surfaces (Orchestrator-Owned)

Applied directly by the orchestrator, no commissions.

### Port Interfaces

1. `packages/bridge/src/ports/checkpoint.ts` — CheckpointPort interface + PipelineCheckpoint, PipelineCheckpointSummary, Phase, FeatureSpec, TestableAssertion types
2. `packages/bridge/src/ports/conversation.ts` — ConversationPort interface + AgentMessage, HumanMessage, GateDecision, GateType, GATE_ACTIONS, SkillRequest, StructuredCard types
3. `packages/bridge/src/domains/build/types.ts` — ExplorationReport, ValidationReport, EvidenceReport, Refinement, PhaseResult, BuildConfig, ConversationMessage
4. `packages/bridge/src/domains/build/config.ts` — Zod schema for BuildConfig (budget defaults, phase timeouts, retry limits, autonomy levels)

### Pact Definition

5. `packages/bridge/src/domains/build/pact.ts` — BuildOrchestratorPact definition (Pacta pact with budget, scope, output schema)

### Gate Assertions

6. `packages/bridge/src/shared/architecture.test.ts` — add:
   - G-BOUNDARY: `build/` does not import from `sessions/`, `strategies/`, `triggers/` internals (only through ports)
   - G-PORT: `build/` uses CheckpointPort and ConversationPort, never filesystem or WebSocket directly

### Verification

```bash
cd packages/bridge && npx tsc --noEmit
npm test -- --run packages/bridge/src/shared/architecture.test.ts
```

## Commission Cards

### C-1: Core Orchestrator

```yaml
- id: C-1
  title: "Core orchestrator — 8-phase loop, checkpoint, validator"
  domain: "bridge/build"
  wave: 1
  scope:
    allowed_paths:
      - "packages/bridge/src/domains/build/orchestrator.ts"
      - "packages/bridge/src/domains/build/checkpoint-adapter.ts"
      - "packages/bridge/src/domains/build/validator.ts"
      - "packages/bridge/src/domains/build/__tests__/orchestrator.test.ts"
      - "packages/bridge/src/domains/build/__tests__/checkpoint.test.ts"
      - "packages/bridge/src/domains/build/__tests__/validator.test.ts"
    forbidden_paths:
      - "packages/bridge/src/ports/*"
      - "packages/bridge/src/shared/*"
      - "packages/bridge/src/server-entry.ts"
      - "packages/bridge/src/domains/build/routes.ts"
      - "packages/bridge/frontend/**"
  depends_on: [C-0]
  parallel_with: [C-2]
  deliverables:
    - "orchestrator.ts — BuildOrchestrator class with 8-phase loop: explore → specify → design → plan → implement → review → validate → measure"
    - "orchestrator.ts — Failure routing: read strategy status, construct targeted retry prompt, re-execute failed commissions only"
    - "orchestrator.ts — Phase loop drives strategies via strategy_execute/strategy_status/strategy_abort MCP tool interfaces (mock in tests)"
    - "orchestrator.ts — Autonomy level support (discuss-all, auto-routine, full-auto)"
    - "checkpoint-adapter.ts — CheckpointPort implementation: save/load/list via YAML in .method/sessions/{id}/checkpoints/"
    - "validator.ts — Evaluates TestableAssertion[] (5 types: command, grep, endpoint, typescript, custom)"
    - "Unit tests: orchestrator drives mock 8-phase pipeline with simulated failures, checkpoint roundtrip, validator evaluates all 5 assertion types"
  documentation_deliverables: []
  acceptance_criteria:
    - "Orchestrator class instantiates with CheckpointPort and ConversationPort (dependency injection)"
    - "8-phase loop executes in order with checkpoints between phases"
    - "Failure routing constructs targeted retry with failure context"
    - "Checkpoint save/load roundtrip preserves FeatureSpec, conversationHistory, and costAccumulator"
    - "Validator evaluates command and typescript assertion types (grep, endpoint, custom as stubs returning 'not implemented' — Wave 2 fills these)"
    - "tsc --noEmit clean, all unit tests pass"
  estimated_tasks: 7
  branch: "feat/047-c1-core-orchestrator"
  status: pending
```

### C-2: Conversation Adapter + Refinement Engine

```yaml
- id: C-2
  title: "Conversation adapter + refinement engine"
  domain: "bridge/build"
  wave: 1
  scope:
    allowed_paths:
      - "packages/bridge/src/domains/build/conversation-adapter.ts"
      - "packages/bridge/src/domains/build/refinement.ts"
      - "packages/bridge/src/domains/build/__tests__/conversation.test.ts"
      - "packages/bridge/src/domains/build/__tests__/refinement.test.ts"
    forbidden_paths:
      - "packages/bridge/src/ports/*"
      - "packages/bridge/src/shared/*"
      - "packages/bridge/src/server-entry.ts"
      - "packages/bridge/frontend/**"
  depends_on: [C-0]
  parallel_with: [C-1]
  deliverables:
    - "conversation-adapter.ts — ConversationPort implementation: sendAgentMessage, sendSystemMessage, waitForHumanMessage, waitForGateDecision, getHistory, requestSkillInvocation"
    - "conversation-adapter.ts — Message persistence (JSONL in .method/sessions/{id}/conversation.jsonl)"
    - "conversation-adapter.ts — WebSocket bridge: emits build.agent_message, build.gate_waiting events; listens for human messages via REST"
    - "refinement.ts — Per-build reflection: analyzes phase durations, retry outcomes, tool gaps, criteria difficulty"
    - "refinement.ts — Produces Refinement[] with target, observation, proposal, evidence"
    - "refinement.ts — Cross-build aggregation: reads past EvidenceReports, deduplicates refinements by proposal similarity, ranks by frequency × confidence, thresholds at ≥ 2 occurrences and ≥ 0.7 confidence"
    - "Unit tests: conversation adapter message flow, refinement engine produces proposals from mock phase data"
  documentation_deliverables: []
  acceptance_criteria:
    - "ConversationPort implementation satisfies the frozen interface"
    - "Messages persist to JSONL and reload on getHistory()"
    - "waitForGateDecision blocks until REST endpoint receives decision"
    - "requestSkillInvocation emits correct event type for debate/review/surface"
    - "Refinement engine produces ≥ 1 refinement from a mock build with 1 failure recovery"
    - "Cross-build aggregation deduplicates and ranks correctly"
    - "tsc --noEmit clean, all unit tests pass"
  estimated_tasks: 5
  branch: "feat/047-c2-conversation-refinement"
  status: pending
```

### C-3: Routes + Domain Registration + Event Wiring

```yaml
- id: C-3
  title: "REST routes, domain registration, server-entry wiring, build events"
  domain: "bridge/build"
  wave: 2
  scope:
    allowed_paths:
      - "packages/bridge/src/domains/build/routes.ts"
      - "packages/bridge/src/domains/build/index.ts"
      - "packages/bridge/src/domains/build/__tests__/routes.test.ts"
    forbidden_paths:
      - "packages/bridge/src/ports/*"
      - "packages/bridge/src/shared/*"
      - "packages/bridge/frontend/**"
  depends_on: [C-1, C-2]
  parallel_with: []
  deliverables:
    - "routes.ts — All BuildUIRoutes endpoints: GET /api/builds, GET /api/builds/:id, POST /api/builds/start, POST /api/builds/:id/message, POST /api/builds/:id/gate/:gate/decide, POST /api/builds/:id/abort, POST /api/builds/:id/resume, GET /api/builds/analytics, GET /api/builds/:id/evidence, GET /api/builds/:id/conversation"
    - "index.ts — Domain registration: createBuildDomain() wiring CheckpointPort, ConversationPort, EventSink, routes"
    - "Build event emission: build.started, build.phase_started, build.phase_completed, build.checkpoint_saved, build.gate_waiting, build.gate_resolved, build.agent_message, build.failure_detected, build.failure_recovery, build.validation_result, build.completed, build.aborted"
    - "Route tests: start/abort/message/gate endpoints respond correctly"
  documentation_deliverables:
    - "packages/bridge/src/domains/build/README.md — domain overview, file index, port dependencies"
  acceptance_criteria:
    - "GET /api/builds returns empty array when no builds"
    - "POST /api/builds/start creates a build and returns build ID"
    - "POST /api/builds/:id/message stores message and triggers orchestrator"
    - "POST /api/builds/:id/gate/specify/decide accepts gate decisions"
    - "Build events emit to event bus and are observable via WebSocket"
    - "tsc --noEmit clean, route tests pass"
  estimated_tasks: 5
  branch: "feat/047-c3-routes-wiring"
  status: pending
```

### C-4: Dashboard UI — Core Views

```yaml
- id: C-4
  title: "Dashboard: BuildsPage, BuildList, BuildDetail, PhaseTimeline, CriteriaTracker, EvidenceReport"
  domain: "frontend/domains/build"
  wave: 3
  scope:
    allowed_paths:
      - "packages/bridge/frontend/src/domains/build/**"
    forbidden_paths:
      - "packages/bridge/frontend/src/shared/**"
      - "packages/bridge/frontend/src/App.tsx"
      - "packages/bridge/src/**"
  depends_on: [C-3]
  parallel_with: []
  deliverables:
    - "BuildsPage.tsx — top-level route component with 3-column layout (sidebar, main, panel placeholder)"
    - "BuildList.tsx — left sidebar: build list with mini pipeline strip (8 dots), status, cost, phase name, + New Build button with modal"
    - "BuildDetail.tsx — main area with 4 tabs (Overview, Artifacts, Events, Analytics)"
    - "PhaseTimeline.tsx — 8 horizontal phase pills with status coloring (green/blue/amber/red/gray) + Gantt timeline bar chart"
    - "CommissionProgress.tsx — Cursor-style task cards: commission name, activity, gate progress, contextual Retry button"
    - "CriteriaTracker.tsx — success criteria checklist from FeatureSpec, lights up during validation"
    - "EvidenceReport.tsx — verdict badge, 5-stat grid, criteria pass/fail, refinements list"
    - "Context bar component — persistent: requirement, phase pill, cost bar, commission status, Pause/Abort/Resume controls, autonomy dropdown"
    - "All components fetch data from /api/builds REST endpoints"
  documentation_deliverables: []
  acceptance_criteria:
    - "BuildsPage renders with sidebar + main area"
    - "BuildList shows mock builds with mini pipeline strips"
    - "PhaseTimeline renders 8 pills with correct status colors"
    - "Gantt chart shows phase durations as horizontal bars"
    - "CriteriaTracker renders criteria from FeatureSpec"
    - "EvidenceReport shows verdict, stats, criteria, refinements"
    - "Context bar shows requirement, cost, controls"
    - "vite build succeeds, no console errors"
  estimated_tasks: 8
  branch: "feat/047-c4-dashboard-core"
  status: pending
```

### C-5: Conversation UI

```yaml
- id: C-5
  title: "Conversation UI: ConversationPanel, ChatMessage, StructuredCard, GateActions, WebSocket"
  domain: "frontend/domains/build"
  wave: 4
  scope:
    allowed_paths:
      - "packages/bridge/frontend/src/domains/build/ConversationPanel.tsx"
      - "packages/bridge/frontend/src/domains/build/ChatMessage.tsx"
      - "packages/bridge/frontend/src/domains/build/StructuredCard.tsx"
      - "packages/bridge/frontend/src/domains/build/GateActions.tsx"
      - "packages/bridge/frontend/src/domains/build/SkillButtons.tsx"
      - "packages/bridge/frontend/src/domains/build/MessageThread.tsx"
      - "packages/bridge/frontend/src/domains/build/__tests__/**"
    forbidden_paths:
      - "packages/bridge/frontend/src/shared/**"
      - "packages/bridge/frontend/src/App.tsx"
      - "packages/bridge/src/**"
  depends_on: [C-4]
  parallel_with: [C-6]
  deliverables:
    - "ConversationPanel.tsx — right panel: tabbed by build gates, collapsible, message input with Enter-to-send"
    - "ChatMessage.tsx — agent/human/system message types with avatars, timestamps, reply button"
    - "MessageThread.tsx — reply-to context indicator, left-border threading"
    - "StructuredCard.tsx — renders FeatureSpec, PRD summary, commission plan, review findings, debate decision, evidence report as interactive cards"
    - "StructuredCard.tsx — inline editing mode for criteria (edit button, contenteditable, update button)"
    - "GateActions.tsx — per-gate action buttons (GATE_ACTIONS map: specify, design, plan, review, escalation)"
    - "SkillButtons.tsx — [Debate] [Review] [Surface] row above input, triggers requestSkillInvocation"
    - "WebSocket subscription for build.agent_message, build.gate_waiting, build.gate_resolved events"
    - "REST integration: POST /api/builds/:id/message, POST /api/builds/:id/gate/:gate/decide"
  documentation_deliverables: []
  acceptance_criteria:
    - "Chat panel shows agent, human, and system messages with correct styling"
    - "Gate actions change per gate type (Approve Spec vs Approve vs Request Changes vs Retry with Direction)"
    - "Message threading works: reply context shows, replies render with left border"
    - "StructuredCard renders FeatureSpec with inline editing"
    - "Skill buttons emit requestSkillInvocation with correct payload"
    - "WebSocket events update conversation in real-time"
    - "vite build succeeds"
  estimated_tasks: 7
  branch: "feat/047-c5-conversation-ui"
  status: pending
```

### C-6: Analytics UI

```yaml
- id: C-6
  title: "Analytics UI: AnalyticsView, cross-build charts, refinement display"
  domain: "frontend/domains/build"
  wave: 4
  scope:
    allowed_paths:
      - "packages/bridge/frontend/src/domains/build/AnalyticsView.tsx"
      - "packages/bridge/frontend/src/domains/build/PhaseBottleneckChart.tsx"
      - "packages/bridge/frontend/src/domains/build/FailurePatterns.tsx"
      - "packages/bridge/frontend/src/domains/build/RefinementList.tsx"
      - "packages/bridge/frontend/src/domains/build/CostTrend.tsx"
      - "packages/bridge/frontend/src/domains/build/__tests__/**"
    forbidden_paths:
      - "packages/bridge/frontend/src/shared/**"
      - "packages/bridge/frontend/src/App.tsx"
      - "packages/bridge/src/**"
  depends_on: [C-4]
  parallel_with: [C-5]
  deliverables:
    - "AnalyticsView.tsx — Analytics tab content: phase bottlenecks, failure patterns, refinements, cost trend, criteria coverage"
    - "PhaseBottleneckChart.tsx — horizontal bar chart: avg time per phase across builds"
    - "FailurePatterns.tsx — table: gate failures ranked by frequency with descriptions"
    - "RefinementList.tsx — categorized refinement proposals with filter buttons [All][Strategy][Gate][Orchestrator][Bridge]"
    - "CostTrend.tsx — sparkline showing cost per build over last N builds"
    - "Fetches from GET /api/builds/analytics"
  documentation_deliverables: []
  acceptance_criteria:
    - "Phase bottleneck chart renders with correct proportions"
    - "Failure patterns show gate name, description, frequency"
    - "Refinement filtering by target works"
    - "Cost sparkline renders from mock data"
    - "vite build succeeds"
  estimated_tasks: 5
  branch: "feat/047-c6-analytics-ui"
  status: pending
```

### C-7: Integration + /build Skill

```yaml
- id: C-7
  title: "/build skill definition, agent init prompt, end-to-end integration test"
  domain: "bridge/build + skill"
  wave: 5
  scope:
    allowed_paths:
      - ".claude/skills/build/**"
      - "packages/bridge/src/domains/build/__tests__/integration.test.ts"
    forbidden_paths:
      - "packages/bridge/src/ports/*"
      - "packages/bridge/src/shared/*"
      - "packages/bridge/frontend/**"
  depends_on: [C-5, C-6]
  parallel_with: []
  deliverables:
    - ".claude/skills/build/SKILL.md — /build skill definition: accepts requirement, drives 8-phase lifecycle via dashboard or Claude Code"
    - "Agent initialization prompt — behavioral contract for the orchestrator agent (8 phases, gate protocol, failure routing, refinement reflection)"
    - "Integration test: /build on test fixture project completes all 8 phases, dashboard shows progress, evidence report produced"
  documentation_deliverables:
    - "docs/guides/36-build-orchestrator.md — usage guide for /build"
  acceptance_criteria:
    - "/build skill loads and accepts a requirement string"
    - "Agent prompt covers all 8 phases with gate behavior for each"
    - "Integration test completes explore → specify → design → plan → implement → review → validate → measure on test fixture"
    - "EvidenceReport produced with ≥ 1 criteria evaluated"
    - "Dashboard renders build progress during integration test"
  estimated_tasks: 5
  branch: "feat/047-c7-build-skill-integration"
  status: pending
```

## Shared Surface Changes

| Wave | File | Change | Reason |
|------|------|--------|--------|
| pre-1 | `packages/bridge/src/ports/checkpoint.ts` | Create CheckpointPort interface + all types | C-1 implements the adapter |
| pre-1 | `packages/bridge/src/ports/conversation.ts` | Create ConversationPort interface + all types | C-2 implements the adapter |
| pre-1 | `packages/bridge/src/domains/build/types.ts` | Create domain types (EvidenceReport, Refinement, etc.) | C-1 and C-2 both consume |
| pre-1 | `packages/bridge/src/domains/build/config.ts` | Create Zod config schema | C-1 and C-2 both consume |
| pre-1 | `packages/bridge/src/domains/build/pact.ts` | Create BuildOrchestratorPact definition | C-1 consumes |
| pre-3 | `packages/bridge/src/server-entry.ts` | Wire build domain (import + register) | C-3 provides the domain factory |
| pre-3 | `packages/bridge/src/ports/index.ts` | Re-export CheckpointPort, ConversationPort | C-3 routes consume ports |
| pre-4 | `packages/bridge/frontend/src/App.tsx` | Add /builds route | C-4 provides BuildsPage |
| pre-4 | `packages/bridge/frontend/src/shared/stores/` | Add buildStore (if Zustand/similar pattern) | C-4 consumes for state |
| pre-5 | none | — | C-5 and C-6 are frontend-only, consume existing shared + C-4 |

## Execution Order

```
Wave 0 (orchestrator): Create port interfaces, types, config, pact, gate assertions
  ↓ verify: tsc clean, gate tests pass

Wave 1 (parallel): C-1 (orchestrator core), C-2 (conversation + refinement)
  ↓ both disjoint files within bridge/build, zero shared file conflicts
  ↓ verify: tsc clean, all unit tests pass

Wave 2 (orchestrator): Wire server-entry, re-exports
Wave 2 (sequential): C-3 (routes + domain registration)
  ↓ verify: bridge starts, REST API responds, events flow

Wave 3 (orchestrator): Wire frontend App.tsx route, create build store
Wave 3 (sequential): C-4 (dashboard core views)
  ↓ verify: vite build, dashboard renders builds

Wave 4 (parallel): C-5 (conversation UI), C-6 (analytics UI)
  ↓ both within frontend/domains/build, disjoint components
  ↓ verify: vite build, conversation + analytics render

Wave 5 (sequential): C-7 (skill + integration test)
  ↓ verify: /build end-to-end on test fixture
```

## Acceptance Gates

| # | Criterion | Verification | Commissions | Status |
|---|-----------|-------------|-------------|--------|
| SC-1 | Full 8-phase lifecycle | Integration test: all 8 phases execute | C-1, C-7 | pending |
| SC-2 | ≤ 4 human interventions | Count gate events in integration test | C-1, C-5 | pending |
| SC-3 | ≥ 60% failure recovery | Simulate failure in integration test, check retry | C-1 | pending |
| SC-4 | ≤ 15% cost overhead | Token accounting in EvidenceReport | C-1, C-2 | pending |
| SC-5 | Validation report per build | Integration test produces EvidenceReport with criteria | C-1, C-7 | pending |
| SC-6 | Dashboard comprehension | Visual inspection of gate presentations | C-4, C-5 | pending |
| SC-7 | ≥ 3 refinements after 5 builds | Refinement aggregation test | C-2, C-6 | pending |

## Status Tracker

Total: 8 commissions (C-0 orchestrator + C-1 through C-7), 6 waves (0-5)
Completed: 0 / 8
Current wave: —
Blocked: —
Failed: —
