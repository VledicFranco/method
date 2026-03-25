# Realization Plan: PRD 027 — Pacta Modular Agent SDK

## FCA Partition Map

```
Packages (independent — can be commissioned separately):
  @method/pacta              → existing L3 library: types, engine, middleware, strategies
    src/budget/              → budget contract types (exists)
    src/modes/               → execution mode types (exists)
    src/output/              → output contract types (exists)
    src/ports/               → port interfaces (exists, AgentProvider)
    src/reasoning/           → reasoning strategy factories (NEW — Phase 3a)
    src/context/             → context management ports + impls (NEW — Phase 3b)
    src/agents/              → pre-assembled reference agents (NEW — Phase 4)
  @method/pacta-testkit      → NEW L3: RecordingProvider, builders, assertions
  @method/pacta-provider-claude-cli → NEW L3: Claude CLI AgentProvider impl
  @method/pacta-playground   → NEW L3: simulated eval environment
  @method/pacta-provider-anthropic  → NEW L3: Anthropic API AgentProvider impl
  @method/bridge             → existing L4: integration target (Phase 5)

Shared surfaces (orchestrator-owned — never modified by sub-agents):
  packages/pacta/src/index.ts           → barrel exports
  packages/pacta/package.json           → dependency declarations
  packages/*/package.json               → new package scaffolds
  packages/*/tsconfig.json              → build configuration
  tsconfig.json (root)                  → project references

Layer stack:
  L4 bridge → L3 pacta, pacta-testkit, pacta-playground, pacta-provider-*, mcp → L2 methodts
```

**Dependency graph (from PRD):**
```
pacta-playground ──→ pacta-testkit ──→ pacta
pacta-provider-* ──→ pacta
bridge ──→ pacta, pacta-provider-*
```

**FCA guarantee:** Each commission targets a distinct package or a disjoint sub-directory within
a package. Cross-package communication is through published types (barrel exports), which the
orchestrator manages. No domain imports another domain.

**Note on intra-package parallelism (Wave 2):** C-5 (`src/reasoning/`) and C-6 (`src/context/`)
are both within `@method/pacta` but touch strictly disjoint file sets. Neither imports the other.
The only shared file (`src/index.ts`) is orchestrator-owned. This is safe to parallelize.

---

## Commissions

| ID | Phase | Domain/Package | Title | Depends On | Status |
|----|-------|---------------|-------|------------|--------|
| C-1 | 1 | @method/pacta core | Types + createAgent engine + middleware + gate tests | — | pending |
| C-2 | 1 | @method/pacta-testkit | RecordingProvider, builders, assertions | C-1 | pending |
| C-3 | 1 | @method/pacta-provider-claude-cli | Claude CLI provider + simpleCodeAgent | C-1 | pending |
| C-4 | 2 | @method/pacta-playground | Scenario runner, virtual FS, eval reports | C-1, C-2 | pending |
| C-5 | 3a | @method/pacta src/reasoning/ | Reasoning strategy factories | C-1 | pending |
| C-6 | 3b | @method/pacta src/context/ | Context management implementations | C-1 | pending |
| C-7 | 4 | @method/pacta-provider-anthropic | Anthropic Messages API provider | C-1 | pending |
| C-8 | 4 | @method/pacta src/agents/ | Reference agents + .with() pattern | C-5, C-6, C-3 | pending |
| C-9 | 5 | @method/bridge | Bridge integration spike | C-8 | pending |

---

## Commission Cards

