---
guide: 16
title: "Strategy Pipelines"
domain: strategy
audience: [delivery-teams]
summary: >-
  Automated DAG workflows that compose methodology invocations, gates, and scripts with event triggers.
prereqs: [1, 2, 10]
touches:
  - packages/bridge/src/domains/strategies/
  - packages/bridge/src/domains/triggers/
  - .method/strategies/
---

# Guide 16 — Strategy Pipelines: Automated Methodology DAG Execution

How to define and run Strategy Pipelines — automated DAG workflows that compose methodology invocations, algorithmic gates, and scripts into repeatable pipelines that fire on project events.

## The Problem This Solves

The bridge (Guide 10) lets an orchestrator spawn sub-agents and coordinate multi-method sessions manually. But many workflows are repeatable: section a PRD, implement each section, review, create a PR. Without Strategy Pipelines, a human or orchestrator agent must manually start each step, evaluate success, retry on failure, and track costs. Every run is bespoke.

Strategy Pipelines make these workflows **declarative and automatic**. You define the DAG in YAML, declare gates for quality, and the executor runs it — parallelizing independent steps, retrying on gate failures, and producing a mandatory retrospective. With event triggers, pipelines fire automatically on git commits, file changes, schedules, or webhooks.

## Quickstart: Your First Automated Strategy

**Goal:** Set up a file-watch trigger that auto-fires a strategy when a file changes.

### 1. Write the strategy YAML

Create `.method/strategies/hello-automation.yaml`:

```yaml
strategy:
  id: S-HELLO-AUTO
  name: "Hello Automation"
  version: "1.0"

  triggers:
    - type: manual
    - type: file_watch
      paths: ["tmp/trigger-test/*.txt"]
      events: [create, modify]
      debounce_ms: 3000
      debounce_strategy: trailing

  context:
    inputs:
      - { name: trigger_event, type: object }

  capabilities:
    read_only: [Read, Glob, Grep]

  dag:
    nodes:
      - id: summarize
        type: methodology
        methodology: P2-SD
        method_hint: M3-TMP
        capabilities: [read_only]
        inputs: [trigger_event]
        outputs: [summary]
        gates:
          - type: algorithmic
            check: "output.result !== undefined"
            max_retries: 1

  oversight:
    rules:
      - { condition: "total_cost_usd > 1.00", action: warn_human }
      - { condition: "total_cost_usd > 5.00", action: escalate_to_human }
```

> **Important:** Set `STRATEGY_DEFAULT_BUDGET_USD` to a safe cap (e.g., `5`) when running automated triggers. Without it, there is no budget limit.

### 2. Start the bridge

```bash
npm run bridge
```

### 3. Verify triggers registered

```bash
curl http://localhost:3456/triggers
# Look for S-HELLO-AUTO in the triggers list with status enabled
```

### 4. Fire it

```bash
mkdir -p tmp/trigger-test
echo "hello automation" > tmp/trigger-test/test.txt
```

The file_watch trigger fires after the 3s debounce window. The strategy executor spawns `claude --print` to run the methodology node.

### 5. Check results

```bash
# List executions
curl http://localhost:3456/strategies

# Check a specific execution
curl http://localhost:3456/strategies/{execution_id}/status

# View trigger fire history
curl http://localhost:3456/triggers/history
```

The retro lands at `.method/retros/retro-strategy-*.yaml`.

### 6. Hot reload after edits

```bash
curl -X POST http://localhost:3456/triggers/reload
```

---

## Architecture

```
Strategy YAML (.method/strategies/*.yaml)
    │
    ├── Trigger System (PRD 018)
    │   FileWatch, GitCommit, Schedule, PtyWatcher, Webhook
    │   → debounce engine → TriggerRouter → executor
    │
    ├── DAG Executor (PRD 017)
    │   Parse YAML → topological sort → parallel level execution
    │   → gate evaluation → retry with feedback → oversight rules
    │
    ├── Node Types
    │   methodology: spawns claude --print, invokes LLM
    │   script: executes inline JS (sandboxed)
    │   strategy: invokes a sub-strategy DAG (recursive composition)
    │   semantic: runs SPL algorithms (explore, design, implement, review)
    │   context-load: queries fca-index for FCA components before downstream nodes
    │
    ├── Gate Types
    │   algorithmic: JS expression on output/artifacts
    │   observation: check execution metadata
    │   human_approval: suspend for human input
    │
    └── Output
        Retro at .method/retros/retro-strategy-*.yaml
        Cost tracking per-node
        Artifacts passed between nodes
```

