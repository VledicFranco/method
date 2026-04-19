---
type: prd
id: PRD-044
title: "FCD Automation Pipeline — Strategies, GlyphJS Reports, Human-Approval Gates"
date: "2026-03-31"
status: draft
author: Lysica (fcd-design session)
domains:
  - methodts/strategy
  - bridge/strategies
  - bridge/frontend/strategies
  - bridge/frontend/reports (new)
  - .method/strategies (config artifacts)
surfaces:
  - MethodologyNodePrompt
  - StrategyNodeConfig
  - GlyphReportPort
  - HumanApprovalPort
---

# PRD-044 — FCD Automation Pipeline

## Problem

Developers currently invoke fcd-* skills manually, one step at a time. The full
design-to-merge cycle (fcd-design → fcd-plan → N × fcd-commission → N × fcd-review)
requires 10–20 manual invocations, hours of developer attention, and constant
context-switching between the skill results and the codebase. The bridge already
has strategy pipelines, event triggers, a React dashboard, and GlyphJS rendering —
none of which are currently wired to execute the FCD lifecycle autonomously.

## Constraints

- Strategy YAML format stays backward-compatible (new node types are additive)
- GlyphJS packages are already in bridge/frontend package.json — no new installs needed
- Test validation must use the isolated `npm run bridge:test` instance (port 3457, fixture repos)
- The orchestrator strategy must be self-contained — reads a plan and drives all waves
- `human_approval` gates currently always fail (Phase 1 stub) — implementing them is in scope
- Sub-strategy node type does not exist — implementing it is in scope
- Cannot break existing strategies (core-test-watch, smoke-test, strategy-designer)

## Success Criteria

1. **SC-1 — Full pipeline automation:** developer provides a problem description → fcd-design,
   fcd-plan, fcd-commission-orch, and fcd-review execute autonomously with human input only
   at `human_approval` gate points
2. **SC-2 — GlyphJS reports in dashboard:** strategy artifacts (review reports, retros, surface
   records, PRDs) render as rich GlyphJS documents in StrategyDetail and ExecutionView
3. **SC-3 — Human-approval gate UI:** when a `human_approval` gate fires, the dashboard shows
   the frozen surface contract (or any artifact) rendered in GlyphJS, with Approve / Reject /
   Request Changes actions; the strategy resumes or retries based on the response
4. **SC-4 — Integration test passes:** `S-FCD-INTEGRATION-TEST` strategy runs against the
   bridge:test fixture environment, executes a fcd-design → fcd-plan → fcd-commission-solo
   mini-pipeline, produces a review report, and all gates pass green
5. **SC-5 — Trigger chains work:** new PRD file in `.method/sessions/fcd-design-*/prd.md`
   auto-fires S-FCD-PLAN; new realize-plan.md auto-fires S-FCD-COMMISSION-ORCH

## Scope

**In scope:**
- `prompt` field on methodology nodes (dag-types.ts, dag-parser.ts, dag-executor.ts)
- `strategy` sub-invocation node type (dag-types.ts, dag-parser.ts, dag-executor.ts)
- `SubStrategySource` port for sub-strategy lookup (dag-types.ts, bridge wiring)
- `human_approval` gate: full suspension/resume via event bus (dag-gates.ts, dag-executor.ts,
  bridge strategies domain, bridge event types)
- `reports/` frontend domain: extract GlyphJS compile+render pattern from ChatView,
  expose `GlyphReport` component for use across dashboard
- `GateApprovalPanel` in frontend strategies domain: renders surface contracts, handles
  approve/reject/feedback, sends approval_response event
- Updates to StrategyDetail and ExecutionView: show GlyphJS artifact viewer, show pending gates
- 7 fcd-* strategy YAML files: s-fcd-surface, s-fcd-card, s-fcd-design, s-fcd-plan,
  s-fcd-commission-solo, s-fcd-commission-orch, s-fcd-review
- `S-FCD-INTEGRATION-TEST` strategy: safe-environment test run against bridge:test fixture
- File trigger declarations in each strategy's `triggers:` section
- Cycle detection in sub-strategy executor (prevent infinite recursion)

