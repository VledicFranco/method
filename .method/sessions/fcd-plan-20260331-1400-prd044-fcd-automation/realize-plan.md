# Realization Plan — PRD-044 FCD Automation Pipeline

## PRD Summary

**Objective:** Automate the full fcd-* design/implementation lifecycle as bridge
strategies. Developers provide a problem description; the pipeline (fcd-design →
fcd-plan → fcd-commission-orch → fcd-review) runs autonomously. Human input
required only at `human_approval` gate points. Reports render as GlyphJS documents
in the bridge dashboard.

**Success Criteria:**
- SC-1 — Full pipeline automation (design → plan → commission → review, automated)
- SC-2 — GlyphJS reports in StrategyDetail and ExecutionView
- SC-3 — Human-approval gate UI (surface contracts rendered + approve/reject actions)
- SC-4 — Integration test passes on bridge:test instance
- SC-5 — File trigger chains work (PRD created → plan fires; plan created → commission fires)

**Build command:** `npm run build`
**Test command:** `npm test`
**Lint:** `npx tsc --noEmit`

---

## FCA Partition Map

```
methodts packages (L2):
  methodts/strategy/        → dag-types, dag-parser, dag-executor, dag-gates
                              transport-agnostic (DR-03), zero bridge deps

bridge packages (L3-L4):
  bridge/strategies/        → strategy-executor (adapter), strategy-parser (re-export),
                              gates (re-export), human-approval-resolver (NEW)
  bridge/server-entry.ts    → composition root — wires HumanApprovalResolver port

frontend (L3 UI):
  frontend/reports/         → GlyphReport component (NEW DOMAIN)
  frontend/strategies/      → GateApprovalPanel, ArtifactViewer (new components),
                              StrategyDetail + ExecutionView (updates)

Config artifacts:
  .method/strategies/       → 8 YAML files (7 fcd-* + integration test)
  experiments/              → integration test run record

Shared surfaces (orchestrator-owned — Wave 0):
  packages/methodts/src/strategy/dag-types.ts        ← type definitions
  packages/bridge/src/ports/event-bus.ts             ← event type conventions
  packages/bridge/frontend/src/domains/reports/index.ts ← GlyphReport interface stub
  packages/bridge/src/shared/architecture.test.ts    ← gate assertions
```

---

## Commission Dependency DAG

```
                Wave 0 (orchestrator)
                      │
          ┌───────────┴───────────┐
        C-1                     C-3
  methodts/strategy          frontend/reports
  (types, parser,            (GlyphReport
   executor, gates)           component)
        │
        └───────────────────────┐
                              C-2
                        bridge/strategies
                        (adapter + human
                         approval resolver)
                              │
                  ┌───────────┴───────────┐
                C-4                     C-5
          frontend/strategies      .method/strategies
          (gate UI, artifact       (8 YAML files)
           viewer, updates)
                  └───────────┬───────────┘
                            C-6
                      integration test
                     (run + record result)

Topological order: [C-1, C-3] → [C-2] → [C-4, C-5] → [C-6]
No cycles. No same-domain parallel conflicts.
```

---

## Wave 0 — Shared Surfaces (Orchestrator Applies)

> All changes below are applied to `master` before any commission branch is cut.
> Every item must survive `npm run build` and `npm test` before Wave 1 begins.

### W0-A: Type additions — dag-types.ts
**File:** `packages/methodts/src/strategy/dag-types.ts`