## Defining a Strategy

Strategies live in `.method/strategies/` as YAML files. Here's the anatomy:

```yaml
strategy:
  id: S-MY-STRATEGY
  name: "Human-readable name"
  version: "1.0"

  # ── Triggers: when does this strategy fire? ──
  triggers:
    - type: manual                    # always include — allows manual invocation
    - type: git_commit                # fires on new commits
      branch_pattern: "master"
      debounce_ms: 10000
      debounce_strategy: leading      # fire on first commit, suppress for 10s
    - type: file_watch                # fires when files change
      paths: ["docs/prds/*.md"]
      events: [create]
      debounce_ms: 5000
    - type: schedule                  # fires on cron
      cron: "0 */6 * * *"            # every 6 hours
    - type: webhook                   # fires on external HTTP POST
      path: "/triggers/webhook/my-hook"
      secret_env: "MY_WEBHOOK_SECRET"
      methods: [POST]
      filter: "payload.action === 'completed'"

  # ── Context: inputs passed to all nodes ──
  context:
    inputs:
      - { name: project_name, type: string, default: "pv-method" }
      - { name: trigger_event, type: object }   # auto-injected by trigger system

  # ── Capabilities: tool restrictions per group ──
  capabilities:
    read_only: [Read, Glob, Grep]
    implementation: [Read, Write, Edit, Bash, Glob, Grep]

  # ── DAG: the workflow ──
  dag:
    nodes:
      - id: analyze
        type: methodology
        methodology: P2-SD
        method_hint: M3-TMP
        capabilities: [read_only]
        inputs: [project_name]
        outputs: [analysis]
        gates:
          - type: algorithmic
            check: "output.result !== undefined"
            max_retries: 2

      - id: process
        type: script
        script: |
          const data = inputs.analysis;
          return { summary: JSON.stringify(data).substring(0, 200), processed: true };
        inputs: [analysis]
        outputs: [report]
        depends_on: [analyze]

    strategy_gates:
      - id: final_check
        depends_on: [process]
        type: algorithmic
        check: "artifacts.report && artifacts.report.processed === true"

  # ── Oversight: cost and time guards ──
  oversight:
    rules:
      - { condition: "total_cost_usd > 5.00", action: warn_human }
      - { condition: "step_duration_ms > 600000", action: kill_and_requeue }
      - { condition: "total_cost_usd > 20.00", action: escalate_to_human }

  outputs:
    - type: channel_event
      target: bridge
```

## Node Types

### Methodology Nodes

Invoke a real LLM via `claude --print`. The executor spawns a process, passes the prompt with context, and parses the structured JSON response.

```yaml
- id: review_code
  type: methodology
  methodology: P2-SD
  method_hint: M1-IMPL
  capabilities: [read_only]
  inputs: [file_list]
  outputs: [review_results]
  gates:
    - type: algorithmic
      check: "output.result && output.result.length > 50"
      max_retries: 3
```

**Cost:** Each methodology node invokes the Claude API. Track via `cost_usd` in execution results.

### Script Nodes

Execute inline JavaScript. No LLM invocation, no cost. Used for data transformation, filtering, aggregation.

```yaml
- id: merge_results
  type: script
  script: |
    return {
      total: inputs.results.length,
      summary: inputs.results.map(r => r.title).join(', ')
    };
  inputs: [results]
  outputs: [summary]
  depends_on: [review_a, review_b]
```

**Sandboxed:** Script nodes run in a `new Function()` sandbox. No access to `require`, `process`, `fs`, or Node.js globals. This is defense-in-depth for trusted YAML, not a security boundary.

### Strategy Nodes (Sub-Strategies)

Invoke another strategy DAG as a child. Enables recursive composition — break complex workflows into reusable sub-strategies.

