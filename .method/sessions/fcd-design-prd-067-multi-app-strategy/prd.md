---
type: prd
title: "PRD-067: Multi-App Strategy Execution (Cross-App Pacta)"
date: "2026-04-14"
status: DRAFT-BLOCKED-ON-CORTEX-PRD-080
index: 67
version: "0.1"
author: "Method team"
summary: >
  Extend method strategy DAGs and pact continuations to invoke operations across
  tenant apps via Cortex's App-to-App Dependencies (Cortex PRD-080). Introduces
  a `CrossAppInvoker` port, a `cross-app-invoke` strategy DAG node type, and an
  extension to S5's `ContinuationEnvelope` for cross-app continuation routing.
  Forward-looking — Cortex PRD-080 is `🔜 deferred` in Wave 5; the Method-side
  surface is designed now so implementation can start the day PRD-080 thaws.
audience: [cto, method-team, cortex-team]
domains:
  - "@method/runtime/strategies"
  - "@method/runtime/ports"
  - "@method/agent-runtime/cortex"
  - "@method/methodts/strategy"
surfaces:
  - CrossAppInvoker
  - CrossAppInvokeNode
  - MultiAppContinuationEnvelopeExtension
depends_on_method:
  - PRD-057 (@method/runtime carve-out — owns strategy executor)
  - PRD-058 (@method/agent-runtime — owns CortexCtx)
  - PRD-059 (CortexLLMProvider + CortexTokenExchangeMiddleware — token exchange primitive)
  - PRD-062 (JobBackedExecutor + ContinuationEnvelope — extended here)
  - PRD-063 (CortexEventConnector — RuntimeEvent emission for cross-app signals)
depends_on_cortex:
  - PRD-080 (App-to-App Dependencies — `🔜 deferred`, Wave 5)
  - PRD-061 (Auth-as-a-Service — RFC 8693 token exchange, already frozen)
  - PRD-072 (Events Service — cross-app event routing)
  - PRD-077 (Health Check System — dependency health propagation)
size: L
estimated_weeks: "3-4 (once PRD-080 unblocks)"
related_surfaces:
  - .method/sessions/fcd-surface-method-agent-port/decision.md (S1 — CortexCtx)
  - .method/sessions/fcd-surface-job-backed-executor/decision.md (S5 — continuation envelope extended)
  - .method/sessions/fcd-surface-event-connector/decision.md (S6 — cross-app event signals)
  - .method/sessions/fcd-surface-cortex-service-adapters/decision.md (S3 — token exchange + depth cap)
related:
  - docs/roadmap-cortex-consumption.md §4.3 item 13
  - t1-repos/t1-cortex-1/docs/prds/080-app-to-app-dependencies.md
  - t1-repos/t1-cortex-1/docs/rfcs/RFC-005-app-platform-service-library.md §9, §12.9
---

# PRD-067: Multi-App Strategy Execution (Cross-App Pacta)

> **Status: DRAFT — BLOCKED ON CORTEX PRD-080.**
> This PRD is forward-looking design. It freezes the Method-side surface so
> implementation can start the day Cortex PRD-080 (currently `🔜 deferred`,
> Wave 5) thaws. All contract assumptions about Cortex are enumerated in §10
> and must hold at PRD-080 freeze time; divergence is mitigated in §11 Risks.

---

## 1. Problem

Today a method-backed agent runs inside exactly one Cortex tenant app. A
strategy DAG decomposes work into nodes, but every node's work happens in
the same app's container, under the same app's scope, budget, and quota.
This is a hard ceiling for the incident-response flagship: the
`incidents-bot` app classifies a Slack incident as a code defect and needs
to hand off to the `feature-dev-agent` app (different manifest, different
scope, different budget attribution) to actually produce a fix PR.

Concretely:

- **Handoff failure.** Today the hand-off is either manual (a human re-posts
  the incident into another channel) or a hack (incidents-bot reaches
  directly into feature-dev-agent's DB/queue — a tool-level coupling Cortex
  RFC-005 §9 forbids).
- **Context explosion.** Without cross-app invocation, the workaround is a
  megalithic tenant app that bundles every skill — violating Cortex's
  operation-level boundary and blowing past per-app budget envelopes.
- **Audit incoherence.** Running the full chain inside one app flattens the
  audit record: it looks like one agent did everything, when in reality the
  triage decision and the implementation decision should be separately
  attributable to two app teams.

Cortex solves the platform half with PRD-080 (App-to-App Dependencies): a
single `POST /v1/platform/apps/invoke` endpoint, delegated auth via RFC
8693, dual audit with correlated `decisionId`. What Cortex PRD-080 does NOT
define is how a **method strategy DAG** models a cross-app call — as a
node, as a continuation, or as an event — and how pact **budget, scope, and
continuation envelope** survive the hop.

PRD-067 answers that Method-side question.

---

## 2. Constraints

### 2.1 From Cortex (authoritative; Method must conform)

- **Operation-level only.** Cross-app calls address operations
  (`knowledge-base.query`), never tools. A strategy node that wants to call
  another app must name an operation.
- **Single endpoint.** All cross-app dispatch goes through
  `POST /v1/platform/apps/invoke`. Method must not invent a bypass.
- **Delegated auth (Model C).** The originating user's token is exchanged
  (RFC 8693) into a target-app-scoped token carrying both app and user
  identity. Max delegation depth = **2** per PRD-080 §5.3 + PRD-061 default.
- **Scope claim required.** The caller's token must include
  `app:{targetAppId}:{operation}` in its scope. Missing scope →
  `cross_app_scope_missing` 403.
- **Deploy-time DAG.** Cortex rejects circular app deps at deploy time.
  Method inherits this — a strategy cannot invoke an app that isn't in the
  current app's `requires.apps[]` manifest block at deploy time.
- **Dual audit with shared `decisionId`.** Both caller and callee log the
  call; Method must surface `targetDecisionId` in its continuation envelope
  so downstream audit correlation works.
