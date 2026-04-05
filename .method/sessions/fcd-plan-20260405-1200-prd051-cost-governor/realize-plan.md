---
type: fcd-realize-plan
prd: "051 — Cost Governor"
prd_path: ".method/sessions/fcd-design-20260405-cost-governor/prd.md"
review_source: ".method/sessions/fcd-review-20260405-prd051/report.md"
date: "2026-04-05"
status: draft
commissions: 10
waves: 7  # Wave 0 + 6 implementation
pre_plan_blockers: [fcd-surface-provider-error-taxonomy, claude-cli-home-spike]
---

# Realization Plan — PRD 051 Cost Governor

## PRD Summary

**Objective:** Introduce a cost-governor bridge domain that throttles LLM dispatches, routes across multiple Claude subscriptions/API accounts, and estimates cost/duration from historical data. Make LLM work predictable, queueable, and account-aware.

**Success Criteria (6):**
1. Predictable cost — `strategy_dry_run` p50 within ±30% of actual
2. Queueable work with backpressure — zero DAG-visible 429s
3. Account load balancing across N accounts
4. ETA estimation with same p50/p90 discipline
5. Zero DR-01 drift (theory untouched)
6. Credential safety (tri-layer V6)

## Pre-Plan Blockers

| Blocker | Scope | Blocks |
|---|---|---|
| **B1: S9 `/fcd-surface` co-design** | Provider error taxonomy (`TransientError`/`PermanentError`, retry ownership) | Wave 0 item W0.4 + commission C-2 |
| **B2: Claude CLI HOME override spike** | 2-day investigation: HOME precedence vs `ANTHROPIC_API_KEY`, Windows HOME vs USERPROFILE, claude-cli version matrix, 429 stderr corpus | Commission C-3 |

Both blockers must resolve before their dependent items can begin. Wave 0 can still ship W0.1, W0.2, W0.3, W0.5, W0.6, W0.7 while B1 is pending (W0.4 is a single file).

## FCA Partition

| Commission | Domain / Package | Wave | Title | Depends On | Consumed Ports |
|---|---|---|---|---|---|
| C-1 | `bridge/domains/tokens` | 1 | ObservationsStore impl + JSONL integrity | W0 | HistoricalObservations |
| C-2 | `pacta` (L3) | 1 | Error taxonomy + Throttler middleware | W0 (+ B1) | RateGovernor base, ProviderCredentials |
| C-5 | `bridge/domains/cost-governor` | 1 | Pure algorithms (token-bucket, estimator, queue) | W0 | — (types only) |
| C-3 | `pacta-provider-claude-cli` | 2 | 429 handling + HOME envOverrides + preflight | C-2 (+ B2) | ProviderCredentials, error taxonomy |
| C-4 | `pacta-provider-anthropic` | 2 | 429 handling + per-invoke credentials + redactor | C-2 | ProviderCredentials, error taxonomy |
| C-6 | `bridge/domains/cost-governor` | 3 | Port impls (oracle, router, governor) + routes | C-1, C-2, C-5 | HistoricalObservations, RateGovernor base, AccountRouter, CostOracle, BridgeRateGovernor |
| C-7 | `bridge/domains/strategies` | 4 | CostOracle consumer + ProviderFactory integration | C-6 | CostOracle, BridgeRateGovernor |
| C-8 | `mcp` (L3) | 4 | `strategy_dry_run` tool + admin-scope check | C-6 | CostOracle |
| C-9 | `bridge/src/server-entry.ts` | 5 | Composition-root wiring + canary + env purge | C-3, C-4, C-6, C-7, C-8 | all |
| C-10 | `experiments/exp-cost-governor/` | 6 | V1-V9 validation artifacts | C-9 | — (observer) |

---

## Wave 0 — Shared Surfaces (Mandatory, Orchestrator-Only)

**No commissions.** All items applied by the orchestrator before any implementation wave begins.

### W0.1 — Canonical Entities (@method/types L0)
**File (NEW):** `packages/types/src/cost-governor.ts`
**Exports:** `InvocationSignature`, `ProviderClass`, `CostBand`, `AccountCapacity`, `AccountUtilization`, `AccountId` (branded), `SlotId` (branded), `AppendToken` (opaque).
**Verification:** `@method/types` builds; bridge, pacta, mcp import without error.

### W0.2 — Bridge Cross-Domain Ports
**Files (NEW):**
- `packages/bridge/src/ports/cost-oracle.ts` → `CostOracle`, `NodeEstimate`, `StrategyEstimate`, `AccountRoutingPlan`
- `packages/bridge/src/ports/rate-governor.ts` → `BridgeRateGovernor extends RateGovernor` (pacta base)
- `packages/bridge/src/ports/historical-observations.ts` → `HistoricalObservations`, `Observation`
- `packages/bridge/src/ports/account-router.ts` → `AccountRouter`, `AccountConfig` (discriminated union), `ProviderHandle`, `SealedCredentials`, `AccountSummary`, `RoutingPolicy`