```yaml
- id: C-1
  phase: 1
  title: "Pacta core — complete type surface + createAgent engine + middleware"
  domain: "@method/pacta (packages/pacta/)"
  scope:
    allowed_paths:
      - "packages/pacta/src/pact.ts"
      - "packages/pacta/src/scope.ts"
      - "packages/pacta/src/events.ts"
      - "packages/pacta/src/budget/**"
      - "packages/pacta/src/modes/**"
      - "packages/pacta/src/output/**"
      - "packages/pacta/src/ports/**"
      - "packages/pacta/src/engine/**"
      - "packages/pacta/src/middleware/**"
      - "packages/pacta/src/gates/**"
      - "packages/pacta/src/**/*.test.ts"
    forbidden_paths:
      - "packages/pacta/src/index.ts"
      - "packages/pacta/src/reasoning/**"
      - "packages/pacta/src/context/**"
      - "packages/pacta/src/agents/**"
      - "packages/pacta/package.json"
      - "packages/pacta/tsconfig.json"
  depends_on: []
  parallel_with: []
  deliverables:
    - "ContextPolicy type (src/context-policy.ts or similar)"
    - "ReasoningPolicy type (src/reasoning-policy.ts or similar)"
    - "ToolProvider port interface (src/ports/tool-provider.ts)"
    - "MemoryPort interface (src/ports/memory-port.ts)"
    - "createAgent() composition function (src/engine/create-agent.ts)"
    - "Budget enforcer middleware (src/middleware/budget-enforcer.ts)"
    - "Output validator middleware (src/middleware/output-validator.ts)"
    - "Gate tests: G-PORT (zero runtime deps), G-BOUNDARY, G-LAYER (src/gates/)"
    - "Unit tests for engine + middleware"
  acceptance_criteria:
    - "createAgent({ provider, pact }) compiles and returns an agent with invoke() method"
    - "Budget enforcer stops execution when budget.maxTurns exceeded"
    - "Output validator retries on schema mismatch (up to maxRetries)"
    - "G-PORT: pacta has zero runtime dependencies (only devDependencies)"
    - "G-BOUNDARY: no cross-domain imports within pacta"
    - "All unit tests pass"
    - "npm run build succeeds with pacta changes"
  estimated_tasks: 8
  branch: "feat/prd-027-c1-pacta-core"
  status: pending

- id: C-2
  phase: 1
  title: "Pacta testkit — RecordingProvider, builders, assertions"
  domain: "@method/pacta-testkit (packages/pacta-testkit/) — NEW PACKAGE"
  scope:
    allowed_paths:
      - "packages/pacta-testkit/src/**"
    forbidden_paths:
      - "packages/pacta-testkit/package.json"
      - "packages/pacta-testkit/tsconfig.json"
      - "packages/pacta/src/**"
      - "packages/bridge/**"
  depends_on: [C-1]
  parallel_with: [C-3, C-5, C-6]
  deliverables:
    - "RecordingProvider — implements AgentProvider, records all interactions"
    - "MockToolProvider — returns scripted tool results"
    - "pactBuilder() — fluent builder with sensible defaults"
    - "agentRequestBuilder() — test request construction"
    - "Assertion helpers: assertToolsCalled(), assertBudgetUnder(), assertOutputMatches()"
    - "Unit tests for all testkit components"
  acceptance_criteria:
    - "RecordingProvider captures tool calls, token usage, cost per turn, reasoning traces"
    - "pactBuilder().withBudget({ maxTurns: 5 }).build() produces valid Pact"
    - "assertToolsCalled(recording, ['Read', 'Grep']) passes/fails correctly"
    - "All testkit tests pass"
    - "npm run build succeeds"
  estimated_tasks: 5
  branch: "feat/prd-027-c2-pacta-testkit"
  status: pending

- id: C-3
  phase: 1
  title: "Claude CLI provider — AgentProvider for Claude Code CLI"
  domain: "@method/pacta-provider-claude-cli (packages/pacta-provider-claude-cli/) — NEW PACKAGE"
  scope:
    allowed_paths:
      - "packages/pacta-provider-claude-cli/src/**"
    forbidden_paths:
      - "packages/pacta-provider-claude-cli/package.json"
      - "packages/pacta-provider-claude-cli/tsconfig.json"
      - "packages/pacta/src/**"
      - "packages/bridge/**"
  depends_on: [C-1]
  parallel_with: [C-2, C-5, C-6]
  deliverables:
    - "claudeCliProvider() — AgentProvider impl using claude --print/--resume"
    - "Mode mapping: oneshot → --print, resumable → --resume"
    - "Capabilities declaration (modes, streaming, budget enforcement)"
    - "simpleCodeAgent — reference agent as integration test + Tier 1 on-ramp"
    - "Unit tests with mocked CLI execution"
  acceptance_criteria:
    - "claudeCliProvider() returns valid AgentProvider with correct capabilities()"
    - "invoke() shells out to claude --print and parses response"
    - "simpleCodeAgent can be imported and has invoke() method"
    - "All tests pass"
    - "npm run build succeeds"
  estimated_tasks: 5
  branch: "feat/prd-027-c3-claude-cli-provider"
  status: pending

- id: C-4
  phase: 2
  title: "Pacta playground — simulated agent evaluation environment"
  domain: "@method/pacta-playground (packages/pacta-playground/) — NEW PACKAGE"
  scope:
    allowed_paths:
      - "packages/pacta-playground/src/**"
    forbidden_paths:
      - "packages/pacta-playground/package.json"
      - "packages/pacta-playground/tsconfig.json"
      - "packages/pacta/src/**"
      - "packages/pacta-testkit/src/**"
  depends_on: [C-1, C-2]
  parallel_with: [C-7]
  deliverables:
    - "FidelityLevel type — compile-time tier enforcement"
    - "VirtualToolProvider — ToolProvider backed by memfs (Tier 3)"
    - "ScriptedToolProvider — rule-based tool responses (Tier 2)"
    - "Scenario runner: given FS state + tools + prompt → run agent → collect results"
    - "Comparative runner: same scenario, two configs, diff behavior"
    - "EvalReport type definition (measurement logic deferred)"
    - "Declarative scenario format (scenario().given().when().then())"
    - "Unit tests for providers + runner"
  acceptance_criteria:
    - "A scenario runs an agent against VirtualToolProvider and produces EvalReport"
    - "ScriptedToolProvider returns scripted results matching input patterns"
    - "Comparative runner diffs two agent configs on the same scenario"
    - "FidelityLevel prevents Tier 2 operations in Tier 3 context at compile time"
    - "All tests pass, npm run build succeeds"
  estimated_tasks: 7
  branch: "feat/prd-027-c4-playground"
  status: pending

- id: C-5
  phase: 3a
  title: "Reasoning strategy factories"
  domain: "@method/pacta src/reasoning/ (sub-directory)"
  scope:
    allowed_paths:
      - "packages/pacta/src/reasoning/**"
    forbidden_paths:
      - "packages/pacta/src/index.ts"
      - "packages/pacta/src/context/**"
      - "packages/pacta/src/agents/**"
      - "packages/pacta/src/engine/**"
      - "packages/pacta/src/middleware/**"
      - "packages/pacta/package.json"
  depends_on: [C-1]
  parallel_with: [C-2, C-3, C-6]
  deliverables:
    - "reactReasoner() — ReAct-style think-act-observe loop"
    - "Think tool implementation (zero-side-effect scratchpad)"
    - "Plan-between-actions system prompt injection"
    - "reflexionReasoner() — multi-trial with verbal self-critique"
    - "Few-shot example injection"
    - "Effort level mapping to provider-specific controls"
    - "Unit tests for each strategy"
  acceptance_criteria:
    - "reactReasoner({ thinkTool: true }) returns middleware that injects think tool"
    - "reflexionReasoner({ maxTrials: 3 }) returns middleware with retry logic"
    - "Effort mapping translates 'low'/'medium'/'high' to provider params"
    - "All tests pass"
  estimated_tasks: 6
  branch: "feat/prd-027-c5-reasoning"
  status: pending

- id: C-6
  phase: 3b
  title: "Context management implementations"
  domain: "@method/pacta src/context/ (sub-directory)"
  scope:
    allowed_paths:
      - "packages/pacta/src/context/**"
    forbidden_paths:
      - "packages/pacta/src/index.ts"
      - "packages/pacta/src/reasoning/**"
      - "packages/pacta/src/agents/**"
      - "packages/pacta/src/engine/**"
      - "packages/pacta/src/middleware/**"
      - "packages/pacta/package.json"
  depends_on: [C-1]
  parallel_with: [C-2, C-3, C-5]
  deliverables:
    - "compactionManager() — configurable threshold + custom instructions"
    - "noteTakingManager() — MemoryPort-backed retrieval"
    - "subagentDelegator() — fresh context windows with summary extraction"
    - "System prompt budget tracking"
    - "Unit tests for each manager"
  acceptance_criteria:
    - "compactionManager({ threshold: 0.8 }) returns context middleware"
    - "noteTakingManager({ memory }) stores/retrieves notes via MemoryPort"
    - "subagentDelegator({ summaryTokens: 500 }) returns delegation middleware"
    - "All tests pass"
  estimated_tasks: 5
  branch: "feat/prd-027-c6-context"
  status: pending

- id: C-7
  phase: 4
  title: "Anthropic API provider"
  domain: "@method/pacta-provider-anthropic (packages/pacta-provider-anthropic/) — NEW PACKAGE"
  scope:
    allowed_paths:
      - "packages/pacta-provider-anthropic/src/**"
    forbidden_paths:
      - "packages/pacta-provider-anthropic/package.json"
      - "packages/pacta-provider-anthropic/tsconfig.json"
      - "packages/pacta/src/**"
  depends_on: [C-1]
  parallel_with: [C-4, C-8]
  deliverables:
    - "anthropicProvider() — AgentProvider impl for Messages API"
    - "Streaming support (Streamable interface)"
    - "Tool use integration"
    - "Prompt caching integration"
    - "Port interface validated with two real implementations (CLI + API)"
    - "Unit tests with mocked API responses"
  acceptance_criteria:
    - "anthropicProvider() returns valid AgentProvider with correct capabilities()"
    - "invoke() calls Messages API and returns AgentResult"
    - "Streaming emits AgentEvent objects"
    - "Same Pact works with both claudeCliProvider and anthropicProvider"
    - "All tests pass, npm run build succeeds"
  estimated_tasks: 5
  branch: "feat/prd-027-c7-anthropic-provider"
  status: pending

- id: C-8
  phase: 4
  title: "Reference agents + .with() customization"
  domain: "@method/pacta src/agents/ (sub-directory)"
  scope:
    allowed_paths:
      - "packages/pacta/src/agents/**"
    forbidden_paths:
      - "packages/pacta/src/index.ts"
      - "packages/pacta/src/reasoning/**"
      - "packages/pacta/src/context/**"
      - "packages/pacta/src/engine/**"
      - "packages/pacta/package.json"
  depends_on: [C-5, C-6, C-3]
  parallel_with: [C-4, C-7]
  deliverables:
    - "codeAgent — pre-assembled coding agent"
    - "researchAgent — pre-assembled research agent"
    - "reviewAgent — pre-assembled code review agent"
    - ".with(overrides) pattern for Tier 1→2 customization"
    - "Unit tests for each reference agent"
  acceptance_criteria:
    - "codeAgent.invoke({ prompt, workdir }) works with default provider"
    - "researchAgent.with({ budget: { maxTurns: 10 } }) returns customized agent"
    - ".with() merges overrides without mutating the original"
    - "All tests pass"
  estimated_tasks: 4
  branch: "feat/prd-027-c8-reference-agents"
  status: pending

- id: C-9
  phase: 5
  title: "Bridge integration spike"
  domain: "@method/bridge (packages/bridge/)"
  scope:
    allowed_paths:
      - "packages/bridge/src/domains/sessions/**"
      - "packages/bridge/src/domains/strategies/**"
    forbidden_paths:
      - "packages/bridge/src/ports/**"
      - "packages/bridge/src/shared/**"
      - "packages/bridge/src/server-entry.ts"
      - "packages/pacta/**"
  depends_on: [C-8]
  parallel_with: []
  deliverables:
    - "Integration spike: validate Pacta-bridge boundary"
    - "One session path uses Pacta agent instead of direct PTY"
    - "Strategy pipeline pact configuration"
    - "Documentation of integration surface for full migration"
  acceptance_criteria:
    - "At least one bridge session path creates and invokes a Pacta agent"
    - "Existing bridge tests still pass (no regression)"
    - "Spike documents integration surface for remaining migration"
    - "npm run build && npm test pass"
  estimated_tasks: 5
  branch: "feat/prd-027-c9-bridge-integration"
  status: pending
```