- **Caller pays quota.** Cortex PRD-080 §12.9 Q5 recommendation: caller
  pays for the call — the originating app's `ctx.llm` budget and per-app
  quota are debited. Callee's own quotas still apply on top.
- **Best-effort request/reply only.** No distributed transactions. A failed
  cross-app call is a failed node — the strategy handles it per its gate
  policy.

### 2.2 From Method (inherited from earlier surfaces)

- **Zero `@cortex/*` runtime imports in `@method/runtime`.** Cross-app
  invocation must reach Cortex only through a port implemented by an
  adapter in `@method/agent-runtime` (parallels S6 CortexEventConnector).
- **Continuation envelope `version: 1` is frozen (S5).** Cross-app routing
  MUST fit as optional fields on v1 — any shape that requires `version: 2`
  breaks the S5 freeze without a new surface session.
- **Depth-2 delegation cap from S3 may need revisiting.** PRD-059's
  `CortexTokenExchangeMiddleware` rejects depth > 2. A pact that already
  delegated user → agent (depth 1) and now wants to cross-app-invoke
  (depth 2) has ZERO budget for a sub-agent on the callee side. This is a
  **flagged conflict** — see §11 Risks and §10 Assumption A6.
- **Fire-and-forget for audit/events.** Event-bus emission of cross-app
  progress must not fail the parent invocation (G-EVENTS-FIRE-AND-FORGET
  inherited from S6).
- **Faithfulness > simplicity.** If Method's DAG semantics diverge from
  what Cortex PRD-080 actually delivers, Method revises — not the Cortex
  contract.

### 2.3 Blast-radius (strict)

A single `cross-app-invoke` node MUST NOT be able to:

- Drain more than its declared `budget.maxCostUsd` from the calling app's
  `ctx.llm` reservation.
- Hold a continuation slot indefinitely (hard wall-clock cap from
  `maxLifetimeMs` on the envelope).
- Chain indefinitely — depth-2 cap is enforced at token exchange; a third
  hop throws `CortexDelegationDepthExceededError`.
- Poison the strategy — a failing target app surfaces as a node failure
  that the strategy's gate/retry policy resolves, never as a runtime crash
  propagated into the calling app's worker.
- Leak callee cost into the caller's audit without correlation —
  `targetDecisionId` MUST round-trip.

---

## 3. Success Criteria

**All success criteria depend on Cortex PRD-080 shipping.** Method's
independent progress is measured by: surface freeze, gate assertions
passing in stub form, and an in-process simulator for PRD-080 semantics
(see §8 Wave 0).

Once PRD-080 ships:

1. **End-to-end cross-app strategy.** A strategy DAG with a
   `cross-app-invoke` node targeting `feature-dev-agent.commission_fix`
   completes: `incidents-bot` classifies → DAG walks to the cross-app node
   → `ctx.apps.invoke` dispatches → callee returns → calling strategy
   consumes the output in a downstream node. Verified by an E2E fixture
   in `@method/smoke-test`.
2. **Depth-2 cap enforced.** A DAG attempting a third hop
   (`A.strategy → B.strategy → C.strategy → D.strategy`) fails at the
   third hop with `CortexDelegationDepthExceededError`; the strategy
   records the failure and runs its gate recovery.
3. **Quota attribution correct.** Calling app's budget decreases by the
   cross-app call's cost; callee's own `ctx.llm` budget is debited
   separately (as its own agent invocation). Both audit entries share a
   `decisionId`. Verified by a golden test inspecting both apps' audit
   logs.
4. **Failure isolation.** A `cross-app-invoke` node whose target returns
   5xx three times surfaces as a failed node; the strategy's existing
   `gate_failed`/retry machinery handles it exactly as it handles a local
   node failure. No propagation to parent process.
5. **Continuation envelope backward-compatible.** A pact using only
   local nodes serialises/deserialises a `version: 1` envelope byte-for-
   byte identical to pre-PRD-067 (the new fields are absent/undefined).
   Verified by snapshot test against a pre-PRD-067 fixture envelope.
6. **Cross-app events visible.** When a callee pact progresses, its
   `method.*` events (via S6 CortexEventConnector) reach the caller's
   observability pipeline through `ctx.events` subscription — not through
   Method-internal event bus. Verified by a fixture that asserts the
   caller's `onEvent` handler sees a `method.cross_app.target_event`
   wrapper carrying the callee's event payload.

---

## 4. Scope

### 4.1 In scope

- **`CrossAppInvoker` port** (in `@method/runtime/ports/`) — the abstract
  contract method's strategy executor calls. Transport-free.
- **`CortexCrossAppInvoker` adapter** (in `@method/agent-runtime/cortex/`)
  — implements the port by calling `ctx.apps.invoke` (PRD-080's SDK API).
- **`cross-app-invoke` strategy DAG node type** — a new `StrategyNode`
  kind parsed by `strategy-parser.ts` and executed by
  `DagStrategyExecutor` via the port.
- **`ContinuationEnvelope` v1 extension** — optional `crossApp?:
  CrossAppContext` field carrying `callerAppId`, `targetAppId`, `operation`,
  `targetDecisionId`, `delegationDepth`. Fully backward-compatible.
- **Multi-app continuation routing** — when a `cross-app-invoke` node is
  long-running, the runtime suspends to `ctx.jobs` on the caller side; the
  callee's pact runs on its own job queue; resumption on the caller merges
  the callee's output into the DAG state bundle.
- **Routing decision: direct call, NOT event bus.** Cross-app invocation is
  request/reply per Cortex PRD-080 §4 in-scope (fire-and-forget is
  explicitly out of scope). Method's cross-app events (a pact subscribing
  to `method.*` topics from another app) are a **separate** concern
  handled by S6 CortexEventConnector + `ctx.events.subscribeFromApp`,
  already in scope there — NOT reopened here.
- **Manifest generator extension** — `@method/agent-runtime` ships a
  helper that, given a strategy DAG with `cross-app-invoke` nodes,
  generates the `requires.apps[]` block for the tenant app's
  `cortex-app.yaml`.
- **Gate assertions** — see §7.