**Out of scope:**
- fcd-debate as a strategy (complex multi-character orchestration, separate PRD)
- fcd-diagnose, fcd-health, fcd-govern (planned, not yet specified)
- PDF export from dashboard
- Full GlyphJS authoring UI
- Realtime collaborative gate review (single-user approval only)

---

## Surfaces (Primary Deliverable)

### Surface 1 — MethodologyNodePrompt
**Complexity:** TRIVIAL
**Owner:** methodts/strategy
**Direction:** dag-types → dag-executor, dag-parser, bridge re-export
**Status:** frozen

Extension of `MethodologyNodeConfig` with an optional `prompt` field injected verbatim
before the methodology context in the agent's prompt. Enables strategy YAML files to
encode phase-level instructions (fcd skill content) directly in the node definition.

```typescript
// packages/methodts/src/strategy/dag-types.ts — extension
export interface MethodologyNodeConfig {
  readonly type: "methodology";
  readonly methodology: string;
  readonly method_hint?: string;
  readonly prompt?: string;          // NEW: injected verbatim before methodology context
  readonly capabilities: readonly string[];
}
```

**Gate assertion:** `dag-parser correctly populates prompt field when present in YAML;
dag-executor injects it before "Methodology:" line in the built prompt`

---

### Surface 2 — StrategyNodeConfig (sub-invocation)
**Complexity:** STANDARD
**Owner:** methodts/strategy
**Direction:** dag-types → dag-executor, dag-parser, bridge strategies (re-export)
**Status:** frozen

New node type that invokes another strategy by ID as a synchronous sub-process. The
sub-strategy's final artifacts are passed to dependent nodes as the node's output.
A `SubStrategySource` port is injected at executor construction time.

```typescript
// packages/methodts/src/strategy/dag-types.ts — additions

/** Invokes a named strategy as a sub-process. */
export interface StrategyNodeConfig {
  readonly type: "strategy";
  readonly strategy_id: string;
  /** Maps node input names to sub-strategy context input names.
   *  Key: name as declared in this node's `inputs:`
   *  Value: context_input name in the sub-strategy */
  readonly input_map?: Record<string, string>;
  /** If false, fires sub-strategy and continues without waiting. Default: true */
  readonly await?: boolean;
}

/** Result returned by a completed sub-strategy node. */
export interface SubStrategyResult {
  readonly strategy_id: string;
  readonly status: "completed" | "failed";
  readonly artifacts: ArtifactBundle;
  readonly cost_usd: number;
  readonly duration_ms: number;
}

/** Port for looking up a sub-strategy DAG by ID. Injected into DagStrategyExecutor. */
export interface SubStrategySource {
  getStrategy(id: string): Promise<StrategyDAG | null>;
}

// Updated NodeConfig union:
export type NodeConfig =
  | MethodologyNodeConfig
  | ScriptNodeConfig
  | StrategyNodeConfig;   // NEW

// Updated StrategyNode:
export interface StrategyNode {
  // ...existing fields...
  readonly config: MethodologyNodeConfig | ScriptNodeConfig | StrategyNodeConfig;
}
```

**Cycle detection:** Executor maintains a call stack of strategy IDs. If a sub-strategy
ID is already in the call stack, execution fails with a clear error.

**Gate assertion:** `strategy node type correctly executes sub-strategy and passes
SubStrategyResult to dependent nodes; cycles are detected and rejected`

---

### Surface 3 — GlyphReportPort
**Complexity:** STANDARD
**Owner:** bridge/frontend/reports (new domain)
**Direction:** reports → strategies, other frontend consumers
**Status:** frozen

React component extracted from the pattern already implemented in `ChatView.tsx`.
Lazy-loads @glyphjs/compiler + @glyphjs/runtime, compiles markdown to IR, renders
via GlyphDocument. Consumers import only from `reports/`, never from `@glyphjs/*` directly.

