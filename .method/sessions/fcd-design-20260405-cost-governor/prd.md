---
type: prd
title: "Cost Governor — Predictable Dispatch, Multi-Account Routing, Historical Estimation"
prd_number: 051
date: "2026-04-05"
status: draft (revised post-fcd-review)
domains: [cost-governor, tokens, strategies, pacta, pacta-provider-claude-cli, pacta-provider-anthropic, mcp]
surfaces: [CostOracle, RateGovernor, AccountRouter, HistoricalObservations, ProviderError-taxonomy, strategy_dry_run, CostEvent-union, SealedCredentials]
depends_on: [PRD-023, PRD-026, PRD-027, PRD-017]
blocks: []
council_source: ".method/sessions/fcd-debate-20260405-strategy-cost-optimization/"
review_source: ".method/sessions/fcd-review-20260405-prd051/"
---

# PRD 051 — Cost Governor

## Problem

The Method bridge executes LLM work with **no unified control over cost, throughput, or provider-account selection**. Work is dispatched against a single provider instance per strategy, cost is computed post-hoc per invocation with no cross-run aggregation, there is no rate-limit awareness, and the operator pays for 3× Claude Max subscriptions that the runtime cannot distinguish from a single account. When a queue of work is scheduled (strategies, triggers, genesis orchestration), operators cannot answer: **"What will this cost?"**, **"When will it finish?"**, or **"Which subscription absorbed it?"**

## Constraints

- **Claude subscription rate limits** are authenticated per OS login (keychain / `~/.claude/config.json`). Multi-account routing requires per-account `HOME` or a shift to Anthropic API with per-key rotation.
- **Plan limits (Nov 2025+):** Pro ~45 msgs/5h; Max 5× ~225 msgs/5h; Max 20× ~900 msgs/5h. Weekly caps reset 7d after session start.
- **Operator has 3× Max 20×** subscriptions → theoretical 2700 msgs/5h, ~9 msgs/min sustained.
- **DR-01 (theory vs implementation):** methodology theory is untouched; this is operational infrastructure.
- **Existing substrate:** PRD 023 (domain co-location), PRD 026 (Universal Event Bus), PRD 027 (Pacta middleware pipeline).

## Success Criteria

1. **Predictable cost:** `strategy_dry_run` MCP tool returns per-node + total cost/time estimate with p50/p90 bands. Target: p50 within ±30% of actual on strategies matching historical signatures.
2. **Queueable work with backpressure:** 100 enqueued strategies execute at a sustained rate under Max-20× 5h limits without 429s reaching the DAG executor.
3. **Account load balancing:** N accounts register, invocations distribute per policy (round-robin / fill-first / least-loaded / priority). Per-account utilization observable.
4. **ETA estimation:** known-shape strategies get wall-clock estimates with same p50/p90 discipline as cost.
5. **Zero DR-01 drift:** methodology theory and YAML unchanged.

## Scope

**In:** Rate governor; cost oracle with historical observations; account router; dry-run MCP tool; provider error taxonomy; governance events on UEB.

**Out:** Cross-strategy session pooling (RFC needed); per-node model selection in YAML (follow-up PRD); cross-provider-class failover; tenant/user billing.

## Domain Map

```
                        ┌─────────────────────────────────┐
                        │        cost-governor (NEW)      │
                        │  RateGovernor │ CostOracle │    │
                        │  AccountRouter │ EtaEstimator   │
                        └──┬──────────┬─────────────┬─────┘
                           │          │             │
                           ▼          ▼             ▼
  pacta Throttler     strategies    tokens    pacta providers
  middleware           (dry-run,    (historical   (HOME/APIKey
                       slot hold)   observations)   per invoke)
                                        │
                                        └──→ Event Bus (governance)
```

11 cross-domain interactions: 7 new surfaces, 1 port modification, 4 new event types, 3 reused.

## Surfaces (PRIMARY DELIVERABLE)

> **Port location convention (revised post-review):** All new bridge-cross-domain ports live in `packages/bridge/src/ports/` (top-level, following the established convention used by `event-bus.ts`, `file-system.ts`, `methodology-source.ts`, etc.). Domain-scoped `ports/` subdirectories were rejected as a convention fork.
>
> **Canonical types home (revised):** Cross-package entities (`InvocationSignature`, `ProviderClass`, `CostBand`, `AccountUtilization`, `AccountCapacity`, `AccountSummary`) live in `@methodts/types` (L0). Bridge-internal entities (`ProviderHandle`, `SealedCredentials`, `AccountRoutingPlan`) live alongside their consuming port files. The non-existent `shared/canonical-types/` directory is NOT used.
>
> **Throttler layer-direction (revised):** The `RateGovernor` interface that Throttler middleware consumes is **defined in pacta** (`packages/pacta/src/ports/rate-governor.ts`). Bridge's cost-governor domain **implements** that interface and extends it with bridge-specific methods (`utilization`, `list`, `rotate`). Pacta never imports from bridge.

### S1 — `CostOracle` (strategies/mcp ← cost-governor)

**File:** `packages/bridge/src/ports/cost-oracle.ts`
**Types imported from `@methodts/types`:** `InvocationSignature`, `CostBand`.

```typescript
// @methodts/types (L0) — consumed by bridge + pacta + methodts
interface InvocationSignature {
  methodologyId: string;
  capabilities: readonly string[];  // sorted, canonicalized
  model: string;
  inputSizeBucket: 'xs' | 's' | 'm' | 'l' | 'xl';
}
interface CostBand { p50Usd: number; p90Usd: number; sampleCount: number; confidence: 'low'|'medium'|'high'; }

// packages/bridge/src/ports/cost-oracle.ts (L4)
import type { InvocationSignature, CostBand } from '@methodts/types';
interface NodeEstimate { nodeId: string; signature: InvocationSignature; cost: CostBand; durationMs: CostBand; }
interface StrategyEstimate { nodes: readonly NodeEstimate[]; totalCost: CostBand; totalDurationMs: CostBand; unknownNodes: readonly string[]; }
interface CostOracle {
  /** Walk a DAG and estimate total cost/time via critical-path with parallelism-discount. */
  estimateStrategy(dag: StrategyDag, inputs: InputBundle): Promise<StrategyEstimate>;
  /** Record an actual outcome. Called by cost-governor after releaseSlot. */
  record(sig: InvocationSignature, actualCostUsd: number, actualDurationMs: number, accountId: string): Promise<void>;
}
// INTERNAL (not on public port): estimateSignature, percentile math
```
**Minimality note:** `estimateSignature()` removed from public surface — it was an internal helper to `estimateStrategy()`. `countBySignature()` removed from `HistoricalObservations` (CostBand.sampleCount covers the use case).
Status: **frozen**. Gate: G-BOUNDARY.

### S2 — `RateGovernor` (split between pacta base + bridge extension)

**Base interface file:** `packages/pacta/src/ports/rate-governor.ts` (L3 — pacta-owned, consumed by Throttler middleware)
**Extension file:** `packages/bridge/src/ports/rate-governor.ts` (L4 — extends base with utilization/list/rotate)
**Types imported from `@methodts/types`:** `ProviderClass`, `AccountUtilization`, `AccountCapacity`.

Branded types prevent string-swap bugs:
```typescript
type SlotId = string & { readonly __brand: 'SlotId' };
type AccountId = string & { readonly __brand: 'AccountId' };
```