### 4.2 Out of scope (explicit)

- **Tool-level cross-app calls.** Cortex PRD-080 forbids this; Method
  mirrors.
- **Transactional multi-app DAGs.** No two-phase commit, no rollback
  semantics. A partially-executed cross-app DAG is a resumable pact with
  a failed node, nothing more.
- **Cross-cluster / federated method clusters.** `@method/cluster` covers
  same-cluster federation; multi-cluster cross-app is v2+.
- **Runtime dependency discovery.** A strategy cannot invoke an app that
  isn't declared in the manifest at deploy time. Dynamic `appId` strings
  are rejected at compose time.
- **Cross-app-invoke inside a `sub-agent` pact.** If a pact already
  delegated (depth 1), and wants to cross-app (depth 2), the callee pact
  cannot further sub-agent delegate. This is a hard cap; see §11 Risks.
- **Redirecting to a specific app version at runtime.** Version pins
  resolve at deploy (PRD-080 §5.4); Method doesn't re-resolve.
- **Cross-app approval gates.** A gate node that requires human approval
  from another app's user pool is out of scope; approval stays in the
  calling app's UI (PRD-063's `method.strategy.gate.awaiting_approval`
  topic can still notify other apps via `ctx.events`, but resolution
  happens in-app).

---

## 5. Domain Map

```
@method/runtime/strategies     ── (existing) DAG executor, gates, retros
         │
         │  consumes
         ▼
@method/runtime/ports          ── CrossAppInvoker port (NEW, this PRD)
         ▲
         │  implements (Cortex adapter)
         │
@method/agent-runtime/cortex   ── CortexCrossAppInvoker (NEW, this PRD)
         │
         │  calls ctx.apps.invoke()
         ▼
Cortex platform (PRD-080)      ── POST /v1/platform/apps/invoke
                                  → target app container → pact or tool
```

Cross-domain arrows requiring a frozen surface:

| From | To | Surface | Status |
|------|----|---------|--------|
| `strategies` | `ports` | `CrossAppInvoker` | **NEW — §6** |
| `strategies` | `methodts/strategy` | `cross-app-invoke` node type | **NEW — §6** |
| `ports` | `agent-runtime/cortex` | `CrossAppInvoker` (impl) | **NEW — §6** |
| `strategies` | `runtime/executors` (S5) | extended `ContinuationEnvelope` | **EXTENSION — §6** |
| `agent-runtime/cortex` | Cortex `ctx.apps` | call site | external (PRD-080) |

No new Method domain. All work lives inside existing domains or
PRD-057/058 carve-outs.

---

## 6. Surfaces (Primary Deliverable)

### 6.1 `CrossAppInvoker` port (NEW)

**File (planned):** `packages/runtime/src/ports/cross-app-invoker.ts`

```typescript
/**
 * CrossAppInvoker — the transport-free port the strategy DAG executor
 * calls to dispatch a `cross-app-invoke` node. The @method/runtime layer
 * knows nothing about Cortex; the adapter in @method/agent-runtime/cortex
 * implements this port by calling ctx.apps.invoke (PRD-080).
 *
 * Owner:    @method/runtime (defines port)
 * Producer: @method/agent-runtime/cortex (CortexCrossAppInvoker impl)
 * Consumer: @method/runtime/strategies (DagStrategyExecutor node dispatch)
 *
 * Gate: G-BOUNDARY — no @cortex/* imports in runtime; only the port.
 */
export interface CrossAppInvoker {
  /**
   * Invoke a named operation on a target Cortex tenant app.
   * Fire-and-forget is NOT supported — request/reply only per PRD-080.
   *
   * Implementations:
   *   - CortexCrossAppInvoker: wraps ctx.apps.invoke(appId, operation, input)
   *   - InProcessCrossAppInvoker: for smoke-test/local — routes to a
   *     sibling runtime instance simulating another app; useful while
   *     PRD-080 is still deferred.
   *   - NullCrossAppInvoker: throws CrossAppNotConfiguredError on every
   *     call; the default when ctx.apps is absent.
   */
  invoke<Input = unknown, Output = unknown>(
    request: CrossAppInvokeRequest<Input>,
  ): Promise<CrossAppInvokeResult<Output>>;

  /**
   * Declare capabilities the runtime can check at compose time.
   * Strategy executor asks this before accepting a cross-app-invoke node
   * so that a dev-mode bridge (no Cortex) can fail fast rather than at
   * execution.
   */
  capabilities(): CrossAppInvokerCapabilities;
}

export interface CrossAppInvokeRequest<Input = unknown> {
  /** Target Cortex app id — must be present in the caller's
   *  requires.apps[] manifest block. Enforced by Cortex at invoke time; the
   *  Method adapter also pre-checks via a declared allowlist to fail fast. */
  readonly targetAppId: string;

  /** Operation name (PRD-080: operations, never tools). */
  readonly operation: string;

  /** Typed payload. Shape contract belongs to the target app's
   *  operation schema — the invoker does NOT validate it; caller's
   *  strategy DAG node config declares its expected shape. */
  readonly input: Input;

  /** Optional per-call timeout. Default: executor's defaultTimeoutMs. */
  readonly timeoutMs?: number;

  /** Idempotency key — if the same (targetAppId, operation, idempotencyKey)
   *  is seen twice, the target returns the first result. Pass the strategy
   *  DAG's (sessionId, nodeId) tuple to dedupe across retries. */
  readonly idempotencyKey?: string;

  /**
   * Delegation context carried into RFC 8693 token exchange.
   *   - parentToken: the caller's ctx-issued token (agent-scoped)
   *   - currentDepth: depth the caller has already consumed; adapter rejects
   *                   if currentDepth >= 2 (PRD-061 cap)
   *
   * Provided by the strategy executor from the pact's token context; not
   * something tenant-app code constructs manually.
   */
  readonly delegation: DelegationCarry;

  /** Strategy correlation ids — flow into the caller-side audit entry. */
  readonly caller: { readonly sessionId: string; readonly nodeId: string };
}

export interface CrossAppInvokeResult<Output = unknown> {
  readonly output: Output;

  /**
   * The target app's decisionId, as returned by ctx.apps.invoke.
   * Method appends this to its caller-side audit entry so Cortex PRD-080's
   * dual-audit correlation works end-to-end.
   */
  readonly targetDecisionId: string;

  /** Wall-clock latency measured at the call site (includes token exchange,
   *  scope check, transport, target execution). */
  readonly latencyMs: number;

  /**
   * Cost attributed to the CALLER's budget, as reported by ctx.llm at
   * the moment of dispatch. Callee's own ctx.llm cost is NOT included
   * (callee debits its own budget separately; the caller doesn't see it).
   */
  readonly callerCostUsd: number;
}

export interface CrossAppInvokerCapabilities {
  /** True when the invoker can actually dispatch; false for NullCrossAppInvoker. */
  readonly enabled: boolean;

  /** Max delegation depth the invoker will accept before rejecting at compose.
   *  Echoes PRD-061/PRD-080 default of 2. Adapters MAY declare lower. */
  readonly maxDelegationDepth: number;

  /** Allowed target app ids, derived from manifest requires.apps[]. Empty
   *  means "adapter doesn't enforce — trust Cortex runtime check". */
  readonly allowedTargetAppIds?: ReadonlySet<string>;
}

/** Thrown when ctx.apps is absent but a cross-app-invoke node runs. */
export class CrossAppNotConfiguredError extends Error {
  readonly code: 'CROSS_APP_NOT_CONFIGURED';
}

/** Thrown at compose time when a DAG targets an app not in the manifest. */
export class CrossAppTargetNotDeclaredError extends Error {
  readonly code: 'CROSS_APP_TARGET_NOT_DECLARED';
  constructor(readonly targetAppId: string, readonly allowedTargetAppIds: ReadonlySet<string>);
}

/** Re-exported from @method/agent-runtime when dispatched through Cortex.
 *  Surfaces Cortex PRD-080's cross_app_scope_missing as a typed error. */
export class CrossAppScopeMissingError extends Error {
  readonly code: 'CROSS_APP_SCOPE_MISSING';
  constructor(readonly targetAppId: string, readonly operation: string);
}
```

