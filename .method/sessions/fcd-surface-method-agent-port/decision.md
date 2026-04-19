---
type: co-design-record
surface: "MethodAgentPort"
slug: "method-agent-port"
date: "2026-04-14"
owner: "@methodts/agent-runtime"
producer: "@methodts/agent-runtime (L3, new package — PRD-058)"
consumer: "Cortex tenant app (category: agent, Tier 2 service) — consumes via npm install"
direction: "producer → consumer (unidirectional factory + streaming events back to consumer callback)"
status: frozen
mode: "new"
prd: "058 — @methodts/agent-runtime (Cortex-targeted public API)"
related:
  - docs/roadmap-cortex-consumption.md (S1, item A2, A7)
  - docs/arch/pacta.md
  - packages/pacta/src/engine/create-agent.ts
  - packages/pacta/src/pact.ts
  - packages/pacta/src/events.ts
  - t1-repos/t1-cortex-1/docs/rfcs/RFC-005-app-platform-service-library.md (§10.2, §4.1.5)
blocks: "PRD-059 (CortexLLMProvider + middleware), PRD-061 (SessionStore), PRD-062 (JobBackedExecutor), sample app samples/cortex-incident-triage-agent/"
---

# Co-Design Record — MethodAgentPort

> **S1** of the Cortex Consumption roadmap. The top-level public API a Cortex
> tenant app uses to create, invoke, and observe a method-backed agent. This is
> the *only* surface a normal tenant app imports from `@methodts/agent-runtime` —
> every richer surface (providers, middleware, stores) is a plug-in that
> composes under this one.

## 1. Context

### Why this surface, why now

Cortex RFC-005 §10.2 defines tenant apps of category `agent` as Tier 2
services. Two April-21 demos (autonomous incident triage, autonomous feature
development) require that a Cortex tenant app be able to embed a
method-governed agent with **one import and one call**. Today pacta is the
right abstraction but presumes direct providers and the caller wires
everything. Cortex mandates that **LLM calls, audit, tokens, storage, jobs,
events, and schedule** flow through `ctx.*` (PRDs 068, 065, 071, 075).

`MethodAgentPort` is the place where pacta's declarative pact meets Cortex's
injected `ctx`. It's a thin, opinionated composition layer — not a new
framework. All heavy lifting still lives in pacta; this surface enforces the
composition invariants required to run safely inside a Cortex container.

### Relationship to pacta's existing `createAgent`

`createAgent` is the L3 composition primitive. `createMethodAgent` is an L3+
tenant-app composition primitive. It **wraps** `createAgent` — never replaces
it. A Cortex tenant app calls `createMethodAgent`; a non-Cortex (e.g.
bridge, standalone) deployment may still call `createAgent` directly. Both
must produce compatible `Agent<T>` instances so that downstream middleware
(throttler, budget enforcer, output validator) works unchanged.

**Core invariant:** `createMethodAgent({ ctx, pact }).invoke(req)` must
behave identically to a hand-wired `createAgent({ pact, provider: CortexLLMProvider(ctx), ... }).invoke(req)`
with the standard Cortex middleware stack. The port exists so tenant apps
don't have to write that wiring.

### Ports-and-adapters shape

```
Cortex tenant app (B, consumer)
        │  import { createMethodAgent } from '@methodts/agent-runtime'
        ▼
@methodts/agent-runtime (A, producer) ─── exposes MethodAgentPort
        │
        ├──► @methodts/pacta        (createAgent, middleware, reference agents)
        ├──► @methodts/pacta-provider-cortex   (NEW, PRD-059 — CortexLLMProvider)
        └──► Cortex ctx           (injected, never imported at module top level)
```

Key discipline: **no `@cortex/*` import appears at module load time in
`@methodts/agent-runtime`**. The Cortex contract is expressed by the
`CortexCtx` *type shape* (structural), which the runtime re-declares or
imports as `type`-only. The concrete `ctx` object is received by
`createMethodAgent` at call time. This keeps `@methodts/agent-runtime`
testable without Cortex and publishable as a normal npm package.

