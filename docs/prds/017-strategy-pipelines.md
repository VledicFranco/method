# PRD 017 — Strategy Pipelines: Methodology DAG Automation

**Status:** Draft
**Date:** 2026-03-16
**Scope:** Phase 1 — Minimal DAG executor, gate framework, print-mode LLM provider, Strategy YAML schema
**Depends on:** PRD 004 (methodology runtime), PRD 005 (bridge), PRD 012 Phase 4 (print-mode sessions)
**Evidence:** Council session 2026-03-16 (12 decisions, 6-member cast), Constellation Engine research, `--print` CLI research
**Vision:** [docs/vision/strategy-pipelines.md](../vision/strategy-pipelines.md) (full idea archive + deferred items)
**Council memory:** `.method/council/memory/strategy-pipelines.yaml` (TOPIC-STRATEGY-PIPELINES)

---

## 1. Purpose and Problem Statement

### Methodology execution is manual and sequential

The methodology runtime (`@method/core`) guides a single agent through a single method's step DAG. Multi-method workflows require a human or orchestrator agent to manually: start a methodology session, evaluate routing, spawn an agent, monitor progress, validate output, transition to the next method, and repeat. This works for 2-3 method sequences but breaks down for complex delivery workflows (PRD sectioning → architecture → planning → parallel implementation → review → PR creation) that should run autonomously.

### The bridge can spawn agents but can't orchestrate workflows

The bridge (`@method/bridge`) manages a pool of PTY sessions and provides channels for visibility. But it has no concept of workflow — it can't execute a sequence of methodology invocations with gates between them, automatically parallelize independent steps, or retry failed steps with feedback. Every orchestration decision requires either a human or a purpose-built orchestrator agent.

### What this PRD delivers

A **Strategy** is an executable DAG that composes methodology invocations, algorithmic gates, and dynamic scripts into an automated workflow. The Strategy executor runs the DAG, handles parallelization, evaluates gates, retries failed steps with feedback, and produces a mandatory retrospective. A Strategy is formally grounded as a higher-order methodology in F1-FTH theory — it integrates with existing governance, retrospectives, MCP tools, and session management.

Phase 1 delivers the core executor, gate framework, LLM provider interface, and Strategy YAML schema. Phase 2+ items (event triggers, LLM review gates, runtime visualization, Constellation port) are documented in the vision doc.

---

## 2. Components

### Component 1: Strategy YAML Schema

A Strategy is defined as a YAML file declaring the DAG topology, node configurations, gates, capabilities, triggers, and oversight rules.

```yaml
strategy:
  id: S-EXAMPLE
  name: "Example Strategy"
  version: "1.0"

  triggers:
    - type: manual
    - type: mcp_tool
      tool: strategy_execute

  context:
    inputs:
      - { name: prd_path, type: string }
      - { name: target_branch, type: string, default: "master" }

  capabilities:
    read_only: [Read, Glob, Grep]
    implementation: [Read, Write, Edit, Bash, Glob, Grep]
    git_ops: ["Bash(git:*)"]
    github_ops: ["mcp__github-personal__*"]
    methodology: ["mcp__method__*"]

  dag:
    nodes:
      - id: section
        type: methodology
        methodology: P2-SD
        method_hint: M7-PRDS
        capabilities: [read_only, methodology]
        inputs: [prd_path]
        outputs: [sections]
        gates:
          - type: algorithmic
            check: "output.sections.length >= 1"
            max_retries: 2

      - id: implement
        type: methodology
        methodology: P2-SD
        method_hint: M1-IMPL
        capabilities: [implementation, git_ops, methodology]
        inputs: [sections]
        outputs: [code_changes]
        depends_on: [section]
        gates:
          - type: algorithmic
            check: "output.test_results.failed === 0"
            max_retries: 3

      - id: merge_results
        type: script
        script: |
          return { summary: inputs.code_changes.map(c => c.branch).join(', ') };
        inputs: [code_changes]
        outputs: [summary]
        depends_on: [implement]

    strategy_gates:
      - id: total_tests
        depends_on: [implement]
        type: algorithmic
        check: "artifacts.test_results.total >= 10"

  oversight:
    rules:
      - { condition: "gate_failures >= 3 on same step", action: escalate_to_human }
      - { condition: "total_cost_usd > 5.00", action: warn_human }
      - { condition: "step_duration_ms > 600000", action: kill_and_requeue }

  outputs:
    - type: channel_event
      target: bridge
```