```yaml
- id: run_tests
  type: strategy
  strategy_id: S-TEST-SUITE
  inputs: [code_output]
  outputs: [test_results]
  depends_on: [implement]
```

The child strategy receives the parent's artifact bundle as context inputs. Sub-strategy results (artifacts, cost, status) are merged back into the parent's artifact store.

**Cycle detection:** The executor maintains a `sharedChain: string[]` that tracks ancestor strategy IDs. Before invoking a sub-strategy, the executor checks whether the target strategy's ID already appears in the chain. This detects both direct cycles (A invokes A) and indirect cycles (A invokes B, B invokes A). If a cycle is detected, the node fails immediately with an error message identifying the cycle path (e.g., `"Cycle detected: S-A → S-B → S-A"`). The chain is passed down to child executors, so detection works at any nesting depth.

### Semantic Nodes (SPL Algorithms)

Invoke SPL (Semantic Programming Language) algorithms directly from the DAG. Four algorithms are available: `explore` (codebase traversal), `design` (port-first architecture), `implement` (gate-checked code generation), and `review` (compositional quality audit).

```yaml
- id: explore_codebase
  type: semantic
  algorithm: explore
  input_mapping:
    query: analysis_query
    path: project_root
  output_key: exploration_results
  inputs: [analysis_query, project_root]
  outputs: [exploration_results]
```

**Fields:**
- `algorithm` — one of `explore`, `design`, `implement`, `review`
- `input_mapping` — maps algorithm input fields to artifact names in the DAG context
- `output_key` — artifact name where the algorithm's result is stored

Semantic nodes require a `SemanticNodeExecutor` port to be wired in the bridge (done automatically). They run through the SPL runtime with truth tracking and confidence scoring.

> **Added in PRD 046 Wave 2c.** Requires bridge version with semantic node support.

### Context-Load Nodes

Query the `fca-index` for relevant FCA components before downstream methodology nodes execute. This pre-fetches architectural context (ports, interfaces, domain boundaries) so that methodology nodes receive grounded structural knowledge instead of relying on the LLM to discover it.

```yaml
- id: load_ports
  type: context-load
  query: "all ports consumed by the sessions domain"
  topK: 5
  filterParts: [port, interface]
  output_key: relevant_components
  outputs: [relevant_components]
```

**Fields:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `query` | string | *(required)* | Semantic description of what to retrieve from the FCA index |
| `topK` | number | `5` | Maximum number of components to return |
| `filterParts` | string[] | *(none — all parts)* | Restrict results to specific FCA parts (e.g., `port`, `interface`, `domain`, `layer`) |
| `output_key` | string | *(required)* | Artifact key where `RetrievedComponent[]` is stored in the ArtifactStore |

**Requirements:**
- `VOYAGE_API_KEY` must be set (used for embedding-based semantic search)
- The `fca-index` must have been scanned for the project (run `fca-index scan` first)

Results are stored in the ArtifactStore under `output_key` as a `RetrievedComponent[]` array. Downstream nodes reference this artifact via `inputs` to receive pre-fetched architectural context.

## Gates

Gates validate node output before the pipeline continues. Failed gates trigger retries with feedback.

### Algorithmic Gates

JavaScript expression evaluated against `output` and `artifacts`:

```yaml
gates:
  - type: algorithmic
    check: "output.result !== undefined && output.result.length > 10"
    max_retries: 3
```

On failure, the node is re-invoked with feedback:
```
GATE FAILURE — Retry 1/3
Gate: output.result !== undefined && output.result.length > 10
Result: FAILED — Expression evaluated to falsy
Please address the gate failure and try again.
```

### Observation Gates

Same expression mechanism as algorithmic gates but semantically intended for monitoring execution metadata — cost, duration, token usage, and other runtime metrics. Default `max_retries` is `2`.

```yaml
gates:
  - type: observation
    check: "output.cost_usd < 0.50 && output.duration_ms < 30000"
    max_retries: 2
```

Use observation gates to enforce runtime budgets per node. While algorithmic gates validate output quality, observation gates validate that the execution stayed within acceptable resource bounds.

### Human Approval Gates

Suspend execution and wait for a human decision. Backed by the EventBus via `BridgeHumanApprovalResolver`.