```typescript
// 1. Add prompt? to MethodologyNodeConfig
export interface MethodologyNodeConfig {
  readonly type: "methodology";
  readonly methodology: string;
  readonly method_hint?: string;
  readonly prompt?: string;          // NEW: verbatim injection before methodology context
  readonly capabilities: readonly string[];
}

// 2. New node type — sub-strategy invocation
export interface StrategyNodeConfig {
  readonly type: "strategy";
  readonly strategy_id: string;
  /** Maps this node's input names → sub-strategy context_input names */
  readonly input_map?: Record<string, string>;
  /** Wait for sub-strategy completion before continuing. Default: true */
  readonly await?: boolean;
}

// 3. Sub-strategy execution result (output of a strategy node)
export interface SubStrategyResult {
  readonly strategy_id: string;
  readonly status: "completed" | "failed";
  readonly artifacts: ArtifactBundle;
  readonly cost_usd: number;
  readonly duration_ms: number;
}

// 4. Port: look up a sub-strategy DAG by ID
export interface SubStrategySource {
  getStrategy(id: string): Promise<StrategyDAG | null>;
}

// 5. Port: resolve a human_approval gate (bridge injects; null = stub)
export interface HumanApprovalContext {
  readonly strategy_id: string;
  readonly execution_id: string;
  readonly gate_id: string;
  readonly node_id: string;
  /** GlyphJS markdown content to show the human */
  readonly artifact_markdown?: string;
  readonly artifact_type?: 'surface_record' | 'prd' | 'plan' | 'review_report' | 'custom';
  readonly timeout_ms: number;
}
export interface HumanApprovalDecision {
  readonly approved: boolean;
  readonly feedback?: string;
}
export interface HumanApprovalResolver {
  requestApproval(ctx: HumanApprovalContext): Promise<HumanApprovalDecision>;
}

// 6. Update NodeConfig union
export type NodeConfig =
  | MethodologyNodeConfig
  | ScriptNodeConfig
  | StrategyNodeConfig;    // NEW

// 7. Update StrategyNode.config
export interface StrategyNode {
  // ...existing fields unchanged...
  readonly config: MethodologyNodeConfig | ScriptNodeConfig | StrategyNodeConfig;
}

// 8. Update StrategyYaml raw type to include strategy node fields
// In the StrategyYaml.strategy.dag.nodes[] array type, add optional fields:
//   strategy_id?: string
//   input_map?: Record<string, string>
//   await?: boolean
```

### W0-B: Event type conventions — event-bus.ts
**File:** `packages/bridge/src/ports/event-bus.ts`

Add JSDoc documenting the two new strategy gate event payload shapes.
No structural change to BridgeEvent (payload is `Record<string, unknown>`).
Add type aliases for documentation:

```typescript
/**
 * Payload shape for domain='strategy', type='gate.awaiting_approval'.
 * Emitted by bridge/strategies when a human_approval gate fires.
 */
export interface StrategyGateAwaitingApprovalPayload {
  strategy_id: string;
  execution_id: string;
  gate_id: string;
  node_id: string;
  artifact_markdown: string;
  artifact_type: 'surface_record' | 'prd' | 'plan' | 'review_report' | 'custom';
  timeout_ms: number;
}

/**
 * Payload shape for domain='strategy', type='gate.approval_response'.
 * Sent by the frontend to resume a suspended gate.
 */
export interface StrategyGateApprovalResponsePayload {
  execution_id: string;
  gate_id: string;
  decision: 'approved' | 'rejected' | 'changes_requested';
  feedback?: string;
}
```

### W0-C: Frontend reports stub
**File (new):** `packages/bridge/frontend/src/domains/reports/index.ts`

```typescript
export interface GlyphReportProps {
  markdown: string;
  className?: string;
  layout?: 'document' | 'dashboard';
  fallback?: React.ReactNode;
}

/** Stub — implemented in C-3. Throws until C-3 is merged. */
export function GlyphReport(_props: GlyphReportProps): React.ReactElement {
  throw new Error('GlyphReport not yet implemented — merge C-3 first');
}
```

### W0-D: Gate assertions — architecture.test.ts
**File:** `packages/bridge/src/shared/architecture.test.ts`

Add three new gate assertions:
```typescript
// G-GLYPHREPORT: frontend strategies/ must import GlyphReport from reports/,
//   never from @glyphjs/* directly
it('strategies/ does not import @glyphjs directly', () => { ... });

// G-SUBSTRATEGY: strategy node type must not create cycles
//   (validated at runtime — gate assertion verifies cycle detection exists in executor)
it('DagStrategyExecutor constructor accepts SubStrategySource and HumanApprovalResolver', () => { ... });

// G-HUMANAPPROVAL: human_approval gate with null resolver fails fast (backward compat)
it('human_approval gate with null resolver returns passed:false immediately', () => { ... });
```

### W0-E: Verification
After applying W0-A through W0-D:
- `npm run build` → must pass (stub throws at runtime, not compile time)
- `npm test` → must pass (new gate assertions pass with stub implementations)
- The GlyphReport stub is a valid export — C-3 replaces the throw with real implementation