```typescript
// packages/bridge/frontend/src/domains/reports/index.ts

export interface GlyphReportProps {
  /** Raw GlyphJS markdown content to compile and render */
  markdown: string;
  /** CSS class for the container */
  className?: string;
  /** GlyphJS layout mode. Default: 'document' */
  layout?: 'document' | 'dashboard';
  /** Fallback content shown while compiling or on error */
  fallback?: React.ReactNode;
}

/** Lazy-compiled GlyphJS document renderer.
 *  Compiles markdown to IR client-side using @glyphjs/compiler,
 *  renders via @glyphjs/runtime GlyphDocument. */
export function GlyphReport(props: GlyphReportProps): React.ReactElement
```

**Gate assertion:** `frontend strategies/ and other consumers import GlyphReport from
'../reports', never import @glyphjs/* directly`

---

### Surface 4 — HumanApprovalPort
**Complexity:** STANDARD
**Owner:** bridge/strategies (server-side emission) ↔ bridge/frontend/strategies (UI receiver)
**Direction:** server → frontend via WebSocket event bus; frontend → server via response event
**Status:** frozen

Replaces the Phase 1 stub in `dag-gates.ts`. When a `human_approval` gate evaluates,
the executor suspends that node's completion and emits an event. The frontend renders
a GateApprovalPanel. User approves, rejects, or requests changes. The executor resumes.

```typescript
// packages/bridge/src/domains — new event types in bridge event definitions

/** Emitted by strategies domain when a human_approval gate fires */
export interface StrategyGateAwaitingApprovalEvent {
  domain: 'strategies';
  type: 'gate.awaiting_approval';
  severity: 'info';
  payload: {
    strategy_id: string;
    execution_id: string;
    gate_id: string;
    node_id: string;
    /** GlyphJS markdown content to display (surface contract, PRD excerpt, etc.) */
    artifact_markdown: string;
    artifact_type: 'surface_record' | 'prd' | 'plan' | 'review_report' | 'custom';
    /** ms to wait for response before triggering oversight escalation. Default: 3600000 (1h) */
    timeout_ms: number;
  };
}

/** Sent by frontend to resume a suspended gate */
export interface StrategyGateApprovalResponseEvent {
  domain: 'strategies';
  type: 'gate.approval_response';
  payload: {
    execution_id: string;
    gate_id: string;
    decision: 'approved' | 'rejected' | 'changes_requested';
    feedback?: string;  // passed as retry context if rejected/changes_requested
  };
}
```

**Executor behavior:**
- `human_approval` gate evaluation: suspend node, emit `gate.awaiting_approval` event,
  register async resolver keyed by `(execution_id, gate_id)`
- On `gate.approval_response` event: resolve the awaiter with `passed: decision === 'approved'`
  and `feedback: response.feedback`; if rejected with feedback, retry up to `max_retries` times
- Timeout: if resolver not called within `timeout_ms`, trigger `escalate_to_human` oversight rule

**Gate assertion:** `human_approval gate suspends execution and resumes only after
approval_response event is received; rejection with feedback triggers retry context`

---

### Surface Summary

| # | Surface | Owner | Direction | Complexity | Status |
|---|---------|-------|-----------|------------|--------|
| 1 | MethodologyNodePrompt | methodts/strategy | types → executor, parser | TRIVIAL | frozen |
| 2 | StrategyNodeConfig | methodts/strategy | types → executor, parser, bridge | STANDARD | frozen |
| 3 | GlyphReportPort | frontend/reports | reports → strategies, all consumers | STANDARD | frozen |
| 4 | HumanApprovalPort | bridge/strategies ↔ frontend/strategies | WS bidirectional | STANDARD | frozen |

---

## Per-Domain Architecture

### D-1: @methodts/methodts/strategy/

**Files changed:**
- `dag-types.ts` — add `prompt?` to MethodologyNodeConfig; add StrategyNodeConfig,
  SubStrategyResult, SubStrategySource; update NodeConfig union and StrategyNode
- `dag-parser.ts` — parse `prompt` field; parse `type: strategy` nodes with strategy_id
  and input_map; validate strategy node fields; add strategy to StrategyYaml raw type
- `dag-executor.ts` — inject SubStrategySource at construction; in executeNode():
  handle `strategy` type by resolving sub-strategy DAG via SubStrategySource, constructing
  a child DagStrategyExecutor with cycle-detection call stack, executing it, returning
  SubStrategyResult; inject `prompt` into methodology node prompt when present