**Consumer-usage minimality check:**
- `invoke(request)` — called by `DagStrategyExecutor` per `cross-app-invoke`
  node. Single call path.
- `capabilities()` — called once at compose time to assert dev-mode vs
  production wiring; not per-invocation.
- No `listTargets()`, `preflight()`, `subscribe()` — all speculative.
  `allowedTargetAppIds` on `capabilities()` covers the only pre-flight
  need (compose-time allowlist); richer introspection belongs on
  Cortex's `GET /v1/platform/apps/:id`, not on this port.

**Status: frozen (pending PRD-080 signature confirmation — see §10).**

### 6.2 `cross-app-invoke` strategy DAG node type (NEW)

Extension to `StrategyNode` parsed by `strategy-parser.ts` (methodts
territory, consumed by `DagStrategyExecutor`).

```typescript
// In @method/methodts/strategy/dag-types.ts — adds a new node kind
export type StrategyNode =
  | MethodologyNode
  | GateNode
  | SemanticNode
  | CrossAppInvokeNode;   // NEW

export interface CrossAppInvokeNode {
  readonly id: string;
  readonly type: 'cross-app-invoke';
  readonly depends_on: readonly string[];
  readonly outputs: readonly string[];

  readonly config: CrossAppInvokeNodeConfig;
}

export interface CrossAppInvokeNodeConfig {
  /** Target Cortex app id — must match a manifest-declared dep. */
  readonly target_app: string;

  /** Operation name on the target app. */
  readonly operation: string;

  /** Input bundle keys from the DAG state to forward as the operation input.
   *  `{ "q": "$.classified_label" }` projects classified_label from the
   *  upstream DAG bundle into the operation's `q` field. Dot-path syntax
   *  mirrors methodts context-load semantics. */
  readonly input_projection: Readonly<Record<string, string>>;

  /** How to merge the target's output back into the DAG bundle.
   *  - "spread":  Object.assign(bundle, output)
   *  - "namespace": bundle[node.id] = output  (default, safer)
   */
  readonly output_merge?: 'spread' | 'namespace';

  /** Optional idempotency key template — templated against node context.
   *  Default: `${sessionId}:${nodeId}`. */
  readonly idempotency_key?: string;

  /** Optional per-node timeout override. */
  readonly timeout_ms?: number;

  /** Optional per-node budget cap (USD) — hard ceiling enforced by the
   *  adapter before dispatch. Defaults to the DAG's per-node budget. */
  readonly max_cost_usd?: number;
}
```

**YAML example (what tenant-app strategy authors write):**

```yaml
# strategies/incident-to-fix.yaml
nodes:
  classify:
    type: methodology
    methodology: incident-classification
    outputs: [classified_label, severity]
  commission_fix:
    type: cross-app-invoke
    depends_on: [classify]
    outputs: [pr_url, estimated_effort]
    config:
      target_app: feature-dev-agent
      operation: commission_fix
      input_projection:
        label: "$.classify.classified_label"
        severity: "$.classify.severity"
      output_merge: namespace
  announce:
    type: methodology
    methodology: incident-announcement
    depends_on: [commission_fix]
```

**Status: frozen (pending PRD-080 confirmation of operation-invoke shape).**

### 6.3 `ContinuationEnvelope` v1 extension (EXTENSION of S5)

S5 freezes `version: 1`. PRD-067 adds two **optional** fields — additive
only, no wire-format break, no `version: 2`.