---

## Wave 1 — Core Infrastructure (Parallel)

### C-1: methodts/strategy — prompt + strategy node + human_approval

**Domain:** `packages/methodts/src/strategy/`
**Wave:** 1
**Branch:** `feat/prd-044-c1-methodts-strategy`
**Estimated tasks:** 6
**Depends on:** Wave 0

```yaml
id: C-1
title: "methodts strategy — prompt injection, strategy node type, human_approval resolver"
domain: methodts/strategy
wave: 1
scope:
  allowed_paths:
    - "packages/methodts/src/strategy/**"
  forbidden_paths:
    - "packages/bridge/**"
    - "packages/mcp/**"
    - "packages/pacta/**"
    - "packages/methodts/src/strategy/dag-types.ts"   # Wave 0 already applied — read only
consumed_ports:
  - name: MethodologyNodePrompt
    status: frozen
    definition: "dag-types.ts prompt? field (Wave 0 applied)"
  - name: StrategyNodeConfig
    status: frozen
    definition: "dag-types.ts StrategyNodeConfig (Wave 0 applied)"
  - name: HumanApprovalResolver
    status: frozen
    definition: "dag-types.ts HumanApprovalResolver interface (Wave 0 applied)"
produced_ports:
  - name: SubStrategySource
    description: "DagStrategyExecutor now accepts SubStrategySource at construction"
  - name: HumanApprovalResolver
    description: "DagStrategyExecutor now accepts HumanApprovalResolver at construction"
deliverables:
  - "packages/methodts/src/strategy/dag-parser.ts — parse prompt field; parse strategy nodes; validate strategy_id"
  - "packages/methodts/src/strategy/dag-executor.ts — inject SubStrategySource + HumanApprovalResolver ports; handle strategy node type with cycle detection; inject prompt into methodology node prompt"
  - "packages/methodts/src/strategy/dag-gates.ts — replace human_approval stub: if resolver != null, await resolver.requestApproval(); if null, return not-passed (backward compat)"
  - "packages/methodts/src/strategy/__tests__/dag-pipeline.test.ts — extend: prompt injection test, strategy sub-invocation test, cycle detection test"
  - "packages/methodts/src/strategy/__tests__/dag-gates-human-approval.test.ts — new: suspension test with mock resolver, null resolver backward compat test"
documentation_deliverables:
  - "packages/methodts/src/strategy/dag-executor.ts JSDoc — document SubStrategySource and HumanApprovalResolver params"
acceptance_criteria:
  - "dag-pipeline.test.ts passes including new prompt injection + strategy sub-invocation tests → SC-1"
  - "dag-gates-human-approval.test.ts passes: mock resolver called on human_approval gate → SC-3"
  - "null resolver: human_approval returns passed:false immediately (backward compat) → SC-3"
  - "Cycle detection: strategy A invokes strategy A → executor throws CycleDetectedError → SC-1"
  - "npm run build passes with no TypeScript errors"
```

---

### C-3: frontend/reports — GlyphReport component (parallel with C-1)

**Domain:** `packages/bridge/frontend/src/domains/reports/`
**Wave:** 1
**Branch:** `feat/prd-044-c3-frontend-reports`
**Estimated tasks:** 4
**Depends on:** Wave 0 (interface stub exists)