### W0.3 — Pacta Ports
**Files (NEW):**
- `packages/pacta/src/ports/rate-governor.ts` → base `RateGovernor`, `DispatchSlot`, `AcquireOptions`, `ObserveOutcome`
- `packages/pacta/src/ports/provider-credentials.ts` → `ProviderCredentials` accessor

### W0.4 — Pacta Error Taxonomy Base ⚠️ BLOCKED BY B1
**File (NEW):** `packages/pacta/src/errors-base.ts`
**Exports:** `ProviderError` abstract, `PermanentError`, `TransientError`, error `kind` discriminator pattern.
**Status:** Cannot be written until `/fcd-surface pacta strategies "Provider error taxonomy"` freezes the contract.

### W0.5 — CostEvent Union + Sanitizer
**File (MODIFIED):** `packages/bridge/src/ports/event-bus.ts`
**Addition:** `CostEvent` discriminated union with 9 variants (observation_recorded, account_saturated, rate_limited, estimate_emitted, prediction_diverged, slot_leaked, integrity_violation, observations_corrupted, clock_discontinuity), `@sensitive` TSDoc annotations on fields, `SensitiveFieldSanitizer` port.

### W0.6 — Architecture Gates
**File (MODIFIED):** `packages/bridge/src/shared/architecture.test.ts`
**Additions (6 new test blocks):**
- `G-CONFIG-UNION` — Zod schema rejects mismatched AccountConfig variants
- `G-SLOT-PARITY` — AST scan: every `acquireSlot` paired with `releaseSlot` in finally
- `G-CREDENTIALS (AST)` — no console.*/JSON.stringify/util.inspect on ProviderHandle/AccountConfig/SealedCredentials
- `G-ENV-PURGE` — boot-time check: `process.env.ANTHROPIC_*` empty after composition root
- `G-EVENT-SANITIZE` — @sensitive fields hashed in webhook egress
- `G-INTEGRITY` — HMAC-per-line validation in observations.jsonl

### W0.7 — Zod Schemas (cost-governor config skeleton)
**File (NEW, skeleton only):** `packages/bridge/src/domains/cost-governor/config.ts`
**Content:** `AccountConfig` discriminated union Zod schema, `CostGovernorConfig` schema with defaults (empty impl).

### Wave 0 Verification
```bash
npm run build         # All packages compile
npm test              # Existing tests pass; new gate tests fail with "not implemented" until commissions land
```

**Exit gate:** All Wave 0 files exist, typecheck clean, new gates fail intentionally (pinned "TODO: implementation wave will satisfy").

---

## Wave 1 — Foundations (3-way parallel)

### C-1 — tokens: ObservationsStore + JSONL Integrity

```yaml
id: C-1
phase: PRD Wave 1
title: "ObservationsStore with HMAC integrity, rotation, crash-recovery"
domain: "bridge/domains/tokens"
wave: 1
scope:
  allowed_paths:
    - "packages/bridge/src/domains/tokens/observations-store.ts"
    - "packages/bridge/src/domains/tokens/observations-rotation.ts"
    - "packages/bridge/src/domains/tokens/observations-store.test.ts"
    - "packages/bridge/src/domains/tokens/observations-rotation.test.ts"
    - "packages/bridge/src/domains/tokens/index.ts"        # re-export only
    - "packages/bridge/src/domains/tokens/README.md"
  forbidden_paths:
    - "packages/bridge/src/ports/*"
    - "packages/bridge/src/shared/*"
    - "packages/bridge/src/domains/tokens/tracker.ts"       # untouched
    - "packages/bridge/src/domains/tokens/usage-poller.ts"  # untouched
    - "packages/bridge/src/domains/*/!(tokens)/**"          # sibling domains
    - "packages/bridge/package.json"
depends_on: [W0]
parallel_with: [C-2, C-5]
consumed_ports:
  - name: HistoricalObservations
    status: frozen
    record: "packages/bridge/src/ports/historical-observations.ts (W0.2)"
  - name: CostEvent (for emissions)
    status: frozen
    record: "packages/bridge/src/ports/event-bus.ts (W0.5)"
produced_ports: []  # C-1 is an implementation, not a port producer
deliverables:
  - "observations-store.ts implements HistoricalObservations"
  - "HMAC-per-line append (boot-key HMAC, invalid lines skipped)"
  - "Monthly file rotation (observations-YYYY-MM.jsonl)"
  - "90-day rollup (per-signature aggregates)"
  - "In-memory Map<signatureHash, Observation[]> cap 1000/signature"
  - "Advisory lock sidecar (refuse boot if held)"
  - "Crash-recovery: rename corrupt file, emit cost.observations_corrupted"
  - "Capability token AppendToken enforcement"
  - "fsync batched (100 records or 5s)"
  - "0600 file permissions on Unix; documented Windows ACL"
  - "Integrity tests in observations-store.test.ts (V8 coverage)"
documentation_deliverables:
  - "tokens/README.md — add ObservationsStore section, JSONL format, recovery paths"
acceptance_criteria:
  - "Write 1000 observations, restart, all loaded → PRD AC-1 (data fidelity for CostOracle)"
  - "Corrupt line 500, restart, 999 loaded + 1 skipped emitted → PRD AC-6 (integrity)"
  - "Total file corruption → rename .corrupt-<ts>, empty store, SEV=error event → PRD AC-6"
  - "HMAC invalid → line skipped, cost.integrity_violation emitted → PRD AC-6"
  - "Concurrent-write protection: sidecar lock held → boot refusal → PRD AC-6"
estimated_tasks: 6
branch: "feat/prd051-c1-observations-store"
status: pending
```