- `dag-gates.ts` — replace human_approval stub: accept a `HumanApprovalResolver` callback
  injected at evaluateGate() call site; if resolver is null, return not-passed (stub behavior
  preserved for pure unit tests); if resolver present, return a Promise that resolves when
  the callback is called

**New types exported from dag-types.ts:**
  StrategyNodeConfig, SubStrategyResult, SubStrategySource

**FCA layer:** L2 — @methodts/methodts domain extensions. Zero transport dependencies.

**Verification:**
- Extend `dag-pipeline.test.ts` with: prompt injection test, strategy sub-invocation test,
  cycle detection test
- New `dag-gates-human-approval.test.ts` for suspension/resume logic

---

### D-2: packages/bridge/src/domains/strategies/

**Files changed:**
- `strategy-executor.ts` (PactaNodeExecutor) — handle `strategy` node type: instantiate
  child executor with bridge's strategy YAML dir as SubStrategySource; add call-stack
  tracking for cycle detection; pass SubStrategySource to methodts DagStrategyExecutor
- `strategy-parser.ts` — re-export StrategyNodeConfig, SubStrategyResult from methodts
- A new `human-approval-resolver.ts` — bridge-level resolver factory: takes EventBus,
  registers listener for `gate.approval_response` events, returns a `HumanApprovalResolver`
  that emits `gate.awaiting_approval` and awaits the response; wired in composition root
  (server-entry.ts)

**FCA layer:** L4 bridge — thin adapter. No new external dependencies.

**Verification:** Integration test: a strategy with `human_approval` gate suspends,
receives approval event, and completes successfully.

---

### D-3: packages/bridge/frontend/src/domains/reports/ (NEW DOMAIN)

**New domain — created from scratch.**

**Files:**
- `GlyphReport.tsx` — extracts and generalizes the lazy-compile pattern from
  `sessions/ChatView.tsx`. Uses the three @glyphjs packages already in package.json.
  Handles compile errors gracefully (shows fallback).
- `GlyphReport.test.tsx` — renders sample GlyphJS markdown, asserts no compile errors
- `index.ts` — exports GlyphReport and GlyphReportProps
- `README.md` — domain purpose, usage, and component reference

**Dependencies:** @glyphjs/compiler, @glyphjs/runtime, @glyphjs/components
(all already in bridge/frontend/package.json — no new installs)

**Co-location:** all files in `src/domains/reports/`

**FCA layer:** L3 frontend — UI utility domain, no business logic.

---

### D-4: packages/bridge/frontend/src/domains/strategies/

**New files:**
- `GateApprovalPanel.tsx` — renders a human_approval gate pause:
  - GlyphReport component showing `artifact_markdown`
  - Gate metadata (strategy ID, node ID, gate ID, artifact type label)
  - Action buttons: Approve / Reject / Request Changes
  - Optional feedback textarea (shown when Reject or Request Changes selected)
  - On action: sends WebSocket message with `gate.approval_response` event
  - Shows timeout countdown if timeout_ms is set
- `ArtifactViewer.tsx` — renders any strategy artifact that looks like GlyphJS markdown
  (detected by presence of `ui:` blocks or `---` frontmatter); falls back to
  syntax-highlighted JSON/YAML for non-GlyphJS artifacts

**Modified files:**
- `StrategyDetail.tsx` — add ArtifactViewer section for completed node artifacts;
  add GateApprovalPanel for any pending `gate.awaiting_approval` events on this strategy
- `ExecutionView.tsx` — add GateApprovalPanel for active executions with awaiting gates;
  add live artifact streaming for running methodology nodes

**Event handling:** subscribe to `strategy.gate.awaiting_approval` via existing WebSocket
event bus; send `gate.approval_response` via the same bus.

**FCA layer:** L3 frontend — strategies domain feature UI.

---

### D-5: .method/strategies/ (7 + 1 YAML files)

**s-fcd-surface.yaml** — 7 nodes (load_context, parse_input, name_scope, define_interface,
map_producers_consumers, write_record, write_port_file). `human_approval` gate on
`write_record` node — presents the full interface definition for freeze confirmation.
Manual trigger only (invoked by fcd-plan or fcd-design as sub-strategy).