```yaml
id: C-3
title: "frontend reports domain — GlyphReport component"
domain: packages/bridge/frontend/src/domains/reports/
wave: 1
scope:
  allowed_paths:
    - "packages/bridge/frontend/src/domains/reports/**"
  forbidden_paths:
    - "packages/bridge/frontend/src/domains/sessions/**"   # ChatView.tsx — read only
    - "packages/bridge/frontend/src/domains/strategies/**"
    - "packages/bridge/src/**"
    - "packages/methodts/**"
consumed_ports:
  - name: GlyphReportPort
    status: frozen
    definition: "reports/index.ts stub (Wave 0 applied)"
produced_ports:
  - name: GlyphReportPort
    description: "Fully implemented GlyphReport component replaces Wave 0 stub"
deliverables:
  - "packages/bridge/frontend/src/domains/reports/GlyphReport.tsx — extract and generalize lazy-compile pattern from sessions/ChatView.tsx; compile markdown→IR with @glyphjs/compiler; render with @glyphjs/runtime GlyphDocument; handle errors with fallback prop"
  - "packages/bridge/frontend/src/domains/reports/GlyphReport.test.tsx — renders sample surface record GlyphJS markdown; asserts no compile error; asserts fallback renders on invalid input"
  - "packages/bridge/frontend/src/domains/reports/index.ts — replace stub: export real GlyphReport + GlyphReportProps"
  - "packages/bridge/frontend/src/domains/reports/README.md — domain purpose, component API, usage example"
documentation_deliverables:
  - "reports/README.md — created"
acceptance_criteria:
  - "GlyphReport renders a sample surface record markdown document without compile errors → SC-2"
  - "GlyphReport renders fallback when markdown is invalid GlyphJS → SC-2"
  - "No direct @glyphjs/* imports outside of reports/ domain — architecture gate passes → SC-2"
  - "npm run build passes (no TypeScript errors)"
```

---

## Wave 2 — Bridge Adapter + Human Approval Resolver

### C-2: bridge/strategies — executor update + human approval resolver

**Domain:** `packages/bridge/src/domains/strategies/`
**Wave:** 2
**Branch:** `feat/prd-044-c2-bridge-strategy-infra`
**Estimated tasks:** 5
**Depends on:** C-1

```yaml
id: C-2
title: "bridge/strategies — sub-strategy support + human_approval gate resolver"
domain: packages/bridge/src/domains/strategies/
wave: 2
scope:
  allowed_paths:
    - "packages/bridge/src/domains/strategies/**"
    - "packages/bridge/src/server-entry.ts"            # composition root wiring only
  forbidden_paths:
    - "packages/bridge/src/ports/**"                   # event-bus.ts — read only
    - "packages/bridge/src/domains/sessions/**"
    - "packages/bridge/src/domains/triggers/**"
    - "packages/bridge/src/domains/projects/**"
    - "packages/methodts/**"
consumed_ports:
  - name: StrategyNodeConfig
    status: frozen
    definition: "dag-types.ts (Wave 0 + C-1 implemented)"
  - name: SubStrategySource
    status: frozen
    definition: "dag-types.ts interface (C-1 produced)"
  - name: HumanApprovalResolver
    status: frozen
    definition: "dag-types.ts interface (C-1 produced)"
  - name: HumanApprovalPort (event bus side)
    status: frozen
    definition: "event-bus.ts payload types (Wave 0 W0-B)"
produced_ports:
  - name: HumanApprovalPort
    description: "bridge-level resolver that emits awaiting_approval event and awaits response"
deliverables:
  - "packages/bridge/src/domains/strategies/human-approval-resolver.ts — NEW: BridgeHumanApprovalResolver class; constructor takes EventBus; requestApproval() emits gate.awaiting_approval event, registers Promise resolver keyed by (execution_id, gate_id), subscribes to gate.approval_response events, resolves Promise on match; timeout triggers escalation"
  - "packages/bridge/src/domains/strategies/strategy-executor.ts — PactaNodeExecutor: add strategy node type handler; instantiate child DagStrategyExecutor with YAML dir SubStrategySource; pass call-stack array for cycle detection; wire SubStrategySource from bridge's .method/strategies/ directory"
  - "packages/bridge/src/domains/strategies/strategy-parser.ts — re-export StrategyNodeConfig, SubStrategyResult from methodts"
  - "packages/bridge/src/server-entry.ts — wire BridgeHumanApprovalResolver into StrategyExecutor at composition root (inject EventBus)"
  - "packages/bridge/src/domains/strategies/strategy-executor.test.ts — extend: mock sub-strategy execution returns SubStrategyResult; human_approval gate suspends and resumes on mock approval_response event"
documentation_deliverables:
  - "packages/bridge/src/domains/strategies/README.md — add section on sub-strategy invocation and human_approval resolver"
acceptance_criteria:
  - "Strategy with strategy node type invokes sub-strategy and passes its artifacts as node output → SC-1"
  - "Strategy with human_approval gate emits gate.awaiting_approval event and suspends → SC-3"
  - "Sending gate.approval_response event with decision:approved resumes the strategy → SC-3"
  - "Sending decision:rejected with feedback causes gate retry with feedback as context → SC-3"
  - "Sub-strategy YAML files in .method/strategies/ are discoverable by SubStrategySource → SC-1"
  - "npm run build passes"
```

