# Cross-App Invoker (PRD-067)

## Responsibility

`packages/runtime/src/ports/cross-app-invoker.ts` defines the transport-free port the strategy DAG executor calls to dispatch a `cross-app-invoke` node — one strategy fanning out to another Cortex tenant app's operation.

**Key constraints:**
- `@methodts/runtime` knows nothing about Cortex (G-BOUNDARY). The port is the abstraction boundary.
- Strategy executors MUST dispatch through this port, never directly through `ctx.apps.invoke` (G-PORT)
- Typed target errors surface as node failures, not strategy crashes (G-FAILURE-ISOLATION)
- Fire-and-forget is NOT supported (PRD-080 §4 OOS): every call is request/reply
- Depth cap is 2 by default (PRD-061/PRD-080 RFC 8693) — `user → agent → cross-app` is the deepest valid chain

## Architecture

```
strategy YAML          methodts (L2)                    runtime (L3)                   ctx (L4 — Cortex)
─────────────          ─────────────                    ────────────                   ──────────────────

cross-app-invoke:      DagStrategyExecutor              CrossAppNodeExecutorImpl       ┌──────────────┐
  target_app: X   ───▶    (node dispatcher)  ──port──▶    (runtime adapter)   ──port─▶ │ CrossApp     │
  operation: Y            │                               │                            │ Invoker      │
  input_projection:       ▼ calls                         ▼ calls (via port)           │ (impl)       │
    foo: $.a.b        CrossAppNodeExecutor            CrossAppInvoker                  └──────────────┘
  output_merge:         (methodts port)               (runtime port)                          │
    spread | namespace                                                                        │
                                                                                              ▼
                                                                              ┌──────────────────┐
                                                                              │ InProcessCrossApp│  ── Track A ──
                                                                              │ Invoker          │   ships now
                                                                              └──────────────────┘
                                                                              ┌──────────────────┐
                                                                              │ CortexCrossApp   │  ── Track B ──
                                                                              │ Invoker (STUB)   │   blocked on
                                                                              └──────────────────┘   Cortex PRD-080
                                                                              ┌──────────────────┐
                                                                              │ NullCrossApp     │  ── default ──
                                                                              │ Invoker (throws) │   no wiring
                                                                              └──────────────────┘
```

## Surfaces

| Surface | Scope | Status | Location |
|---------|-------|--------|----------|
| `CrossAppInvoker` port | Runtime-side transport-free invocation boundary | frozen | `packages/runtime/src/ports/cross-app-invoker.ts` |
| `CrossAppNodeExecutor` port | Methodts-side injection point for DAG cross-app-invoke nodes | frozen | `packages/methodts/src/strategy/dag-executor.ts` |
| `cross-app-invoke` node config | Strategy DAG node type (`input_projection`, `output_merge`, `idempotency_key`, `target_app`, `operation`, `timeout_ms`) | frozen | `packages/methodts/src/strategy/dag-types.ts` |
| `ContinuationEnvelope.crossApp` extension | Session continuity across cross-app suspension | frozen | `packages/runtime/src/ports/continuation-envelope.ts` |

## Invocation request shape

```typescript
interface CrossAppInvokeRequest<Input> {
  targetAppId: string;         // MUST be in caller's requires.apps[] manifest
  operation: string;           // Operation (never a tool) — PRD-080 §5.7
  input: Input;                // Projected from DAG bundle via input_projection
  timeoutMs?: number;
  idempotencyKey?: string;     // Default: ${sessionId}:${nodeId}
  delegation: DelegationCarry; // RFC 8693 context (parent token, currentDepth, originatingRequestId)
  caller: { sessionId: string; nodeId: string };
}

interface CrossAppInvokeResult<Output> {
  output: Output;
  targetDecisionId: string;    // Cortex PRD-080 §5.7 — enables dual-audit correlation
  latencyMs: number;
  callerCostUsd: number;       // Debited to caller's ctx.llm budget; callee's is invisible
}
```

## Typed error taxonomy

All errors surface as `CrossAppTargetError`-family failures — strategy gate/retry machinery resolves them as node failures, not strategy crashes (G-FAILURE-ISOLATION).