## 2. Scope

### What flows

| Thing | Direction | Frequency | Cardinality |
|---|---|---|---|
| `CreateMethodAgentOptions` (config + `ctx` + `pact` + hooks) | B → A | once per agent | 1:1 |
| `MethodAgent<T>` handle | A → B | once per create call | 1:1 |
| `AgentRequest` | B → A | per invocation | 1:N per handle |
| `AgentResult<T>` / typed error | A → B | per invocation | 1:N per handle |
| `AgentEvent` stream | A → B (via `onEvent` callback or async iterable) | many per invocation | 1:many |
| `Resumption` descriptor (sessionId + opaque token) | A ↔ B (returned on suspend, passed in on resume) | per long pact | 1:N per handle |
| Lifecycle control (`dispose`, `abort`, `resume`) | B → A | on demand | 1:N per handle |

### What does NOT flow on this surface

- Raw LLM provider keys — must be `ctx.llm`-only.
- Cortex `AppId`, `UserId`, user tokens — present only on `ctx`; the runtime
  never exposes them back to the tenant app as plain strings. If the tenant
  app needs them, it already has `ctx`.
- Direct access to pacta's internal middleware types — tenant apps configure
  behavior through `CreateMethodAgentOptions` fields, not by passing
  middleware. Advanced tenant apps that *need* to pass middleware fall back
  to `createAgent` directly, out of scope for this port.
- Persistent session state — `MemoryPort` / `SessionStore` bindings are
  *internal* wiring owned by PRD-061. Tenant apps express intent via
  `pact.mode` (oneshot / resumable) and `pact.recovery`, not by passing
  stores.

## 3. Ownership

**Owner:** `@methodts/agent-runtime` (producer). Defines and publishes all
types below. Semver discipline: any change to an exported type is a minor
(additive) or major (breaking) bump on `@methodts/agent-runtime`.

**Consumer:** Cortex tenant apps (`category: agent`, Tier 2). Consumer code
depends on the published types only.

Neither side may extend the interface unilaterally. Extensions require a
new `/fcd-surface` session; breaking changes require simultaneous migration
on both sides (see §7 Compatibility).

## 4. Interface — TypeScript

**File (planned):** `packages/agent-runtime/src/index.ts` (new package,
PRD-058). Publicly exported from `@methodts/agent-runtime`.

### 4.1 The `CortexCtx` injection shape

`@methodts/agent-runtime` re-declares a *structural* subset of the Cortex `ctx`
object. It imports nothing from `@cortex/*` at runtime; a `type`-only import
of `@cortex/sdk` is acceptable if the import is erased at compile time.