```typescript
// @method/runtime/src/ports/continuation-envelope.ts (extension)
export interface ContinuationEnvelope {
  version: 1;                    // unchanged
  sessionId: string;             // unchanged
  turnIndex: number;             // unchanged
  checkpointRef: CheckpointRef;  // unchanged
  budgetRef: BudgetRef;          // unchanged
  nextAction: NextAction;        // unchanged
  pactKey: string;               // unchanged
  tokenContext: TokenContext;    // unchanged (delegationDepth already present)
  emittedAt: number;             // unchanged
  traceId: string;               // unchanged

  /** NEW (optional) — present when this continuation arose from or is
   *  awaiting a cross-app-invoke node. Absent for pure in-app pacts;
   *  envelopes serialised pre-PRD-067 round-trip identically. */
  readonly crossApp?: CrossAppContinuationContext;
}

export interface CrossAppContinuationContext {
  /** The node id in the caller's DAG that triggered the cross-app call. */
  readonly callerNodeId: string;

  /** Target app id + operation the caller dispatched to. */
  readonly targetAppId: string;
  readonly operation: string;

  /** Cortex PRD-080 decisionId returned on the outbound invoke — used to
   *  look up audit correlation and (when async) to poll the callee's
   *  completion. */
  readonly targetDecisionId: string;

  /** Phase of the cross-app call:
   *   - "awaiting_callee"  : caller suspended, callee's pact is running in
   *                          its own app's job queue; resumption happens
   *                          when the caller's ctx.events subscription
   *                          receives method.cross_app.target_event.type=completed
   *   - "completed"        : output merged into DAG bundle, envelope moves on
   *   - "failed"           : target returned error; strategy gate decides retry
   */
  readonly phase: 'awaiting_callee' | 'completed' | 'failed';

  /** Carry of the result on the resume envelope — only populated when
   *  phase === 'completed'. Opaque JSON; merged by output_merge. */
  readonly calleeOutput?: Readonly<Record<string, unknown>>;

  /** Last error from the target if phase === 'failed'. */
  readonly failureReason?: string;
}
```

**Invariant:** if `crossApp` is absent, the envelope is byte-identical to a
pre-PRD-067 `version: 1` envelope (gate `G-ENVELOPE-BACKWARD-COMPAT`).

**Status: EXTENSION of S5. Ratified as "additive only, backward-compat",
does NOT require a new fcd-surface session per S5 §9 extensibility clause:
*"Additional envelope fields — MUST keep version: 1 semantics compatible;
add optional fields only."* This PRD is exactly that case.**

### 6.4 Entity identification

- `CrossAppInvokeRequest` / `CrossAppInvokeResult` — port-local types,
  owned by `@method/runtime/ports/cross-app-invoker.ts`. Not promoted to
  a shared entities package; only the port consumes them.
- `CrossAppContinuationContext` — lives on the envelope, owned by
  `continuation-envelope.ts`. Reuses existing `CheckpointRef` / `BudgetRef`
  shapes.
- `DelegationCarry` — thin wrapper over S3's `CortexTokenExchangeMiddleware`
  token context. Defined locally on the port so runtime doesn't depend on
  agent-runtime types.

No new canonical business entity. No shared-types package update required.

### 6.5 Surface summary table

| Surface | Owner | Producer → Consumer | Status | Gate |
|---------|-------|---------------------|--------|------|
| `CrossAppInvoker` port | `@method/runtime` | `agent-runtime/cortex` → `runtime/strategies` | frozen (pending §10) | G-BOUNDARY, G-PORT |
| `cross-app-invoke` node type | `@method/methodts/strategy` | parser → DagStrategyExecutor | frozen (pending §10) | G-PARSER-NODE-KIND |
| `CrossAppContinuationContext` (envelope ext.) | `@method/runtime` | caller executor → callee-aware resume | frozen (additive ext. of S5) | G-ENVELOPE-BACKWARD-COMPAT |

---

## 7. Per-Domain Architecture

### 7.1 `@method/runtime/strategies`

- Extend `DagStrategyExecutor` to dispatch nodes of kind
  `cross-app-invoke` via the injected `CrossAppInvoker` port.
- Composition root (PRD-057 carve-out) accepts `crossAppInvoker` as an
  optional constructor dep. Default = `NullCrossAppInvoker` — any
  `cross-app-invoke` node in a DAG with null invoker fails at
  `execute()` entry with `CrossAppNotConfiguredError`.
- On node dispatch: project input bundle per `input_projection`, call
  `invoker.invoke(...)`, on success merge output per `output_merge`, emit
  `strategy.cross_app.invoked` runtime event (new type, see §7.4).
- On long-running target (env decision: await or suspend), the executor
  writes a `crossApp.phase='awaiting_callee'` continuation envelope and
  hands off to `JobBackedExecutor` (S5 path, no changes to S5).
- **Layer:** L3 (existing). No new component — extension of
  `DagStrategyExecutor`.

### 7.2 `@method/agent-runtime/cortex`

- New file `packages/agent-runtime/src/cortex/cross-app-invoker.ts`
  implementing `CortexCrossAppInvoker implements CrossAppInvoker`.
- Wraps `ctx.apps.invoke(appId, operation, input, options)` (PRD-080
  SDK signature §5.7). Threads token exchange through
  `CortexTokenExchangeMiddleware` (S3 — same machinery, different hop).
- Pre-check: if `request.delegation.currentDepth >= 2`, throw
  `CortexDelegationDepthExceededError` before calling `ctx.apps`. (Belt
  and suspenders: Cortex also enforces, but failing at our boundary is
  cheaper + surfaces as a typed method error for the strategy gate.)
- Allowlist: reads `requires.apps[]` at agent-runtime boot; populates
  `capabilities().allowedTargetAppIds`. A DAG targeting an app not in
  allowlist fails at compose time via
  `CrossAppTargetNotDeclaredError`.
- Emits audit event per invocation via `CortexAuditMiddleware` (S3) —
  `method.cross_app.invoked` eventType, payload includes
  `targetDecisionId`, `targetAppId`, `operation`, `callerCostUsd`.
- **Layer:** L3 (existing agent-runtime). No new package.

### 7.3 `@method/methodts/strategy`

- Extend `strategy-parser.ts` (bridge-side) to accept `type:
  cross-app-invoke` and validate `config` shape via zod schema.
- Extend `dag-types.ts` in methodts to export `CrossAppInvokeNode` as a
  `StrategyNode` variant.
