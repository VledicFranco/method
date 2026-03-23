---
guide: 16
title: "Strategy Pipelines"
domain: strategy
audience: [delivery-teams]
summary: >-
  Automated DAG workflows that compose methodology invocations, gates, and scripts with event triggers.
prereqs: [1, 2, 10]
touches:
  - packages/bridge/src/strategy/
  - packages/bridge/src/triggers/
  - .method/strategies/
---

# Guide 16 — Strategy Pipelines: Automated Methodology DAG Execution

How to define and run Strategy Pipelines — automated DAG workflows that compose methodology invocations, algorithmic gates, and scripts into repeatable pipelines that fire on project events.

## The Problem This Solves

The bridge (Guide 10) lets an orchestrator spawn sub-agents and coordinate multi-method sessions manually. But many workflows are repeatable: section a PRD, implement each section, review, create a PR. Without Strategy Pipelines, a human or orchestrator agent must manually start each step, evaluate success, retry on failure, and track costs. Every run is bespoke.

Strategy Pipelines make these workflows **declarative and automatic**. You define the DAG in YAML, declare gates for quality, and the executor runs it — parallelizing independent steps, retrying on gate failures, and producing a mandatory retrospective. With event triggers, pipelines fire automatically on git commits, file changes, schedules, or webhooks.

## Architecture

```
Strategy YAML (.method/strategies/*.yaml)
    │
    ├── Trigger System (PRD 018)
    │   FileWatch, GitCommit, Schedule, PtyWatcher, ChannelEvent, Webhook
    │   → debounce engine → TriggerRouter → executor
    │
    ├── DAG Executor (PRD 017)
    │   Parse YAML → topological sort → parallel level execution
    │   → gate evaluation → retry with feedback → oversight rules
    │
    ├── Node Types
    │   methodology: spawns claude --print, invokes LLM
    │   script: executes inline JS (sandboxed)
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

## Event Triggers

Strategies fire automatically when project events occur. Six trigger types:

| Type | Fires when | Example |
|------|-----------|---------|
| `git_commit` | Commit lands on a branch | Code review on every push |
| `file_watch` | File created/modified in a directory | New PRD triggers architecture review |
| `schedule` | Cron expression matches | Nightly drift audit |
| `webhook` | External HTTP POST (HMAC validated) | GitHub PR webhook triggers CI |
| `pty_watcher` | PTY observation pattern detected | Test failure triggers quality review |
| `channel_event` | Bridge channel event emitted | Session completion triggers summary |

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

### Polling Status

```bash
curl http://localhost:3456/strategies/exec-S-MY-STRATEGY-1774011072980/status
```

Returns node statuses, cost, gate results, artifacts, and retro path.

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

### Strategy Definitions

```bash
curl http://localhost:3456/api/strategies/definitions
```

Lists all strategy YAML definitions found in `.method/strategies/`. Each entry includes the parsed `id`, `name`, `version`, `triggers`, `nodes`, `strategy_gates`, `oversight_rules`, `context_inputs`, `outputs`, and `last_execution` (cross-referenced from in-memory executions). Files that fail to parse are included with an `error` field.

### MCP Tools

From Claude Code sessions:

```
strategy_execute   — start a strategy execution
strategy_status    — poll execution status
trigger_list       — list all registered triggers
trigger_enable     — enable a trigger
trigger_disable    — disable a trigger
trigger_pause_all  — maintenance mode (pause all triggers)
trigger_resume_all — resume after maintenance
trigger_reload     — hot reload strategy files
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

The bridge dashboard at `http://localhost:3456/dashboard` includes a **Triggers** panel showing:
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
6. For each level: execute nodes in parallel
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

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `STRATEGY_ENABLED` | `true` | Master switch for strategy execution |
| `STRATEGY_MAX_PARALLEL` | `3` | Max concurrent nodes per execution |
| `STRATEGY_DEFAULT_GATE_RETRIES` | `3` | Default max retries for algorithmic gates |
| `STRATEGY_DEFAULT_TIMEOUT_MS` | `600000` | Per-node timeout (10 min) |
| `STRATEGY_DEFAULT_BUDGET_USD` | *(none)* | Per-execution LLM cost budget cap (USD) |
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

## Limitations (Phase 2)

- **No sub-strategy composition** — strategies cannot invoke other strategies as nodes (Phase 3)
- **No LLM review gates** — gates are algorithmic expressions only, not LLM-evaluated (Phase 2b)
- **No resumption** — suspended executions (from `escalate_to_human`) cannot be resumed; they must be re-executed (Phase 2b)
- **No runtime DAG visualization** — the dashboard shows trigger status but not live execution graph (Phase 2b)
- **Script node timeout** cannot interrupt synchronous infinite loops — use short scripts
- **Sandbox is not a security boundary** — `new Function()` with shadowed globals, known escape vectors documented