```typescript
/**
 * Structural subset of the Cortex tenant-app ctx that @methodts/agent-runtime
 * needs. Providers and middleware in PRD-059 add fields as they wire in.
 *
 * Consumer responsibility: pass the real Cortex ctx. Structural typing
 * means any ctx with these shapes satisfies MethodAgentPort.
 *
 * Producer responsibility: never narrow an existing field without a
 * breaking-change migration. Adding optional fields is non-breaking.
 */
export interface CortexCtx {
  /** Cortex app identity. Used for per-AppId budget + audit attribution. */
  readonly app: { readonly id: string; readonly tier: 'service' | 'tool' | 'web' };

  /** LLM facade (PRD-068). The ONLY path to a model from agent-runtime. */
  readonly llm: CortexLlmFacade;

  /** Audit sink (PRD-065). Every AgentEvent is mirrored to this sink. */
  readonly audit: CortexAuditFacade;

  /** Event bus (PRD-072). Optional — set by CortexEventConnector in PRD-063. */
  readonly events?: CortexEventsFacade;

  /** Per-app KV/document storage (PRD-064). Backs the session store. */
  readonly storage?: CortexStorageFacade;

  /** Job queue (PRD-071). Backs resumable-mode continuations (PRD-062). */
  readonly jobs?: CortexJobsFacade;

  /** Scheduler (PRD-075). Used only by createScheduledMethodAgent (Phase B). */
  readonly schedule?: CortexScheduleFacade;

  /** Token exchange (RFC 8693 per RFC-005 §4.1.5). Required for delegated agents. */
  readonly auth?: CortexAuthFacade;

  /** Structured logger. Falls back to a no-op if absent. */
  readonly log?: CortexLogger;
}

// ---- Opaque facade types — intentionally minimal on the port ----
// Concrete shape is the Cortex SDK's responsibility; this surface only
// names the fields it dispatches on. Full contracts ship with PRD-059.

export interface CortexLlmFacade {
  complete(req: { readonly tier: 'fast' | 'standard' | 'reasoning'; readonly prompt: string; readonly [k: string]: unknown }): Promise<{ readonly text: string; readonly usage: { readonly inputTokens: number; readonly outputTokens: number; readonly costUsd: number }; readonly model: string }>;
  // Additional methods (structured, embed, stream) declared by PRD-059.
}

export interface CortexAuditFacade {
  event(e: { readonly kind: string; readonly actor?: string; readonly subject?: string; readonly payload?: Readonly<Record<string, unknown>> }): Promise<void>;
}

export interface CortexEventsFacade {
  publish(topic: string, payload: Readonly<Record<string, unknown>>): Promise<void>;
}

export interface CortexStorageFacade {
  get(key: string): Promise<Readonly<Record<string, unknown>> | null>;
  put(key: string, value: Readonly<Record<string, unknown>>): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface CortexJobsFacade {
  enqueue(job: { readonly kind: string; readonly payload: Readonly<Record<string, unknown>>; readonly runAfterMs?: number }): Promise<{ readonly jobId: string }>;
}

export interface CortexScheduleFacade {
  register(cron: string, handler: { readonly kind: string; readonly payload: Readonly<Record<string, unknown>> }): Promise<{ readonly scheduleId: string }>;
}

export interface CortexAuthFacade {
  /** RFC 8693 token exchange. depth enforced at ≤ 2 by the middleware. */
  exchangeForAgent(parentToken: string, scope: ReadonlyArray<string>): Promise<{ readonly token: string; readonly expiresAt: number }>;
}

export interface CortexLogger {
  info(msg: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(msg: string, fields?: Readonly<Record<string, unknown>>): void;
  error(msg: string, fields?: Readonly<Record<string, unknown>>): void;
}
```

> Composition-theorem note: every field above is used by at least one shipped
> middleware in PRD-059 / PRD-061 / PRD-062 / PRD-063. Fields without a
> consumer at freeze time are `?` optional; if no consumer appears before
> GA of `@methodts/agent-runtime`, they come out.

### 4.2 `CreateMethodAgentOptions<T>`