### C-2 — pacta: Error Taxonomy + Throttler Middleware

```yaml
id: C-2
phase: PRD Wave 2 (reindexed to fcd-plan Wave 1)
title: "ProviderError hierarchy + Throttler middleware with AsyncDisposable"
domain: "pacta (L3)"
wave: 1
blocked_by_external: "B1: /fcd-surface provider-error-taxonomy must freeze before starting"
scope:
  allowed_paths:
    - "packages/pacta/src/errors.ts"
    - "packages/pacta/src/errors.test.ts"
    - "packages/pacta/src/middleware/throttler.ts"
    - "packages/pacta/src/middleware/throttler.test.ts"
    - "packages/pacta/src/index.ts"          # re-exports only
    - "packages/pacta/README.md"
    - "packages/pacta/src/errors-base.ts"    # concrete subclasses (base shape from W0.4)
  forbidden_paths:
    - "packages/pacta/src/ports/*"           # ports are W0
    - "packages/pacta/src/pact.ts"           # untouched
    - "packages/pacta/src/scope.ts"          # untouched
    - "packages/pacta/src/budget/*"          # untouched
    - "packages/pacta/src/engine/*"          # untouched
    - "packages/pacta/package.json"
depends_on: [W0, W0.4 (post-B1)]
parallel_with: [C-1, C-5]
consumed_ports:
  - name: RateGovernor (base interface)
    status: frozen
    record: "packages/pacta/src/ports/rate-governor.ts (W0.3)"
  - name: ProviderCredentials
    status: frozen
    record: "packages/pacta/src/ports/provider-credentials.ts (W0.3)"
  - name: ProviderError base taxonomy
    status: frozen post-B1
    record: "packages/pacta/src/errors-base.ts (W0.4) + .method/sessions/fcd-surface-provider-error-taxonomy/record.md"
produced_ports:
  - name: ProviderError concrete subclasses
  - name: Throttler middleware
deliverables:
  - "errors.ts: RateLimitError, AuthError, NetworkError, TimeoutError, InvalidRequestError, CliExecutionError as subclasses"
  - "kind discriminator + retryAfterMs propagation"
  - "Dual-emit: old .name/.code fields preserved for 2 versions (migration compatibility)"
  - "Migration audit: grep for err.code/err.name/err.message.includes/JSON.stringify(err) call sites"
  - "throttler.ts: AsyncDisposable + try/finally discipline; acquire→invoke→release lifecycle"
  - "Throttler releases slot on provider throw (tested)"
  - "Abort-signal handling: slot released on abort"
documentation_deliverables:
  - "pacta/README.md — add Error Taxonomy + Throttler Middleware sections"
  - "docs/arch/provider-error-taxonomy.md — transient vs permanent contract"
  - "docs/guides/42-pacta-error-migration.md — pre/post mapping table for callers"
acceptance_criteria:
  - "JSON.stringify(new RateLimitError(...)) schema matches golden fixture → PRD AC-7 (migration)"
  - "instanceof CliExecutionError still works (subclass of PermanentError) → PRD AC-7"
  - "Throttler calls releaseSlot on provider throw → PRD AC-2 (slot leak prevention)"
  - "AbortSignal fires during invoke → slot released with outcome='timeout' → PRD AC-2"
  - "kind='transient' discriminator present on all TransientError subclasses → PRD AC-7"
estimated_tasks: 5
branch: "feat/prd051-c2-pacta-errors-throttler"
status: pending
```

### C-5 — cost-governor: Pure Algorithms