```yaml
gates:
  - type: human_approval
    artifact_type: prd
    timeout_ms: 300000
```

**Flow:**

1. The gate emits a `strategy.gate.awaiting_approval` event with:
   - `artifact_markdown` — GlyphJS content summarizing what needs approval
   - `artifact_type` — one of `surface_record`, `prd`, `plan`, `review_report`, or `custom`
   - `timeout_ms` — how long to wait before escalation (default: 300000ms / 5 minutes)

2. The executor subscribes to `strategy.gate.approval_response` and suspends the node.

3. A human (via dashboard or MCP tool) responds with a decision:
   - `approved` — gate passes, execution continues
   - `rejected` — gate fails, node is marked failed
   - `changes_requested` — gate fails with feedback, node retries with the feedback injected into the prompt

4. If `timeout_ms` elapses without a response, the gate triggers oversight escalation (same as `escalate_to_human`).

### Strategy Gates

Run after all nodes complete. Validate the final artifact state:

```yaml
strategy_gates:
  - id: quality_check
    depends_on: [implement]
    type: algorithmic
    check: "artifacts.test_results && artifacts.test_results.failed === 0"
```

Strategy gates are **single-shot** (no retries) — they validate the whole pipeline, not individual steps.

## Artifact Store Versioning

The artifact store is an immutable versioned store. Every write creates a new version — content is never overwritten in place.

**Operations:**
- `put(id, content, producer_node_id)` — creates a new version of artifact `id`. Never overwrites; appends a new version entry.
- `get(id)` — returns the latest version of artifact `id`.
- `getVersion(id, n)` — returns version `n` (1-indexed) of artifact `id`.
- `history(id)` — returns all versions of artifact `id`, oldest first.
- `snapshot()` — returns a frozen bundle of all artifacts at their latest versions, used as input when a node begins execution.

**ArtifactVersion structure:**

| Field | Type | Description |
|-------|------|-------------|
| `artifact_id` | string | The artifact key (e.g., `"analysis"`, `"review_results"`) |
| `version` | number | 1-indexed version number |
| `content` | any | The artifact content (object, string, array, etc.) |
| `producer_node_id` | string | ID of the node that produced this version |
| `timestamp` | string | ISO 8601 timestamp of creation |

Context inputs declared in the strategy's `context.inputs` are initialized as version 1 with `producer_node_id` set to `"__context__"`. When a node writes to an artifact that already exists (e.g., a retry produces updated output), the new content becomes the next version. Downstream nodes always receive the latest version via `snapshot()`.

## DAG Validation

Before execution begins, the strategy YAML is validated. Validation catches structural errors early, before any LLM calls are made.

**Checks performed:**

1. **Unique node IDs** — no two nodes may share the same `id`
2. **Dependency target existence** — every ID in a node's `depends_on` array must correspond to a defined node
3. **Gate type validity** — `type` must be one of `algorithmic`, `observation`, or `human_approval`
4. **Capability reference existence** — every capability group referenced by a node must be defined in the strategy's `capabilities` map
5. **Acyclicity** — DFS-based cycle detection ensures the DAG has no circular dependencies
6. **Gate expression syntax** — algorithmic and observation gate `check` expressions are validated as syntactically correct JavaScript via `new Function()` (not executed, only parsed)

Validation results are returned as a `StrategyValidationResult` object. If any check fails, the `errors` array contains one entry per violation with a human-readable message. Execution does not begin if `errors` is non-empty.

## Event Triggers

Strategies fire automatically when project events occur. Five event trigger types (plus `manual` and `mcp_tool` invocation types):

| Type | Fires when | Example |
|------|-----------|---------|
| `git_commit` | Commit lands on a branch | Code review on every push |
| `file_watch` | File created/modified in a directory | New PRD triggers architecture review |
| `schedule` | Cron expression matches | Nightly drift audit |
| `webhook` | External HTTP POST (HMAC validated) | GitHub PR webhook triggers CI |
| `pty_watcher` | PTY observation pattern detected | Test failure triggers quality review |

> **Note:** `channel_event` was removed in PRD 026 Phase 5 and replaced by EventBus subscriptions. YAML files with `channel_event` triggers will parse but the watcher will not be created.