---

## Shared Surface Changes

| Wave | File | Change | Reason |
|------|------|--------|--------|
| pre-2 | `packages/pacta/src/index.ts` | Re-export new types from C-1 (ContextPolicy, ReasoningPolicy, ToolProvider, MemoryPort, createAgent, middleware) | Wave 2 commissions consume these types |
| pre-2 | `packages/pacta-testkit/package.json` | Scaffold new package with @method/pacta dependency | C-2 needs package shell |
| pre-2 | `packages/pacta-testkit/tsconfig.json` | TypeScript config with project reference to pacta | C-2 needs build config |
| pre-2 | `packages/pacta-testkit/src/index.ts` | Empty barrel export | C-2 fills this in |
| pre-2 | `packages/pacta-provider-claude-cli/package.json` | Scaffold new package with @method/pacta dependency | C-3 needs package shell |
| pre-2 | `packages/pacta-provider-claude-cli/tsconfig.json` | TypeScript config with project reference to pacta | C-3 needs build config |
| pre-2 | `packages/pacta-provider-claude-cli/src/index.ts` | Empty barrel export | C-3 fills this in |
| pre-2 | `tsconfig.json` (root) | Add project references for new packages | Build system needs references |
| pre-3 | `packages/pacta/src/index.ts` | Re-export reasoning/ and context/ from C-5, C-6 | Wave 3 consumers need these |
| pre-3 | `packages/pacta-playground/package.json` | Scaffold new package with pacta + pacta-testkit deps | C-4 needs package shell |
| pre-3 | `packages/pacta-playground/tsconfig.json` | TypeScript config | C-4 needs build config |
| pre-3 | `packages/pacta-playground/src/index.ts` | Empty barrel export | C-4 fills this in |
| pre-3 | `packages/pacta-provider-anthropic/package.json` | Scaffold new package | C-7 needs package shell |
| pre-3 | `packages/pacta-provider-anthropic/tsconfig.json` | TypeScript config | C-7 needs build config |
| pre-3 | `packages/pacta-provider-anthropic/src/index.ts` | Empty barrel export | C-7 fills this in |
| pre-4 | `packages/pacta/src/index.ts` | Re-export agents/ from C-8 | Bridge integration needs reference agents |