```typescript
/**
 * Everything a Cortex tenant app passes to create a method-governed agent.
 *
 * Design rule: every non-ctx, non-pact field has a safe default. The common
 * case should be `createMethodAgent({ ctx, pact })`.
 */
export interface CreateMethodAgentOptions<TOutput = unknown> {
  /** Injected Cortex ctx. Never imported at module top level. */
  readonly ctx: CortexCtx;

  /** The typed contract (pacta Pact<T>, re-exported). */
  readonly pact: Pact<TOutput>;

  /** Fires for every AgentEvent. Synchronous, best-effort. */
  readonly onEvent?: (event: AgentEvent) => void;

  /** Optional alternate async channel. Mutually exclusive with onEvent: if
   *  both set, onEvent wins and events() throws IllegalStateError on call. */
  readonly eventsChannel?: 'async-iterable' | 'callback';

  /**
   * Provider override. Advanced use only. When omitted, the runtime wires
   * CortexLLMProvider(ctx.llm) automatically. Passing a provider directly
   * bypasses ctx.llm budget — NOT permitted when ctx.app.tier === 'service'
   * in production (asserted by runtime in strict mode).
   */
  readonly provider?: AgentProvider;

  /**
   * Middleware toggles. Defaults are production-safe for Cortex:
   *   audit: true, tokenExchange: true, budgetPrecheck: true,
   *   reasoning: pact.reasoning?-derived, context: pact.context?-derived.
   * Setting any flag to false is a deliberate opt-out and is logged at warn.
   */
  readonly middleware?: {
    readonly audit?: boolean;
    readonly tokenExchange?: boolean;
    readonly budgetPrecheck?: boolean;
    readonly throttle?: 'auto' | 'off';
  };

  /**
   * Resumability. Controls whether a suspended agent produces a Resumption
   * token, which is backed by ctx.storage + ctx.jobs (PRD-061, PRD-062).
   * Ignored when pact.mode.type === 'oneshot'.
   */
  readonly resumption?: {
    readonly enabled?: boolean;   // default: derived from pact.mode
    readonly storeNamespace?: string;  // default: `agent/${ctx.app.id}`
  };

  /** Strict mode: rejects unsafe configurations (custom provider, absent
   *  audit, depth>2 delegation) at composition time with ConfigurationError.
   *  Default: true when ctx.app.tier === 'service', false otherwise. */
  readonly strict?: boolean;
}
```

### 4.3 `MethodAgent<T>` — the returned handle

```typescript
/**
 * The consumer's handle to a live method-backed agent.
 *
 * Invoke is the primary entry point. events() is an alternate consumer
 * channel that returns an AsyncIterable over the event stream of the most
 * recent invocation (or all invocations, if observed before first call).
 *
 * Resume and abort target a specific invocation by sessionId.
 */
export interface MethodAgent<TOutput = unknown> {
  /** Frozen copy of the pact this agent was composed with. */
  readonly pact: Pact<TOutput>;

  /** Cumulative state across invocations (same shape as pacta Agent<T>.state). */
  readonly state: AgentState;

  /** Oneshot or first call of a resumable pact. */
  invoke(request: AgentRequest): Promise<MethodAgentResult<TOutput>>;

  /** Re-enter a previously suspended invocation. Throws UnknownSessionError
   *  if the sessionId isn't found in storage. */
  resume(resumption: Resumption, request?: Partial<AgentRequest>): Promise<MethodAgentResult<TOutput>>;

  /** Cooperative cancel. Signals the provider + middleware to abort. */
  abort(sessionId: string, reason?: string): Promise<void>;

  /** Async iterable channel for events (alternative to onEvent callback).
   *  Throws IllegalStateError if options.onEvent was provided. */
  events(): AsyncIterable<AgentEvent>;

  /** Release resources held by the agent (background tasks, open streams,
   *  storage subscriptions). Safe to call multiple times. */
  dispose(): Promise<void>;
}
```

### 4.4 `MethodAgentResult<T>` — result with Cortex annotations

```typescript
/**
 * Extends pacta AgentResult<T> with Cortex-specific fields. Consumers that
 * only care about pacta semantics can structurally assign to AgentResult<T>.
 */
export interface MethodAgentResult<TOutput = unknown> extends AgentResult<TOutput> {
  /** If the pact suspended (recovery === 'resume' and a long job deferred),
   *  a resumption token the tenant app can persist. Undefined on completion. */
  readonly resumption?: Resumption;

  /** AppId under which budget + audit were attributed. Echoes ctx.app.id. */
  readonly appId: string;

  /** Number of ctx.audit.event() calls the runtime made for this invocation. */
  readonly auditEventCount: number;
}

/** Opaque resumption descriptor. Shape is owned by @methodts/agent-runtime;
 *  tenant apps must treat it as a black-box string payload. */
export interface Resumption {
  readonly sessionId: string;
  readonly opaque: string;  // base64-encoded internal state pointer
  readonly expiresAt: number;  // unix ms
}
```