```typescript
// @methodts/types (L0)
type ProviderClass = 'claude-cli' | 'anthropic-api' | 'ollama';
interface AccountCapacity { burstWindowMsgs: number; weeklyMsgs: number; concurrentCap: number; }
interface AccountUtilization {
  accountId: AccountId; burstWindowUsedPct: number; weeklyUsedPct: number;
  inFlightCount: number; backpressureActive: boolean; status: 'ready'|'saturated'|'unavailable';
}

// packages/pacta/src/ports/rate-governor.ts (L3)
interface DispatchSlot {
  readonly slotId: SlotId; readonly providerClass: ProviderClass; readonly accountId: AccountId;
  readonly acquiredAt: number; readonly estimatedCostUsd: number; readonly maxLifetimeMs: number;
}
interface AcquireOptions {
  providerClass: ProviderClass; estimatedCostUsd: number;
  timeoutMs: number;  // REQUIRED (no longer optional — callers must reason about it)
  abortSignal?: AbortSignal;
}
interface ObserveOutcome {
  slotId: SlotId; actualCostUsd: number; actualDurationMs: number;
  attemptCount: number;  // NEW: provider reports retries it made internally
  outcome: 'success'|'transient_error'|'permanent_error'|'rate_limited'|'timeout';
}
/** Base interface consumed by pacta Throttler middleware. */
interface RateGovernor {
  acquireSlot(opts: AcquireOptions): Promise<DispatchSlot>;
  releaseSlot(outcome: ObserveOutcome): Promise<void>;
}

// packages/bridge/src/ports/rate-governor.ts (L4 — EXTENDS pacta's base)
interface BridgeRateGovernor extends RateGovernor {
  utilization(providerClass: ProviderClass): Promise<readonly AccountUtilization[]>;
  activeSlots(): Promise<readonly DispatchSlot[]>;  // for leak-detection dashboards
}
```

**Slot lifecycle contract (P2.1):**
- `acquireSlot` reserves `estimatedCostUsd × 1.5` up-front; surplus refunded on success.
- `releaseSlot` MUST be called even on failure — throttler uses `try/finally` + `AsyncDisposable`.
- Watchdog sweeps every 30s; slots with `now - acquiredAt > maxLifetimeMs` force-released with `outcome: 'timeout'` + emit `cost.slot_leaked` event.
- Queue admission: if projected wait > `timeoutMs` given refill rate → immediate `SaturationError` (no hopeless queuing).
- Abort during queue wait: listener removes entry in O(log n) via addressable queue.
- Refund matrix: `success` → refund surplus; `rate_limited` → no refund + additional bucket penalty; `permanent_error` (pre-send) → partial refund; `transient_error`/`timeout` → no refund.

Status: **frozen**. Gate: G-BOUNDARY + G-SLOT-PARITY.

### S5 — `HistoricalObservations` (cost-governor ← tokens)

**File:** `packages/bridge/src/ports/historical-observations.ts`
**Types imported from `@methodts/types`:** `InvocationSignature`, `ProviderClass`, `AccountId`.

```typescript
interface Observation {
  signature: InvocationSignature; costUsd: number; durationMs: number;
  tokensIn: number; tokensOut: number; tokensCacheRead: number; tokensCacheWrite: number;
  recordedAt: number; accountId: AccountId; providerClass: ProviderClass;
  hmac: string;  // HMAC(obs_json_without_hmac, bridge_boot_key) — integrity check
}
interface HistoricalObservations {
  /** Query observations matching a signature, newest first. O(1) lookup via in-memory Map index. */
  query(sig: InvocationSignature, limit?: number): Promise<readonly Observation[]>;
  /** Append an observation. Constructed with a capability token — only RateGovernor.releaseSlot() holds it. */
  append(obs: Omit<Observation, 'hmac'>, token: AppendToken): Promise<void>;
}
/** Opaque capability — passed from composition root to RateGovernor only. */
declare const __appendTokenBrand: unique symbol;
type AppendToken = { readonly [__appendTokenBrand]: true };
```
**Minimality note:** `countBySignature` removed — callers use `query().length` or read `CostBand.sampleCount`. Append requires a capability token to prevent poisoning via hostile strategy authors.
Status: **frozen**. Gate: G-BOUNDARY + G-INTEGRITY.

### S11 — `AccountRouter` + `SealedCredentials` (bridge-internal, providers ← cost-governor)

**File:** `packages/bridge/src/ports/account-router.ts`
**Credential-access port (pacta-defined):** `packages/pacta/src/ports/provider-credentials.ts`

`AccountConfig` is a **discriminated union** (rejects cross-provider credential misdirection):

```typescript
// packages/bridge/src/ports/account-router.ts
import type { ProviderClass, AccountCapacity, AccountId } from '@methodts/types';

type AccountConfig =
  | { providerClass: 'claude-cli';    accountId: AccountId; claudeHome: string; capacity: AccountCapacity; priority: number; }
  | { providerClass: 'anthropic-api'; accountId: AccountId; apiKeyEnvName: string; capacity: AccountCapacity; priority: number; }
  | { providerClass: 'ollama';        accountId: AccountId; endpoint: string; priority: number; };
// Zod schema enforces tag-to-field correspondence; both-set configs rejected.

interface AccountSummary {
  accountId: AccountId; providerClass: ProviderClass; priority: number; capacity?: AccountCapacity;
}
type RoutingPolicy = 'round-robin' | 'fill-first' | 'least-loaded' | 'priority';

/** Opaque credential wrapper — NEVER serialize, NEVER log. */
interface SealedCredentials {
  reveal(): Readonly<Record<string, string>>;
  toJSON(): '[REDACTED]';
  toString(): '[REDACTED]';
  [Symbol.toPrimitive](): '[REDACTED]';
  [Symbol.for('nodejs.util.inspect.custom')](): '[REDACTED]';
}

interface ProviderHandle {
  readonly accountId: AccountId;
  readonly providerClass: ProviderClass;
  readonly envOverrides: Readonly<Record<string,string>>;  // HOME, etc. — NOT credentials
  readonly credentials: SealedCredentials;  // non-enumerable; only accessor is .reveal()
}

interface AccountRouter {
  /** Select next account per policy. Returns null if all saturated (caller handles). */
  selectNext(providerClass: ProviderClass, policy: RoutingPolicy): ProviderHandle | null;
  /** Non-admin-scope summary: hashed accountIds, no capacity. Admin: full. */
  list(providerClass: ProviderClass, scope: 'public'|'admin'): readonly AccountSummary[];
  /** Rotate credentials in-place without restart. In-flight slots keep old creds via closures. */
  rotate(accountId: AccountId, newConfig: AccountConfig): void;
}

/** Construction-time factory — no runtime register(). */
declare function createAccountRouter(configs: readonly AccountConfig[]): AccountRouter;
```

**Credential safety contract (P1.5, F-S-1):**
- `credentials` field defined via `Object.defineProperty(handle, 'credentials', { enumerable: false, configurable: false })`.
- Boot-time: AccountRouter reads `process.env[apiKeyEnvName]` into closure, then `delete process.env[apiKeyEnvName]` (purge from parent process).
- claude-cli spawn: child env scrubbed of `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` before exec.
- Startup refusal if `ANTHROPIC_API_KEY` set AND any claude-cli account registered, unless `METHOD_ALLOW_MIXED_CLAUDE_CREDS=true`.

Status: **frozen**. Gates: G-BOUNDARY + G-CREDENTIALS + G-CONFIG-UNION.

### S9 — Provider Error Taxonomy (BREAKING CHANGE)