**s-fcd-card.yaml** — 5 nodes (load_context, q1_q2_domain_ports, check_missing_ports,
q3_q5_structural, write_card). Script gate on q1_q2 output checks that consumed ports
exist or flags for s-fcd-surface sub-invocation. Manual trigger.

**s-fcd-design.yaml** — 7 nodes (load_context, discovery, domain_identification,
surface_definition, per_domain_arch, phase_plan, write_prd). Surface_definition node
uses `type: strategy` with `strategy_id: S-FCD-SURFACE` for complex surfaces.
Produces GlyphJS-formatted PRD artifact. `human_approval` gate on write_prd.
Manual trigger.

**s-fcd-plan.yaml** — 7 nodes (load_prd, domain_survey, decompose, surface_enum,
topo_order, wave_construction, write_plan). Surface_enum uses `type: strategy` for
missing surfaces. Algorithmic gates for DAG cycle detection.
File trigger: `.method/sessions/fcd-design-*/prd.md` (created).
Manual trigger.

**s-fcd-commission-solo.yaml** — 6 nodes (port_freeze_check, confidence_raise, design_a_plus,
implement_loop, hygiene, create_pr). `implement_loop` is a methodology node with
capabilities: [Read, Glob, Grep, Write, Bash] — allows git push and gh pr create.
`prompt` field encodes Phase B instructions. Algorithmic gate checks for no TODO/FIXME/STUB
before marking complete. Manual trigger only.

**s-fcd-commission-orch.yaml** — Orchestrator strategy. Nodes:
(load_plan, wave_0_apply, wave_0_validate, wave_N_dispatch..., write_retro).
`wave_N_dispatch` nodes use `type: strategy` with `strategy_id: S-FCD-COMMISSION-SOLO`.
The number of commission waves is bounded in the YAML (max 3 waves × max 5 commissions = 15
sub-strategy nodes pre-declared; empty slots guarded by script gates that skip if no task).
File trigger: `.method/sessions/fcd-plan-*/realize-plan.md` (created).
Manual trigger.

**s-fcd-review.yaml** — Parallel advisor nodes (6 at same topological level, runs in parallel
via maxParallel), then 4 parallel synthesizer nodes, then write_action_plan. All advisor
nodes use `prompt` field with advisor-specific instructions. GlyphJS action plan artifact.
`human_approval` gate on write_action_plan for Fix-Now findings.
Git trigger: PR created on `feat/*` branch.
Manual trigger.

**s-fcd-integration-test.yaml** — Test orchestrator:
1. `setup` script node — validates bridge:test is reachable at port 3457
2. `run_design` strategy node — invokes S-FCD-DESIGN against fixture task
3. `validate_prd` script node — asserts PRD file exists and has `surfaces:` section
4. `run_plan` strategy node — invokes S-FCD-PLAN on PRD output
5. `validate_plan` script node — asserts plan has Wave 0 + at least 1 commission
6. `run_commission` strategy node — invokes S-FCD-COMMISSION-SOLO on C-1
7. `validate_commission` script node — asserts PR branch exists in fixture repo
8. `run_review` strategy node — invokes S-FCD-REVIEW on the commission output
9. `validate_review` script node — asserts action plan artifact is non-empty GlyphJS
10. `teardown` script node — cleanup summary

All validation script nodes emit structured JSON results. Strategy-level gate
checks all validation results are truthy.

---

## Phase Plan

### Wave 0 — Shared Surfaces (Orchestrator applies, no commissions)

The orchestrator applies these changes to `master` before spawning any commission:

**A. Type additions in dag-types.ts (@methodts/methodts)**
- Add `prompt?: string` to `MethodologyNodeConfig`
- Add `StrategyNodeConfig`, `SubStrategyResult`, `SubStrategySource` types
- Update `NodeConfig` union to include `StrategyNodeConfig`
- Update `StrategyNode.config` type to include `StrategyNodeConfig`
- Add raw YAML type support: `StrategyYaml.dag.nodes[]` includes `strategy` node fields