### 4.5 The factory — `createMethodAgent`

```typescript
/**
 * Compose a method-backed agent for a Cortex tenant app.
 *
 * This is the entire public API most tenant apps use.
 *
 * Composition steps (internal, observable in strict mode via ctx.log):
 *   1. Validate ctx shape (structural check on required facades).
 *   2. Validate options.strict implications (e.g., reject custom provider
 *      when tier === 'service' && strict).
 *   3. Build provider: options.provider ?? CortexLLMProvider(ctx.llm).
 *   4. Build middleware stack (auditEmitter, tokenExchange, budgetPrecheck,
 *      throttler) based on options.middleware + ctx.* availability.
 *   5. Delegate to pacta createAgent({ pact, provider, onEvent: fanOut,
 *      context, reasoning, tools, memory }).
 *   6. Wrap with Resumption + abort machinery.
 *
 * Throws (at composition time, fail-fast):
 *   - CapabilityError (re-thrown from pacta) — provider doesn't support mode.
 *   - ConfigurationError — options violate a strict-mode rule.
 *   - MissingCtxError — a required ctx facade is absent given options.
 */
export function createMethodAgent<TOutput = unknown>(
  options: CreateMethodAgentOptions<TOutput>,
): MethodAgent<TOutput>;
```

### 4.6 Errors — inheriting from pacta

All pacta error types are re-exported; agent-runtime adds three:

```typescript
// Re-exported from @methodts/pacta (no behavioral change):
export {
  ProviderError, TransientError, PermanentError,
  RateLimitError, NetworkError, TimeoutError,
  AuthError, InvalidRequestError, CliExecutionError,
  CliSpawnError, CliAbortError,
  CapabilityError,
  BudgetExhaustedError,
  isProviderError, isTransientError, isPermanentError,
} from '@methodts/pacta';

/** Thrown at composition time when CreateMethodAgentOptions is invalid. */
export class ConfigurationError extends Error {
  readonly code: 'CONFIGURATION';
  constructor(message: string, readonly reasons: ReadonlyArray<string>);
}

/** Thrown at composition time when a required ctx.* facade is absent. */
export class MissingCtxError extends Error {
  readonly code: 'MISSING_CTX';
  constructor(readonly missing: ReadonlyArray<keyof CortexCtx>);
}

/** Thrown at resume() time when no session matches the resumption token. */
export class UnknownSessionError extends Error {
  readonly code: 'UNKNOWN_SESSION';
  constructor(readonly sessionId: string);
}

/** Thrown when events() is called but onEvent was provided (or vice versa). */
export class IllegalStateError extends Error {
  readonly code: 'ILLEGAL_STATE';
}
```

**Retry ownership** is inherited from pacta verbatim: providers retry
transients internally; agent-runtime never double-retries; consumers do not
retry `ProviderError` themselves. Composing under Cortex does not change
retry semantics — it only adds audit + budget pre-check side effects.

### 4.7 Re-exported pacta types

To keep consumers from importing `@methodts/pacta` directly (and accidentally
reaching into implementation), `@methodts/agent-runtime` re-exports the
pacta types used by the port:

```typescript
export type {
  Pact, AgentRequest, AgentResult, AgentState,
  AgentEvent,
  ExecutionMode, OneshotMode, ResumableMode, PersistentMode,
  BudgetContract, OutputContract, ScopeContract,
  ContextPolicy, ReasoningPolicy,
  TokenUsage, CostReport, RecoveryIntent,
  AgentProvider,  // only for the advanced `options.provider` escape hatch
} from '@methodts/pacta';
```

## 5. Name validation

Proposed name `createMethodAgent({ ctx, pact, onEvent? })` **validated**.

Considered and rejected:
- `createAgent` — collides with pacta's existing export; `@methodts/pacta` users
  expect `createAgent` to mean the low-level primitive.