```yaml
id: C-5
phase: PRD Wave 3 (reindexed to fcd-plan Wave 1)
title: "Token-bucket, estimator, signature-builder, backpressure-queue (pure functions)"
domain: "bridge/domains/cost-governor"
wave: 1
scope:
  allowed_paths:
    - "packages/bridge/src/domains/cost-governor/token-bucket.ts"
    - "packages/bridge/src/domains/cost-governor/estimator.ts"
    - "packages/bridge/src/domains/cost-governor/signature-builder.ts"
    - "packages/bridge/src/domains/cost-governor/backpressure-queue.ts"
    - "packages/bridge/src/domains/cost-governor/bucket-snapshot.ts"
    - "packages/bridge/src/domains/cost-governor/percentile.ts"
    - "packages/bridge/src/domains/cost-governor/*.test.ts"
    - "packages/bridge/src/domains/cost-governor/index.ts"     # partial — algorithm exports only
  forbidden_paths:
    - "packages/bridge/src/ports/*"
    - "packages/bridge/src/shared/*"
    - "packages/bridge/src/domains/*/!(cost-governor)/**"
    - "packages/bridge/src/domains/cost-governor/cost-oracle-impl.ts"     # C-6 scope
    - "packages/bridge/src/domains/cost-governor/account-router-impl.ts"  # C-6 scope
    - "packages/bridge/src/domains/cost-governor/rate-governor-impl.ts"   # C-6 scope
    - "packages/bridge/src/domains/cost-governor/sealed-credentials.ts"   # C-6 scope
    - "packages/bridge/src/domains/cost-governor/routes.ts"               # C-6 scope
    - "packages/bridge/src/domains/cost-governor/watchdog.ts"             # C-6 scope
    - "packages/bridge/src/domains/cost-governor/config.ts"               # W0.7
depends_on: [W0.1 (types), W0.7 (config skeleton)]
parallel_with: [C-1, C-2]
consumed_ports: []  # pure functions, types only
produced_ports: []  # internal algorithms, not a port producer
deliverables:
  - "token-bucket.ts: monotonic clock (process.hrtime.bigint), 5h burst + weekly + concurrent-cap math"
  - "Bucket-snapshot: 30s periodic persist to .method/data/rate-bucket.json + restart-clamp logic"
  - "Resume-from-sleep: elapsed > 5min → 50% capacity reset + emit flag"
  - "estimator.ts: critical-path DAG cost/time with parallelism-discount factor"
  - "Empty-history heuristic: max(p90 of methodologyId, $0.05) × sizeBucketMultiplier"
  - "signature-builder.ts: canonical capability sort + inputSizeBucket thresholds + stable hash"
  - "backpressure-queue.ts: addressable (O(log n) removal), FIFO+priority, abort-safe"
  - "Heavy unit test coverage: 5 DAG shapes (linear, diamond, fan-out, fan-in, pathological)"
documentation_deliverables:
  - "cost-governor/README.md — skeleton with algorithm documentation pointers"
  - "docs/arch/cost-estimation.md — critical-path algorithm, confidence tiers, sparse-data heuristics"
  - "docs/arch/invocation-signature.md — canonicalization, size buckets, hash stability"
acceptance_criteria:
  - "Token-bucket refill never exceeds capacity → PRD AC-2"
  - "Backward clock jump does not crash or over-charge → PRD AC-2 (clock safety)"
  - "5-shape DAG estimation: p50_coverage ≥ 0.60 on synthetic fixtures → PRD AC-1"
  - "Empty signature → low-confidence band, never 0 USD → PRD AC-1"
  - "1000 concurrent acquires from queue: correct FIFO+priority ordering → PRD AC-2"
  - "Abort 100 queued entries simultaneously → queue.size == 0 after → PRD AC-2"
estimated_tasks: 6
branch: "feat/prd051-c5-cost-governor-algorithms"
status: pending
```

---

## Wave 2 — Provider 429 Handling (2-way parallel)

### C-3 — pacta-provider-claude-cli: 429 + HOME + Preflight

```yaml
id: C-3
phase: PRD Wave 2 (extension)
title: "429 classification + HOME envOverrides + ANTHROPIC_* scrub + preflight probe"
domain: "pacta-provider-claude-cli (L3)"
wave: 2
blocked_by_external: "B2: HOME override spike must conclude"
scope:
  allowed_paths:
    - "packages/pacta-provider-claude-cli/src/**"
    - "packages/pacta-provider-claude-cli/README.md"
    - "packages/pacta-provider-claude-cli/test-fixtures/stderr-corpus/**"
  forbidden_paths:
    - "packages/pacta-provider-claude-cli/package.json"
    - "packages/pacta/**"
    - "packages/pacta-provider-anthropic/**"
    - "packages/bridge/**"
depends_on: [C-2]
parallel_with: [C-4]
consumed_ports:
  - name: ProviderCredentials
    status: frozen
    record: "packages/pacta/src/ports/provider-credentials.ts (W0.3)"
  - name: RateLimitError, AuthError, CliExecutionError (from pacta errors)
    status: frozen post-C-2
    record: "packages/pacta/src/errors.ts (C-2 deliverable)"
produced_ports: []
deliverables:
  - "cli-executor.ts: structured parse of exit codes + JSON error payloads"
  - "Regex fallback for 429 with HTTP 429 anchor + specific phrases"
  - "Corpus test: 20+ real stderr samples classified correctly"
  - "Exponential backoff: 3 attempts, jittered, respect retry-after"
  - "Provider throws RateLimitError with retryAfterMs after exhaustion"
  - "envOverrides: HOME switching via spawn options"
  - "Child env scrub: delete ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN before exec"
  - "Per-account preflight: HOME=<alt> claude --help (5s timeout) at boot"
  - "Periodic health probe (5min interval)"
  - "Version-compatibility check on startup"
  - "Windows HOME vs USERPROFILE handling (spike-documented)"
documentation_deliverables:
  - "pacta-provider-claude-cli/README.md — HOME override + 429 classification"
  - "docs/guides/39-multi-account-setup.md — claude login per HOME + threat model"
acceptance_criteria:
  - "20-sample corpus: correct classification rate 100% → PRD AC-2"
  - "ANTHROPIC_API_KEY present in parent env + claude-cli account → startup refusal (or override) → PRD AC-6"
  - "Preflight fails for bad HOME → account marked 'unavailable', skipped by router → PRD AC-2"
  - "RateLimitError includes retryAfterMs when header present → PRD AC-2"
  - "HOME override respected (spike validates this in advance) → PRD AC-3"
estimated_tasks: 6
branch: "feat/prd051-c3-claude-cli-provider"
status: pending
```