- No runtime change in methodts — the executor delegates dispatch
  through the port via a new `NodeExecutor` branch owned by the bridge
  adapter (same pattern as `PactaNodeExecutor`). A `CrossAppNodeExecutor`
  class in `@method/runtime/strategies` implements the dispatch.
- **Layer:** L2 (methodts parser + types). L3 adapter in runtime.

### 7.4 Event-bus additions (S6-compatible)

Two new `RuntimeEvent` types, both additive (no union break beyond the
known minor-bump contract from S6):

| RuntimeEvent.type | Cortex topic (ctx.events) | Classification | Audit? | Rationale |
|---|---|---|---|---|
| `strategy.cross_app.invoked` | `method.cross_app.invoked` | `$.targetAppId` L0, `$.callerCostUsd` L1 | yes | Orchestrators and cost apps can react |
| `strategy.cross_app.result` | `method.cross_app.result` | `$.output` L2 | yes | Terminal per call; carries `targetDecisionId` for correlation |

Both are added to `METHOD_TOPIC_REGISTRY` (S6) as a follow-up
registration — no S6 contract change, just registry entries. Gate
`G-AUDIT-SUPERSET` (from S6) is preserved.

### 7.5 Architecture gates

| Gate | Scope | Check |
|------|-------|-------|
| G-BOUNDARY | `@method/runtime/ports/cross-app-invoker.ts` | No `@cortex/*` imports; only port-local types |
| G-PORT | `runtime/strategies` dispatch path | Calls `CrossAppInvoker.invoke`, never `ctx.apps` directly |
| G-PARSER-NODE-KIND | `strategy-parser.ts` | `cross-app-invoke` node parses and round-trips YAML identically |
| G-ENVELOPE-BACKWARD-COMPAT | `continuation-envelope.ts` | Pre-PRD-067 fixture envelope deserialises; re-serialised bytes identical when `crossApp` absent |
| G-DELEGATION-DEPTH-CAP | `CortexCrossAppInvoker` | Invocation with `currentDepth >= 2` throws before calling `ctx.apps` |
| G-TARGET-ALLOWLIST | `CortexCrossAppInvoker` | Invocation to un-declared app throws `CrossAppTargetNotDeclaredError` at compose |
| G-FAILURE-ISOLATION | `DagStrategyExecutor` | Transport error from invoker is caught, surfaces as node failure, never as executor-level exception |
| G-AUDIT-CORRELATION | `CortexAuditMiddleware` | Every `method.cross_app.invoked` audit entry includes `targetDecisionId` |

---

## 8. Phase Plan

Phase plan is **gated on PRD-080 status**. Method can freeze surfaces
and build a simulator now; live integration waits.

### Wave 0 — Surfaces + simulator (can start immediately)

1. Freeze §6 surfaces (this PRD).
2. Create `packages/runtime/src/ports/cross-app-invoker.ts` with the
   port + error classes + `NullCrossAppInvoker` default.
3. Extend `continuation-envelope.ts` with optional `crossApp` field.
4. Ship `InProcessCrossAppInvoker` for `@method/smoke-test` — routes to
   a sibling runtime instance simulating "another app" with a stub
   `ctx.apps` shape that matches our §10 assumptions. This lets us E2E
   test the whole DAG flow without waiting for PRD-080.
5. Add `cross-app-invoke` node type to methodts parser + types.
6. Stub gate assertions (G-BOUNDARY, G-ENVELOPE-BACKWARD-COMPAT can land
   now; gates that require a real `ctx.apps` stub-fail until Wave 2).

**Exit criteria:** surfaces frozen; smoke-test includes one multi-app
strategy running on `InProcessCrossAppInvoker`; bridge E2E test green.

### Wave 1 — Parser, executor, events (can start immediately, parallel to Wave 0 tail)

1. `CrossAppNodeExecutor` in `@method/runtime/strategies`.
2. `DagStrategyExecutor` dispatch branch.
3. Two new `RuntimeEvent` types + registry entries.
4. E2E: incidents-bot-sim → feature-dev-agent-sim in `smoke-test`.

**Exit criteria:** live cross-app DAG executes end-to-end under
simulator; audit events correlate via synthetic `decisionId`.

### Wave 2 — Cortex adapter (BLOCKED ON PRD-080 ship)

1. `CortexCrossAppInvoker` in `@method/agent-runtime/cortex/`.
2. Wire into `createMethodAgent` composition root when `ctx.apps` is
   present.
3. Manifest helper: strategy DAG → `requires.apps[]` generator.
4. Validate §10 assumptions against real PRD-080 surface; file
   amendments for any drift.

**Exit criteria:** real tenant-app smoke test (incidents-bot → feature-
dev-agent) passes against a live Cortex dev stack.

### Wave 3 — Failure paths + health propagation

1. Retry policy interaction (DAG gate `on_failure: retry` on
   `cross-app-invoke` node).
2. PRD-077 `dependenciesHealth` surfacing into the DAG —
   `cross-app-invoke` node short-circuits with
   `dependency_unavailable` when the target is `degraded`.
3. DLQ visibility: a pact suspended with `crossApp.phase='awaiting_callee'`
   whose callee DLQs surfaces a terminal `pact.dead_letter` event
   carrying `crossApp` context.

**Exit criteria:** failure-injection fixtures (callee 5xx, callee
timeout, callee DLQ, callee health degraded) all surface as typed node
failures with the strategy's gate machinery resolving them.

### Wave 4 — Deprecation + version skew

1. Consume PRD-080's `app.operation.deprecated` events via S6 connector.
2. Surface as `strategy.cross_app.operation_deprecated` runtime event.
3. `cortex-app impact` equivalent on Method side — given a method app,
   list every strategy DAG that pins each cross-app operation.

**Exit criteria:** method strategies declaring a deprecated operation
emit warnings at deploy time; operation authors can see which method
strategies depend on them.