```typescript
abstract class ProviderError extends Error { abstract readonly kind: 'transient'|'permanent'; providerClass: ProviderClass; accountId?: string; }
abstract class PermanentError extends ProviderError { readonly kind = 'permanent'; }
abstract class TransientError extends ProviderError { readonly kind = 'transient'; retryAfterMs?: number; }
class RateLimitError extends TransientError { /* ... */ }
class AuthError extends PermanentError { /* ... */ }
class NetworkError extends TransientError { /* ... */ }
class TimeoutError extends TransientError { /* ... */ }
// + existing errors re-homed under correct base
```
**Ownership contract:** provider owns transient-retry (exhausts its budget, then throws `TransientError`); DAG owns semantic-retry (only retries on `PermanentError`).
Status: **pending /fcd-surface session**. Gate: G-PORT.

### S6/S7 — `CostEvent` discriminated union (new event types)

**File:** `packages/bridge/src/ports/event-bus.ts` (alongside existing `BridgeEvent` types)

Typed discriminated union with sensitivity annotations. Fields marked `@sensitive` must be hashed/stripped by external connectors:

```typescript
type CostEvent =
  | { type: 'cost.observation_recorded'; domain: 'tokens'; severity: 'info';
      payload: { signature: InvocationSignature; costUsd: number; durationMs: number;
                 /** @sensitive */ accountId: AccountId; correlationId: string; }; }
  | { type: 'cost.account_saturated'; domain: 'cost-governor'; severity: 'warning';
      payload: { /** @sensitive */ accountId: AccountId; providerClass: ProviderClass;
                 window: 'burst'|'weekly'; usedPct: number; correlationId: string; }; }
  | { type: 'cost.rate_limited'; domain: 'cost-governor'; severity: 'warning';
      /** Coalesced per-account per 10s window — single event covers a burst. */
      payload: { /** @sensitive */ accountId: AccountId; providerClass: ProviderClass;
                 retryAfterMs: number; count: number; firstAt: number; lastAt: number; }; }
  | { type: 'cost.estimate_emitted'; domain: 'cost-governor'; severity: 'info';
      payload: { strategyId: string; totalCostP50Usd: number; totalCostP90Usd: number;
                 durationMsP50: number; confidence: 'low'|'medium'|'high'; correlationId: string; }; }
  | { type: 'cost.prediction_diverged'; domain: 'cost-governor'; severity: 'info';
      payload: { strategyId: string; estimatedUsd: number; actualUsd: number;
                 divergencePct: number; correlationId: string; }; }
  | { type: 'cost.slot_leaked'; domain: 'cost-governor'; severity: 'error';
      payload: { slotId: SlotId; /** @sensitive */ accountId: AccountId;
                 ageMs: number; correlationId: string; }; }
  | { type: 'cost.integrity_violation'; domain: 'tokens'; severity: 'error';
      payload: { source: 'observations.jsonl'; lineNumber: number; reason: string; }; }
  | { type: 'cost.observations_corrupted'; domain: 'tokens'; severity: 'error';
      payload: { renamedTo: string; recordsLoaded: number; recordsSkipped: number; }; }
  | { type: 'cost.clock_discontinuity'; domain: 'cost-governor'; severity: 'warning';
      payload: { elapsedMs: number; action: 'reset-to-50pct'|'continue'; }; };
```

**External connector sanitization contract (F-S-3):** `SensitiveFieldSanitizer` port replaces `@sensitive`-tagged fields with `HMAC(value, webhook_secret)` for each external connector. Connector config declares allowlisted event types — deny-by-default.

Status: **frozen**. Gate: reuse existing EventBus gate + new G-EVENT-SANITIZE.

### S10 — `strategy_dry_run` MCP Tool

**Input:** `{ strategyYaml: string; inputBundle?: object; revealAccountPlan?: boolean }`

**Output (default, non-admin):** `{ estimate: StrategyEstimate; unknownNodes: readonly string[]; planSummary: { totalSlots: number; byProviderClass: Record<ProviderClass, number> }; confidenceWarning?: string }`

**Output (admin scope, `revealAccountPlan: true`):** adds `accountPlan: AccountRoutingPlan`.

```typescript
// Bridge-internal type, defined in packages/bridge/src/ports/cost-oracle.ts
interface AccountRoutingPlan {
  nodeAssignments: readonly { nodeId: string; accountId: AccountId; providerClass: ProviderClass }[];
  policy: RoutingPolicy;
}
```

Low-confidence estimates carry `confidenceWarning: "NOT VALIDATED — 3 nodes have no historical data"` text (F-R-3).
Status: **frozen**.

### Cross-Package Canonical Entities

Located in `@methodts/types` (L0 package) — consumed by bridge (L4), pacta (L3), methodts (L2):

| Entity | Location |
|---|---|
| `InvocationSignature` | `@methodts/types` |
| `ProviderClass` | `@methodts/types` |
| `CostBand` | `@methodts/types` |
| `AccountCapacity` | `@methodts/types` |
| `AccountUtilization` | `@methodts/types` |
| `AccountId`, `SlotId` (branded) | `@methodts/types` |

Bridge-internal (co-located with port file):

| Entity | Location |
|---|---|
| `ProviderHandle` | `packages/bridge/src/ports/account-router.ts` |
| `AccountSummary`, `AccountConfig` (union) | `packages/bridge/src/ports/account-router.ts` |
| `AccountRoutingPlan`, `StrategyEstimate`, `NodeEstimate` | `packages/bridge/src/ports/cost-oracle.ts` |
| `DispatchSlot`, `AcquireOptions`, `ObserveOutcome` | `packages/pacta/src/ports/rate-governor.ts` |
| `SealedCredentials`, `AppendToken` | their respective port files |

**`shared/canonical-types/` directory is NOT created** — it doesn't fit the bridge's existing `@methodts/types` + `src/ports/` convention.

### Surface Summary

| # | Surface | File | Owner | Direction | Status | Gates |
|---|---|---|---|---|---|---|
| S1 | `CostOracle` | `bridge/src/ports/cost-oracle.ts` | cost-governor | → strategies/mcp | frozen | G-BOUNDARY |
| S2 (base) | `RateGovernor` | `pacta/src/ports/rate-governor.ts` | pacta | → Throttler middleware | frozen | G-BOUNDARY + G-SLOT-PARITY |
| S2 (ext) | `BridgeRateGovernor` | `bridge/src/ports/rate-governor.ts` | cost-governor | → strategies | frozen | G-BOUNDARY |
| S5 | `HistoricalObservations` | `bridge/src/ports/historical-observations.ts` | tokens | → cost-governor | frozen | G-BOUNDARY + G-INTEGRITY |
| S9 | `ProviderError` taxonomy | `pacta/src/errors.ts` | pacta | → all callers | **BLOCKS Wave 2 until `.method/sessions/fcd-surface-provider-error-taxonomy/record.md` exists** | G-PORT |
| S11 | `AccountRouter` + `SealedCredentials` | `bridge/src/ports/account-router.ts` | cost-governor | → bridge-internal | frozen | G-BOUNDARY + G-CREDENTIALS + G-CONFIG-UNION |
| S11b | `ProviderCredentials` accessor | `pacta/src/ports/provider-credentials.ts` | pacta | → providers | frozen | G-BOUNDARY |
| S6/S7 | `CostEvent` union + sanitizer | `bridge/src/ports/event-bus.ts` | bridge | all | frozen | reuse EventBus + G-EVENT-SANITIZE |
| S10 | `strategy_dry_run` MCP tool | `mcp/src/tools/` | mcp | → cost-governor | frozen | — |

## Per-Domain Architecture

> **Layer reminder:** cost-governor is an **L4 bridge domain** (all bridge domains are L4). Layer stack: L0 `@methodts/types` → L2 `@methodts/methodts` → L3 `@methodts/mcp`/`@methodts/pacta` → L4 `@methodts/bridge`. The PRD's earlier "cost-governor at L2" framing was incorrect.