---

## Execution Order

```
Wave 1: C-1 (pacta core)
  Solo — foundation for everything. All types, engine, middleware, gate tests.

  → orchestrator: scaffold pacta-testkit + pacta-provider-claude-cli packages
  → orchestrator: update pacta barrel exports for new types from C-1

Wave 2 (parallel): C-2, C-3, C-5, C-6
  C-2: pacta-testkit (new package)
  C-3: pacta-provider-claude-cli (new package)
  C-5: pacta/src/reasoning/ (disjoint sub-dir)
  C-6: pacta/src/context/ (disjoint sub-dir)
  All depend only on C-1 (done). All touch different packages/directories.

  → orchestrator: scaffold pacta-playground + pacta-provider-anthropic packages
  → orchestrator: update pacta barrel exports for reasoning/ + context/

Wave 3 (parallel): C-4, C-7, C-8
  C-4: pacta-playground (new package, needs C-2 testkit)
  C-7: pacta-provider-anthropic (new package, needs C-1 types)
  C-8: pacta/src/agents/ (needs C-5 reasoning + C-6 context + C-3 provider)
  All touch different packages/directories.

  → orchestrator: update pacta barrel exports for agents/

Wave 4: C-9 (bridge integration)
  Solo — modifies bridge sessions/strategies domains.
  Depends on C-8 (reference agents available).
```