---

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **PRD-080 `ctx.apps.invoke` signature differs from §10 assumption** | Medium | Medium — amend `CortexCrossAppInvoker`; port stays stable | Port is transport-free; only the adapter changes. §10 assumption table tracks every concrete assumption for review at PRD-080 freeze. |
| **PRD-080 delegation depth > 2 conflicts with S3's depth-2 cap** (flagged) | Medium | **High** — collapses the "user → agent → cross-app-invoke → sub-agent on callee" composition that many flagship pacts want | See dedicated §9.1 below. Mitigation: route sub-agent delegation THROUGH cross-app-invoke rather than nesting after it; or lobby Cortex to raise cap to 3 for method-certified apps. |
| **Envelope extension collides with future S5 changes** | Low | High — would force a `version: 2` bump | Gate `G-ENVELOPE-BACKWARD-COMPAT` enforces round-trip byte equality when `crossApp` absent; every S5 consumer must tolerate unknown optional fields. |
| **Cortex PRD-080 stays deferred through Wave 5** | High | Medium — Method-side is ready but demoable only in simulator | Wave 0/1 delivery under `InProcessCrossAppInvoker` gives the incidents-bot → feature-dev-agent demo a standalone path. Live Cortex demo waits. |
| **Operation-level boundary creates false-coupling via output schemas** | Medium | Medium — callee schema change breaks caller strategy silently | Strategy DAG declares `outputs:` explicitly; mismatched shape surfaces as node-output validation warning (existing PactaNodeExecutor machinery). Document "cross-app operation output shapes are a contract between apps" in migration guide. |
| **Circular invocations at strategy runtime (not graph)** | Low | High — A.strategy → B.strategy → A.other_strategy can deadlock a slot | Cortex deploy-time cycle check is on the APP-dep graph, not the strategy-dep graph. Mitigation: strategy-level cycle detection at compose time — a DAG may not contain a cross-app-invoke to an app that's currently awaiting a cross-app call into us. (Tracked; implementation in Wave 3.) |
| **Caller pays even on target-side bugs** | Medium | Low — caller sees a cost charge for a failed call | This matches Cortex PRD-080 §12.9 Q5. Surface via audit; the target app's operator sees their own cost attribution separately. |
| **Quota exhaustion on caller blocks all cross-app nodes** | Medium | Medium | Caller's `ctx.llm` budget enforcement applies pre-dispatch; a node that would exceed fails with `BudgetExhaustedError`, strategy gate resolves per policy. |

### 9.1 Token-exchange depth conflict (FLAGGED)

This is the most important unresolved design question and is called out
explicitly per the task brief.

**The conflict:**

- S3's `CortexTokenExchangeMiddleware.exchangeForSubAgent` throws
  `CortexDelegationDepthExceededError` at **depth >= 2**.
- Cortex PRD-080's max delegation depth is **2** (PRD-061 default,
  affirmed in PRD-080 §5.3 and §12.9 Q7).
- A realistic pact composition is:
  1. Depth 0 — user invokes Cortex app.
  2. Depth 1 — app spawns method agent (token exchanged to agent scope).
  3. Depth 2 — agent's strategy DAG hits `cross-app-invoke` → token
     exchanged for `feature-dev-agent` scope.
  4. **Depth 3 — feature-dev-agent's internal pact wants a sub-agent
     (e.g., code-review sub-agent) — REJECTED by S3 middleware AND by
     Cortex.**

**Consequence:** any pact that already used `subagentDelegator` on the
caller side CANNOT `cross-app-invoke`. Any `cross-app-invoke`d callee
CANNOT use `subagentDelegator` at all. Many flagship pacts (feature-dev
uses a reviewer sub-agent internally) break this.

**Mitigations, in preferred order:**

1. **Re-compose at the boundary.** Teach feature-dev-agent's internal
   design to express what-was-a-sub-agent as another `cross-app-invoke`
   to a dedicated code-reviewer-agent app. Flattens the tree; each
   cross-app call is depth 2 from the originating user. This is the
   Cortex-native composition and should be the default pattern in
   Method's documentation.
2. **Lobby Cortex to raise cap to 3 for method-certified apps.** Open a
   PRD-080 amendment request: add an `AppCapability` flag
   `max_delegation_depth: 3` for apps that pass a security review. Risk:
   weakens the depth-2 safety property.
3. **Accept the limitation and document it.** For pacts that genuinely
   need depth > 2 (rare — audit shows only one candidate in our
   pipeline), keep them single-app until PRD-080 v2.

**Decision:** **(1) is the default.** Method documentation (migration
guide + cookbook) steers authors to flatten sub-agent trees into
cross-app-invoke calls. (2) is opened as a discussion item for Cortex
security review; not blocking PRD-067 ship. (3) is the fallback for any
stubborn outlier.

**Open action for Cortex team:** confirm depth-2 cap is final for v1.0
or open an amendment slot. Tracked as assumption A6 in §10.

---

## 10. Cortex Contract Assumptions (must hold at PRD-080 freeze)