**Schema location:** Strategy YAML files live in `.method/strategies/` or are passed directly to the executor.

**Validation:** At load time, the executor validates: DAG is acyclic, all `depends_on` references exist, all capability sets are defined, all `method_hint` methods exist in the registry, gate `check` expressions parse.

### Component 2: DAG Executor

A TypeScript DAG execution engine in `@method/bridge` that runs Strategy DAGs.

**Type model** (Constellation-compatible):

```typescript
interface StrategyNode {
  id: string;
  type: 'methodology' | 'gate' | 'script';
  depends_on: string[];
  inputs: string[];
  outputs: string[];
  config: MethodologyNodeConfig | GateNodeConfig | ScriptNodeConfig;
}

interface StrategyDAG {
  id: string;
  name: string;
  nodes: StrategyNode[];
  strategy_gates: StrategyGateNode[];
  capabilities: Record<string, string[]>;
  oversight: OversightRules;
}

interface ExecutionState {
  dag: StrategyDAG;
  node_status: Map<string, 'pending' | 'running' | 'completed' | 'failed' | 'suspended'>;
  artifacts: ArtifactStore;
  context: StrategyContext;
  gate_results: GateResult[];
  side_reports: SideReport[];
  cost_usd: number;
  started_at: string;
}
```

**Execution algorithm:**

1. Topological sort all nodes
2. Group by dependency level (nodes at the same level have no mutual dependencies)
3. For each level, execute all nodes in parallel:
   - **Methodology nodes:** invoke `LlmProvider.execute()` with the method step prompt, context, artifacts, and capability restrictions
   - **Gate nodes:** evaluate the gate function against artifacts
   - **Script nodes:** execute the script with artifact inputs
4. After each node completes, run its step gates (if any)
5. If a step gate fails and retries remain: requeue the node with gate failure feedback
6. If a step gate fails and no retries: escalate per oversight rules
7. After all levels complete, run strategy gates
8. Generate mandatory retrospective

**Parallelization:** Nodes at the same dependency level run concurrently. The executor uses `Promise.allSettled()` for parallel execution, so one node's failure doesn't abort siblings.

**Context passing:** Each node receives an `ArtifactBundle` assembled from the `outputs` of its `depends_on` nodes. Artifacts are immutable — each node produces new versions, never mutates existing ones.

### Component 3: Gate Framework

```typescript
interface Gate {
  type: 'algorithmic' | 'observation' | 'human_approval';
  check: string;           // Expression evaluated against output/artifacts
  max_retries: number;     // Default: 3 for algorithmic, 2 for observation, 0 for human
  timeout_ms: number;      // Default: 5000
}

interface GateContext {
  step_output: Record<string, unknown>;
  artifacts: ArtifactStore;
  strategy_context: StrategyContext;
  execution_metadata: {
    num_turns: number;
    cost_usd: number;
    tool_call_count: number;
    duration_ms: number;
  };
}

interface GateResult {
  gate_id: string;
  passed: boolean;
  reason: string;
  feedback?: string;       // Injected into retry prompt
}
```

**Gate types (Phase 1):**

| Type | Mechanism | Requeue? |
|------|-----------|----------|
| **Algorithmic** | Expression evaluated against artifacts (tests pass, schema validates, file exists) | Auto-requeue up to `max_retries` with failure reason as feedback |
| **Observation** | Check execution metadata (agent made > 0 tool calls, no permission stalls, cost < budget) | Auto-requeue up to `max_retries` |
| **Human-approval** | Suspend execution, emit event to channel, resume on human response | Suspend (no auto-requeue) |