### Debounce

Rapid events are collapsed. Two strategies:

- **Leading** (default for `git_commit`): Fire on the first event, suppress subsequent events for `debounce_ms`. Best when the first event is most informative.
- **Trailing** (default for `file_watch`): Wait for `debounce_ms` of silence, then fire. Best when you want to batch rapid changes.

```yaml
triggers:
  - type: git_commit
    debounce_ms: 10000
    debounce_strategy: leading    # fire immediately, suppress for 10s
    max_concurrent: 1             # only one execution at a time
```

### Trigger Context

When a trigger fires, the event payload is injected as `trigger_event` in the strategy's context:

```json
{
  "trigger_type": "file_watch",
  "trigger_id": "S-MY-STRATEGY:file_watch:1",
  "fired_at": "2026-03-20T12:51:12.969Z",
  "debounced_count": 1,
  "path": "docs/prds/019-new-feature.md",
  "event_type": "create",
  "filename": "019-new-feature.md"
}
```

Nodes can access this via `inputs.trigger_event` to know what event caused the run.

## Execution

### Manual Execution

```bash
# Via HTTP
curl -X POST http://localhost:3456/strategies/execute \
  -H "Content-Type: application/json" \
  -d '{"strategy_path": ".method/strategies/my-strategy.yaml", "context_inputs": {"project_name": "pv-method"}}'

# Response
{"execution_id": "exec-S-MY-STRATEGY-1774011072980", "status": "started"}
```

### `strategy_yaml` Parameter

Instead of a file path, you can pass the strategy YAML inline:

```bash
curl -X POST http://localhost:3456/strategies/execute \
  -H "Content-Type: application/json" \
  -d '{"strategy_yaml": "strategy:\n  id: S-INLINE\n  name: Inline test\n  ...", "context_inputs": {}}'
```

The body accepts either `strategy_path` (reads from disk) or `strategy_yaml` (inline YAML string). Exactly one must be provided.

### ExecutionStateSnapshot

The execution state is available at any time via `executor.getState()` (programmatic) or the status endpoint (HTTP). It returns an `ExecutionStateSnapshot` with the following structure:

| Field | Type | Description |
|-------|------|-------------|
| `strategy_id` | string | The strategy's `id` from YAML |
| `strategy_name` | string | The strategy's `name` from YAML |
| `status` | enum | `running`, `completed`, `failed`, or `suspended` |
| `node_status` | Map\<string, string\> | Per-node status (`pending`, `running`, `completed`, `failed`, `skipped`) |
| `node_results` | Map\<string, object\> | Per-node execution results (output, cost, duration, gate results) |
| `artifacts` | object | Current artifact bundle (latest version of each artifact) |
| `gate_results` | object[] | Strategy gate evaluation results |
| `cost_usd` | number | Total accumulated LLM cost |
| `started_at` | string | ISO 8601 start timestamp |
| `completed_at` | string \| null | ISO 8601 completion timestamp (null if still running) |
| `levels` | string[][] | Topological levels — each level is an array of node IDs that execute in parallel |
| `oversight_events` | object[] | Oversight rule triggers (warnings, escalations) |

### Polling Status

```bash
curl http://localhost:3456/strategies/exec-S-MY-STRATEGY-1774011072980/status
```

Returns the `ExecutionStateSnapshot` — node statuses, cost, gate results, artifacts, and retro path.

### Listing Executions

```bash
curl http://localhost:3456/strategies
```

Returns all strategy executions in memory with `execution_id`, `strategy_id`, `strategy_name`, `status`, `started_at`, `cost_usd`, and `retro_path`.

### DAG Structure

```bash
curl http://localhost:3456/api/strategies/exec-S-MY-STRATEGY-1774011072980/dag
```

Returns the parsed DAG for a given execution: nodes (with `id`, `type`, `depends_on`, `inputs`, `outputs`, `gates`, `config`), `strategy_gates`, `capabilities`, `oversight_rules`, and `context_inputs`. Used by the dashboard visualizer.

### Resume / Abort

