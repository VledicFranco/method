/**
 * Long-form feature narratives as template literals.
 *
 * Lifted from method-1/tmp/smoke-test-visualization-design.md §Feature Inventory
 * and method-1/tmp/smoke-test-viz-mock.html CLUSTERS.features[i].narrative.
 *
 * Kept in a separate file to keep registry.ts readable (D-2).
 */

export const featureNarratives: Record<string, string> = {
  // ── Methodology Layer — Session Lifecycle ────────────────────────
  'methodology-start':
    'Creates a new methodology session state. The session tracks completed methods, global objective status, and current routing info. Requires a methodology ID (which methodology to use) and a challenge description (what problem to solve). Returns the methodology metadata and transition function summary.',
  'methodology-list':
    'Queries the stdlib catalog via the MethodologySource port and returns all available methodologies with their methods. Each entry includes methodology ID, name, description, and an array of methods with step counts. This is how an agent discovers what methodologies are available before starting a session.',
  'methodology-status':
    'Returns the current state of a methodology session: which methodology is loaded, which method is active, what step the agent is on, and overall progress. The session status can be: initialized, routing, executing, transitioning, completed, or failed.',
  'session-isolation':
    'Different session IDs maintain completely independent state — separate step pointers, separate output histories, separate methodology progress. This enables multiple agents to work through the same methodology concurrently without interference.',

  // ── Methodology Layer — Routing & Transition ─────────────────────
  'routing-inspection':
    'Returns the full transition function structure: all predicates with their descriptions and truth conditions, all arms with their priority, condition, selected method, and rationale, and the evaluation order (priority-stack). This lets an agent understand the routing logic before evaluating it.',
  'route-evaluation':
    'The core routing operation. Takes optional challenge_predicates (overrides for predicate values) and evaluates arms in priority order. Returns: which predicates were evaluated (with sources: "provided" or "inferred"), which arm matched, and which method was selected. Structural predicates like is_method_selected and method_completed are inferred automatically from session state.',
  'method-selection':
    'After routing recommends a method, selection records the decision and loads the method\'s step DAG into the session. Validates that the method is in the methodology\'s repertoire, initializes step tracking to the first step, and sets the session status to "executing".',
  'methodology-transition':
    'The methodology\'s main state transition. Gathers all step outputs from the completed method, records a CompletedMethodRecord with timestamp and summary, re-evaluates delta-Phi with updated predicates, and either loads the next method or marks the methodology as complete. The completed method\'s outputs become available to future methods via priorMethodOutputs.',

  // ── Method Layer — Step Execution ────────────────────────────────
  'step-current':
    'Returns the full step record: ID, name, role, precondition label, postcondition label, execution guidance, and output schema. The precondition tells the agent what must be true before starting. The postcondition tells what must be true after. The output schema defines the expected structure of the step\'s output.',
  'step-context':
    'Builds the full context an agent needs to execute a step: methodology progress (e.g., "method 2 of 3"), method objective, current step details, prior step outputs (JSON summaries of what previous steps produced), and prior method outputs (from earlier methods in the methodology session). This is the bridge between the formal methodology structure and the agent\'s prompt.',
  'step-advance':
    'Increments the step pointer in topological order. Returns the previous step (just completed) and next step (about to begin), or null if at the terminal step. Emits methodology.step_completed and methodology.step_started events via the event bus. At the terminal step, returns nextStep=null signaling the method is complete and ready for transition.',
  'step-validate':
    'Two-phase validation. Phase 1 (schema): checks required fields by name, validates types (string, number, boolean, array, object, enum). Phase 2 (postcondition): extracts keywords from the postcondition label and performs substring matching against the output (50% keyword threshold). Returns a recommendation: "advance" (valid), "retry" (schema errors), or "escalate" (schema ok but postcondition unmet).',
  'step-preconditions':
    'Preconditions are first-order predicates (and/or/not/implies/forall/exists) that define what must be true before a step can begin. The system extracts human-readable labels from check predicates for display. Complex predicates (conjunction, disjunction) are composed from simpler ones. Agents should verify preconditions are met before executing a step.',

  // ── Strategy Layer — Node Types ──────────────────────────────────
  'methodology-node':
    'Methodology nodes invoke LLM agents with a prompt, role, and capability set. They are the primary mechanism for getting LLM work done inside a strategy DAG. The node executor assembles the prompt from template + context inputs + method hint, calls the configured provider, and stores the output as an artifact.',
  'script-node':
    'Script nodes execute sandboxed JavaScript with zero LLM cost. They are deterministic, cheap, and ideal for data transformation, arithmetic, and glue between LLM nodes. The sandbox blocks process/require access. Script outputs become artifacts just like LLM outputs.',
  'strategy-node':
    'Strategy nodes delegate execution to a nested sub-strategy via the SubStrategySource port. Child strategies run in an isolated context and return their final artifacts to the parent. This is how strategies compose: a parent DAG can invoke a smaller strategy as a black-box step.',
  'semantic-node':
    'Semantic nodes dispatch an SPL (Semantic Processing Language) algorithm — explore, design, implement, review — via the semantic node executor. The executor maps strategy inputs onto algorithm parameters, runs the algorithm, and stores the result as an artifact. Semantic nodes encode reusable multi-agent patterns.',
  'context-load-node':
    'Context-load nodes retrieve FCA component information from the context index. They query via a free-text query string with optional topK and filterParts parameters, returning RetrievedComponent records (path, level, docText, coverageScore, score). Used to inject codebase context into downstream LLM nodes without hand-curated prompts.',
  'sub-strategy':
    'The sub-strategy invocation mechanism used by strategy nodes. Parent loads the child YAML via SubStrategySource, runs it in an isolated context, and threads child artifacts back into the parent bundle. Enables strategy composition and reuse.',
  'spl-algorithms':
    'The SPL (Semantic Processing Language) algorithm library — explore, design, implement, review. Each algorithm defines a reusable multi-agent pattern that semantic nodes dispatch. Algorithms are parameterized by input mappings from the parent strategy.',
  'fca-index':
    'The Fractal Component Architecture index — a queryable store of codebase component metadata (files, summaries, dependencies). Context-load nodes retrieve records from it to build LLM prompts with real codebase context.',

  // ── Strategy Layer — Gates & Control Flow ────────────────────────
  'algorithmic-gate':
    'Algorithmic gates evaluate a JS expression against node output (e.g., `output.score >= 0.8`). They are synchronous, cheap, and deterministic. Gate result decides whether the strategy continues or retries/fails the preceding node.',
  'observation-gate':
    'Observation gates check execution metadata like `cost_usd < 0.01` or `duration_ms < 5000`. They inspect the runtime metrics of the preceding node rather than its output. Used to enforce cost and latency budgets at the node level.',
  'human-approval-gate':
    'Human approval gates emit a `gate.awaiting_approval` event and suspend the strategy until an external resolver (human or agent) approves or rejects. On approval the strategy resumes. Used for high-stakes transitions that need human-in-the-loop oversight.',
  'gate-retry':
    'When a gate fails, the preceding node can be retried with the failure reason injected as feedback into its next prompt. The retry count is tracked per node; the strategy proceeds once the gate passes or max retries are exceeded.',
  'strategy-level-gate':
    'Strategy-level gates run after the entire DAG completes (not after a single node). They evaluate aggregate conditions across multiple artifacts — e.g., "both result_a and result_b must exist". Used for post-completion validation.',
  'gate-expressions':
    'The expression language used by gates — a restricted JS subset evaluated against output bundles and execution metadata. Supports comparison, boolean logic, and property access.',
  'execution-metadata':
    'Per-node runtime metrics captured during execution: cost_usd, duration_ms, attempt count, tool calls. Observation gates and oversight rules consume this data.',
  'human-approval-flow':
    'The end-to-end human approval flow — strategy emits gate.awaiting_approval, external resolver approves or rejects via API/UI, strategy resumes with the resolution recorded in the retro.',
  'feedback-injection':
    'On gate failure, the gate\'s failure reason is injected into the preceding node\'s prompt as feedback context, so the next attempt can correct the specific issue. Core mechanism of the gate-retry loop.',

  // ── Strategy Layer — Data Flow & Oversight ───────────────────────
  'artifact-passing':
    'Nodes communicate through the ArtifactStore. Each node declares the artifact keys it consumes and produces. The executor passes consumed artifacts into the node\'s input bundle and writes produced artifacts back on completion. Artifact passing forms the data plumbing of the strategy DAG.',
  'artifact-versioning':
    'The ArtifactStore is immutable and versioned — multiple writes to the same key preserve prior versions rather than overwriting. Retros can inspect the full write history. Enables safe re-runs and audit trails.',
  'oversight-rules':
    'Oversight rules monitor execution metrics against thresholds (cost, duration, tool calls) and fire actions (escalate_to_human, warn, kill_and_requeue) when breached. Rules are declared in the strategy YAML and evaluated after every node completion.',
  'escalate-to-human':
    'Escalate action — when an oversight threshold is breached, the executor records an OversightEvent in the run state and suspends the strategy. Execution halts until a human (or automated resolver) decides to resume, abort, or adjust. No separate domain event is emitted; the suspension itself is the signal.',
  'warn-human':
    'Warn action — when an oversight threshold is breached, the executor records an OversightEvent in the run state but continues execution. The record surfaces in the retrospective and in the RunFlow for UI display. Used for soft alerts that don\'t block progress.',
  'immutable-store':
    'The immutability guarantee of the ArtifactStore — once a value is written, it cannot be overwritten or deleted within a single strategy run. Every write creates a new version. Enables replay and audit.',
  'node-dependencies':
    'Static dependency edges declared by a node — which upstream artifacts it consumes. The executor uses dependencies to build the topological order and to pass the correct inputs into each node.',

  // ── Strategy Layer — Execution Engine ────────────────────────────
  'parallel-execution':
    'Independent nodes at the same topological level execute concurrently up to a `max_parallel` limit. The executor uses a work queue to dispatch ready nodes as their dependencies complete. Reduces wall-clock time for branchy strategies.',
  'prompt-construction':
    'The full prompt-assembly pipeline: base template + context inputs (from prior artifacts) + injection points + method hint + capability list. Produces the final string handed to the LLM provider. One of the most testable parts of the executor.',
  'scope-contract':
    'A declared capability boundary for a methodology node — which tools it may call, which artifacts it may read/write, which cost ceiling applies. The executor enforces the contract by whitelisting tools before the LLM invocation.',
  'budget-enforcement':
    'Max cost limit for a strategy or individual node. Tracked as cumulative cost_usd during execution. When the limit is hit, a `budget_exhausted` event fires and the strategy halts gracefully with partial artifacts preserved.',
  'output-validation':
    'Schema validation on node outputs — required fields, type checks (string, number, boolean, array, object, enum), optional value constraints. Runs automatically after each node; validation failures trigger retry or gate failure.',
  'dag-validation':
    'Static validation of the strategy YAML at parse time — checks for cycles, duplicate node IDs, missing dependencies, invalid edges. Catches structural errors before any node executes.',
  'retro-generation':
    'Post-run retrospective — a structured summary of the strategy run: per-node timing, cost, gate outcomes, artifact diffs, oversight events, critical-path analysis. Persisted alongside the final bundle for audit and debugging.',
  'critical-path':
    'Critical Path Method computation over the strategy DAG — identifies the longest-duration chain of dependencies, which constrains total wall-clock time. The retro reports critical path and the parallel speedup ratio (sum of durations / wall-clock).',
  'capabilities':
    'The declared capability set a methodology node requires — tool names, artifact read/write scopes, model class. Used by the scope-contract enforcement mechanism.',
  'topological-sort':
    'The DAG-ordering algorithm that produces execution order from node dependencies. Also used to detect cycles at parse time.',
  'max-parallel':
    'The upper bound on concurrent node execution. Controls how aggressively the executor schedules independent ready nodes. Configurable per strategy.',
  'refresh-context':
    'Mechanism to refresh or reload context artifacts mid-strategy — e.g., re-query the FCA index after a codebase change. Used by long-running strategies that must pick up external state updates.',
  'session-management':
    'Per-run strategy session state — active node, in-flight artifacts, gate results, retry counts. Maintained by the executor for the lifetime of one strategy run.',
  'cost-tracking':
    'Cumulative cost accounting — every LLM invocation reports cost_usd; the executor aggregates totals per node, per strategy, and per run. Feeds budget enforcement, oversight rules, and retro cost reports.',
  'output-parsing':
    'Extraction of structured data from LLM outputs — JSON parsing, schema coercion, error recovery. Runs before output-validation so the validator sees a parsed object rather than raw text.',
  'tool-whitelist':
    'The subset of tools a methodology node may invoke, declared in its scope contract. The provider adapter filters the tool list at prompt time so the LLM cannot call disallowed tools.',
  'prompt-injection':
    'The mechanism for splicing dynamic values (prior artifacts, context records, method hints) into prompt templates. Uses named injection points inside template strings.',
  'method-hint':
    'A short string injected into a methodology node\'s prompt that tells the agent which method/step it is executing. Helps the LLM align its output with the methodology structure.',
  'cycle-detection':
    'Static check in dag-validation that catches cyclic dependencies between nodes. Strategies with cycles are rejected at parse time.',
  'parse-errors':
    'Structured errors emitted by the YAML parser when strategy files fail to parse or validate. Include file path, line number, and a descriptive message for operators.',
  'trigger-system':
    'The event-driven mechanism for invoking a strategy in response to external signals (webhooks, file changes, git events, cron). Separate from manual and pipeline-triggered runs.',
  'manual-trigger':
    'Manual strategy invocation — a human or agent calls the executor directly with an input bundle, without any external event. Used for ad-hoc runs and debugging.',
  'context-inputs':
    'The initial input bundle passed to a strategy at invocation — populated from the trigger payload or caller arguments. Becomes the root artifact set seen by the first nodes.',
  'timing':
    'Per-node and per-run duration tracking (duration_ms). Reported in retros, consumed by observation gates and critical-path analysis.',
  'speedup-ratio':
    'The ratio of total summed node duration to wall-clock duration — a measure of parallel efficiency. Reported in retros alongside critical path.',
  'execution-state-snapshot':
    'Point-in-time snapshot of strategy execution state — active node, completed nodes, artifact bundle, gate results, cost totals. Used by retros, debugging tools, and resume flows to capture a complete picture of the run at a given moment.',

  // ── Agent Layer — Agent Execution ────────────────────────────────
  'method-steps':
    'Multi-step agent chain — sequential agent invocations where each step builds on prior outputs via an accumulating bundle. Core pattern for methodology-driven agent work. Verifies data flow, step isolation, and final bundle integrity.',
  'tool-use':
    'Agent tool invocation across multiple turns. The agent emits a tool_use event, the testkit resolves it deterministically, the agent sees a tool_result and continues. Verifies the full tool loop and event stream ordering.',
  'schema-retry':
    'Output-validation-driven retry at the agent level. First attempt fails the output schema; the agent sees the failure as feedback and retries. Second attempt produces valid output. Verifies feedback injection and retry counting.',
  'context-compaction':
    'When context length exceeds the policy threshold, the agent runs a compaction pass (summarize old turns) before continuing. Emits a `context_compacted` event. Verifies the agent can continue after compaction.',
  'reflexion':
    'On failure, the agent runs a self-critique pass (reflexion) before retrying. The reflection text is injected as context for the retry attempt. Verifies the critique loop and that the second attempt succeeds.',
  'budget-exhausted':
    'When the agent exceeds its configured maxCostUsd, it returns a normal AgentResult with stopReason: "budget_exhausted" rather than throwing an error or silently overspending. This is a clean stop, not a failure — the result preserves any partial output and metadata.',
  'data-flow':
    'Data flow between agent steps — how each step\'s output becomes the next step\'s input via the accumulating bundle. Tested alongside multi-step chains.',
  'token-tracking':
    'Input/output token counts per agent invocation, emitted alongside cost_usd. Used for budget enforcement and usage dashboards.',
  'multi-turn':
    'Multi-turn conversation within a single agent invocation — user message, tool use, tool result, assistant response, repeat. Verifies the event stream preserves turn boundaries.',
  'agent-events':
    'The typed event stream emitted by agents — tool_use, tool_result, message, context_compacted, reflexion, budget_exhausted. Consumers (smoke test, bridge, UI) subscribe to the stream for observability.',
  'graceful-stop':
    'Clean termination when the agent hits a stop condition (budget, max turns, explicit abort). The final event is a terminal status with a reason, not an uncaught exception.',
  'validation-feedback':
    'Schema validation failures are formatted as feedback strings and injected into the next attempt\'s prompt. Part of the schema-retry loop.',
  'context-policy':
    'The configured rules for when and how to compact context — token thresholds, which turns to preserve, whether to summarize or drop. Drives the context-compaction mechanism.',
  'long-context':
    'Support for long conversation histories that exceed naive token windows. Relies on context-policy and context-compaction to keep the window manageable.',
  'reasoning-policy':
    'The agent\'s configured reasoning discipline — whether to use reflexion on failure, how many retry passes, how to blend critiques into retries. Part of the Pact configuration.',
  'reflect-on-failure':
    'Behavioral rule that triggers a reflexion pass whenever an attempt fails. Part of reasoning-policy.',
};