**Expression evaluation:** Gate `check` strings are evaluated as JavaScript expressions with `output` and `artifacts` in scope. Sandboxed via `new Function()` with a frozen context object — no access to `require`, `process`, `fs`, or globals.

**Retry with feedback:** When a gate fails and retries remain, the retry prompt includes:
```
GATE FAILURE — Retry {N}/{max_retries}
Gate: {gate.check}
Result: FAILED — {gate_result.reason}
Previous attempt feedback: {gate_result.feedback}
Please address the gate failure and try again.
```

### Component 4: LLM Provider Interface

```typescript
interface LlmProvider {
  execute(request: LlmRequest): Promise<LlmResponse>;
  stream(request: LlmRequest): AsyncIterable<LlmStreamEvent>;
  readonly capabilities: {
    resume: boolean;
    budget_cap: boolean;
    tool_filtering: boolean;
    structured_output: boolean;
    session_fork: boolean;
  };
}

interface LlmRequest {
  prompt: string;
  session_id?: string;
  system_prompt_append?: string;
  allowed_tools?: string[];
  max_budget_usd?: number;
  model?: string;
}

interface LlmResponse {
  result: string;
  session_id: string;
  usage: { input_tokens: number; output_tokens: number; cache_read_tokens: number };
  cost_usd: number;
  num_turns: number;
  duration_ms: number;
  permission_denials: Array<{ tool_name: string }>;
}
```

**First implementation:** `ClaudeCodeProvider` wrapping `claude --print --output-format json --resume <session_id> --permission-mode bypassPermissions`. Maps `LlmRequest` fields to CLI flags. Parses JSON result into `LlmResponse`.

**Streaming:** `ClaudeCodeProvider.stream()` uses `--output-format stream-json --verbose --include-partial-messages`, emitting events to the session's progress channel for real-time observability.

### Component 5: Artifact Store

```typescript
interface ArtifactVersion {
  artifact_id: string;
  version: number;
  content: unknown;
  producer_node_id: string;
  timestamp: string;
}

interface ArtifactStore {
  get(artifact_id: string): ArtifactVersion | null;          // Latest version
  getVersion(artifact_id: string, version: number): ArtifactVersion | null;
  put(artifact_id: string, content: unknown, producer: string): ArtifactVersion;
  snapshot(): ArtifactBundle;   // Read-only snapshot for passing to nodes
  history(artifact_id: string): ArtifactVersion[];
}
```

Artifacts are immutable — `put()` creates a new version, never overwrites. The store is in-memory for Phase 1 (persists for the Strategy execution lifetime). The `snapshot()` method returns a frozen copy for node consumption.

### Component 6: MCP Tool + HTTP Endpoint

**MCP tool:** `strategy_execute` — starts a Strategy execution.

```typescript
{
  strategy_path: string;        // Path to Strategy YAML
  context_inputs: Record<string, unknown>;  // Values for strategy.context.inputs
  session_id?: string;          // Optional methodology session correlation
}
```

**HTTP endpoint:** `POST /strategies/execute` — same parameters, returns execution ID.

**Status endpoint:** `GET /strategies/:id/status` — returns `ExecutionState` snapshot (node statuses, artifacts, cost, gate results).

### Component 7: Mandatory Retrospective

After Strategy execution completes (all nodes done, or aborted), the executor generates a retro at `.method/retros/retro-strategy-YYYY-MM-DD-NNN.yaml`:

```yaml
retro:
  strategy_id: S-EXAMPLE
  generated_by: strategy-executor
  generated_at: "2026-03-16T14:30:00Z"

  timing:
    started_at: "2026-03-16T14:00:00Z"
    completed_at: "2026-03-16T14:30:00Z"
    duration_minutes: 30
    critical_path: [section, implement, merge_results]  # Longest dependency chain

  execution_summary:
    nodes_total: 3
    nodes_completed: 3
    nodes_failed: 0
    parallelization_efficiency: 0.85  # actual_time / sequential_time

  cost:
    total_usd: 1.24
    per_node:
      - { node: section, cost_usd: 0.18 }
      - { node: implement, cost_usd: 1.02 }
      - { node: merge_results, cost_usd: 0.04 }

  gates:
    total: 3
    passed: 3
    failed_then_passed: 1  # Retried and succeeded
    failed_final: 0
    retries:
      - { node: implement, gate: "test_results.failed === 0", attempts: 2, final: passed }

  side_reports:
    - { node: implement, report: "Large file required splitting into 3 smaller files" }

  artifacts_produced:
    - { id: sections, producer: section }
    - { id: code_changes, producer: implement }
    - { id: summary, producer: merge_results }
```

---

## 3. Implementation Order

### Phase 1a: Foundation (LLM Provider + Artifact Store)

**Deliverables:**
- `LlmProvider` interface and `ClaudeCodeProvider` implementation in `packages/bridge/src/strategy/`
- `ArtifactStore` with immutable versioning
- Unit tests: provider wraps `claude --print` correctly, artifact versioning works

**Why first:** Everything else depends on being able to invoke LLM steps and pass typed data between them.

### Phase 1b: Gate Framework

**Deliverables:**
- `Gate` interface with three types (algorithmic, observation, human-approval)
- Expression evaluator (sandboxed `new Function()`)
- Retry-with-feedback mechanism
- Unit tests: gate evaluation, retry logic, expression sandboxing

**Why second:** Gates are the reliability layer. Without them, the executor is just a task runner.

### Phase 1c: DAG Executor

**Deliverables:**
- Strategy YAML parser and validator (acyclicity, reference integrity)
- `StrategyExecutor` with topological sort, parallel level execution, gate integration
- Context and artifact passing between nodes
- Oversight rule evaluation
- Integration test: 3-node Strategy (methodology → gate → script) runs end-to-end

**Why third:** Depends on both the provider (to invoke nodes) and gates (to validate outputs).

### Phase 1d: MCP Tool + Retro + Dashboard

**Deliverables:**
- `strategy_execute` MCP tool and `POST /strategies/execute` HTTP endpoint
- `GET /strategies/:id/status` endpoint
- Mandatory retrospective generation
- Static DAG visualization in dashboard (from Strategy YAML)
- `.method/strategies/` directory for Strategy definitions

**Why last:** Integration layer that connects the executor to the rest of the system.

---

## 4. Success Criteria

1. **Strategy executes end-to-end:** A 3-node Strategy (section → implement → create_pr) completes autonomously with zero human intervention
2. **Gates catch failures:** When an agent produces output that fails a gate, the step is automatically requeued with failure feedback and the retry succeeds
3. **Parallelization works:** Two independent nodes in the same Strategy execute concurrently (wall time < sum of individual times)
4. **Artifacts flow correctly:** Each node receives only the artifacts from its declared dependencies, not all artifacts
5. **Cost tracking:** Strategy execution reports total cost in USD, per-node breakdown, and token usage
6. **Retro generated:** Every Strategy execution produces a retrospective at `.method/retros/` with timing, cost, gate results, and side reports
7. **Provider interface works:** `ClaudeCodeProvider` wraps `claude --print` and returns structured `LlmResponse` with all metadata fields populated
8. **No regression:** Existing bridge functionality (PTY sessions, channels, dashboard) unaffected

---