**B. Event type additions (bridge event definitions)**
- Add `StrategyGateAwaitingApprovalEvent` to bridge event types
- Add `StrategyGateApprovalResponseEvent` to bridge event types

**C. Interface stub in frontend/reports/**
- Create `packages/bridge/frontend/src/domains/reports/index.ts` with
  exported `GlyphReportProps` interface and stub `GlyphReport` function signature
  (no implementation — stub for type-checking Wave 1 consumers)

**D. Gate assertions in architecture.test.ts**
- `strategies/ does not import @glyphjs/* directly` (must use reports/)
- `strategy node sub-invocation does not allow cycles (call stack depth > 10)`
- `human_approval gate suspends on resolve=null (backward compat stub preserved)`

**E. Verification:** `npm run build` passes, `npm test` passes on existing tests.

---

### Wave 1 — Core Infrastructure [parallel: C-1 + C-2]

**C-1: methodts strategy infrastructure**
Domain: `packages/methodts/src/strategy/`
- dag-parser.ts: parse `prompt` field, parse `strategy` nodes, validate strategy_id
- dag-executor.ts: inject SubStrategySource port; handle strategy node type with
  cycle detection; inject `prompt` into methodology node prompt
- dag-gates.ts: HumanApprovalResolver callback pattern replacing the stub
- New test: `dag-gates-human-approval.test.ts`
- Extend: `dag-pipeline.test.ts` with prompt injection + strategy sub-invocation tests
Branch: `feat/prd-044-c1-methodts-strategy`
Consumed ports: MethodologyNodePrompt (frozen), StrategyNodeConfig (frozen)
Produced ports: SubStrategySource (interface used by bridge)

**C-2: frontend reports domain**
Domain: `packages/bridge/frontend/src/domains/reports/`
- Create new domain: GlyphReport.tsx, test, index.ts, README
- Extract lazy-compile pattern from ChatView.tsx (do not modify ChatView)
- Validate renders sample surface record markdown
Branch: `feat/prd-044-c2-frontend-reports`
Consumed ports: GlyphReportPort interface stub (from Wave 0)
Independent of C-1

---

### Wave 2 — Bridge Adapter + Human Approval [sequential: C-3 → C-4]

**C-3: bridge strategies — sub-strategy support + human approval gate**
Domain: `packages/bridge/src/domains/strategies/`
- strategy-executor.ts: handle strategy node type, wire SubStrategySource from YAML dir loader
- human-approval-resolver.ts: event bus integration — emit awaiting_approval, await response
- Composition root wiring (server-entry.ts or strategies domain init)
- Integration test: strategy with human_approval gate suspends and resumes
Branch: `feat/prd-044-c3-bridge-strategy-infra`
Depends on: C-1 (methodts infrastructure must be in place)
Consumed ports: StrategyNodeConfig (frozen), HumanApprovalPort (frozen)

**C-4: fcd-* strategy YAML files**
Domain: `.method/strategies/`
- Write all 8 YAML files (7 fcd-* + integration test)
- Validate each with: `node -e "require('js-yaml').load(fs.readFileSync(...),'utf8')"`
- Validate bridge:test can load and list all strategies
Branch: `feat/prd-044-c4-fcd-strategy-yamls`
Depends on: C-3 (new node types must be parseable before YAML files are valid)
Note: these are configuration artifacts, not code — simpler commission

---

### Wave 3 — Frontend Gate UI + ExecutionView Updates [C-5]

**C-5: frontend strategies gate UI**
Domain: `packages/bridge/frontend/src/domains/strategies/`
- GateApprovalPanel.tsx: renders GlyphReport of surface contract + approve/reject UI
- ArtifactViewer.tsx: renders any strategy artifact as GlyphJS or fallback
- Update StrategyDetail.tsx: ArtifactViewer for completed nodes, pending gate panel
- Update ExecutionView.tsx: GateApprovalPanel for active strategies with awaiting gates
Branch: `feat/prd-044-c5-frontend-gate-ui`
Depends on: C-2 (GlyphReport), C-3 (gate events exist on server)
Consumed ports: GlyphReportPort (frozen), HumanApprovalPort frontend side (frozen)

---

### Wave 4 — Integration Test Run [C-6]

**C-6: integration test validation**
Domain: `.method/strategies/` + `experiments/exp-fcd-automation/`
- Confirm s-fcd-integration-test.yaml is correct (authored in C-4)
- Execute against bridge:test instance: `npm run bridge:test`
- Run: `mcp__method__strategy_execute("S-FCD-INTEGRATION-TEST", {})`
- Record result in `experiments/log/2026-03-31-exp-fcd-automation-test.yaml`
- All 10 validation script gates must pass
- Write experiment README: hypothesis, methodology, result
Branch: `feat/prd-044-c6-integration-test`
Depends on: C-4 (YAML files), C-5 (gate UI in place)

**AC:** S-FCD-INTEGRATION-TEST completes with status: "completed", all strategy_gates pass,
review report artifact is non-empty GlyphJS markdown, total cost < $15.

---

### Acceptance Gates (Mapped to Success Criteria)

| Gate | Commission | SC | Pass Condition |
|------|------------|-----|----------------|
| methodts prompt injection | C-1 | SC-1 | dag-pipeline.test.ts passes with prompt injection test |
| methodts strategy sub-invocation | C-1 | SC-1 | sub-strategy executes and passes artifacts through |
| human_approval suspend/resume | C-3 | SC-3 | integration test: gate suspends, event fires, resumes |
| GlyphReport renders | C-2 | SC-2 | test: sample surface record compiles and renders |
| GateApprovalPanel visible | C-5 | SC-3 | gate awaiting_approval event → panel visible in dashboard |
| ArtifactViewer renders | C-5 | SC-2 | completed node with GlyphJS artifact shows rendered in StrategyDetail |
| All 8 YAML files valid | C-4 | SC-1 | js-yaml parse passes for all 8 files |
| Integration test passes | C-6 | SC-4 | S-FCD-INTEGRATION-TEST: status completed, all gates green |
| Trigger chain fires | C-4 | SC-5 | writing PRD file triggers S-FCD-PLAN within debounce window |

---

## Risk Assessment

**Highest risk — human_approval gate suspension/resume**
The current implementation always returns `passed: false`. The suspension pattern requires
the executor to hold an async resolver across event bus messages, which involves shared
mutable state in the executor. Incorrect implementation can cause hanging strategies
or spurious completions. Requires careful testing.

**Second risk — sub-strategy executor wiring**
The SubStrategySource port needs to find strategy YAMLs by ID at runtime. The bridge's
strategy YAML directory must be queryable from within strategy execution. The composition
root wiring in server-entry.ts needs care to avoid circular initialization.

**Third risk — s-fcd-commission-orch wave structure**
Pre-declaring up to 15 commission slots (3 waves × 5) with skip guards is workable but
produces a verbose YAML. If real plans exceed 5 commissions per wave, the YAML structure
breaks down. Treat the 5-per-wave cap as a known constraint to address post-PRD.

**Fourth risk — integration test fixture scope**
The test-fixtures/bridge-test/ repos need a task suitable for fcd-commission-solo. The
fixture must have: a domain structure, at least 2 domains, no existing port between them.
If fixtures don't have this, C-6 needs to add or adjust a fixture. Verify before C-6 runs.

---

## Commission Summary

| Commission | Domain | Wave | Branch | Depends On |
|------------|--------|------|--------|------------|
| C-1 | methodts/strategy | 1 | feat/prd-044-c1-methodts-strategy | Wave 0 |
| C-2 | frontend/reports (new) | 1 | feat/prd-044-c2-frontend-reports | Wave 0 |
| C-3 | bridge/strategies | 2 | feat/prd-044-c3-bridge-strategy-infra | C-1 |
| C-4 | .method/strategies/ | 2 | feat/prd-044-c4-fcd-strategy-yamls | C-3 |
| C-5 | frontend/strategies | 3 | feat/prd-044-c5-frontend-gate-ui | C-2, C-3 |
| C-6 | integration test | 4 | feat/prd-044-c6-integration-test | C-4, C-5 |

Total: 6 commissions, 4 waves (+ Wave 0). Estimated cost: $30–60 total pipeline run.