---

## Wave 3 — Frontend Gate UI + Strategy YAML Files (Parallel)

### C-4: frontend/strategies — gate UI + artifact viewer

**Domain:** `packages/bridge/frontend/src/domains/strategies/`
**Wave:** 3
**Branch:** `feat/prd-044-c4-frontend-gate-ui`
**Estimated tasks:** 5
**Depends on:** C-2 (gate events on server), C-3 (GlyphReport component)

```yaml
id: C-4
title: "frontend/strategies — GateApprovalPanel + ArtifactViewer + StrategyDetail updates"
domain: packages/bridge/frontend/src/domains/strategies/
wave: 3
scope:
  allowed_paths:
    - "packages/bridge/frontend/src/domains/strategies/**"
  forbidden_paths:
    - "packages/bridge/frontend/src/domains/reports/**"    # import GlyphReport, don't modify
    - "packages/bridge/frontend/src/domains/sessions/**"
    - "packages/bridge/src/**"
    - "packages/@glyphjs/**"                               # never import @glyphjs directly
consumed_ports:
  - name: GlyphReportPort
    status: frozen
    definition: "reports/index.ts (C-3 implemented)"
  - name: HumanApprovalPort (frontend side)
    status: frozen
    definition: "event-bus.ts payload types (Wave 0 W0-B)"
produced_ports: []
deliverables:
  - "GateApprovalPanel.tsx — renders strategy gate pause: GlyphReport showing artifact_markdown, gate metadata (strategy/node/gate IDs), action buttons (Approve / Reject / Request Changes), feedback textarea when rejecting, sends gate.approval_response WebSocket event on action, shows countdown if timeout_ms set"
  - "ArtifactViewer.tsx — renders any strategy artifact: detects GlyphJS markdown (by ui: blocks or --- frontmatter with type:), falls back to syntax-highlighted code block for non-GlyphJS content; prop: { content: string; artifactId: string }"
  - "StrategyDetail.tsx — add ArtifactViewer section for completed node artifacts; add GateApprovalPanel when strategy has pending gate.awaiting_approval events"
  - "ExecutionView.tsx — add GateApprovalPanel for active strategies with awaiting gates; add live artifact display for running methodology nodes"
  - "websocket event handling — subscribe to strategy.gate.awaiting_approval events, store pending gates in component state; send strategy.gate.approval_response on user action"
documentation_deliverables:
  - "packages/bridge/frontend/src/domains/strategies/README.md — add GateApprovalPanel and ArtifactViewer usage"
acceptance_criteria:
  - "gate.awaiting_approval event received → GateApprovalPanel visible in StrategyDetail with GlyphJS artifact rendered → SC-3"
  - "User clicks Approve → gate.approval_response event sent with decision:approved → SC-3"
  - "User clicks Request Changes with feedback → gate.approval_response sent with feedback text → SC-3"
  - "Completed methodology node with GlyphJS artifact → ArtifactViewer renders it in StrategyDetail → SC-2"
  - "import from @glyphjs/* directly → architecture gate fails (reports/ import required) → SC-2"
```

---

### C-5: .method/strategies — 8 FCD strategy YAML files (parallel with C-4)

**Domain:** `.method/strategies/`
**Wave:** 3
**Branch:** `feat/prd-044-c5-fcd-strategy-yamls`
**Estimated tasks:** 4 (write + validate all 8 files)
**Depends on:** C-2 (new node types parseable by bridge)

