# Guide 18: Strategy Context Continuity

> **What this covers:** How to use `refresh_context` to control when strategy nodes start fresh LLM sessions vs. continuing the session from the previous node.

## The Problem

By default, each strategy node in a DAG runs in isolation — it gets a fresh LLM session (new `sessionId`, no prior chat history). This is safe and avoids context accumulation, but it means:

- **Lost coherence:** A `design` node can't reference the reasoning from the `analyze` node — only its final output (as JSON)
- **No chat context reuse:** If nodes share context (e.g., "here's the analysis, now refine it"), they're operating from scratch each time
- **Independent context budgets:** Each node pays full context cost even if they could share

## The Solution: `refresh_context`

You can now explicitly control whether a node should refresh (start fresh) or continue the session from the previous node:

```yaml
strategy:
  id: S-EXAMPLE
  dag:
    nodes:
      # Analyze the objective — starts fresh session
      - id: analyze
        type: methodology
        methodology: P1-EXEC
        refresh_context: false  # (default) continue session from prior node (or start fresh if first)

      # Design based on analysis — SAME session as analyze
      - id: design
        type: methodology
        methodology: P1-EXEC
        refresh_context: false  # continues the session from analyze

      # Validate in a separate context — FRESH session
      - id: validate
        type: methodology
        methodology: P1-EXEC
        refresh_context: true   # start a new session, discard analyze+design chat history
```

**Semantics:**
- `refresh_context: false` (default): Use the same session as the previous node. Pass session ID via `--resume` to maintain chat history.
- `refresh_context: true`: Kill the session and start a new one. Chat history from prior nodes is discarded, but their outputs (artifacts) are still available as JSON inputs.

## When to Use Each

### Use `refresh_context: false` when:

- **Nodes are conceptually related:** analyze → design → validate (iterative refinement)
- **The LLM benefits from seeing prior reasoning:** "Here's why the analysis says X. Now design based on that context."
- **You want coherence:** The node's response should build on the prior node's explanation, not just its output
- **Cost is secondary:** Keeping chat history costs more tokens, but gives better quality

**Example:**
```yaml
# Story generation pipeline — each step builds on prior context
- id: plot_outline
  type: methodology
  refresh_context: false

- id: expand_scenes
  type: methodology
  refresh_context: false  # sees the plot_outline reasoning, not just the JSON output

- id: copyedit
  type: methodology
  refresh_context: false  # sees the original reasoning chain
```

### Use `refresh_context: true` when:

- **Nodes are independent tasks:** analyze metrics, validate correctness, install to registry
- **You want cost control:** Fresh session = smaller context window, lower token cost
- **Chat history would confuse:** The validation node doesn't need to see analysis reasoning — it needs to validate the artifact
- **Context isolation is important:** If a node fails and is retried, you want a clean slate

**Example:**
```yaml
# Strategy designer pipeline — each step is independent
- id: analyze
  type: methodology
  refresh_context: false

- id: design
  type: methodology
  refresh_context: false  # continues from analyze

- id: validate
  type: methodology
  refresh_context: true   # fresh session — just validate the YAML

- id: install
  type: methodology
  refresh_context: true   # fresh session — just write to disk
```

## How It Works Under the Hood

**Executor behavior:**

1. **First node:** Starts with `sessionId = crypto.randomUUID()` (fresh)
2. **Second node (if `refresh_context: false`):** Passes `resumeSessionId = first_node_id` → same session
3. **Second node (if `refresh_context: true`):** Generates new UUID, passes `refreshSessionId = new_uuid` → fresh session
4. **Retries within a node:** Always maintain session continuity (use `resumeSessionId`) regardless of `refresh_context`

**Why retries always continue the same session:**
- Retries need context from the prior attempt to apply feedback
- Example: "Your JSON was invalid. Here's the error. Fix it." — the node needs to see both the original attempt and the feedback
- Context refresh only happens between nodes, never within retries

**Artifacts are always available:**
- Even with `refresh_context: true`, the node receives prior outputs as JSON inputs
- The LLM can use these artifacts; it just doesn't see the chat history that produced them

## Example: Core Test Watcher Strategy

```yaml
strategy:
  id: S-CORE-TEST-WATCH
  name: "Core Test Watcher"
  triggers:
    - type: file_watch
      paths: ["packages/core/src/**/*.ts"]
  dag:
    nodes:
      # Run the tests
      - id: run_tests
        type: methodology
        methodology: P1-EXEC
        refresh_context: false

      # Parse the results into a structured report
      - id: parse_results
        type: script
        refresh_context: false  # script nodes can also use refresh_context
```

Both nodes use `refresh_context: false` (default), so:
- `run_tests` starts a fresh session
- `parse_results` continues the same session
- The LLM has context from the test execution and can reference it when parsing

## Common Patterns

### Pattern 1: Coherent Pipeline
Nodes are stages of a single thought process:
```yaml
- id: read_spec
  refresh_context: false
- id: design
  refresh_context: false  # sees the spec reasoning
- id: generate_code
  refresh_context: false  # sees design reasoning
```

### Pattern 2: Isolated Quality Gates
First phase is coherent, second phase validates independently:
```yaml
- id: generate
  refresh_context: false
- id: validate
  refresh_context: true   # fresh session, just check correctness
- id: install
  refresh_context: true   # fresh session, just write the artifact
```

### Pattern 3: Cost-Optimized
Minimize context where possible:
```yaml
- id: analyze
  refresh_context: false
- id: design
  refresh_context: true   # cost savings: don't need analyze chat history
- id: validate
  refresh_context: true
```

## Troubleshooting

**Q: My node isn't seeing prior context. Why?**
A: Make sure the prior node has `refresh_context: false` (or omit it — default is false). If it's true, that node started a fresh session.

**Q: My node is taking too long. Can I make it faster?**
A: Set `refresh_context: true` on that node (or before it) to reduce context size. Each node will have a smaller context window, making inference faster.

**Q: Do I need to worry about context accumulation with `refresh_context: false`?**
A: Yes. If a DAG has 10+ nodes all with `refresh_context: false`, the last node's context window will include all prior nodes' exchanges. Monitor cost via `total_cost_usd` and consider adding refresh points if it grows unbounded.

**Q: What happens to retries with `refresh_context: true`?**
A: Retries within the node always continue the session (use `resumeSessionId`), regardless of `refresh_context`. So if a node retries 3 times, all retries are in the same session, and `refresh_context: true` only takes effect when moving to the next node.

## Essence & Design

**Why this matters:**
- Gives strategy designers explicit control over context lifecycle (theory-driven)
- Supports both coherence (continuous session) and cost (isolated sessions)
- Retries stay coherent (session continuation) but context can refresh between nodes
- Backward compatible: all existing strategies default to `refresh_context: false`

**Interface guarantee:**
- If both `resumeSessionId` and `refreshSessionId` are set on an LLM request, the provider throws an error with a clear message
- Semantics are unambiguous: exactly one of (refresh, resume, or default) is active per invocation