### cost-governor (NEW L4 bridge domain)
```
packages/bridge/src/domains/cost-governor/
├── cost-oracle-impl.ts         # Implements CostOracle port
├── estimator.ts                # critical-path DAG cost/time with parallelism-discount
├── signature-builder.ts        # canonicalize (methodologyId, caps, model, sizeBucket)
├── rate-governor-impl.ts       # Implements BridgeRateGovernor, wraps pacta RateGovernor
├── token-bucket.ts             # monotonic-clock-based 5h + weekly + concurrency algo
├── bucket-snapshot.ts          # 30s snapshots to .method/data/rate-bucket.json (P2.4)
├── account-router-impl.ts      # Implements AccountRouter via factory
├── sealed-credentials.ts       # SealedCredentials factory with closure-held secrets
├── backpressure-queue.ts       # addressable queue (O(log n) removal for aborts)
├── watchdog.ts                 # slot-leak sweeper (F-R-1)
├── config.ts                   # Zod config schema
├── routes.ts                   # /cost-governor/* HTTP endpoints (admin-scope)
├── README.md
├── index.ts
└── (tests co-located as .test.ts files per bridge convention)
```

Imports allowed: `@methodts/types` (L0), `@methodts/methodts` (L2), `@methodts/pacta` (L3), sibling L4 domains via `packages/bridge/src/ports/` only.

### tokens (EXTENSION)
- New files (flat, per bridge convention — no `ports/` subdir):
  - `observations-store.ts` implements `HistoricalObservations` (from `../../ports/historical-observations.ts`)
  - `observations-rotation.ts` — monthly file rotation, 90-day rollup, memory cap
- JSONL at `.method/data/observations-YYYY-MM.jsonl`; HMAC per line; advisory sidecar lock (P2.2).
- Existing `tracker.ts`, `usage-poller.ts` untouched.

### pacta (MODIFICATION — L3 SDK)
- New files:
  - `src/errors.ts` — full error taxonomy (S9) with `kind` discriminator
  - `src/ports/rate-governor.ts` — **base** `RateGovernor` interface + `DispatchSlot`/`AcquireOptions`/`ObserveOutcome`
  - `src/ports/provider-credentials.ts` — `ProviderCredentials` accessor port (opaque to providers)
  - `src/middleware/throttler.ts` — consumes `RateGovernor` via DI; `AsyncDisposable` pattern + `try/finally`
- Throttler composition order (outermost → innermost): `Throttler` → `BudgetEnforcer` → `OutputValidator` → `provider.invoke()`.
- **Pacta defines the contract; bridge implements it** (layer direction preserved).

### pacta-provider-claude-cli (EXTENSION)
- 429 classification: structured parse first (exit codes, JSON payloads), then regex fallback with corpus-test (F-R-9).
- Accept `envOverrides` for `HOME` switching; scrub `ANTHROPIC_*` from child env before exec (F-S-6).
- Emit typed `RateLimitError`/`AuthError`/`CliExecutionError` extending `TransientError`/`PermanentError`.
- **Spike (blocks Wave 2):** verify `HOME=<alt> claude --print` precedence over env `ANTHROPIC_API_KEY`; Windows HOME vs USERPROFILE precedence; per-account preflight probe (`--help` with 5s timeout).

### pacta-provider-anthropic (EXTENSION)
- 429 parsing with `retry-after` header respect + exponential backoff (3 attempts).
- Per-invocation API key resolved via `ProviderCredentials.reveal()` (opaque accessor from pacta port).
- HTTP client wrapped with header redactor (`x-api-key`, `Authorization`, `Cookie`).

### strategies (EXTENSION)
- Consumes `CostOracle` port (from `packages/bridge/src/ports/cost-oracle.ts`).
- Receives `ProviderFactory` (throttler-wrapped) from composition root — no longer constructs providers directly.

### mcp (EXTENSION)
- Registers `strategy_dry_run` tool — handler reads admin scope before including `accountPlan` in output (F-S-10).