```bash
# Resume — NOT YET IMPLEMENTED (returns 501)
curl -X POST http://localhost:3456/strategies/{execution_id}/resume

# Abort a running or suspended execution
curl -X POST http://localhost:3456/strategies/{execution_id}/abort \
  -H "Content-Type: application/json" \
  -d '{"reason": "Manual abort — investigating unexpected cost"}'
```

> **Caveat:** Abort sets the status to `failed` but does not cancel in-flight LLM calls. The current node may continue until it finishes.

### Strategy Definitions (CRUD)

```bash
# List all definitions
curl http://localhost:3456/api/strategies/definitions

# Create a new strategy
curl -X POST http://localhost:3456/api/strategies/definitions \
  -H "Content-Type: application/json" \
  -d '{"id": "s-my-new-strategy", "yaml": "strategy:\n  id: S-MY-NEW-STRATEGY\n  ..."}'

# Update an existing strategy
curl -X PUT http://localhost:3456/api/strategies/definitions/s-my-strategy \
  -H "Content-Type: application/json" \
  -d '{"yaml": "strategy:\n  id: S-MY-STRATEGY\n  ..."}'

# Delete a strategy
curl -X DELETE http://localhost:3456/api/strategies/definitions/s-my-strategy

# Force reload all definitions
curl -X POST http://localhost:3456/api/strategies/reload
```

Lists all strategy YAML definitions found in `.method/strategies/`. Each entry includes the parsed `id`, `name`, `version`, `triggers`, `nodes`, `strategy_gates`, `oversight_rules`, `context_inputs`, `outputs`, and `last_execution` (cross-referenced from in-memory executions). Files that fail to parse are included with an `error` field.

### MCP Tools

From Claude Code sessions:

```
# Strategy execution
strategy_execute          — start a strategy execution
strategy_execution_status — poll execution status (detailed)
strategy_status           — poll execution status (legacy alias)
strategy_resume           — resume a suspended execution (not yet implemented — Phase 2b)
strategy_abort            — abort a running/suspended execution

# Strategy CRUD
strategy_create           — create a new strategy YAML definition
strategy_update           — update an existing strategy definition
strategy_delete           — delete a strategy definition
strategy_reload           — force reload all strategy definitions

# Trigger management
trigger_list              — list all registered triggers
trigger_enable            — enable a trigger
trigger_disable           — disable a trigger
trigger_pause_all         — maintenance mode (pause all triggers)
trigger_resume_all        — resume after maintenance
trigger_reload            — hot reload strategy files + triggers
```

## Trigger Management

### List Triggers

```bash
curl http://localhost:3456/triggers
```

Response includes the `triggers` array plus top-level metadata:

```json
{
  "triggers": [ ... ],
  "paused": false,
  "total": 3,
  "watcher_count": 5
}
```

Each trigger object includes `trigger_id`, `strategy_id`, `strategy_path`, `type`, `enabled`, `max_concurrent`, `active_executions`, `stats`, `trigger_config`, and type-specific derived fields (e.g., `branch_pattern` for `git_commit`, `webhook_path` for `webhook`).

### Single Trigger Detail

```bash
curl http://localhost:3456/triggers/{trigger_id}
```

Returns the full trigger object (same fields as the list entry) plus `recent_fires` — the last 10 fire events for this trigger, newest last.

### Trigger Fire History

```bash
curl http://localhost:3456/triggers/history
curl http://localhost:3456/triggers/history?limit=20
curl http://localhost:3456/triggers/history?trigger_id=S-MY-STRATEGY:git_commit:0
```

Global trigger fire history. Optional `limit` query param caps the number of events returned (from the end of history). Optional `trigger_id` param filters to a single trigger's fires. Returns `{ events: [...], count: N }`.

### Webhook Request Log

```bash
curl http://localhost:3456/triggers/{trigger_id}/webhook-log
curl http://localhost:3456/triggers/{trigger_id}/webhook-log?limit=10
```

Returns the ring buffer of recent webhook HTTP requests for a webhook-type trigger. Default limit is 20, max 50. Returns 400 if the trigger is not a `webhook` type.

### Enable/Disable

```bash
curl -X POST http://localhost:3456/triggers/{trigger_id}/enable
curl -X POST http://localhost:3456/triggers/{trigger_id}/disable
```