### C-4 — pacta-provider-anthropic: 429 + Per-Invoke Credentials

```yaml
id: C-4
phase: PRD Wave 2 (extension)
title: "429 with retry-after + per-invocation API key + HTTP header redactor"
domain: "pacta-provider-anthropic (L3)"
wave: 2
scope:
  allowed_paths:
    - "packages/pacta-provider-anthropic/src/**"
    - "packages/pacta-provider-anthropic/README.md"
  forbidden_paths:
    - "packages/pacta-provider-anthropic/package.json"
    - "packages/pacta/**"
    - "packages/pacta-provider-claude-cli/**"
    - "packages/bridge/**"
depends_on: [C-2]
parallel_with: [C-3]
consumed_ports:
  - name: ProviderCredentials
    status: frozen
    record: "packages/pacta/src/ports/provider-credentials.ts (W0.3)"
  - name: RateLimitError, AuthError, NetworkError (from pacta errors)
    status: frozen post-C-2
    record: "packages/pacta/src/errors.ts (C-2 deliverable)"
produced_ports: []
deliverables:
  - "anthropic-provider.ts: 429 parsing with retry-after header respect"
  - "Exponential backoff, 3 attempts, retry-after honored when present"
  - "Per-invocation API key via ProviderCredentials.reveal()"
  - "HTTP client wrapped with header redactor (x-api-key, Authorization, Cookie)"
  - "Typed error emission (RateLimitError, AuthError, NetworkError)"
  - "Unit test: debug-logging enabled + captured output → zero credential leakage"
documentation_deliverables:
  - "pacta-provider-anthropic/README.md — 429 handling + credential flow"
acceptance_criteria:
  - "429 with retry-after: 5s → provider waits 5s before retry → PRD AC-2"
  - "API key in request body/headers never appears in logs at any level → PRD AC-6"
  - "Per-invocation key switch: 2 invocations with different keys → both succeed against different accounts → PRD AC-3"
estimated_tasks: 4
branch: "feat/prd051-c4-anthropic-provider"
status: pending
```

---

## Wave 3 — Cost-Governor Port Implementations

### C-6 — cost-governor: Port Impls + Routes + Config