### Composition Root (`server-entry.ts`)
Wiring order:
1. Load `AccountConfig[]` via Zod schema from per-account env vars; purge those env vars after read.
2. `createAccountRouter(configs)` — factory, no runtime `register()`.
3. `ObservationsStore` loads JSONL, rename on corruption, emit diagnostic event.
4. `CostOracleImpl(observationsStore, eventBus)`.
5. `RateGovernorImpl(accountRouter, eventBus, bucketSnapshotStore, watchdogConfig)` — produces `BridgeRateGovernor`.
6. `ProviderFactory`: returns providers wrapped with Throttler middleware consuming the pacta `RateGovernor` interface (bridge's impl satisfies it).
7. Register MCP `strategy_dry_run` tool with admin-scope check.
8. Inject `CostOracle` into strategies domain.
9. Boot-time canary: emit synthetic credential `CANARY_<rand>`, assert scrubbed from every sink (F-S-15).

### Gate Plan

All gates are executable tests in `packages/bridge/src/shared/architecture.test.ts` unless noted.

| Gate | Enforcement | Test name |
|---|---|---|
| G-PORT | Ports typed, no `any`, no leaked internals | `G-PORT: cost-governor interfaces exported only from ports files` |
| G-BOUNDARY | No cross-domain runtime imports except via `packages/bridge/src/ports/` | existing test extended |
| G-LAYER | cost-governor (L4) imports only from L0 `@methodts/types`, L2 `@methodts/methodts`, L3 `@methodts/pacta`, sibling L4 via `ports/` | `G-LAYER: cost-governor L4 dependencies` |
| G-ENTITY | InvocationSignature/ProviderClass/CostBand defined only in `@methodts/types` | `G-ENTITY: canonical types single source` |
| G-CREDENTIALS | Tri-layer: AST scan + runtime canary + regex. No `console.*`/`JSON.stringify`/`util.inspect` on `ProviderHandle`/`AccountConfig`/`SealedCredentials` | `G-CREDENTIALS: AST scan` + `G-CREDENTIALS: runtime canary` |
| G-CONFIG-UNION | Zod schema rejects `AccountConfig` with mismatched provider-class/credential fields | `G-CONFIG-UNION: discriminated union validation` |
| G-SLOT-PARITY | Every `acquireSlot` call syntactically paired with `releaseSlot` in finally | `G-SLOT-PARITY: AST scan of acquire/release pairs` |
| G-INTEGRITY | Observations.jsonl HMAC validated on read; invalid lines skipped+emitted | runtime test in `observations-store.test.ts` |
| G-EVENT-SANITIZE | `@sensitive`-tagged fields replaced by HMAC in external-connector egress | `G-EVENT-SANITIZE: webhook payload inspection` |
| G-BACKPRESSURE | acquireSlot resolves within timeoutMs or throws `SaturationError` | behavioral integration test |
| G-ENV-PURGE | After composition root runs, `process.env.ANTHROPIC_*` is empty | boot-time assertion |

## Operational Invariants & Recovery

This section is normative. It enumerates what is persisted, what is reconstructed, what is lost on crash, what triggers degraded mode, and what events fire during recovery. Derived from fcd-review findings (F-R-1 through F-R-23, F-S-7).

### State Inventory

| State | Location | Persistence | Recovery Path |
|---|---|---|---|
| Token bucket per account | In-memory | 30s snapshot → `.method/data/rate-bucket.json` | On restart: load snapshot, clamp `consumed` by `(now - lastUpdated) × refillRate` |
| Active slots | In-memory only | None | On restart: lost; watchdog zeroes counters. DAG-side retries absorb work |
| Observations | `.method/data/observations-YYYY-MM.jsonl` | Per-line append + batched fsync (100 records or 5s) | On corruption: rename to `.corrupt-<ts>`, start empty, emit `cost.observations_corrupted` SEV=error |
| Credentials | Closure-held in AccountRouter instance | None (env vars purged after boot) | Required on every bridge start |
| Account registration | Composition-root-only (factory) | None (reread from env) | Required on every bridge start |

### Slot Lifecycle Invariants

- `acquireSlot` MUST be paired with `releaseSlot` — enforced by G-SLOT-PARITY AST scan + runtime watchdog.
- Watchdog runs every 30s; slots with `now - acquiredAt > maxLifetimeMs` force-released with `outcome: 'timeout'` + emit `cost.slot_leaked` SEV=error.
- Abort mid-queue: listener removes entry in O(log n); no orphan slots.
- Default `maxLifetimeMs = 2 × estimated durationMs` with floor 60s, ceiling 600s.

### Token-Bucket Clock Safety

- Use `process.hrtime.bigint()` (monotonic) for elapsed-time math.
- Wall-clock used only for week-boundary calculation; trust provider `x-ratelimit-reset` headers over local computation.
- Resume-from-sleep detection: elapsed > 5min → emit `cost.clock_discontinuity`, conservative 50% capacity reset.
- Refill cap: `refilled = min(elapsed × rate, capacity)`. Bucket can never go negative.

### Retry Cost Reconciliation

- Governor reserves `estimatedCostUsd × 1.5` at `acquireSlot`; refunds surplus on `outcome: 'success'`.
- Provider reports `attemptCount` in `ObserveOutcome`; `actualCostUsd > estimatedCostUsd × 1.5` triggers `cost.prediction_diverged`.
- Refund policy matrix:
  | Outcome | Refund | Bucket penalty |
  |---|---|---|
  | success | full surplus | none |
  | transient_error | none | none |
  | rate_limited | none | +1 signal (shrink window) |
  | permanent_error (pre-send) | partial | none |
  | timeout | none | none |
- Provider internal retry budget: hard stop at (timeoutMs − 5s).

### Empty-History Estimator Safety

- Unknown signature returns heuristic: `max(p90 of same methodologyId, $0.05) × sizeBucketMultiplier`.
- `acquireSlot` enforces minimum charge: 1 msg slot + $0.02 regardless of input estimate.
- Inputs `estimatedCostUsd < $0.001` coerced to floor.
- `strategy_dry_run` emits `confidenceWarning` text for low-confidence estimates; operators see "NOT VALIDATED" badge.

### JSONL Durability Invariants

- Line framing: `<json>\n`; malformed lines skipped on boot, `cost.observation_parse_error` emitted per bad line.
- HMAC per line using bridge-boot-key; invalid HMAC → skip + emit `cost.integrity_violation`.
- Monthly rotation: `observations-YYYY-MM.jsonl`; on startup load all months.
- 90-day rollup: per-signature aggregate (count, p50, p90, mean) compacts old JSONL.
- Memory cap: keep last N=1000 observations per signature + aggregate rest. Hard cap 200MB loaded.
- Advisory lock sidecar (`observations.jsonl.lock`); refuse boot if held by another PID.
- File permissions: 0600 Unix; documented ACL policy Windows.

### Startup Health Checks

On boot, bridge emits `bridge.startup_health` with:
- `observationsLoaded`, `observationsSkipped`, `observationsFileSizeBytes`
- `accountsRegistered`, `accountsUnavailable` (from preflight probes)
- `bucketSnapshotAge` (if snapshot file exists)
- `canaryScrubResult` (pass/fail)

If canary leak detected OR `G-ENV-PURGE` fails OR mixed-creds policy violated → **refuse to start** (log SEV=critical, exit non-zero).

### Account Health

- Per-account preflight at boot: `HOME=<alt> claude --print --help` (5s timeout) OR Anthropic API ping; failed accounts marked `status: 'unavailable'`.
- Periodic health probe every 5 min; status transitions emit `cost.account_health_changed`.
- Circuit breaker per account: N consecutive transient failures → status `degraded` for 60s.

### Event Coalescing

- `cost.rate_limited` coalesced per-account per 10s window with `{count, firstAt, lastAt}` payload.
- All events carry `correlationId` + `parentEventId` for UI grouping.
- Per-request telemetry goes to debug logs only, not UEB.

### Rate-Limit Classification Robustness

- Primary: exit-code match + JSON error payload parsing.
- Fallback: regex with anchored HTTP 429 indicator + specific phrase list.
- Corpus test: 20+ real stderr samples asserting correct classification.
- Startup version check: `claude --version` compatibility assertion.
- Debug emission: `cost.rate_limit_classification` with scrubbed stderr snippet.

## Phase Plan

### Wave 0 — Surfaces (2-3 days)
**Deliverables:**
- Canonical types in `@methodts/types` (L0): `InvocationSignature`, `ProviderClass`, `CostBand`, `AccountCapacity`, `AccountUtilization`, `AccountId`, `SlotId` branded types.
- Port files in `packages/bridge/src/ports/`: `cost-oracle.ts`, `rate-governor.ts`, `historical-observations.ts`, `account-router.ts`.
- Pacta port files: `packages/pacta/src/ports/rate-governor.ts` (base contract), `packages/pacta/src/ports/provider-credentials.ts`.
- `CostEvent` discriminated union + `SensitiveFieldSanitizer` port added to `packages/bridge/src/ports/event-bus.ts`.
- `SealedCredentials` type in account-router port file.
- Architecture gates added to `packages/bridge/src/shared/architecture.test.ts`: G-CONFIG-UNION, G-SLOT-PARITY, G-CREDENTIALS (AST layer), G-ENV-PURGE, G-EVENT-SANITIZE.
- Zod schema for `AccountConfig` discriminated union.

**BLOCKERS:**
- S9 `/fcd-surface` session MUST produce `.method/sessions/fcd-surface-provider-error-taxonomy/record.md` before Wave 2 starts.
- Claude CLI `HOME` override spike MUST conclude before Wave 2 starts (see Wave 2).

### Wave 1 — tokens `ObservationsStore` + integrity
JSONL store with HMAC-per-line, monthly rotation, 90-day rollup, advisory lock, crash-safe parse with per-line skip + corruption recovery. Capability-token `AppendToken` pattern. Boot-time diagnostic events. Depends on Wave 0.

### Wave 2 — pacta error taxonomy + provider 429 + spike
- **Pre-work spike (2 days):** (a) verify claude-cli `HOME` override precedence vs `ANTHROPIC_API_KEY` env; (b) Windows HOME vs USERPROFILE behavior; (c) claude-cli version compatibility matrix; (d) 429 stderr format corpus collection (20+ samples).
- Full error hierarchy (S9) with `kind` discriminator; existing error classes re-homed as subclasses preserving `.name`/`.code` for 2 versions (migration audit: grep `err.code`, `err.name`, `err.message.includes`, `JSON.stringify(err)` call sites).
- claude-cli 429 handling: structured parse first, regex fallback, corpus test; child-env scrubbing of `ANTHROPIC_*`.
- anthropic 429 handling with `retry-after` respect; HTTP client header redactor.
- Per-invocation credentials via `ProviderCredentials.reveal()`.
- Depends on Wave 0 + S9 co-design + spike conclusion.

### Wave 3 — cost-governor core
- Monotonic-clock token-bucket + 30s bucket snapshots + resume-from-sleep detection.
- `estimator.ts` critical-path with parallelism-discount, empty-history heuristic + floor charges.
- `CostOracleImpl` reading `HistoricalObservations`.
- `AccountRouterImpl` via factory (`createAccountRouter`), `SealedCredentials` closures, env-var purge.
- `RateGovernorImpl` extending pacta `RateGovernor` with `utilization`/`activeSlots`/`rotate`; backpressure queue (addressable, abort-safe); watchdog sweeper.
- Pacta `Throttler` middleware with `AsyncDisposable` + `try/finally`.
- Event coalescing (10s window) + correlationId propagation.
- Circuit breaker per account.
- Depends on Waves 1 + 2.

### Wave 4 — strategies + mcp wiring + auth
- Composition-root integration: env loading → AccountRouter factory → ObservationsStore → CostOracle → RateGovernor → ProviderFactory.
- Boot-time canary emission + sink verification.
- `strategy_dry_run` MCP tool with admin-scope check (`revealAccountPlan: true` opt-in).
- `/cost-governor/*` HTTP routes with admin-scope auth, rate-limiting, audit events.
- `list(scope: 'public'|'admin')` hashes accountIds for non-admin.
- Per-account OAuth rotation flow: `POST /cost-governor/accounts/:id/rotate` + `cost.account_rotated` event.
- Docs: multi-account setup guide, secrets strategy, auth posture statement.
- Depends on Wave 3.

### Wave 5 — Operational hardening (optional, own review gate)
Genesis UI panel (utilization tiers for non-admin), adaptive throttling with bounded adjustment (0.5× to 1.5× nominal, 3-confirmation direction change, 24h auto-reset, manual pin override), alerting (weekly cap > 90%), CSV export of observations. Wave 5 must pass its own `/fcd-review` before merge.

## Test Plan

Tests are **co-located with the domain they exercise** (FCA DR) and scoped by wave so that each wave's acceptance gate is unambiguous.

### Unit Tests (pure functions, no I/O)

| Subject | Location | What it proves |
|---|---|---|
| `token-bucket.ts` | `cost-governor/tests/` | 5h burst window refill, weekly cap, concurrent-cap interleave; bucket never goes negative; clock-advancement math |
| `signature-builder.ts` | `cost-governor/tests/` | Canonical capability sort, inputSizeBucket thresholds (xs<1KB, s<10KB, m<100KB, l<1MB, xl>=1MB), stable hashing across runs |
| `estimator.ts` | `cost-governor/tests/` | Critical-path computation on 5 DAG shapes (linear, diamond, fan-out, fan-in, pathological); parallelism-discount factor; unknown-node propagation |
| `percentile.ts` (inside oracle-impl) | `cost-governor/tests/` | p50/p90 on synthetic distributions; edge cases (0 samples, 1 sample, identical samples) |
| `account-router-impl.ts` | `cost-governor/tests/` | All 4 policies; saturation returns null; priority ordering; round-robin fairness over 1000 selects |
| `observations-store.ts` | `tokens/tests/` | Append/query round-trip, count-by-signature, boot-time parse restores index, concurrent-append safety |
| `errors.ts` (taxonomy) | `pacta/tests/` | `instanceof` relationships, `kind` discriminator, `retryAfterMs` propagation, `toJSON()` strips stack traces |

**Coverage target:** ≥ 90% line coverage on all files in `cost-governor/core/` and `pacta/src/errors.ts`.

### Integration Tests (real ports, fake I/O)

| Subject | Location | What it proves |
|---|---|---|
| `CostOracleImpl` + in-memory `HistoricalObservations` | `cost-governor/tests/` | Estimate with 0/5/50 samples returns correct confidence tier; `record()` updates subsequent queries |
| `RateGovernorImpl` + `AccountRouterImpl` + in-memory observations | `cost-governor/tests/` | Slot acquisition blocks under saturation; release restores capacity; abort signal frees slot |
| `Throttler` middleware + fake `RateGovernor` + fake provider | `pacta/tests/` | acquireSlot → invoke → releaseSlot ordering; releaseSlot called on provider throw; transient-error outcome tagged |
| `claude-cli-provider` + mock spawn | `pacta-provider-claude-cli/tests/` | 429 stderr → `RateLimitError`; exit-code mapping; `HOME` env-override passed to spawned process |
| `anthropic-provider` + nock | `pacta-provider-anthropic/tests/` | 429 response → retry with `retry-after` respected; exhaustion → `RateLimitError`; 401 → `AuthError` |
| Backpressure queue | `cost-governor/tests/` | Queue ordering (FIFO with priority), timeout → rejection, abort mid-wait → cleanup |

### E2E Tests (bridge instance, real files, synthetic providers)

| Subject | Location | What it proves |
|---|---|---|
| 5-node linear strategy, 1 account, stubbed provider | `bridge/tests/e2e/cost-governor-1acct.test.ts` | Estimate → dispatch → observe loop closes; observations.jsonl grows; events emitted |
| 10-node fanout strategy, 3 accounts, round-robin | `bridge/tests/e2e/cost-governor-3acct.test.ts` | Invocations distribute ~evenly across accounts; no account exceeds burst capacity; `cost.account_saturated` fires when one drains |
| 100-strategy queue, 3 accounts | `bridge/tests/e2e/cost-governor-queue.test.ts` | Throughput ≤ aggregate 5h cap; backpressure holds queue; no 429 reaches DAG layer |
| Provider injected to always-429 | `bridge/tests/e2e/cost-governor-rate-limit.test.ts` | Provider retries 3×, emits `RateLimitError`, DAG does NOT retry |
| `strategy_dry_run` MCP tool | `mcp/tests/e2e/` | Returns StrategyEstimate with unknownNodes populated when no history; matches CostOracle output |

### Architecture Gate Tests

Added to `architecture.test.ts` in Wave 0:

```typescript
test('G-BOUNDARY: strategies imports only from cost-governor/ports', ...);
test('G-BOUNDARY: pacta providers never import cost-governor directly', ...);
test('G-BOUNDARY: mcp tool imports only from cost-governor/ports', ...);
test('G-LAYER: cost-governor depends only on L0, L1, L2', ...);
test('G-ENTITY: InvocationSignature defined only in canonical-types', ...);
test('G-CREDENTIALS: ProviderHandle.credentials never logged', ...);
```

### Performance / Load Tests (Wave 3+)

| Subject | What it proves |
|---|---|
| Token-bucket under 10k acquires/sec | Bucket arithmetic is not the bottleneck |
| ObservationsStore with 100k records | Query-by-signature stays < 10ms (in-memory index) |
| RateGovernor concurrency 100 | No deadlock, no slot leakage, clean abort |

### Regression Safety

- All existing `pacta` tests must pass unchanged after S9 migration (re-homed error classes preserve public names).
- All existing `strategies` tests must pass with throttler middleware disabled (no-governor mode = current behavior).
- Bridge startup without `CLAUDE_ACCOUNTS_JSON` env var must not crash (defaults to single-account Anthropic mode).

---

## Validation Plan

Validation proves the **Success Criteria** are met with measurable thresholds. Each criterion maps to a concrete experiment with pass/fail thresholds.

### V1 — Cost Prediction Accuracy (Success Criterion #1)

**Experiment:** Run 50 strategy executions matching 5 known signatures (10 runs each). For each run, compare `strategy_dry_run` estimate against actual outcome.

**Metrics:**
- `error_pct = |actual - p50| / actual × 100` per run
- `p50_coverage = fraction of runs where actual ∈ [p50 × 0.7, p50 × 1.3]`
- `p90_coverage = fraction of runs where actual ≤ p90`

**Pass thresholds:**
- `median(error_pct) ≤ 30%` across all runs with sampleCount ≥ 20
- `p50_coverage ≥ 0.60`
- `p90_coverage ≥ 0.85`

**Artifact:** `experiments/exp-cost-governor/v1-prediction-accuracy/results.yaml`

### V2 — Queue Throughput & Backpressure (Success Criterion #2)

**Experiment:** Enqueue 100 synthetic strategy executions against a stubbed provider that enforces Max-20× rate limits (900 msgs/5h, 3/min sustained). Measure wall-clock, 429 count, backpressure events.

**Metrics:**
- `completion_time_min` — wall clock to drain queue
- `dag_visible_429_count` — 429s that reached the DAG executor (MUST be 0)
- `provider_internal_429_count` — 429s absorbed by provider backoff
- `theoretical_min_time = 100 / (3 msg/min)` ≈ 33 min for 1 account; 11 min for 3 accounts

**Pass thresholds:**
- `dag_visible_429_count == 0`
- `completion_time_min ≤ theoretical_min_time × 1.2` (≤ 20% overhead)
- At least one `cost.account_saturated` event emitted when bucket drains

**Artifact:** `experiments/exp-cost-governor/v2-queue-throughput/results.yaml`

### V3 — Account Load Balancing (Success Criterion #3)

**Experiment:** Register 3 accounts (A priority 1, B priority 2, C priority 3). Run 300 invocations under each policy: round-robin, fill-first, least-loaded, priority.

**Metrics per policy:**
- `distribution = [count_A, count_B, count_C]`
- `gini_coefficient` of distribution (0 = perfect equality)
- `saturation_events` — count of `cost.account_saturated` emissions

**Pass thresholds:**
- **round-robin:** `max - min ≤ 2` over 300 calls
- **fill-first:** `count_A ≥ count_B ≥ count_C`; account A saturates before B gets traffic
- **least-loaded:** `gini ≤ 0.15`
- **priority:** `count_A > count_B > count_C` monotonic

**Artifact:** `experiments/exp-cost-governor/v3-routing-policies/results.yaml`

### V4 — ETA Estimation Accuracy (Success Criterion #4)

**Experiment:** Same setup as V1 but measure duration bands instead of cost.

**Pass thresholds:** Same as V1 — `median(error_pct) ≤ 30%`, `p90_coverage ≥ 0.85`.

**Artifact:** `experiments/exp-cost-governor/v4-eta-accuracy/results.yaml`

### V5 — DR-01 Theory Invariance (Success Criterion #5)

**Validation (not experimental):**
- Diff `theory/` directory before/after: must be **identical**.
- Diff `registry/` YAML files: must be **identical** (ignoring compilation metadata).
- Diff strategy YAML schemas: must be **identical** (no new top-level fields on methodology nodes).

**Pass threshold:** zero diff in theory/registry/YAML schema.

### V6 — Credential Leakage (Security) — Tri-Layer

**Layer 1 (static AST):** Run G-CREDENTIALS AST scan on `packages/bridge/src/` and `packages/pacta*/src/`. Assertions:
- No `console.log`/`console.debug`/`console.error` call takes `ProviderHandle`, `AccountConfig`, `SealedCredentials`, or any variable named `credentials`/`apiKey`/`token`/`authorization`.
- No `JSON.stringify` call on those types.
- No `util.inspect` call on those types.
- No spread (`{...handle}`) or `Object.entries(handle)` without sanitization.

**Layer 2 (runtime canary):** At bridge boot, inject synthetic credential `CANARY_<rand16>` into AccountRouter's secret map. Monkey-patch every log sink (stdout, winston, event-bus sinks, HTTP response serializer) to scan for the canary value. Emit 1000 synthetic events + make 10 HTTP requests to `/cost-governor/*`. If canary appears in ANY sink → refuse to start (SEV=critical, exit non-zero).

**Layer 3 (regex + hash validation):** Grep all log files + observations.jsonl + event-bus JSONL for:
- `sk-ant-[A-Za-z0-9_-]+`
- JWT shape: `eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`
- `Authorization:\s*Bearer\s+`
- Exact hash match of each loaded credential (SHA256 computed at boot, pre-committed to check)

**Pass threshold:** zero hits across all three layers.

**Artifact:** `experiments/exp-cost-governor/v6-credential-leakage/results.yaml`

### V8 — Observations Integrity + Recovery

**Experiment:** 
1. Write 1000 valid observations → verify all loaded on restart.
2. Corrupt line 500 (random bytes) → restart; verify 999 loaded, SEV=error event emitted, bad line counted in diagnostics.
3. Truncate file mid-line → restart; verify trailing-partial line skipped, `cost.observations_corrupted` NOT fired (normal recovery).
4. Total file corruption (random bytes throughout) → restart; verify file renamed to `.corrupt-<ts>`, empty store start, SEV=error event fired.
5. Inject line with invalid HMAC → restart; verify line skipped, `cost.integrity_violation` emitted.

**Pass thresholds:** all 5 scenarios recover to a usable state; no silent data acceptance of corrupt records.

**Artifact:** `experiments/exp-cost-governor/v8-observations-integrity/results.yaml`

### V9 — Slot-Leak Detection

**Experiment:**
1. Spawn 100 concurrent `acquireSlot` calls against a fake provider that throws before `releaseSlot`.
2. Wait 2 × maxLifetimeMs.
3. Verify: watchdog fired, all slots released, `cost.slot_leaked` events = 100, bucket restored to full capacity.
4. Repeat with abort-during-queue: 100 callers queued, all aborted mid-wait → verify `queue.size == 0` after.

**Pass thresholds:** bucket state restored exactly; zero leaked slots after sweep; zero orphan queue entries.

**Artifact:** `experiments/exp-cost-governor/v9-slot-leaks/results.yaml`

### V7 — Breaking Change Migration (S9)

**Validation:**
- Full test suite passes after taxonomy migration: `npm test` green.
- Manual smoke: invoke a real Anthropic call with invalid API key → `AuthError` thrown (was `AnthropicApiError` before).
- `grep -r "instanceof CliExecutionError" packages/` returns same count pre/post (preserved as subclass).

**Pass threshold:** zero existing-test regressions.

### Validation Sequencing

| Wave | Validates | Gates |
|---|---|---|
| 1 | — (prerequisite for V1/V4) | — |
| 2 | V6, V7 | Must pass before Wave 3 merges |
| 3 | V2, V3 | Must pass before Wave 4 merges |
| 4 | V1, V4 | Must pass before PRD closure |
| 4 | V5 | Continuous check via architecture.test.ts |

---

## Documentation Plan

Per **PR-01** (Guide sync): any change to registry or domains requires doc updates. Documentation lives in three places — `docs/arch/` (one concern per file, DR-12), `docs/guides/` (usage), and per-domain READMEs.

### New docs/arch/ entries (architecture specs, one concern per file)

| File | Content |
|---|---|
| `docs/arch/cost-governor.md` | cost-governor domain overview: purpose, port inventory, token-bucket algorithm, event emissions |
| `docs/arch/account-routing.md` | Account router design: registration, policies, ProviderHandle contract, credential-safety invariants |
| `docs/arch/invocation-signature.md` | Canonical signature semantics: capability canonicalization, inputSizeBucket thresholds, hash stability |
| `docs/arch/provider-error-taxonomy.md` | S9 taxonomy: transient vs permanent contract, retry ownership, migration from pre-taxonomy classes |
| `docs/arch/cost-estimation.md` | Critical-path estimation algorithm, confidence tiers, sparse-data heuristics, divergence detection |

### New docs/guides/ entries

| File | Content |
|---|---|
| `docs/guides/39-multi-account-setup.md` | Operator runbook: setting up multiple `~/.claude-*/` HOME dirs, `claude login` per account, `CLAUDE_ACCOUNTS_JSON` schema + examples |
| `docs/guides/40-strategy-dry-run.md` | How to use `strategy_dry_run` MCP tool, interpreting confidence bands, what to do with unknown nodes |
| `docs/guides/41-cost-telemetry.md` | Governance events catalogue, Genesis UI panels, cost-divergence investigation flow |

### Updated docs/guides/

| File | Update |
|---|---|
| `docs/guides/04-strategy-pipelines.md` | Add section on budget vs rate-governor distinction, dry-run before execute pattern |
| `docs/guides/30-secrets-1password.md` | Add multi-account secret management (per-account API keys via 1Password) |

### Per-domain READMEs (new)

| File | Content |
|---|---|
| `packages/bridge/src/domains/cost-governor/README.md` | Domain essence, port inventory, composition wiring, test organization |
| `packages/bridge/src/shared/canonical-types/README.md` | Catalog of canonical entities, rules for adding new ones, relocation rationale |

### Updated per-domain READMEs

| File | Update |
|---|---|
| `packages/bridge/src/domains/tokens/README.md` | Add `HistoricalObservations` port + `ObservationsStore` section |
| `packages/bridge/src/domains/strategies/README.md` | Add CostOracle dependency, dry-run flow |
| `packages/pacta/README.md` | Error taxonomy section, Throttler middleware section |

### PRD & ADR artifacts

| Artifact | Purpose |
|---|---|
| `docs/prds/051-cost-governor.md` | Copied from this session's PRD when approved; official PRD location |
| `.method/sessions/fcd-surface-provider-error-taxonomy/record.md` | Co-design record for S9 (produced by the `/fcd-surface` session) |
| **Migration guide** (in `docs/guides/42-pacta-error-migration.md`) | Pre/post error-class mapping table, grep patterns for callers, diff examples for common call sites |

### Code-level documentation

- **TSDoc on all frozen ports** — each method documented with contract semantics (who calls, when, what throws, side-effects).
- **Example test fixtures** in `cost-governor/tests/fixtures/` showing canonical account configs, signature examples, DAG shapes.
- **Inline rationale** in `token-bucket.ts` explaining 5h vs weekly vs concurrency math.

### Doc acceptance criteria per wave

| Wave | Docs required for wave to merge |
|---|---|
| 0 | `docs/arch/cost-governor.md` skeleton, canonical-types README |
| 1 | Update `tokens/README.md` |
| 2 | `docs/arch/provider-error-taxonomy.md`, `docs/guides/42-pacta-error-migration.md` |
| 3 | `docs/arch/cost-estimation.md`, `docs/arch/account-routing.md`, `docs/arch/invocation-signature.md`, update `pacta/README.md` |
| 4 | `docs/guides/39-multi-account-setup.md`, `docs/guides/40-strategy-dry-run.md`, `docs/guides/41-cost-telemetry.md`, update `strategies/README.md`, publish `docs/prds/051-cost-governor.md` |
| 5 | Operational runbook for adaptive throttling |

### PR-01 compliance

Every wave's PR checklist must confirm: *"Guide sync check — all registry/domain changes have matching docs updates listed above."* Missing docs block merge.

---

### Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| S9 breaking change blast-radius | HIGH | Dual-emit (old fields + new discriminator) for 2 versions; migration audit greps `.code`/`.name`/`.message.includes`/`JSON.stringify(err)` |
| Credential leakage via ProviderHandle | CRITICAL | Tri-layer G-CREDENTIALS (AST + canary + regex); `SealedCredentials` opaque type w/ custom inspect hooks; non-enumerable field; env-var purge at boot |
| Claude CLI ignores HOME override, uses env API key | CRITICAL | Wave-2 spike mandatory; scrub `ANTHROPIC_*` from child env before exec; refuse boot on mixed-creds config |
| JSONL poisoning → cost-estimation attack | HIGH | HMAC per line; `AppendToken` capability; 0600 file perms |
| Adaptive throttling oscillation | MEDIUM | Wave 5 only, bounded adjustment [0.5×, 1.5×], 3-confirmation direction change, 24h auto-reset |
| In-memory observations OOM | MEDIUM | 1000-per-signature cap + 90d rollup; hard 200MB load limit |
| Slot leak on throw/crash/abort | HIGH | Watchdog sweeper + `AsyncDisposable` pattern + G-SLOT-PARITY AST gate |
| Clock drift / laptop sleep | HIGH | Monotonic clock for elapsed; wall-clock only for week-boundary; trust provider `x-ratelimit-reset` |
| 429 regex false positives | MEDIUM | Structured parse first (exit codes, JSON); corpus test with 20+ samples; version-check claude CLI |
| Account pool reconnaissance via `utilization()`/`accountPlan` | MEDIUM | Admin-scope required for full detail; tiered utilization for non-admin; hashed accountIds |
| Estimator returns 0 USD bypassing throttle | HIGH | Floor charges in acquireSlot ($0.02/1 msg min); reject estimatedCostUsd < $0.001; confidence warning in dry-run |
| Event storm under 429 | MEDIUM | Per-account per-10s coalescing; fine-grained telemetry to debug log only |

### Deferred Items (post-MVP, documented not blocking)

- **F-SC-18** AccountConfigSource port — env parsing stays composition-root-only.
- **F-R-16** Cross-module `instanceof` in monorepos — rely on `kind` discriminator; add `Symbol.for` brand if needed.
- **F-R-18** `countBySignature` perf contract — covered by removing the method.
- **F-R-20** Runtime invariant monitoring (`METHOD_STRICT=1`) — Wave 5.
- **F-R-21** Circuit breaker per account — Wave 3 (promoted from Wave 5).
- **F-R-22** Log-bucketing for inputSize — future refinement after data.
- **F-S-12** Per-account OS-user isolation — documented in Guide 39 as stronger-threat-model path.
- **F-S-13** `utilization()` fine-grained timing side-channel — mitigated by admin-scope; no additional work.

## Open Questions

1. ~~`InvocationSignature` location?~~ **Resolved (fcd-review):** lives in `@methodts/types` (L0 package), consumed by bridge + pacta + methodts. The `shared/canonical-types/` directory proposed in the first draft does not exist and conflicts with the established `@methodts/types` convention.
2. **`HOME` override vs API-key routing?** Ship `HOME`-override for Max economics; Wave 2 spike (mandatory) validates precedence over env `ANTHROPIC_API_KEY`. Fallback to Anthropic-API-key routing only if spike fails.
3. **Per-node model selection?** Separate follow-up PRD (not this scope).
4. **How much of the Wave 5 circuit breaker belongs in Wave 3?** **Decision (fcd-review):** basic per-account circuit breaker (3 states, failure-rate threshold) promoted to Wave 3; adaptive throttling stays Wave 5.
5. **Throttler middleware — pacta owns the contract, bridge implements?** **Resolved:** yes. Pacta defines base `RateGovernor` interface; bridge's `BridgeRateGovernor` extends it. Throttler middleware consumes the pacta base interface, satisfying layer discipline.

## Decision Traces

| Decision | Surface Impact | Action |
|---|---|---|
| Provider owns transient retries | Breaking change to Provider contract | `/fcd-surface pacta strategies "ProviderError taxonomy"` |
| cost-governor as new domain | 3 new ports + 1 consumed port | This PRD |
| Multi-account via HOME override | New AccountConfig.claudeHome field | This PRD, spike first |
| Throttler as middleware (not provider-internal) | Uses pacta middleware composition | This PRD |
| JSONL persistence for observations | Simple, crash-safe | Wave 1 |