- `spawnAgent` — implies process semantics (PTY, child process); the Cortex
  case is in-process composition.
- `defineAgent` — implies declarative-only (no runtime handle returned).
- `createCortexAgent` — ties the *method* runtime to Cortex in the name,
  closing the door to a future `ctx`-shaped adapter for another host.

`createMethodAgent` says: "produces a method-governed agent, parameterized
by the ctx you hand me." That's what it does.

## 6. Producer / Consumer Mapping

### 6.1 Producer

- **Package:** `@methodts/agent-runtime` (L3, NEW — PRD-058)
- **Entry file:** `packages/agent-runtime/src/index.ts`
- **Core composition:** `packages/agent-runtime/src/create-method-agent.ts`
- **Middleware stack home:** `packages/agent-runtime/src/middleware/` (audit,
  token-exchange, budget-precheck — implementations land in PRD-059)
- **Provider home:** `packages/pacta-provider-cortex/src/cortex-llm-provider.ts`
  (NEW, PRD-059 — NOT in agent-runtime itself to preserve the pacta provider
  family convention). `@methodts/agent-runtime` depends on
  `@methodts/pacta-provider-cortex` for the default provider.
- **Wiring:** Tenant apps construct directly via `createMethodAgent(...)`.
  No DI container. The factory is the composition root on the agent-runtime
  side; on the Cortex side, the composition root is the tenant app's entry
  module (owns `ctx` and passes it in).

### 6.2 Consumer

- **Package:** Cortex tenant app of `category: agent` (Tier 2). Reference
  implementation planned at `samples/cortex-incident-triage-agent/` (roadmap
  item A6).
- **Usage file (planned):** `samples/cortex-incident-triage-agent/src/agent.ts`
- **Injection:** Tenant app receives `ctx` from Cortex runtime (RFC-005 §9,
  `export default async function app(ctx: Ctx) { ... }`). It calls
  `createMethodAgent({ ctx, pact })` inside that handler (or caches one
  handle per app boot if the pact is static).
- **Event consumption:** Tenant app passes an `onEvent` callback that
  typically (a) mirrors interesting events to `ctx.notify` (for Slack),
  (b) writes structured entries to `ctx.log`, and (c) updates UI state for
  Tier 3 web apps.

### 6.3 Wiring sketch (for readers, not a spec)

```typescript
// samples/cortex-incident-triage-agent/src/agent.ts
import type { Ctx } from '@cortex/sdk';
import { createMethodAgent, oneshot } from '@methodts/agent-runtime';
import { incidentTriagePact } from './pacts/incident-triage.js';

export default async function app(ctx: Ctx) {
  const agent = createMethodAgent({
    ctx,
    pact: incidentTriagePact,
    onEvent: (e) => { if (e.type === 'text') ctx.notify?.slack(e.content); },
  });
  const result = await agent.invoke({ prompt: ctx.input.text });
  await ctx.audit.event({ kind: 'incident.triaged', payload: { output: result.output } });
  return { ok: true, cost: result.cost.totalUsd };
}
```

## 7. Compatibility Guarantees (semver)

`@methodts/agent-runtime` is versioned independently of `@methodts/pacta`.

| Change | Semver bump |
|---|---|
| Add a new optional field to `CreateMethodAgentOptions` | **minor** |
| Add a new method to `MethodAgent` that has a default implementation | **minor** |
| Add a new `AgentEvent` variant (already a risk inherited from pacta) | **minor** with release-note flag; consumers must switch exhaustively |
| Add a new optional facade to `CortexCtx` | **minor** |
| Widen a parameter type (e.g., add a union member) | **minor** |
| Narrow a return type (e.g., remove a union member) | **minor** |
| Narrow a parameter type, rename a field, remove a field | **major** |
| Change `createMethodAgent` to async | **major** |
| Change default of a `middleware.*` flag | **major** |
| Upgrade pacta peer dep across a major (e.g., 1.x → 2.x) | **major** on agent-runtime |