```yaml
id: C-6
phase: PRD Wave 3
title: "CostOracle, AccountRouter, RateGovernor impls + routes + SealedCredentials + watchdog"
domain: "bridge/domains/cost-governor"
wave: 3
scope:
  allowed_paths:
    - "packages/bridge/src/domains/cost-governor/cost-oracle-impl.ts"
    - "packages/bridge/src/domains/cost-governor/account-router-impl.ts"
    - "packages/bridge/src/domains/cost-governor/rate-governor-impl.ts"
    - "packages/bridge/src/domains/cost-governor/sealed-credentials.ts"
    - "packages/bridge/src/domains/cost-governor/watchdog.ts"
    - "packages/bridge/src/domains/cost-governor/circuit-breaker.ts"
    - "packages/bridge/src/domains/cost-governor/event-coalescer.ts"
    - "packages/bridge/src/domains/cost-governor/routes.ts"
    - "packages/bridge/src/domains/cost-governor/config.ts"     # complete the skeleton from W0.7
    - "packages/bridge/src/domains/cost-governor/*.test.ts"
    - "packages/bridge/src/domains/cost-governor/index.ts"      # public exports
    - "packages/bridge/src/domains/cost-governor/README.md"
  forbidden_paths:
    - "packages/bridge/src/ports/*"
    - "packages/bridge/src/shared/*"
    - "packages/bridge/src/domains/*/!(cost-governor)/**"
    - "packages/bridge/src/domains/cost-governor/token-bucket.ts"       # C-5 scope
    - "packages/bridge/src/domains/cost-governor/estimator.ts"          # C-5 scope
    - "packages/bridge/src/domains/cost-governor/signature-builder.ts"  # C-5 scope
    - "packages/bridge/src/domains/cost-governor/backpressure-queue.ts" # C-5 scope
depends_on: [C-1, C-2, C-5]
parallel_with: []
consumed_ports:
  - name: HistoricalObservations
    status: frozen post-C-1
    record: "packages/bridge/src/ports/historical-observations.ts (W0.2) + C-1 impl"
  - name: RateGovernor (pacta base)
    status: frozen
    record: "packages/pacta/src/ports/rate-governor.ts (W0.3)"
  - name: CostEvent union
    status: frozen
    record: "packages/bridge/src/ports/event-bus.ts (W0.5)"
produced_ports:
  - name: CostOracle (impl)
  - name: AccountRouter (impl via createAccountRouter factory)
  - name: BridgeRateGovernor (impl)
deliverables:
  - "sealed-credentials.ts: closure-factory with non-enumerable credentials field + custom inspect/Symbol.toPrimitive/toJSON → [REDACTED]"
  - "account-router-impl.ts: createAccountRouter factory, Zod validation, rotate() in-place, AccountConfig discriminated union"
  - "Env var purge: delete process.env[apiKeyEnvName] after load"
  - "cost-oracle-impl.ts: wires HistoricalObservations + estimator.ts; floor charges ($0.02/1-msg minimum)"
  - "rate-governor-impl.ts: extends pacta base, wires token-bucket + account-router + backpressure-queue"
  - "watchdog.ts: 30s sweeper for leaked slots, emits cost.slot_leaked"
  - "circuit-breaker.ts: 3-state per-account (closed/open/half-open) with failure-rate threshold"
  - "event-coalescer.ts: per-account 10s window coalescing for cost.rate_limited"
  - "routes.ts: admin-scope /cost-governor/accounts, /utilization endpoints with rate-limiting + audit events"
  - "config.ts: finalize CostGovernorConfig schema, env overrides"
documentation_deliverables:
  - "cost-governor/README.md — complete domain essence + port inventory"
  - "docs/arch/cost-governor.md — token-bucket algorithm, refund matrix, slot lifecycle"
  - "docs/arch/account-routing.md — policies, SealedCredentials contract, rotation"
acceptance_criteria:
  - "Saturation: all accounts full → acquireSlot times out with SaturationError → PRD AC-2"
  - "Slot leak: 100 concurrent acquires + throws → watchdog releases all → PRD AC-2"
  - "Credential sanitization: JSON.stringify(handle) → credentials: '[REDACTED]' → PRD AC-6"
  - "Rotate accountId in-flight: new credentials used for new slots, old for in-flight → PRD AC-3 & AC-6"
  - "3-account round-robin: distribution even (max-min ≤ 2 over 300 calls) → PRD AC-3"
  - "Circuit breaker: 5 consecutive failures → account 'degraded' 60s → PRD AC-2"
  - "Event coalescing: 100 concurrent 429s → single cost.rate_limited per account per 10s → PRD AC-2"
estimated_tasks: 8
branch: "feat/prd051-c6-cost-governor-impls"
status: pending
```

---

## Wave 4 — Integration (2-way parallel)

### C-7 — strategies: CostOracle + ProviderFactory Consumer

```yaml
id: C-7
phase: PRD Wave 4
title: "Strategies consumes CostOracle; ProviderFactory replaces direct claudeCliProvider()"
domain: "bridge/domains/strategies"
wave: 4
scope:
  allowed_paths:
    - "packages/bridge/src/domains/strategies/strategy-executor.ts"
    - "packages/bridge/src/domains/strategies/strategy-routes.ts"
    - "packages/bridge/src/domains/strategies/pacta-strategy.ts"
    - "packages/bridge/src/domains/strategies/strategy-executor.test.ts"
    - "packages/bridge/src/domains/strategies/strategy-routes.test.ts"
    - "packages/bridge/src/domains/strategies/README.md"
  forbidden_paths:
    - "packages/bridge/src/ports/*"
    - "packages/bridge/src/shared/*"
    - "packages/bridge/src/domains/*/!(strategies)/**"
    - "packages/bridge/src/domains/strategies/gates.ts"               # untouched
    - "packages/bridge/src/domains/strategies/artifact-store.ts"      # untouched
    - "packages/bridge/src/domains/strategies/retro-*.ts"             # untouched
depends_on: [C-6]
parallel_with: [C-8]
consumed_ports:
  - name: CostOracle
    status: frozen post-C-6
    record: "packages/bridge/src/ports/cost-oracle.ts (W0.2) + C-6 impl"
  - name: BridgeRateGovernor
    status: frozen post-C-6
    record: "packages/bridge/src/ports/rate-governor.ts (W0.2) + C-6 impl"
produced_ports: []
deliverables:
  - "Strategy executor consumes CostOracle (injected, no direct construction)"
  - "Strategy routes receive ProviderFactory (throttler-wrapped) from composition root"
  - "Remove direct claudeCliProvider() construction in strategy-routes.ts"
  - "Pre-dispatch cost estimation call before DAG execution starts"
  - "Abort signal properly propagates to throttler slots"
  - "Regression: all existing strategy tests pass with governor wired or absent"
documentation_deliverables:
  - "strategies/README.md — CostOracle dependency, dry-run flow"
  - "docs/guides/04-strategy-pipelines.md — update: budget vs rate-governor distinction"
acceptance_criteria:
  - "No direct provider construction in strategies domain → G-BOUNDARY pass"
  - "Strategy with throttler: 100 nodes, 3 accounts, no DAG-visible 429s → PRD AC-2"
  - "Strategy without CostOracle (fallback/legacy): current behavior preserved → regression"
estimated_tasks: 4
branch: "feat/prd051-c7-strategies-integration"
status: pending
```