| Error | `code` | When |
|-------|--------|------|
| `CrossAppNotConfiguredError` | `CROSS_APP_NOT_CONFIGURED` | Strategy has a cross-app-invoke node but composition root wired `NullCrossAppInvoker` (or none) |
| `CrossAppTargetNotDeclaredError` | `CROSS_APP_TARGET_NOT_DECLARED` | Compose-time check: DAG targets an app not in `capabilities().allowedTargetAppIds` |
| `CrossAppScopeMissingError` | `CROSS_APP_SCOPE_MISSING` | Runtime: token is missing the `app:<X>:<op>` scope claim (Cortex PRD-080 403) |
| `CrossAppDelegationDepthExceededError` | `CROSS_APP_DELEGATION_DEPTH_EXCEEDED` | RFC 8693 depth cap exceeded (default 2). Mitigation: flatten sub-agent trees into sibling cross-app calls |
| `CrossAppTargetError` | `CROSS_APP_TARGET_ERROR` | Target app/operation is registered but its handler threw |
| `CrossAppTargetUnknownError` | `CROSS_APP_TARGET_UNKNOWN` | Simulator analogue: target app not registered with the invoker |

## Implementations

### `InProcessCrossAppInvoker` — simulator (Track A, shipping)

`packages/runtime/src/strategy/in-process-cross-app-invoker.ts`

In-memory map of registered apps. Dispatches synchronously in-process. Useful for:
- Unit + integration tests of multi-app strategies without Cortex
- Single-process demos of Digital Twins flows
- CI pipelines (no Cortex dependency)

Apps register via `registerApp({ appId, operations })` where each operation is a `(input) => Promise<output>` handler. `capabilities().allowedTargetAppIds` reflects the registered set for compose-time enforcement.

### `CortexCrossAppInvoker` — live adapter (Track B, STUB)

`packages/runtime/src/strategy/cortex-cross-app-invoker.stub.ts`

**STATUS: STUB — BLOCKED ON CORTEX PRD-080.**

Constructor does NOT throw (`capabilities()` is callable for compose-time inspection). Every `invoke()` call throws `CortexCrossAppInvokerNotImplementedError` with the PRD-080 reference baked into the message. When PRD-080 thaws, swapping the stub for the live adapter is a single file replacement — the port surface stays identical.

The eventual real home for the live adapter is `@methodts/agent-runtime/cortex/` (PRD-067 §7.2); the stub lives next to the port for discoverability until PRD-080 ships.

### `NullCrossAppInvoker` — default

`packages/runtime/src/ports/cross-app-invoker.ts`

Default used when the composition root did not wire a real invoker. `invoke()` throws `CrossAppNotConfiguredError`; `capabilities().enabled = false` so the strategy parser can refuse cross-app nodes at compose time rather than at execution.

## Composition

```typescript
// runtime composition root
const invoker: CrossAppInvoker =
  process.env.CORTEX_DEPLOYED
    ? new CortexCrossAppInvoker({ ctxApps, allowedTargetAppIds })  // stub until PRD-080
    : new InProcessCrossAppInvoker({ registeredApps });            // simulator

const nodeExecutor = new CrossAppNodeExecutorImpl(invoker, {
  delegationSupplier: (args) => ({
    parentToken: ctx.auth.currentToken(),
    currentDepth: ctx.auth.delegationDepth(),
    originatingRequestId: args.sessionId,
  }),
  defaultTimeoutMs: 30_000,
});

// Inject into DagStrategyExecutor as the 9th positional arg (after contextLoadExecutor)
const dagExecutor = new DagStrategyExecutor(
  /* ... */,
  contextLoadExecutor,
  /* sharedChain */ undefined,
  nodeExecutor,
);
```

## Open questions / deferred

- **PRD-080 thaw** — real `CortexCrossAppInvoker` ships when `ctx.apps.invoke` lands in Cortex Wave 5. Drop-in replacement.
- **Depth-cap conflict** — PRD-067 §9.1 flags that S3's depth-2 cap can block `user → agent → cross-app → sub-agent` chains. Default mitigation is to re-compose deep sub-agent trees as siblings via additional cross-app-invoke calls (flatten the tree). Still an open design axis.
- **Streaming outputs** — not supported; every call is request/reply. Streaming cross-app would need a `CrossAppStreamInvoker` variant and is out of scope.
- **Compose-time DAG validator** — `assertCrossAppTargetsAllowed(invoker, declaredTargetAppIds)` is exported but not yet wired into the compose-time strategy parser. Call site should be added in a follow-up when more cross-app demos land.

## Related
- [pacta.md](pacta.md) — pact contracts and composition
- [event-bus.md](event-bus.md) — event bus (cross-app calls emit audit events through it)
- [`packages/runtime/src/ports/cross-app-invoker.ts`](../../packages/runtime/src/ports/cross-app-invoker.ts) — port + error taxonomy
- [`packages/runtime/src/strategy/cross-app-node-executor.ts`](../../packages/runtime/src/strategy/cross-app-node-executor.ts) — methodts→runtime bridge
- PRD-067 — `.method/sessions/fcd-design-prd-067-multi-app-strategy/prd.md`