Pacta is declared as a **peer dependency** so a single version flows
through the tenant app. Agent-runtime declares a version range; out-of-range
pacta triggers a composition-time `ConfigurationError` with a clear message.

## 8. Gate Assertions

To be added to `packages/bridge/src/shared/architecture.test.ts` (project
convention — central arch-gate file). Package-local gate tests live at
`packages/agent-runtime/src/gates/gates.test.ts` (new, mirrors pacta).

```typescript
// G-BOUNDARY: @methodts/agent-runtime does not import from @cortex/* at runtime
describe('G-BOUNDARY: agent-runtime keeps Cortex as injected ctx, not import', () => {
  it('no value import from @cortex/* in agent-runtime src', () => {
    const violations: string[] = [];
    const files = glob('packages/agent-runtime/src/**/*.ts');
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      // Allow `import type {...} from '@cortex/sdk'` (erased at compile).
      // Disallow any other import form.
      const valueImports = [...content.matchAll(/^\s*import\s+(?!type\b)[^;]*from\s+['"]@cortex\//gm)];
      if (valueImports.length > 0) violations.push(file);
    }
    assert.deepStrictEqual(violations, []);
  });
});

// G-PORT: @methodts/agent-runtime's public surface matches the frozen MethodAgentPort
describe('G-PORT: MethodAgentPort surface exports are stable', () => {
  it('exports the expected symbol set', async () => {
    const mod = await import('@methodts/agent-runtime');
    const expected = [
      'createMethodAgent',
      'ConfigurationError', 'MissingCtxError', 'UnknownSessionError', 'IllegalStateError',
      'ProviderError', 'isProviderError', 'isTransientError', 'isPermanentError',
      'CapabilityError', 'BudgetExhaustedError',
    ];
    for (const name of expected) assert.ok(name in mod, `missing export: ${name}`);
  });
});

// G-LAYER: agent-runtime is L3 — no imports from @methodts/bridge (L4)
describe('G-LAYER: agent-runtime does not reach upward to bridge', () => {
  it('no import from @methodts/bridge in agent-runtime src', () => {
    const violations = scanImports('packages/agent-runtime/src', /^@method\/bridge/);
    assert.deepStrictEqual(violations, []);
  });
});
```

## 9. Open Questions — Resolution Table

Every roadmap open question is resolved here at freeze. The entries below
are binding for PRD-058 / 059.