### C-8 — mcp: strategy_dry_run Tool

```yaml
id: C-8
phase: PRD Wave 4
title: "strategy_dry_run MCP tool with admin-scope revealAccountPlan"
domain: "mcp (L3)"
wave: 4
scope:
  allowed_paths:
    - "packages/mcp/src/tools/strategy-dry-run.ts"
    - "packages/mcp/src/tools/strategy-dry-run.test.ts"
    - "packages/mcp/src/index.ts"       # tool registration only
    - "packages/mcp/README.md"
  forbidden_paths:
    - "packages/mcp/package.json"
    - "packages/bridge/**"
    - "packages/pacta*/**"
    - "packages/mcp/src/tools/!(strategy-dry-run).ts"
depends_on: [C-6]
parallel_with: [C-7]
consumed_ports:
  - name: CostOracle
    status: frozen post-C-6
    record: "packages/bridge/src/ports/cost-oracle.ts (W0.2) + C-6 impl"
produced_ports: []
deliverables:
  - "strategy_dry_run tool registered with input { strategyYaml, inputBundle?, revealAccountPlan? }"
  - "Default output: { estimate, unknownNodes, planSummary, confidenceWarning? }"
  - "Admin-scope output: adds accountPlan (per-node accountId mapping)"
  - "Low-confidence badge: 'NOT VALIDATED — N nodes have no historical data'"
  - "Input validation via Zod"
documentation_deliverables:
  - "docs/guides/40-strategy-dry-run.md — usage, interpreting bands, unknown-node handling"
acceptance_criteria:
  - "Dry-run on 21-node strategy returns estimate in < 500ms → PRD AC-1"
  - "revealAccountPlan: false (default) → no accountIds in output → PRD AC-6"
  - "revealAccountPlan: true without admin scope → 403-equivalent MCP error → PRD AC-6"
  - "Unknown signatures → confidenceWarning populated → PRD AC-1"
estimated_tasks: 4
branch: "feat/prd051-c8-mcp-strategy-dry-run"
status: pending
```

---

## Wave 5 — Composition Root

### C-9 — bridge composition-root: Wiring + Canary + Env Purge

```yaml
id: C-9
phase: PRD Wave 4 (composition slice)
title: "server-entry.ts wiring, boot-time canary, env purge, startup refusal logic"
domain: "bridge/src/server-entry.ts (composition root — orchestrator-owned slice)"
wave: 5
scope:
  allowed_paths:
    - "packages/bridge/src/server-entry.ts"
    - "packages/bridge/src/shared/validation/**"     # boot-time validations
    - "packages/bridge/src/shared/config-reload/**"  # if needed
  forbidden_paths:
    - "packages/bridge/src/ports/*"
    - "packages/bridge/src/domains/*/!(cost-governor|tokens|strategies)/**"
    - "packages/bridge/package.json"
depends_on: [C-3, C-4, C-6, C-7, C-8]
parallel_with: []
consumed_ports:
  - name: all cost-governor + pacta + provider ports
    status: frozen post-all-prior-commissions
produced_ports: []
deliverables:
  - "Composition order: load AccountConfig[] from per-account env vars via Zod"
  - "Construct AccountRouter via createAccountRouter factory"
  - "Delete process.env.ANTHROPIC_* and per-account env vars after AccountRouter construction"
  - "Construct ObservationsStore → CostOracleImpl → RateGovernorImpl → ProviderFactory"
  - "Inject CostOracle into strategies domain"
  - "Register strategy_dry_run MCP tool with admin-scope check"
  - "Boot-time canary: inject synthetic CANARY_<rand> credential → verify scrubbed in all sinks → refuse start on leak"
  - "G-ENV-PURGE assertion at end of composition"
  - "Startup refusal if ANTHROPIC_API_KEY + claude-cli accounts mixed, unless METHOD_ALLOW_MIXED_CLAUDE_CREDS"
  - "bridge.startup_health event with counts (observations loaded/skipped, accounts registered/unavailable)"
documentation_deliverables:
  - "docs/guides/39-multi-account-setup.md — operator runbook (finalize)"
  - "docs/guides/41-cost-telemetry.md — governance event catalogue"
  - "docs/arch/provider-error-taxonomy.md — (finalized after C-2/C-3/C-4 complete)"
acceptance_criteria:
  - "Canary leak in any sink → bridge refuses to start (exit non-zero) → PRD AC-6"
  - "Post-composition: process.env.ANTHROPIC_* is empty → G-ENV-PURGE pass → PRD AC-6"
  - "Mixed-creds config + no override flag → startup refusal with clear error → PRD AC-6"
  - "Full e2e: 3 accounts registered, 10-node strategy, round-robin dispatch → completes in < 120s → PRD AC-2/AC-3"
estimated_tasks: 5
branch: "feat/prd051-c9-composition-root"
status: pending
```