These assumptions drive §6 port shape and §7 adapter code. If any is
violated at PRD-080 freeze, the cited artifact changes — in all cases a
scoped, localized change (port stays stable in most scenarios because
it's transport-free).

| # | Assumption | Artifact that changes if wrong |
|---|------------|-------------------------------|
| A1 | `ctx.apps.invoke(appId, operation, input, options)` exists with the signature in PRD-080 §5.7 (returns `{ output, targetDecisionId, latencyMs }`). | `CortexCrossAppInvoker` adapter only. |
| A2 | `targetDecisionId` is a string present on every response (success AND typed error); shared with the target's audit entry. | `CrossAppInvokeResult.targetDecisionId` field kept or renamed. |
| A3 | Cortex rejects cross-app calls without `app:{targetAppId}:{operation}` scope with a stable, catchable error (HTTP 403, code `cross_app_scope_missing`). | `CrossAppScopeMissingError` constructor + adapter error mapping. |
| A4 | Delegation via RFC 8693 is the auth mechanism (Model C from PRD-080 §5.3); token exchange uses the same `ctx.auth.exchangeForAgent` primitive as S3. | `CortexCrossAppInvoker` delegation call-site; otherwise stable. |
| A5 | Per-app manifest `requires.apps[]` is authoritative at deploy time and queryable at runtime to build the allowlist in `capabilities()`. | `CortexCrossAppInvoker` allowlist population only. |
| A6 | **Max delegation depth = 2 remains final for v1.0.** No platform flag raises it. | If cap becomes 3+: §9.1 (a) mitigation remains but (b) becomes available. No port change. |
| A7 | Cost attribution: caller's `ctx.llm` budget is debited; callee's `ctx.llm` is debited separately. Both appear in their respective audit streams. | `CrossAppInvokeResult.callerCostUsd` naming; behavioral assumption. |
| A8 | Target returns `dependency_unavailable` (or equivalent) when the target app is `degraded` via PRD-077, letting us short-circuit at node level. | Wave 3 failure-path code; no surface change. |
| A9 | Idempotency: `ctx.apps.invoke` accepts an `idempotencyKey` in `options` per PRD-080 §5.7 SDK signature. | `CrossAppInvokeRequest.idempotencyKey` wiring; fallback = drop field, accept at-least-once semantics. |
| A10 | Fire-and-forget is NOT added as an alternative mode — request/reply only per PRD-080 §4 OOS + §12 Q1. | §4.2 out-of-scope stays valid; no revisit. |
| A11 | `app.operation.deprecated` events flow through `ctx.events` per PRD-080 §5.6 and are routable via S6 CortexEventConnector. | Wave 4 deprecation handler; no surface change. |
| A12 | Cortex does not mutate the `input` payload between SDK and target handler (it passes through verbatim after scope/auth checks). | `input_projection` semantics; if Cortex normalizes payloads, projector must match. |
| A13 | Operation schemas are accessible at build time (e.g., via `GET /v1/platform/apps/:id` per PRD-080 §7.2) so the manifest generator can type-check `input_projection` shapes. If not: projection is runtime-validated only. | Manifest generator strictness; fallback = runtime validation. |

---

## 11. Acceptance Gates

| Gate | Criteria |
|------|----------|
| Compile | All packages build with the port + node type additions |
| Wave 0 | `InProcessCrossAppInvoker` smoke test green; envelope round-trip snapshot passes |
| G-BOUNDARY | `@method/runtime` imports zero `@cortex/*` at runtime |
| G-PORT | Strategy executor dispatches through `CrossAppInvoker`, never directly |
| G-PARSER-NODE-KIND | YAML round-trip for `cross-app-invoke` node identical pre/post |
| G-ENVELOPE-BACKWARD-COMPAT | Pre-PRD-067 envelope fixture round-trips byte-identical |
| G-DELEGATION-DEPTH-CAP | Adapter rejects currentDepth>=2 before `ctx.apps.invoke` |
| G-TARGET-ALLOWLIST | Non-declared target throws at compose, not at runtime |
| G-FAILURE-ISOLATION | Target 5xx/timeout/DLQ surface as node failures only |
| G-AUDIT-CORRELATION | Every cross-app audit entry carries `targetDecisionId` |
| E2E (Wave 1 simulator) | incidents-bot-sim → feature-dev-agent-sim DAG completes |
| E2E (Wave 2 live) | Same, but against live Cortex dev stack (BLOCKED on PRD-080) |
| Depth-2 integration | Composed pact (user → agent → cross-app) works; depth-3 attempt fails cleanly |

---

## 12. Judgment Calls (for PRD review)

1. **Routing = direct call, not events.** The roadmap §4.3 task brief asks
   "routing via event bus vs direct call — decide." Direct call is the
   right answer because PRD-080 models cross-app invocation as
   request/reply (§4 OOS lists fire-and-forget explicitly) and method
   pacts expect typed output merged into the DAG bundle. Event-bus-style
   invocation would require a separate correlation layer on top of
   `ctx.events` that duplicates what `ctx.apps.invoke` already provides.
   Cross-app *events* (subscription to another app's `method.*` topics)
   remain a separate capability handled by S6 — not reopened here.
2. **Envelope extension, not new envelope version.** Adding optional
   fields to S5's v1 envelope is within its frozen extensibility clause.
   A `version: 2` bump would force every existing consumer to upgrade for
   zero behavioral gain in in-app pacts. This extension is additive by
   construction.
3. **`InProcessCrossAppInvoker` ships now.** Waiting for PRD-080 to thaw
   means Method sits idle 4-6 weeks. The simulator is cheap to build
   (~1 day) and gives the incidents-bot → feature-dev-agent demo a
   credible standalone path. The port abstraction makes the simulator →
   production swap a single composition-root line change.
4. **Depth-3 pattern = re-compose, not lobby.** Default documentation
   guides authors to express deep chains as flat cross-app calls. Opening
   an amendment request to Cortex for depth-3 is a non-blocking
   conversation, not a PRD-067 dependency. This keeps Method compatible
   with every PRD-080 outcome.
5. **No new Method domain.** Everything fits in existing L2/L3
   partitions. A "multi-app" domain would be a premature abstraction —
   there's one port, one adapter, one node type.
6. **Caller-side allowlist, not runtime discovery.** Method pre-checks
   target app in `capabilities().allowedTargetAppIds` at compose. This
   fails fast (minutes at boot, not hours into a run) and mirrors
   Cortex's deploy-time graph check — we inherit Cortex's invariant at
   our layer.

---

## 13. Status Recap

- **Status:** DRAFT-BLOCKED-ON-CORTEX-PRD-080.
- **Unblocked work:** Wave 0 + Wave 1 (surfaces, simulator, parser,
  executor, event registry). Can start today against §6 frozen port.
- **Blocked work:** Wave 2 (live Cortex adapter) requires PRD-080 freeze.
  Waves 3-4 require PRD-080 + PRD-077 in prod.
- **Review required before unblock:** Cortex team confirms §10
  assumptions A1-A13; PR amendment opens for A6 if depth cap becomes a
  flagship blocker.
- **Changes after freeze require:** new `/fcd-surface` session if the
  port shape changes; additive-only adapter changes don't need one.