> **Localhost only:** Enable, disable, pause, resume, and reload endpoints require the request to originate from localhost (`127.0.0.1`, `::1`, or `::ffff:127.0.0.1`). Non-local requests receive a `403 Forbidden` response.

### Maintenance Mode

```bash
curl -X POST http://localhost:3456/triggers/pause    # pause all
curl -X POST http://localhost:3456/triggers/resume   # resume all
```

### Hot Reload

After editing strategy YAML files, reload without restarting the bridge:

```bash
curl -X POST http://localhost:3456/triggers/reload
# Returns: { added: N, updated: N, removed: N, errors: [...] }
```

## Dashboard

The bridge dashboard at `http://localhost:3456/app/` includes a **Triggers** panel showing:
- Registered triggers with status (active/disabled/paused)
- Fire count, last fired time, error count
- Fire history timeline (last 20 fires)
- Maintenance mode banner when triggers are paused

The panel auto-refreshes every 5 seconds.

## Oversight Actions

Oversight rules evaluate conditions against execution state after each dependency level completes. Three actions are available:

| Action | Behavior |
|--------|----------|
| `warn_human` | Logs a warning and emits an oversight event. Execution continues. |
| `kill_and_requeue` | Kills the current node and requeues it for retry. |
| `escalate_to_human` | Sets execution status to `suspended` and halts the pipeline immediately. Strategy gates are skipped. The execution remains in memory for inspection. |

```yaml
oversight:
  rules:
    - { condition: "total_cost_usd > 5.00", action: warn_human }
    - { condition: "step_duration_ms > 600000", action: kill_and_requeue }
    - { condition: "total_cost_usd > 20.00", action: escalate_to_human }
```

## Execution Statuses

| Status | Meaning |
|--------|---------|
| `started` | Execution created, about to begin DAG traversal. |
| `running` | Actively executing nodes. |
| `completed` | All nodes and strategy gates passed. |
| `failed` | One or more nodes or strategy gates failed after all retries. |
| `suspended` | Halted by an `escalate_to_human` oversight rule. Execution is frozen for human inspection. |

Statuses `completed`, `failed`, and `suspended` are terminal — these executions are eligible for eviction from the in-memory store after `STRATEGY_EXECUTION_TTL_MS`.

## Execution Flow

```
1. Trigger fires (or manual POST)
     ↓
2. Debounce engine collapses rapid events
     ↓
3. max_concurrent check (skip if at capacity)
     ↓
4. Strategy YAML parsed → DAG validated (acyclic, references, capabilities)
     ↓
5. Topological sort → dependency levels
     ↓
6. For each level: execute ready nodes in parallel (chunked by maxParallel)
     ↓
7. Per node: invoke LLM (methodology) or run script
     ↓
8. Evaluate step gates → retry with feedback if failed
     ↓
9. Check oversight rules (cost, duration)
     ↓
10. After all levels: evaluate strategy gates
     ↓
11. Generate retro at .method/retros/retro-strategy-*.yaml
```

**maxParallel chunking:** At step 6, each topological level's ready nodes are split into groups of `maxParallel` size (default: `STRATEGY_MAX_PARALLEL=3`). Each group executes via `Promise.allSettled` — all nodes in the group run concurrently, but the next group does not start until the current group finishes. This ensures the executor never exceeds `maxParallel` concurrent node executions within a level.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `STRATEGY_ENABLED` | `true` | Master switch for strategy execution |
| `STRATEGY_MAX_PARALLEL` | `3` | Max concurrent nodes per execution |
| `STRATEGY_DEFAULT_GATE_RETRIES` | `3` | Default max retries for algorithmic gates |
| `STRATEGY_DEFAULT_TIMEOUT_MS` | `600000` | Per-node timeout (10 min) |
| `STRATEGY_DEFAULT_BUDGET_USD` | *(none — no cap)* | Per-execution LLM cost budget cap (USD). When unset, executions have no budget limit. Set this to a safe cap (e.g., `5`) when running automated triggers. |
| `STRATEGY_RETRO_DIR` | `.method/retros` | Override retro output directory |
| `STRATEGY_EXECUTION_TTL_MS` | `3600000` | TTL for completed executions in memory (1 hour) |
| `STRATEGY_MAX_EXECUTIONS` | `50` | Max executions retained in memory |
| `TRIGGERS_ENABLED` | `true` | Master switch for event triggers |
| `TRIGGERS_STRATEGY_DIR` | `.method/strategies` | Directory scanned for strategy YAML |
| `TRIGGERS_DEFAULT_DEBOUNCE_MS` | `5000` | Default debounce window |
| `TRIGGERS_MAX_BATCH_SIZE` | `10` | Max events per debounce batch |
| `TRIGGERS_MAX_WATCHERS` | `50` | Max active file/git watchers |
| `TRIGGERS_GIT_POLL_INTERVAL_MS` | `5000` | Git commit polling fallback interval |