---

## Wave 6 — Validation

### C-10 — experiments/exp-cost-governor: V1-V9 Validation

```yaml
id: C-10
phase: PRD validation plan
title: "Run V1-V9 experiments and produce results artifacts"
domain: "experiments/exp-cost-governor"
wave: 6
scope:
  allowed_paths:
    - "experiments/exp-cost-governor/**"
    - "experiments/log/2026-04-*-exp-cost-governor-*.yaml"
  forbidden_paths:
    - "packages/**"
    - "experiments/PROTOCOL.md"
    - "experiments/AGENDA.md"
depends_on: [C-9]
parallel_with: []
consumed_ports: []   # observer role
produced_ports: []
deliverables:
  - "V1 prediction accuracy: 50 runs × 5 signatures, bands vs actuals, results.yaml"
  - "V2 queue throughput: 100-strategy stress test, theoretical vs actual completion time"
  - "V3 routing policies: 300 calls × 4 policies, distribution + gini computed"
  - "V4 ETA accuracy: same 50 runs, duration bands vs actuals"
  - "V5 DR-01 invariance: diff theory/, registry/, strategy YAML schemas"
  - "V6 credential leakage tri-layer: AST + canary + regex"
  - "V7 S9 migration: full test suite post-migration, zero regressions"
  - "V8 observations integrity: 5 corruption scenarios, recovery verified"
  - "V9 slot-leak detection: 100-concurrent-abort test, watchdog behavior"
  - "README.md with consolidated findings + pass/fail status per criterion"
documentation_deliverables:
  - "experiments/exp-cost-governor/README.md — hypothesis, methodology, findings"
  - "experiments/log/ YAML entries per run (merge-conflict-free)"
  - "docs/prds/051-cost-governor.md — publish (promotion from session)"
acceptance_criteria:
  - "V1 median(error_pct) ≤ 30%, p90_coverage ≥ 0.85 → PRD AC-1 ACHIEVED"
  - "V2 dag_visible_429_count == 0, overhead ≤ 20% → PRD AC-2 ACHIEVED"
  - "V3 round-robin max-min ≤ 2 over 300 calls → PRD AC-3 ACHIEVED"
  - "V4 median(error_pct) ≤ 30% for durations → PRD AC-4 ACHIEVED"
  - "V5 zero diff in theory/registry/YAML → PRD AC-5 ACHIEVED"
  - "V6 zero credential leakage across 3 layers → PRD AC-6 ACHIEVED"
  - "V7 zero regressions, V8 5/5 scenarios recover, V9 zero orphan slots → quality gates pass"
estimated_tasks: 6
branch: "feat/prd051-c10-validation-artifacts"
status: pending
```

---

## Plan Verification

| Gate | Status | Detail |
|---|---|---|
| Single-domain commissions | **PASS** | 10/10 commissions own exactly one domain/package |
| No wave domain conflicts | **PASS** | Same-domain commissions (C-5, C-6) in different waves |
| DAG acyclic | **PASS** | No cycles detected |
| Surfaces enumerated | **PASS** | 16 surfaces catalogued; 15 frozen, 1 pending co-design (blocker tracked) |
| Scope completeness | **PASS** | All 10 commissions have allowed + forbidden paths |
| Criteria traceability | **PASS** | Every AC references PRD AC-1 through AC-7 |
| PRD coverage | **PASS** | All 6 PRD success criteria mapped to commissions |
| Task count bounds | **PASS** | All commissions: 3-8 tasks (C-6 at ceiling 8) |
| Wave 0 non-empty | **PASS** | 7 surface prep items |
| All consumed ports frozen | **CONDITIONAL PASS** | 15/16 frozen; S9 must freeze before C-2 starts (documented blocker) |

**Overall: 10/10 gates pass** (conditional on S9 `/fcd-surface` completion before Wave 1).

### Risk Assessment

- **Critical path length:** W0 → C-1/C-2/C-5 → C-3/C-4 → C-6 → C-7/C-8 → C-9 → C-10 = **6 sequential waves** (C-5 doesn't gate C-2 or C-3).
- **Largest wave (by commissions):** Wave 1 with 3 parallel commissions.
- **Highest-risk commission:** C-6 (8 tasks, wires 5 ports, depends on 3 upstream commissions).
- **External dependencies:** 2 blockers (S9 co-design, HOME override spike) — neither is inside the plan.
- **Surface change count:** 16 new surfaces (13 ports/types/events, 6 gates — overlap counted).
- **Breaking-change risk:** S9 error taxonomy has blast radius across all providers; dual-emit for 2 versions mitigates.

### Execution Preview

Total estimated tasks: **56** across 10 commissions.
Pre-plan blocker work: 1 fcd-surface session (S9) + 1 spike (B2 HOME override).