```yaml
id: C-5
title: ".method/strategies — 8 fcd-* strategy YAML files"
domain: .method/strategies/
wave: 3
scope:
  allowed_paths:
    - ".method/strategies/**"
  forbidden_paths:
    - "packages/**"
    - "docs/**"
    - "registry/**"
consumed_ports:
  - name: MethodologyNodePrompt
    status: frozen
    definition: "prompt? field in YAML nodes (supported after C-2 bridge update)"
  - name: StrategyNodeConfig
    status: frozen
    definition: "type: strategy node in YAML (supported after C-2 bridge update)"
produced_ports: []
deliverables:
  - "s-fcd-surface.yaml — 7 methodology nodes, human_approval gate on write_record node (surface freeze confirmation), manual trigger only"
  - "s-fcd-card.yaml — 5 nodes (3 methodology + 2 script), algorithmic gates, manual trigger only"
  - "s-fcd-design.yaml — 7 methodology nodes, human_approval gate on write_prd, strategy sub-invocation for complex surfaces, manual trigger only"
  - "s-fcd-plan.yaml — 7 nodes (methodology + script), file trigger on .method/sessions/fcd-design-*/prd.md (created), manual trigger"
  - "s-fcd-commission-solo.yaml — 6 nodes including implement_loop with Bash capability, algorithmic gate checking no TODO/FIXME/STUB before commit, manual trigger only"
  - "s-fcd-commission-orch.yaml — orchestrator: load_plan + wave_0_apply + wave_0_validate + up to 3×5 commission strategy-node slots (guarded by script skip gates) + write_retro; file trigger on .method/sessions/fcd-plan-*/realize-plan.md"
  - "s-fcd-review.yaml — 6 parallel advisor nodes + 4 parallel synthesizer nodes + write_action_plan; human_approval gate on action plan if Fix-Now items present; git trigger on feat/* PR creation, manual trigger"
  - "s-fcd-integration-test.yaml — 10 nodes: setup (validate bridge:test reachable) + run_design + validate_prd + run_plan + validate_plan + run_commission + validate_commission + run_review + validate_review + teardown; manual trigger only"
acceptance_criteria:
  - "All 8 YAML files pass js-yaml parse without errors → DR-13"
  - "npm run bridge:test loads and lists all 8 strategies by ID → SC-4"
  - "s-fcd-plan.yaml trigger correctly patterns .method/sessions/fcd-design-*/prd.md → SC-5"
  - "s-fcd-commission-orch.yaml trigger correctly patterns .method/sessions/fcd-plan-*/realize-plan.md → SC-5"
  - "s-fcd-review.yaml uses parallel node topology (6 advisor nodes + 4 synthesizer nodes at same DAG level)"
```

---

## Wave 4 — Integration Test

### C-6: Integration test run + experiment record

**Domain:** `experiments/exp-fcd-automation/` + `.method/strategies/` (validate only)
**Wave:** 4
**Branch:** `feat/prd-044-c6-integration-test`
**Estimated tasks:** 3
**Depends on:** C-4 (gate UI), C-5 (YAML files)

```yaml
id: C-6
title: "Integration test — S-FCD-INTEGRATION-TEST run + experiment record"
domain: experiments/exp-fcd-automation/
wave: 4
scope:
  allowed_paths:
    - "experiments/exp-fcd-automation/**"
    - ".method/strategies/s-fcd-test-canary.yaml"    # canary file created by integration test
  forbidden_paths:
    - "packages/**"
    - "docs/**"
    - "registry/**"
    - ".method/strategies/s-fcd-*.yaml"              # source YAMLs — read only
consumed_ports:
  - name: StrategyNodeConfig
    status: frozen
    definition: "C-2 implemented — sub-strategy invocation works"
  - name: GlyphReportPort
    status: frozen
    definition: "C-3 implemented — GlyphReport renders"
  - name: HumanApprovalPort
    status: frozen
    definition: "C-2 + C-4 implemented — gate suspend/resume works"
produced_ports: []
deliverables:
  - "experiments/exp-fcd-automation/README.md — experiment: hypothesis (S-FCD-INTEGRATION-TEST produces green result on bridge:test), methodology (start bridge:test, run strategy, record), acceptance criteria"
  - "experiments/exp-fcd-automation/run.md — execution log: commands run, strategy output, validation results per step"
  - "experiments/log/2026-03-31-exp-fcd-automation-integration-test.yaml — run record per PROTOCOL.md: hypothesis, result (PASS/FAIL per gate), cost_usd, findings"
  - "Test artifact: .method/strategies/s-fcd-test-canary.yaml — created by commission run, validated as parseable"
acceptance_criteria:
  - "S-FCD-INTEGRATION-TEST executes with status: completed on bridge:test instance → SC-4"
  - "All 10 validation script gates pass (setup through teardown) → SC-4"
  - "s-fcd-test-canary.yaml artifact exists and passes js-yaml parse → SC-4"
  - "validate_review gate: action plan artifact is non-empty GlyphJS markdown (contains ui: or --- frontmatter) → SC-4"
  - "Total cost < $15 USD → oversight rules enforced → SC-4"
  - "Experiment log written to experiments/log/ per PROTOCOL.md"
```

