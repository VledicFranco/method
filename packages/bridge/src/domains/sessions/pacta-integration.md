# Pacta-Bridge Integration Surface

Spike validation document. Describes how the bridge would fully adopt Pacta for session management and strategy execution.

## Concept Mapping

| Bridge Abstraction | Pacta Concept | Notes |
|---|---|---|
| `SessionPool` | Agent lifecycle | Pool manages many agents; Pacta manages one agent per Pact |
| `PtySession` | `AgentProvider` (persistent mode) | PTY sessions are long-lived; maps to Pacta's `persistent` execution mode |
| `PrintSession` | `AgentProvider` (oneshot mode) | Print sessions are fire-and-forget; maps to Pacta's `oneshot` mode |
| `SessionBudget` (max_depth, max_agents) | `BudgetContract` | Bridge budget is about spawning limits; Pacta budget is per-agent resource limits. Complementary, not identical. |
| `ScopeConstraint` (scope-hook.ts) | `ScopeContract` | Both constrain what an agent can do. Bridge scope enforces at PTY level; Pacta scope declares at contract level. |
| `SessionChainInfo` | Not directly mapped | Agent hierarchies (parent/child chains) are a bridge orchestration concern, not a single-agent contract. Would need a bridge-level orchestrator on top of Pacta. |
| `WorktreeInfo` / `IsolationMode` | `AgentRequest.workdir` | Worktree isolation is a bridge concern. Pacta's workdir is the execution directory; bridge would set it to the worktree path. |
| `SessionMode` ('pty' / 'print') | `ExecutionMode` ('persistent' / 'oneshot') | Direct mapping. PTY = persistent, print = oneshot. |
| `LlmProvider` (strategies) | `AgentProvider` | Bridge's strategy LlmProvider is a simpler abstraction. Pacta's AgentProvider is richer (capabilities, events, middleware). |
| `StrategyNode` | `Pact` per node | Each strategy pipeline node could declare a Pact specifying its agent's constraints. |
| Strategy gates | Not directly mapped | Gates are strategy orchestration; they evaluate after an agent completes. Pacta's `onExhaustion` is the closest analog for budget gates. |
| `EventBus` / `BridgeEvent` | `AgentEvent` + `onEvent` callback | Bridge events are richer (domain, severity, persistence). Pacta events are per-agent. Bridge would subscribe to Pacta's `onEvent` and map to BridgeEvents. |

## Migration Steps

### Phase 1: Parallel Path (this spike)
- [x] Add Pacta dependencies to bridge
- [x] Create `pacta-session.ts` — Pacta-based session creation alongside existing pool
- [x] Create `pacta-strategy.ts` — Pact configuration for strategy steps
- [x] Unit tests validating the integration surface

### Phase 2: Provider Adaptation
- Create a `BridgePtyProvider` implementing `AgentProvider` that wraps the existing PTY session logic
- This provider would use `persistent` mode and support streaming via PTY output parsing
- The provider handles worktree setup, scope hook installation, and PTY lifecycle
- `claudeCliProvider` from `@method/pacta-provider-claude-cli` handles the `oneshot` (print) path

### Phase 3: Pool Integration
- `SessionPool.spawn()` would accept a `Pact` instead of raw spawn options
- Pool internally calls `createAgent()` with the Pact and the appropriate provider
- Session chain budget tracking (max_depth, max_agents) remains a pool concern — it wraps Pacta's per-agent budget
- The pool becomes an orchestrator of Pacta agents rather than a PTY manager

### Phase 4: Strategy Pipeline Integration
- Strategy nodes declare `PactStrategyConfig` in the strategy YAML (new optional field)
- The strategy executor resolves each step's Pact via `resolveStepPact()`
- Node execution creates a Pacta agent per step instead of using the bridge LlmProvider directly
- Strategy gates remain as-is — they evaluate after agent completion
- The `LlmNodeExecutor` adapter is replaced by direct Pacta agent invocation

### Phase 5: Event Unification
- Bridge subscribes to Pacta `AgentEvent` streams via `onEvent`
- Maps `AgentEvent` types to `BridgeEvent` types for the Universal Event Bus
- Pacta events feed into existing sinks (WebSocket, persistence, channels)
- Per-agent cost/usage tracking comes from `AgentResult` instead of manual accumulation

### Phase 6: Full Migration
- Remove direct PTY spawning from session pool (replaced by `BridgePtyProvider`)
- Remove `LlmNodeExecutor` from strategy executor (replaced by Pacta agents)
- Bridge becomes a Pacta orchestrator: pool manages agent lifecycles, strategies define agent contracts, events flow through the bus

## Key Design Decisions for Full Adoption

1. **Session chains stay in the bridge.** Pacta is a single-agent SDK. Multi-agent orchestration (parent/child chains, budget propagation across agents) is the bridge's responsibility. The bridge orchestrates Pacta agents; Pacta does not orchestrate itself.

2. **Worktree isolation stays in the bridge.** Git worktree creation, branch management, and merge-back are infrastructure concerns. The bridge sets up the worktree, then passes the path as `workdir` to the Pacta agent.

3. **Event mapping, not replacement.** `AgentEvent` and `BridgeEvent` serve different purposes. AgentEvent is per-agent, low-level. BridgeEvent is domain-scoped, severity-tagged, persistent. The bridge maps one to the other; it does not replace its event system.

4. **Pact as the session contract.** Instead of scattered spawn options (timeout, model, tools, scope), a Pact object becomes the single configuration surface for what an agent session can do. This is the main ergonomic win.

5. **Strategy Pacts are optional.** Existing strategies without Pact configs continue to work via the current LlmProvider path. Pact configs are additive — strategy authors opt in per step.