| # | Question | Resolution |
|---|---|---|
| Q1 | Factory name — `createMethodAgent` or alternative? | **`createMethodAgent`.** See §5. |
| Q2 | Event delivery: callback, async iterable, or both? | **Both, mutually exclusive.** `onEvent` callback is default (parity with pacta `createAgent`); `eventsChannel: 'async-iterable'` opts into the `events()` iterable. Setting both throws `IllegalStateError` at call time. Rationale: avoids double-delivery surprises and keeps the common case one-line. |
| Q3 | Who owns token-exchange depth enforcement (producer or Cortex platform)? | **Producer enforces, platform double-checks.** The `CortexTokenExchangeMiddleware` (PRD-059) rejects depth > 2 at composition. Cortex may also reject at the `ctx.auth.exchangeForAgent` boundary per RFC-005 §4.1.5. Two layers of defense; no double-count of depth. |
| Q4 | Does the port support a "custom provider" escape hatch or not? | **Yes, gated by `strict`.** `options.provider` exists for non-production (`tier !== 'service'`) cases and for tests. In strict mode with `tier === 'service'`, passing `provider` throws `ConfigurationError`. Rationale: RFC-005 §10 forbids bypassing `ctx.llm` in production but agent-runtime must be testable without Cortex. |
| Q5 | Resumption token shape — opaque or structured? | **Opaque.** `Resumption.opaque` is a base64 string the tenant app stores as a black box. This lets agent-runtime change the internal representation (storage schema v1→v2) without a major bump. The `sessionId` field is visible for correlation/logging only. |
| Q6 | Do we expose pacta `AgentState` on `MethodAgent`, or a Cortex-annotated variant? | **Expose pacta `AgentState` unchanged.** Adding a parallel `MethodAgentState` would duplicate pacta for no consumer gain. Cortex-specific counters (audit event count, resumption count) live on `MethodAgentResult` per invocation, where they're useful. |
| Q7 | `MethodAgent.events()` — scope to last invocation or all? | **Last invocation.** Subscribing before first invoke returns a live iterable that attaches to whichever invocation fires next. Simpler semantics; the tenant app that wants a multiplexed stream subscribes to `ctx.events` directly. |
| Q8 | `abort()` — cooperative or hard kill? | **Cooperative.** Propagates through pacta `AgentRequest.abortSignal`. Hard-kill semantics (for stuck PTY providers) live in pacta `Killable` port and are out of scope here. |
| Q9 | Budget pre-reservation (roadmap Q2) — reserve via `ctx.llm.reserve` or predictive only? | **Predictive-only at freeze.** The port declares `budgetPrecheck: boolean` as a toggle; the middleware PRD-059 ships the predictive implementation. If Cortex adds `ctx.llm.reserve()` (RFC-005 amendment), the middleware upgrades transparently behind this toggle — no port change. |
| Q10 | `ctx.notify` — is it on the port? | **No.** Tenant apps call `ctx.notify` from their `onEvent` handler. Baking it into agent-runtime would create an opinionated channel policy that's tenant-specific. The port stays minimal. |
| Q11 | Breaking change to pacta `AgentEvent` union — how does agent-runtime handle it? | **Follows pacta.** Agent-runtime versioning matches pacta's for union widenings (minor with exhaustive-switch warning). Removing an event variant is major in both packages. |
| Q12 | Does `createMethodAgent` accept a pre-built `MemoryPort` / `ToolProvider`? | **Not in v1.** Intentional omission. Tenant apps that need custom memory/tools fall back to `createAgent` (advanced path). If demand emerges, adds optional fields as minor bumps. |

No questions remain open. **Status: frozen.**

## 10. Non-Goals (explicit)

- **Multi-agent orchestration.** Spawning sub-agents from inside a pact is a
  pacta concern via `subagentDelegator`; this port does not add a second
  factory for coordinating agents across tenant apps. That's roadmap item 13
  (PRD-080-dependent).
- **Direct `ctx.events` forwarding.** `CortexEventConnector` (PRD-063) is a
  separate concern wired via `options.middleware`; agent-runtime does not
  publish to `ctx.events` by default.
- **Scheduler integration.** `createScheduledMethodAgent` is a Phase B
  separate factory (PRD-062) that composes `createMethodAgent` with
  `ctx.schedule`. Not on this port.
- **Bridge parity.** This port does not expose bridge-specific session/PTY
  controls. Bridge consumption keeps using `@methodts/pacta` directly.

## 11. Agreement

**Frozen:** 2026-04-14
**Owner:** `@methodts/agent-runtime` (PRD-058)
**Unblocks:** PRD-058 implementation, PRD-059 (provider + middleware),
PRD-061 (session store), PRD-062 (scheduler), PRD-063 (event connector),
sample app `samples/cortex-incident-triage-agent/`, roadmap gate A7.

**Changes after freeze require:**
- Additive field (optional, safe default) → inline note + minor version bump.
- New method on `MethodAgent` with default impl → minor version bump.
- Any narrowing, rename, removal, or default-flip → new `/fcd-surface`
  session with migration plan, major version bump.

**Reviewers (implicit via FCD discipline):** Method team (pacta maintainers),
Cortex team (RFC-005 owners). Surface Advocate review required before
PRD-058 merge per FCD Rule 3.