## 5. Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `STRATEGY_ENABLED` | `true` | Master switch for Strategy execution |
| `STRATEGY_MAX_PARALLEL` | `3` | Max concurrent nodes per Strategy execution |
| `STRATEGY_DEFAULT_GATE_RETRIES` | `3` | Default max retries for algorithmic gates |
| `STRATEGY_DEFAULT_TIMEOUT_MS` | `600000` | Default per-node timeout (10 min) |
| `STRATEGY_DEFAULT_BUDGET_USD` | *(none)* | Default per-node cost cap |
| `STRATEGY_RETRO_DIR` | `.method/retros` | Directory for Strategy retrospectives |

---

## 6. Out of Scope (Phase 1)

All deferred items are documented in [docs/vision/strategy-pipelines.md](../vision/strategy-pipelines.md) with rationale and target phase.

- **Event triggers** (webhooks, filesystem, cron) — Phase 2
- **LLM-review and dual-confirm gates** — Phase 2
- **Runtime DAG visualization** — Phase 2
- **Dynamic tool discovery** — Phase 2
- **LLM oversight council** — Phase 2
- **Suspension/resumption** — Phase 2
- **Sub-strategy composition** — Phase 3+
- **Constellation Engine port** — Phase 3
- **OS-level sandboxing** — Future
- **Strategy definition language** (beyond YAML) — Future

---

## 7. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Gate expression injection** — malicious or buggy `check` expressions access globals | LOW | HIGH | Sandboxed via `new Function()` with frozen context. No `require`, `process`, `fs` in scope. Expression timeout of 5s. |
| **Parallel node contention** — two nodes modify the same files | MEDIUM | MEDIUM | Artifact immutability prevents data conflicts. File-level conflicts handled by worktree isolation (PRD 006) per methodology node. |
| **Print-mode process overhead** — spawning `claude` process per step adds 1-2s | MEDIUM | LOW | Acceptable for methodology steps that take minutes. Strategy-level overhead is ~5-10s for a 5-node DAG. |
| **Runaway cost** — no `--max-turns` in print mode | MEDIUM | MEDIUM | `--max-budget-usd` caps per-node cost. Oversight rules cap Strategy-level cost. Bridge can externally kill processes. |
| **Context overflow on retry** — retry prompts accumulate, exceeding context window | LOW | MEDIUM | `--resume` with `--fork-session` can branch to fresh context. Gate feedback is limited to 500 chars. Max 3 retries caps accumulation. |
| **DAG complexity** — Strategies with 15+ nodes are hard to debug | MEDIUM | LOW | Static visualization helps. Retro provides per-node breakdown. Phase 2 runtime visualization addresses this fully. |

---

## 8. Relationship to Existing PRDs

| PRD | Relationship |
|-----|-------------|
| **PRD 004** (Methodology Runtime) | Strategy executor uses the methodology runtime for method loading, step advancement, and routing evaluation within each methodology node. |
| **PRD 005** (Bridge) | Strategy executor lives in `@method/bridge`. Uses existing session management, channel infrastructure, and dashboard. |
| **PRD 008** (Agent Visibility) | Strategy execution emits progress and events to bridge channels. Strategy gates and node completions appear in the event feed. |
| **PRD 010** (PTY Auto-Detection) | Not used for print-mode sessions. PTY watcher remains for any PTY-mode admin sessions. |
| **PRD 012** (Session Reliability) | Phase 4 (print-mode sessions) is a prerequisite. Strategy execution uses the `ClaudeCodeProvider` wrapping `claude --print`. Adaptive settle and diagnostics apply to PTY sessions only. |
| **PRD 014** (Scope Enforcement) | Strategy capability model (`--allowedTools`) is the Phase 1 enforcement. PRD 014's `allowed_paths` + pre-commit hooks provide additional file-level enforcement per worktree session. |

### Architectural Note

The Strategy executor is a new module in `@method/bridge` at `packages/bridge/src/strategy/`. It does NOT touch `@method/core` (DR-03 — no transport deps in core). The methodology runtime is invoked via the existing core API (`loadMethodology`, `startMethodologySession`, etc.) from within the executor. The LLM provider interface abstracts the Claude CLI — future providers (Claude API, other LLMs) implement the same interface.