## Example: Code Review on Git Commit

```yaml
strategy:
  id: S-CODE-REVIEW
  name: "Auto Code Review"
  version: "1.0"

  triggers:
    - type: manual
    - type: git_commit
      branch_pattern: "master"
      debounce_ms: 15000
      debounce_strategy: leading
      max_concurrent: 1

  context:
    inputs:
      - { name: trigger_event, type: object }

  capabilities:
    review: [Read, Glob, Grep]

  dag:
    nodes:
      - id: review
        type: methodology
        methodology: P2-SD
        method_hint: M3-TMP
        capabilities: [review]
        inputs: [trigger_event]
        outputs: [findings]
        gates:
          - type: algorithmic
            check: "output.result !== undefined"
            max_retries: 1

      - id: summarize
        type: script
        script: |
          const review = inputs.findings;
          return { commit: inputs.trigger_event?.commit_sha, reviewed: true };
        inputs: [findings, trigger_event]
        outputs: [summary]
        depends_on: [review]

  oversight:
    rules:
      - { condition: "total_cost_usd > 2.00", action: warn_human }
```

Every push to master triggers a code review. The leading-edge debounce fires immediately on the first commit, suppresses rapid follow-ups for 15 seconds. `max_concurrent: 1` ensures only one review runs at a time.

## Retrospectives

Every strategy execution generates a retro at `.method/retros/retro-strategy-YYYY-MM-DD-NNN.yaml` containing:
- Timing (started, completed, duration, critical path)
- Execution summary (nodes total/completed/failed, speedup ratio)
- Cost breakdown (total and per-node)
- Gate results (passed, failed, retries)
- Artifacts produced

**Critical path calculation:** The Earliest Completion Time (ECT) is calculated per node in topological order: `ECT(n) = max(ECT of all dependencies) + own_duration_ms`. For root nodes (no dependencies), `ECT(n) = own_duration_ms`. The critical path is the sequence of nodes that determines the minimum possible pipeline duration — the chain of nodes whose ECTs form the longest path through the DAG. It represents the theoretical lower bound on execution time even with unlimited parallelism.

**Speedup ratio:** Calculated as `sum(all node durations) / actual_duration`. A ratio greater than 1.0 indicates that parallelism reduced wall-clock time compared to sequential execution. For example, a speedup ratio of 2.5 means the pipeline ran 2.5x faster than if all nodes had executed one after another. A ratio of 1.0 or below indicates no parallelism benefit (either the DAG is fully sequential or overhead dominated).

## Limitations

- **No LLM review gates** — gates are algorithmic expressions only, not LLM-evaluated (Phase 2b)
- **No resumption** — suspended executions (from `escalate_to_human`) cannot be resumed; they must be re-executed. The `POST /strategies/:id/resume` endpoint returns `501 Not Implemented`. Checkpoint-based resumption is planned for Phase 2b.
- **Abort does not cancel in-flight LLM calls** — `POST /strategies/:id/abort` sets the execution status to `failed` but does not signal the running `claude --print` process. The current node may continue until it finishes. Full cancellation via AbortController is planned for Phase 2b.
- **No runtime DAG visualization** — the dashboard shows trigger status but not live execution graph (Phase 2b)
- **Script node timeout** cannot interrupt synchronous infinite loops — use short scripts
- **Sandbox is not a security boundary** — `new Function()` with shadowed globals, known escape vectors documented