---

## Acceptance Gates

| # | Criterion (from PRD Success Criteria) | Verification | Commissions | Status |
|---|---------------------------------------|-------------|-------------|--------|
| 1 | Agent assembled from independent, typed parts | `createAgent({ provider, reasoning, context, output, pact })` compiles and runs | C-1, C-5, C-6 | pending |
| 2 | Same agent works with two providers | Same Pact + same test with claudeCliProvider and anthropicProvider | C-3, C-7 | pending |
| 3 | Reasoning policies improve behavior | Playground scenario: with/without think tool produces different tool sequences | C-5, C-4 | pending |
| 4 | Context policies prevent context rot | Playground scenario: compaction triggers on long-running task | C-6, C-4 | pending |
| 5 | Budget enforcement stops/warns | Unit test: budget enforcer fires budget_exhausted after maxTurns | C-1 | pending |
| 6 | Output validation retries on mismatch | Unit test: output validator retries with verbal feedback | C-1 | pending |
| 7 | Reference agents work out of the box | `codeAgent.invoke({ prompt, workdir })` returns result | C-8 | pending |
| 8 | All events typed through single vocabulary | AgentEvent union type covers all lifecycle events | C-1 | pending |
| 9 | Zero transport deps in core | G-PORT gate test: pacta package.json has no runtime deps | C-1 | pending |
| 10 | FCA gates pass | G-PORT + G-BOUNDARY + G-LAYER all green | C-1 | pending |
| 11 | Testkit ships with Phase 1 | RecordingProvider, builders, assertions importable from @method/pacta-testkit | C-2 | pending |
| 12 | Playground scenarios run against virtual FS | Scenario + VirtualToolProvider produces EvalReport | C-4 | pending |

---

## Status Tracker

```
Total: 9 commissions, 4 waves
Completed: 9 / 9 ✓ — PRD REALIZED
Current wave: DONE
Blocked: —
Failed: —

PRs:
  C-1: PR #58 — merged ✓ (54 tests)
  C-2: PR #59 — merged ✓ (37 tests)
  C-3: PR #62 — merged ✓ (21 tests)
  C-4: PR #65 — merged ✓ (41 tests)
  C-5: PR #60 — merged ✓ (30 tests)
  C-6: PR #61 — merged ✓ (16 tests)
  C-7: PR #64 — merged ✓ (27 tests)
  C-8: PR #63 — merged ✓ (11 tests)
  C-9: PR #66 — merged ✓ (29 tests)
```