---

## Verification Report

| Gate | Status |
|------|--------|
| Single-domain commissions | PASS — C-1 methodts, C-2 bridge/strategies, C-3 frontend/reports, C-4 frontend/strategies, C-5 .method/strategies, C-6 experiments |
| No wave domain conflicts | PASS — Wave 1: methodts vs frontend/reports (different). Wave 3: frontend/strategies vs .method/strategies (different) |
| DAG acyclic | PASS — Topo order: [C-1,C-3]→[C-2]→[C-4,C-5]→[C-6]. No back-edges. |
| Surfaces enumerated | PASS — All 4 PRD surfaces frozen in Wave 0; no cross-commission dep without named surface |
| Scope complete | PASS — All commissions have allowed_paths + forbidden_paths |
| Criteria traceable | PASS — All commission ACs trace to SC-1 through SC-5 |
| PRD coverage | PASS — SC-1→C-1,C-2,C-5; SC-2→C-3,C-4; SC-3→C-1,C-2,C-4; SC-4→C-6; SC-5→C-5 |
| Task bounds (3-8) | PASS — C-1:6, C-2:5, C-3:4, C-4:5, C-5:4, C-6:3 |
| Wave 0 non-empty | PASS — 4 surface artifacts + gate assertions + verification |
| All consumed ports frozen | PASS — All consumed_ports reference Wave 0 definitions or prior commission outputs |

**Overall: 10/10 gates pass.**

---

## Risk Assessment

**Critical path:** Wave 0 → C-1 → C-2 → C-4 → C-6 (5 sequential steps)
Longest wave: Wave 3 (C-4 and C-5 in parallel, C-4 is larger)

**Risk 1 (HIGH): human_approval gate suspension/resume**
The HumanApprovalResolver async pattern requires the executor to hold a pending Promise
across event bus messages. Incorrect implementation can cause strategy hangs or spurious
completions. Mitigation: C-1 unit tests with mock resolver; C-2 integration test with
real event bus. Gate: both must pass before C-4 (UI) is built on top.

**Risk 2 (MEDIUM): Sub-strategy YAML discovery from within execution**
The SubStrategySource needs to find .method/strategies/*.yaml files by strategy ID
at runtime, while the executor itself is running within the strategies domain.
Initialization order at composition root matters. Mitigation: C-2 wires via the
bridge's existing YAML dir loader — same mechanism as strategy loading at startup.

**Risk 3 (MEDIUM): s-fcd-commission-orch wave cap**
Pre-declaring 15 commission slots (3 waves × 5) with skip guards produces ~200-line YAML.
Readability concern, not a correctness risk. The plan is valid up to 5 commissions/wave.
Flag as known constraint for post-PRD improvement.

**Risk 4 (LOW): Integration test fixture scope**
S-FCD-INTEGRATION-TEST runs S-FCD-COMMISSION-SOLO against task: "create s-fcd-test-canary.yaml."
This is minimal and safe — only modifies .method/strategies/ which is recoverable.
Fixture repos in test-fixtures/bridge-test/ are not involved.

---

## Status Tracker

```
Total: 6 commissions, 4 waves (+ Wave 0)
Completed: 0 / 6

[ ] Wave 0 — orchestrator (type additions, stubs, gate assertions)
[ ] C-1 — methodts/strategy (prompt + strategy node + human_approval gate)
[ ] C-3 — frontend/reports (GlyphReport component)
[ ] C-2 — bridge/strategies (adapter + human approval resolver)
[ ] C-4 — frontend/strategies (gate UI + artifact viewer)
[ ] C-5 — .method/strategies (8 YAML files)
[ ] C-6 — integration test (run + record)
```

---

*Execute with: `/fcd-commission --orchestrate .method/sessions/fcd-plan-20260331-1400-prd044-fcd-automation/realize-plan.md`*
