---
type: prd
id: PRD-058
title: "@method/agent-runtime — Cortex-Targeted Public API"
version: 0.1.0
status: draft
date: "2026-04-14"
owner: "@method/agent-runtime"
size: M
phase: Phase 1 (Library carve-out, roadmap §7)
domains:
  - agent-runtime (NEW — this PRD creates the package)
  - pacta (consumed as peer dep — unchanged by this PRD)
  - runtime (consumed for event bus + ports — PRD-057)
  - pacta-provider-cortex (consumed — PRD-059, separate package)
surfaces_consumed:
  - S1 MethodAgentPort (frozen — this PRD IS its implementation)
  - S2 RuntimePackageBoundary (frozen — @method/runtime consumer)
  - S3 CortexServiceAdapters (frozen — composed as default middleware)
  - S6 CortexEventConnector (frozen — wired when ctx.events present)
  - S7 CortexMethodologySource (frozen — optional, wired when ctx.storage + methodology feature enabled)
surfaces_produced:
  - createMethodAgent factory (IS S1)
  - Default middleware composition (internal; no new cross-domain surface)
related:
  - docs/roadmap-cortex-consumption.md §4.1 items A2/A7, §7 Phase 1
  - .method/sessions/fcd-surface-method-agent-port/decision.md (S1 — THE frozen surface this PRD implements)
  - .method/sessions/fcd-surface-cortex-service-adapters/decision.md (S3 — composed adapters)
  - .method/sessions/fcd-surface-runtime-package-boundary/decision.md (S2 — dependency surface)
  - .method/sessions/fcd-surface-event-connector/decision.md (S6 — event connector wiring)
  - .method/sessions/fcd-surface-methodology-source/decision.md (S7 — methodology source port)
blocks:
  - samples/cortex-incident-triage-agent/ (roadmap item A6)
  - April 21 demo gate (3.1 Autonomous Incident Tracking)
depends_on:
  - PRD-057 (@method/runtime carve-out) — must ship first; agent-runtime has no internal copy
  - PRD-059 (CortexLLMProvider + middleware) — runs in parallel; factory composes them by name
---

# PRD-058 — `@method/agent-runtime`: Cortex-Targeted Public API

## 1. Summary

Ship `@method/agent-runtime`, a new L3 library published to the internal registry,
that a Cortex tenant app installs with `npm install @method/agent-runtime` and
uses to embed a method-governed agent with **one import and one call**:

```typescript
import { createMethodAgent } from '@method/agent-runtime';
const agent = createMethodAgent({ ctx, pact: incidentTriagePact });
const result = await agent.invoke({ prompt: ctx.input.text });
```

The package is the **composition layer** between pacta's declarative pact model
and Cortex's injected `ctx.*` services. It contains no new framework code —
every concrete capability (LLM dispatch, audit, token exchange, session store,
events translation) lives in adjacent packages (`@method/pacta`,
`@method/runtime`, `@method/pacta-provider-cortex`). This PRD wires them into
a Cortex-safe default configuration and publishes that composition as the
`createMethodAgent` factory frozen by FCD Surface S1.

**What this PRD ships:**

1. A new package `packages/agent-runtime/` published as `@method/agent-runtime`.
2. The `createMethodAgent<TOutput>(options)` factory matching the S1 frozen surface verbatim.
3. Default middleware composition stack (token-exchange → audit → budget-precheck) composed in the order mandated by S3.
4. `events()` / `onEvent` mutually-exclusive enforcement and the `MethodAgent` handle contract (invoke / resume / abort / dispose / events).
5. Opaque `Resumption` descriptor and its wire-up to the session store (behind a port; the Cortex adapter lands in PRD-061).
6. Optional `CortexEventConnector` auto-registration when `ctx.events` is present (S6 wiring).
7. A working sample app at `samples/cortex-incident-triage-agent/` that builds and runs end-to-end against a mocked Cortex ctx, exercising the April 21 demo path.
8. Architecture + gate tests at `packages/agent-runtime/src/gates/` covering G-PORT, G-BOUNDARY, G-LAYER (per S1 §8).

**Non-invariants this PRD does NOT change:** the S1 surface (frozen),
pacta's public API (peer dep), the bridge's own composition root (separate
consumer of `@method/runtime`), Cortex's `ctx.*` shape (upstream concern).

---

## 2. Problem

Cortex tenant apps of category `agent` (RFC-005 §10.2, Tier 2 services) have
**no library to import that gives them a method-governed agent.** Today pacta
ships `createAgent` — but using it in Cortex requires every tenant app to
manually wire:

- A `CortexLLMProvider` (instead of a direct Anthropic/Claude-CLI provider).
- A `CortexAuditMiddleware` wrapping every pacta `AgentEvent`.
- A `CortexTokenExchangeMiddleware` for RFC 8693 delegated tokens.
- A `CortexEventConnector` for the Universal Event Bus → `ctx.events` bridge.
- Predictive-only budget enforcement (per S3 §4 — single authority = `ctx.llm`).
- Opaque `Resumption` token plumbing over `ctx.storage`.
- Safe defaults (audit on, token-exchange on, strict mode in production).

That wiring is 150+ lines of non-trivial composition, must be identical across
every tenant app, and gets the RFC 8693 depth check, the budget
double-count resolution, and the events/audit split wrong in subtle ways if
re-derived by each team. **April 21 demos ship with two tenant apps (incidents
bot, feature-dev agent) that must embed method-governed agents**, and Twins
Wave 1 adds N more. Without a single shipping library, every team rebuilds the
same fragile composition.

Related problems this PRD does NOT solve (explicit scope):

- The composition itself doesn't exist — those adapters live in PRD-059.
  This PRD *ships the package that composes them*.
- The bridge still uses pacta directly — that's bridge's composition root,
  not a Cortex tenant app's.
- Resumption persistence — the port is wired here; the Cortex-backed store
  is PRD-061.

---

## 3. Constraints

### 3.1 Hard constraints (from frozen surfaces)

1. **S1 frozen — factory signature is verbatim.** `createMethodAgent<T>(options: CreateMethodAgentOptions<T>): MethodAgent<T>`. Synchronous factory. Returns handle. No deviations without a new `/fcd-surface` session.

2. **Pacta is a peer dependency, not a regular dep.** A single pacta version flows through the tenant app; out-of-range pacta triggers a composition-time `ConfigurationError` (S1 §7). Package.json:
   ```json
   "peerDependencies": { "@method/pacta": "^{current-major}" }
   ```

3. **Type-only imports from Cortex SDKs.** `@method/agent-runtime` must not import any Cortex package at runtime (S1 §4.1, gate `G-BOUNDARY`). The `CortexCtx` shape is re-declared structurally in `src/cortex/ctx-types.ts` as a type-only file. Cortex SDK types may be imported with `import type` (erased at compile).

4. **`@method/pacta-provider-cortex` is a SEPARATE package (S1 §6.1, explicit).** `@method/agent-runtime` depends on it as a regular dependency. The provider family naming convention is preserved. Moving `CortexLLMProvider` into `@method/agent-runtime` is **rejected** at the surface level.

5. **Opaque `Resumption` token (S1 §4.4, Q5).** The `Resumption.opaque` field is a base64 payload tenant apps treat as black box. The runtime may change the internal representation between minor versions. Only `sessionId` and `expiresAt` are visible fields.

6. **`events()` and `onEvent` mutually exclusive (S1 §4.2, Q2).** If both are set, calling `events()` throws `IllegalStateError`. The check happens at `events()` invocation time, not at `createMethodAgent`, so tenant apps can pass `onEvent` as undefined when `eventsChannel: 'async-iterable'` is set and consume via `events()`.

7. **Audit is always on by default (S1 §4.2, S3).** Tenant apps may set `middleware.audit: false` but only with a `ctx.log.warn` emission at compose time. In strict mode (`ctx.app.tier === 'service'`), `audit: false` throws `ConfigurationError`.

8. **Budget enforcer in predictive mode (S3 §4, gate G-BUDGET-SINGLE-AUTHORITY).** When the composed provider declares `capabilities().budgetEnforcement === 'native'` (which `CortexLLMProvider` does), the factory wires pacta's `budgetEnforcer` with `mode: 'predictive'`. Turn/duration enforcement stays authoritative in pacta. No double-charge, no race.

### 3.2 Soft constraints (architectural preferences)

9. **Zero new ports invented here.** Every port this factory depends on is defined elsewhere (pacta's `AgentProvider`/`MemoryPort`, runtime's `EventBus`/`SessionStore`, Cortex's `ctx.*`). This package only **composes**.

10. **Testable without Cortex.** A Node test harness can pass a mock `ctx` object satisfying the structural `CortexCtx` shape and exercise the full factory. No `@t1/cortex-sdk` runtime dependency means no authentication, no network, no Cortex dev stack required for unit tests.

11. **Strict mode default by app tier.** `options.strict` default is `ctx.app.tier === 'service'`. Explicit override allowed. Rationale: tests and tools (tiers `web`/`tool`) sometimes need permissive defaults; production services never do.

12. **The sample app is a first-class deliverable.** `samples/cortex-incident-triage-agent/` is not documentation — it is the test harness CI runs to prove the package compiles and runs end-to-end. If the sample breaks, the PR fails.

### 3.3 Dual ctx import paths — the compatibility risk

Method ships `CortexCtx` as a structural type re-declared in-package. Cortex
ships the canonical `Ctx` via `@t1/cortex-sdk`. **Drift between the two is
inevitable.** Risk + mitigation:

- **Risk:** Cortex adds a mandatory field to `ctx.llm.complete`. Method's
  structural type doesn't have it. Tenant app code compiles because
  `type`-only imports are erased — but at runtime the field is undefined.
- **Mitigation A (in-PR):** Every `CortexXxxFacade` type in
  `src/cortex/ctx-types.ts` has a header comment pointing to the RFC-005 /
  PRD source of truth + the field list it structurally requires.
- **Mitigation B (in-PR):** An opt-in `assertCtxCompatibility(ctx)` helper
  that structurally checks the runtime `ctx` against the declared
  facades; tenant apps may call it at boot, and the sample app does.
- **Mitigation C (ongoing, not in this PRD):** Cortex adds `@method/agent-runtime`
  as a smoke-test consumer of their SDK's type shape so drift trips Cortex
  CI. Tracked as roadmap follow-up O-DRIFT (scoped to Cortex side).

This is an accepted, bounded risk — the whole point of the type-only seam is
to keep method publishable without Cortex.

---

## 4. Success Criteria

Each item is independently measurable. Acceptance requires all green.

1. **Package builds standalone.** `cd packages/agent-runtime && npm run build` completes with no errors. `tsc --noEmit` clean. No runtime imports of `@t1/cortex-sdk` (gate `G-BOUNDARY-NO-CORTEX-VALUE-IMPORT`).

2. **S1 symbol export set exact match.** Gate `G-PORT-SYMBOLS` asserts the exported names equal the frozen list in S1 §8: `createMethodAgent`, `ConfigurationError`, `MissingCtxError`, `UnknownSessionError`, `IllegalStateError`, plus the inherited pacta re-exports. New exports require a new `/fcd-surface`.

3. **Sample app compiles and runs against mock Cortex.** `cd samples/cortex-incident-triage-agent && npm test` passes. The test spins up an in-process mock `ctx`, runs `createMethodAgent({ ctx, pact })`, calls `agent.invoke({ prompt: 'ingest this alert' })`, asserts (a) result ok, (b) `ctx.audit.event()` called N≥6 times, (c) `ctx.llm.complete()` called once, (d) `auditEventCount > 0` on result, (e) no `ctx.events.publish` calls if connector not wired, (f) a synthetic `Resumption` token round-trips through `resume()` for a `ResumableMode` pact.

4. **Budget double-count resolution verified.** A fixture test asserts that when `CortexLLMProvider` is the composed provider, `pactaBudgetEnforcer` runs in predictive mode. Concretely: provider reports `cost.totalUsd = $0.03`, enforcer does **not** reject even if the declared `maxCostUsd = $0.01` (enforcement is ctx.llm's job; enforcer emits warning only). Gate `G-BUDGET-SINGLE-AUTHORITY` from S3.

5. **Token-exchange depth check fires at depth 2.** A fixture test constructs a parent token with `act_as` chain length 2 and asserts `CortexTokenExchangeMiddleware.exchangeForSubAgent()` throws `CortexDelegationDepthExceededError`. Gate `G-TOKEN-DEPTH-CAP` from S3.

6. **Events/onEvent mutual exclusion enforced.** Test: calling `events()` when `options.onEvent` was provided throws `IllegalStateError` with the documented code `'ILLEGAL_STATE'`.

7. **Strict-mode refusal path works.** Test: passing `options.provider` (custom provider) while `ctx.app.tier === 'service'` in strict mode throws `ConfigurationError` with reason `"strict-mode-custom-provider"`.

8. **`MethodAgent.abort()` is cooperative.** Test: invoking then immediately `abort(sessionId)` causes the invoke promise to reject with `AbortError` (pacta's) within a bounded time (<100ms in test). No PTY-style hard-kill semantics leak in.

9. **Resumption round-trips.** Test: a `ResumableMode` pact that suspends produces a `Resumption` with a non-empty opaque field, a fresh `createMethodAgent` call with the same ctx resumes via `agent.resume(resumption)`, and the resumed invocation observes the prior budget state.

10. **Gate tests pass in CI.** `npm test` inside `packages/agent-runtime/` runs the gate test file (`gates/gates.test.ts`) plus unit tests; all green. The gate file asserts the S1 §8 gate set (G-BOUNDARY, G-PORT, G-LAYER) plus the S3-derived G-BUDGET-SINGLE-AUTHORITY and G-TOKEN-DEPTH-CAP.

11. **Zero changes to pacta's public API.** Gate `G-PACTA-UNCHANGED`: the diff of `packages/pacta/src/index.ts` between the merge base and this PR is empty. (PRD-059 is the place the predictive mode flag lands — this PRD may not touch pacta.)

12. **Roadmap gate A7 closeable.** The sample app output can be manually run against a `t1-cortex-1` dev stack and a surface-advocate signoff collected before merge.

---

## 5. Scope

### 5.1 In Scope

**Package scaffolding:**
- `packages/agent-runtime/package.json` — name `@method/agent-runtime`, peer dep on pacta, regular dep on `@method/runtime` + `@method/pacta-provider-cortex`, NO `@t1/cortex-sdk` anywhere.
- `packages/agent-runtime/tsconfig.json` — standard FCA package settings, subpath exports where needed.
- `packages/agent-runtime/src/index.ts` — barrel exporting the S1 symbol set only.
- `packages/agent-runtime/README.md` — minimal (Install / Usage / Sample / Links to S1).

**The factory:**
- `src/create-method-agent.ts` — the `createMethodAgent<T>` implementation matching S1 §4.5.
- Composition steps in order per S1 §4.5:
  1. `validateCtxShape(ctx)` — structural check; throws `MissingCtxError`.
  2. `validateOptionsStrict(options, ctx)` — strict-mode rule enforcement; throws `ConfigurationError`.
  3. Build provider: `options.provider ?? cortexLLMProvider({ handlers, config }).compose({ ctx })`.
  4. Build middleware stack (see §5.1 next subsection).
  5. Delegate to pacta `createAgent({ pact, provider, onEvent: fanOut, context, reasoning, tools: undefined, memory: undefined, throttle })`.
  6. Wrap result in `MethodAgent<T>` handle with `Resumption` + `abort` machinery.

**Default middleware composition stack** (composed outer → inner, per S3 §3.2):
```
createMethodAgent composes this onto pacta's createAgent:
  outer ↑  CortexTokenExchangeMiddleware   (from pacta-provider-cortex via PRD-059)
         →  CortexAuditMiddleware            (same package)
         →  pacta.budgetEnforcer(mode='predictive')
         →  pacta.outputValidator (when pact.output.schema)
         →  pacta reasoning middleware
  inner ↓  CortexLLMProvider.invoke          (ctx.llm.complete)
```

Ordering rationale (fixed): token-exchange runs first so all downstream
calls see a narrowed delegated token in `request.metadata`. Audit runs next
so every event (including token-exchange events) is mirrored. Budget-precheck
runs predictive-only (S3 §4). Provider last, per pacta convention.

**Handle implementation:**
- `src/method-agent-handle.ts` — `MethodAgent<T>` concrete class wrapping pacta's `Agent<T>`, adding `resume`, `abort`, `events()`, `dispose()`, and annotating `MethodAgentResult<T>`.
- `src/events-multiplexer.ts` — the `onEvent` ⇄ `events()` fanout. Guards mutual exclusion at `events()` call time via a cheap state flag.

**Event connector auto-wire:**
- `src/wire-event-connector.ts` — if `ctx.events` present, constructs a `CortexEventConnector` (PRD-063; type-only import here; runtime wire lives in `@method/agent-runtime/src/cortex/event-connector.ts` but **this PRD only imports and registers it if available**; actual connector class lands in PRD-063). Guarded by `options.middleware.events !== false`.

**Resumption machinery:**
- `src/resumption.ts` — opaque `Resumption` codec (base64(JSON) with `{ v: 1, storeKey, fencingToken }`), `createResumptionDescriptor()`, `parseResumption()`. Internal shape versioned; consumers see `{ sessionId, opaque, expiresAt }` only.
- `src/session-store-adapter.ts` — thin adapter between the `SessionStore` port (from `@method/runtime/ports`) and the handle's resume plumbing. Uses the FS adapter by default (bridge-compatible) and the `ctx.storage` adapter when `ctx.storage` is present.

**Errors:**
- `src/errors.ts` — `ConfigurationError`, `MissingCtxError`, `UnknownSessionError`, `IllegalStateError`. Re-export pacta's error taxonomy.

**Cortex structural types (type-only seam):**
- `src/cortex/ctx-types.ts` — re-declares `CortexCtx`, `CortexLlmFacade`, `CortexAuditFacade`, `CortexEventsFacade`, `CortexStorageFacade`, `CortexJobsFacade`, `CortexScheduleFacade`, `CortexAuthFacade`, `CortexLogger` verbatim per S1 §4.1. Header comment lists the upstream source-of-truth file for each facade (RFC-005 / PRD-068 etc.).

**Compatibility helper:**
- `src/cortex/assert-ctx-compatibility.ts` — `assertCtxCompatibility(ctx): void` structural runtime check. Throws `MissingCtxError` on drift. Used by the sample app at boot.

**Sample app** (see §7 below).

**Gate tests:**
- `src/gates/gates.test.ts` — G-BOUNDARY, G-PORT, G-LAYER (S1), G-BUDGET-SINGLE-AUTHORITY, G-TOKEN-DEPTH-CAP (S3), G-PACTA-UNCHANGED.
- `src/architecture.test.ts` — scan-based gates (import discipline, layer discipline).

### 5.2 Out of Scope

Explicit exclusions — any of these below is a separate PRD:

- **The adapter implementations themselves** (`CortexLLMProvider`, `CortexAuditMiddleware`, `CortexTokenExchangeMiddleware`). → **PRD-059.** This PRD imports them by name from `@method/pacta-provider-cortex`.
- **The runtime package carve-out** (`@method/runtime` from `@method/bridge`). → **PRD-057.** This PRD declares it as a dep; the symbols must exist before merge.
- **Cortex-backed session store** (`ctx.storage`-backed `SessionStore` implementation). → **PRD-061.** This PRD wires the port; the Cortex adapter lands in PRD-061. Until then, the sample app uses the FS adapter.
- **`JobBackedExecutor` and `createScheduledMethodAgent`.** → **PRD-062.** Phase B; not on the S1 port.
- **`CortexEventConnector` implementation.** → **PRD-063.** This PRD autowires the class if present at import resolution; does not contain its code.
- **`CortexMethodologySource` implementation.** → **PRD-064.**
- **Conformance testkit.** → **PRD-065.** This PRD's sample app is a smoke test, not a conformance test.
- **MCP transport for Cortex tool registry.** → **PRD-066.**
- **Bridge migration to `@method/agent-runtime`.** The bridge stays on `@method/pacta` directly. This PRD does not touch bridge code.
- **Pacta `budgetEnforcer.mode` option extension.** → Landed by **PRD-059** (the first place the new mode is *used*). This PRD depends on PRD-059 shipping that field; if PRD-059 is delayed, a stub mock provider is used to validate the wiring path.
- **Multi-agent orchestration (sub-agent coordination across tenant apps).** S1 §10 non-goal.
- **`CortexCtx` extensions.** Adding an optional facade is a minor bump on agent-runtime but remains a new `/fcd-surface` session.

### 5.3 Scope boundary: what changes about pacta? Answer: nothing.

Gate `G-PACTA-UNCHANGED` (§4 item 11) asserts the index.ts diff is empty.
The pacta changes needed for Cortex (predictive mode on `budgetEnforcer`)
land in PRD-059 alongside the provider that uses them. This PRD references
them by interface — if they don't exist at merge time, this PRD cannot
merge (hard dep).

---

## 6. Architecture Sketch

### 6.1 Layer placement

```
L4  @method/bridge                (unchanged by this PRD)
    Cortex tenant app             (imports @method/agent-runtime)

L3  @method/agent-runtime         ← THIS PRD (new package)
       └─ depends on:
            @method/pacta (peer)
            @method/runtime (regular, for EventBus + SessionStore ports)
            @method/pacta-provider-cortex (regular, for the cortex adapters)
    @method/pacta                 (peer dep, unchanged here)
    @method/runtime               (PRD-057, consumed)
    @method/pacta-provider-cortex (PRD-059, consumed)

L2  @method/methodts              (unchanged)
```

No L4 code in this package. No upward imports from L3 to L4 (gate `G-LAYER`).

### 6.2 Directory layout

```
packages/agent-runtime/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts                          # Barrel — S1 symbols only
│   ├── create-method-agent.ts            # The factory
│   ├── method-agent-handle.ts            # MethodAgent<T> class
│   ├── events-multiplexer.ts             # onEvent ⇄ events() fanout
│   ├── resumption.ts                     # Opaque token codec
│   ├── session-store-adapter.ts          # SessionStore port → handle plumbing
│   ├── wire-event-connector.ts           # Optional CortexEventConnector autowire
│   ├── errors.ts                         # ConfigurationError, MissingCtxError, etc.
│   ├── cortex/
│   │   ├── ctx-types.ts                  # Type-only re-declaration of CortexCtx facades
│   │   └── assert-ctx-compatibility.ts   # Runtime structural check helper
│   ├── gates/
│   │   └── gates.test.ts                 # G-BOUNDARY, G-PORT, etc.
│   └── architecture.test.ts              # Import-discipline scans
├── samples/
│   └── cortex-incident-triage-agent/     # See §7
└── test/
    └── fixtures/                         # Shared mock-ctx + pacts for tests
```

### 6.3 Call flow (happy path)

```
Tenant app code
  │   const agent = createMethodAgent({ ctx, pact, onEvent });
  ▼
createMethodAgent
  1. validateCtxShape(ctx)                       → MissingCtxError on gap
  2. validateOptionsStrict(options, ctx)         → ConfigurationError on violation
  3. provider = options.provider                      ??
                cortexLLMProvider({ handlers }).compose({ ctx }).asProvider()
  4. middlewareStack = composeStack({
         tokenExchange: cortexTokenExchangeMiddleware({ appId, narrowScope }),
         audit:         cortexAuditMiddleware({ appId }),
         budgetMode:    (provider.capabilities().budgetEnforcement === 'native')
                          ? 'predictive' : 'authoritative',
     })
  5. pactaAgent = createAgent({ pact, provider, onEvent: multiplexer.fanIn, ... })
  6. return new MethodAgentHandle({ pactaAgent, multiplexer, resumption, abort })
  │
  ▼
Tenant app code
      const result = await agent.invoke({ prompt });
                                  │
                                  ▼
      pactaAgent.invoke                      (now runs the middleware stack)
        → tokenExchangeMw.wrap → auditMw.wrap → budgetEnforcer(predictive)
          → outputValidator → reasonerMw → CortexLLMProvider.invoke
            → ctx.llm.complete(req)        (SINGLE authoritative enforcement)
      (events fan out via onEvent multiplexer to: tenant's onEvent callback
       AND CortexAuditMiddleware AND optional CortexEventConnector AND
       optional async-iterable events() queue)
```

### 6.4 Key design decisions

**D1 — Factory, not class.** S1 mandates `createMethodAgent` as a function,
not a constructor. The `MethodAgent<T>` handle is an interface; its concrete
class is internal (`MethodAgentHandle`). Consumers never see the class name.

**D2 — No DI container.** Composition is hand-written in the factory body,
mirroring pacta's `createAgent`. Every dependency is either a function
parameter or imported by module name. This keeps the package debuggable and
the composition theorem checkable by reading one file.

**D3 — Handle state lives in the handle, not the factory.** `invocationCount`,
current-invocation abort controllers, the events queue — all owned by the
`MethodAgentHandle` instance. The factory returns a fresh handle per call;
calling `createMethodAgent` twice with the same ctx+pact produces two
independent handles (same underlying pacta composition re-built — this is
cheap).

**D4 — Events multiplexer runs in-process.** No queue, no worker thread.
A callback fan-out and a bounded async-iterable pump. Bounded to 1000 events
per invocation by default; overflow drops oldest with a `ctx.log.warn`.

**D5 — Compatibility helper is opt-in.** `assertCtxCompatibility(ctx)` is NOT
called inside `createMethodAgent` (would slow every factory call).
Tenant apps call it at boot if they want the safety net. The sample app
calls it; production tenant apps are encouraged but not forced.

**D6 — Session store default = FS adapter.** The bridge and the sample app
both use the filesystem adapter (shared with `@method/runtime`). Cortex
tenant apps in production wire the `ctx.storage`-backed adapter via
`options.resumption.storeAdapter` — **that adapter ships in PRD-061**, not
here. The factory reads `options.resumption.storeAdapter` if set, else uses
the FS default.

**D7 — No implicit `CortexEventConnector`.** The connector is auto-wired
only when `ctx.events` is present AND `options.middleware.events !== false`.
If PRD-063 hasn't shipped the connector class yet, this PRD ships a no-op
stub that simply returns from its constructor; the wire-up logic works
against an interface, not the class. Upgrade path: swap the stub import
when PRD-063 merges.

### 6.5 Error taxonomy

All errors from `createMethodAgent` are composition-time (fail-fast):
- `MissingCtxError` — required facade absent (`ctx.llm`, etc.).
- `ConfigurationError` — strict-mode rule violated, or custom provider incompatible.
- `CapabilityError` (re-thrown from pacta) — provider doesn't support pact mode.

All errors from `MethodAgent.invoke/resume/abort` inherit pacta's taxonomy:
- `ProviderError` and its subclasses — passed through unchanged.
- `BudgetExhaustedError` — emitted when ctx.llm returns `LLMError.BudgetExceeded`.
- `UnknownSessionError` — only thrown from `resume()` when sessionId missing.
- `IllegalStateError` — only from `events()` when onEvent was provided.

No new runtime error introduced. All errors have `.code` fields matching S1.

### 6.6 Gate plan

| Gate | Source | Assertion |
|------|--------|-----------|
| G-BOUNDARY-NO-CORTEX-VALUE-IMPORT | S1 §8 | Scan `packages/agent-runtime/src/**/*.ts` — no non-`type` import from `@cortex/*` or `@t1/cortex-sdk` |
| G-PORT-SYMBOLS | S1 §8 | `import * as mod from '@method/agent-runtime'` — expected symbol set exact match |
| G-LAYER | S1 §8 | No import from `@method/bridge` anywhere under `src/` |
| G-BUDGET-SINGLE-AUTHORITY | S3 §4 | When provider.capabilities().budgetEnforcement === 'native', factory wires budgetEnforcer mode='predictive' (introspect via test-only diagnostics handle) |
| G-TOKEN-DEPTH-CAP | S3 §5 | exchangeForSubAgent throws at depth 2 (unit test) |
| G-PACTA-UNCHANGED | this PRD | `packages/pacta/src/index.ts` diff empty in this PR |
| G-SAMPLE-BUILDS | this PRD | samples/cortex-incident-triage-agent/ builds and its test passes |
| G-STRICT-MODE-REFUSAL | this PRD | options.provider + strict + tier==='service' throws ConfigurationError |
| G-EVENTS-MUTEX | this PRD | events() after onEvent provided throws IllegalStateError |

All gates are CI-enforced via the `packages/agent-runtime/` test script.

---

## 7. Sample App Deliverable

### 7.1 Path

`samples/cortex-incident-triage-agent/` (at the workspace root, not
under `packages/` — samples are not published, consistent with the
`packages/*` convention).

### 7.2 Directory layout

```
samples/cortex-incident-triage-agent/
├── package.json                 # name: sample-cortex-incident-triage-agent (private, no publish)
├── tsconfig.json
├── README.md                    # How to run locally + against mock ctx + manual dev-stack instructions
├── src/
│   ├── agent.ts                 # The tenant app entry: createMethodAgent + invoke + ctx.notify.slack wiring
│   ├── pacts/
│   │   └── incident-triage.ts   # Pact<TriageOutput> definition — mode, budget, scope, reasoning, output schema
│   └── types.ts                 # TriageOutput Zod schema
└── test/
    ├── mock-ctx.ts              # In-process Cortex ctx — implements CortexCtx facades with spies
    ├── end-to-end.test.ts       # Main smoke: run the agent, assert the contract
    └── resumption.test.ts       # Round-trip a Resumption token
```

### 7.3 What the sample proves

The sample is the **executable proof** that the S1 contract works. It:

1. Defines a realistic incident-triage pact (oneshot, $0.10 budget, 10 turns
   max, `incident-schema` output, `medium` reasoning, scope: read-only tools
   + `Slack.post` via `ctx.notify`).
2. Imports only `@method/agent-runtime` (no `@method/pacta` directly — proves
   the re-exports are complete).
3. Uses an in-process mock `ctx` implementing each `CortexCtx` facade with a
   Vitest/sinon-style spy. `ctx.llm.complete` returns a canned JSON string.
4. Runs `agent.invoke({ prompt: ctx.input.text })` and asserts the end-to-end
   contract from §4.3.
5. Exercises the `onEvent` path **and** the `events()` async-iterable path in
   two separate test cases — proving the mutual exclusion enforcement.
6. Round-trips a `Resumption` token: first call suspends (via a canned
   `stopReason: 'turn_limit'` in the mock provider), second call `resume()`s
   and observes prior `MethodAgentResult.auditEventCount` accrued.

### 7.4 What the sample does NOT do (bounded)

- Does not talk to a real Cortex stack. Instructions in README for manual
  dev-stack run, but CI uses mock only (no API keys, no network). The
  roadmap A8 gate (smoke test against `t1-cortex-1` dev stack) is a
  manual sign-off, not a CI job, per roadmap §5 Group A.
- Does not ship a UI. It's a Node test harness.
- Does not include a full `CortexEventConnector` wire. `ctx.events` is
  absent in the mock by default; one test case adds it and asserts the
  connector registered.
- Does not use `ctx.storage`. Resumption round-trip uses the FS adapter
  against a `tmp/` directory (cleaned between tests).

### 7.5 CI integration

Root `package.json` adds a test target:
```json
"test:sample-cortex-incident-triage": "npm --workspace=samples/cortex-incident-triage-agent test"
```
Wired into the main `npm test` target. Sample failures block PR merge.

---

## 8. Per-Domain Architecture

Only one domain ships new code: **`agent-runtime` (new)**. Other domains are
consumed read-only.

### 8.1 `@method/agent-runtime` (this PRD)

**Layer:** L3.

**Internal structure:** see §6.2. Every file is < 300 LOC; the factory file
is the largest at ~250 LOC.

**Ports produced:** none. The factory IS the port (S1). No new cross-domain
interfaces.

**Ports consumed:**
- `AgentProvider`, `MemoryPort`, `Pact<T>`, `AgentRequest`, `AgentResult<T>`, `AgentEvent` — from `@method/pacta`.
- `EventBus`, `EventSink`, `SessionStore` (port only) — from `@method/runtime/ports`.
- `CortexCtx` and sub-facades — type-only re-declaration at `src/cortex/ctx-types.ts` (S1 §4.1).
- `CortexLLMProvider`, `CortexAuditMiddleware`, `CortexTokenExchangeMiddleware` — from `@method/pacta-provider-cortex` (PRD-059).
- `CortexEventConnector` (optional) — from `@method/pacta-provider-cortex` or separate `@method/agent-runtime-cortex-events`; final home decided by PRD-063.

**Tests:**
- Unit tests for: `create-method-agent.ts`, `method-agent-handle.ts`, `events-multiplexer.ts`, `resumption.ts`, `errors.ts`.
- Gate tests in `gates/gates.test.ts`.
- Integration: full sample app suite (§7).

**Verification:** `cd packages/agent-runtime && npm test` exits 0. Gates all green.

### 8.2 `@method/pacta` (unchanged)

No changes. Gate `G-PACTA-UNCHANGED` enforces.

### 8.3 `@method/runtime` (consumed, unchanged)

Imports: `EventBus`, `EventSink`, `SessionStore` (port only), `RuntimeEvent` type.
No code changes here.

### 8.4 `@method/pacta-provider-cortex` (consumed, separate PRD)

PRD-059 ships this package. This PRD declares it as a dependency in
`package.json` with a version range. If PRD-059 has not merged at PR time
for this PRD, CI fails (version unresolvable) — that is the desired
coordination mechanism.

---

## 9. Phase Plan

Because the S1 surface is already frozen and the S2/S3/S6/S7 dependencies are
already surfaced, the entire work is effectively **one wave** within PRD-058.
Sub-phases are serial because they share one package.

### Wave 0 — Surfaces (already done, external to this PRD)

All consumed surfaces frozen on 2026-04-14. No Wave 0 work in this PRD.

### Wave 1 — Package skeleton + type seam (sequence A)

1. Create `packages/agent-runtime/` with package.json, tsconfig, empty src.
2. Write `src/cortex/ctx-types.ts` (type-only re-declaration of CortexCtx facades, S1 §4.1).
3. Write `src/errors.ts` (the four new error classes + pacta re-exports).
4. Write `src/resumption.ts` (opaque codec).
5. Wire workspace membership in root `package.json`. `npm install` resolves.

**Acceptance:** `tsc --noEmit` clean. No runtime behavior yet.

### Wave 2 — Handle + multiplexer (sequence B)

1. Write `src/events-multiplexer.ts` (fanout + async-iterable queue).
2. Write `src/method-agent-handle.ts` (the MethodAgent class wrapping pacta's Agent).
3. Unit tests for both — mutual-exclusion, iterable semantics, dispose idempotency.

**Acceptance:** handle tests pass with a fake inner pacta Agent.

### Wave 3 — Factory + composition (sequence C)

1. Write `src/create-method-agent.ts` — the factory, including validateCtxShape and validateOptionsStrict.
2. Wire it to the Wave-1 type seam, Wave-2 handle, and (via dep) the PRD-059 adapters.
3. Write `src/session-store-adapter.ts` (FS adapter for default).
4. Write `src/wire-event-connector.ts` (optional autowire; stub if PRD-063 absent).

**Acceptance:** `createMethodAgent({ ctx: mockCtx, pact })` returns a handle; `invoke` runs end-to-end against stub adapters.

### Wave 4 — Sample app + gates (sequence D)

1. Scaffold `samples/cortex-incident-triage-agent/`.
2. Write the incident-triage pact + mock ctx + end-to-end test.
3. Write the resumption round-trip test.
4. Write `packages/agent-runtime/src/gates/gates.test.ts` (all gates from §6.6).
5. Write `packages/agent-runtime/src/architecture.test.ts` (scan-based gates).
6. Wire sample into root test script.

**Acceptance:** every success criterion in §4 green in CI.

### Wave 5 — Docs + readiness sign-off (sequence E)

1. Write `packages/agent-runtime/README.md` — Install, Usage, link to S1 decision.md and PRD-058.
2. Update `docs/guides/` — new guide for "embedding an agent in a Cortex tenant app" referencing this package and the sample.
3. Update `docs/roadmap-cortex-consumption.md` — mark A2 and A6 done; note A7 (surface advocate signoff) status.
4. Manually run the sample against a `t1-cortex-1` dev stack if available; record in the PR description.

**Acceptance:** PRD-058 merged; roadmap checklist updates reflected.

### Dependencies between waves

Waves are strictly serial within this PRD (shared package). But:
- **PRD-057 must merge before Wave 1** (needs `@method/runtime` types).
- **PRD-059 must merge before Wave 3** (needs adapter imports). If PRD-059 slips, Wave 3 substitutes stub adapters; Wave 4 tests then use the stubs.
- **PRD-061 MAY slip past this PRD.** Its `ctx.storage`-backed store is optional; FS adapter is the default.

### Size

**M** (roadmap §6 calls this M). Rough LOC estimate: 1200–1600 lines of TS
source + 600–900 lines of tests + 300–500 lines of sample app. 2 agent-days
serial, could parallelize Wave 2 and Wave 4 once Wave 1 lands.

---

## 10. Risks + Mitigations

### R1 — Dual ctx import paths (high)

**Risk:** Cortex `ctx.*` drifts from our structural declaration; tenant apps
compile but fail at runtime. Type-only imports mean TypeScript won't catch
the drift.

**Mitigation:**
- Ship `assertCtxCompatibility(ctx)` helper; sample calls it at boot; guide
  documents the pattern.
- Every facade in `ctx-types.ts` has a pointer-comment to its Cortex
  source-of-truth file with a version date.
- Ongoing: Cortex side adds `@method/agent-runtime` as a type-smoke consumer
  (roadmap O-DRIFT, out of scope for this PRD).

**Residual risk:** accepted. The whole point of the type-only seam is to keep
method publishable without Cortex. If the tradeoff becomes too painful, we
add a build-time check that reads `@t1/cortex-sdk`'s declarations and asserts
our structural shape is compatible — that's a new PRD if needed.

### R2 — PRD-059 not shipping in time (high for demos)

**Risk:** April 21 demo gates block on this PRD; this PRD blocks on PRD-059's
Cortex adapters. If PRD-059 slips, the sample app can't run end-to-end.

**Mitigation:**
- Write `createMethodAgent` to compose by **interface**, not concrete class.
  If PRD-059's `cortexLLMProvider` factory isn't available, the sample uses
  a local no-op provider that satisfies the same interface and asserts the
  factory wiring path.
- PRD-058 can merge with stub adapters; sample app tests pass; roadmap A2
  closes; demo readiness tracked separately in roadmap A3.

**Residual risk:** demos might need PRD-059 real adapters; coordinate merge
windows.

### R3 — Pacta peer-dep version drift (medium)

**Risk:** Tenant apps install a pacta version outside our declared range;
composition-time `ConfigurationError` surfaces confusingly.

**Mitigation:**
- Error message is explicit: "pacta peer version X.Y.Z outside supported
  range ^N.M.0 — install `@method/pacta@^N.M` or see upgrade guide at..."
- Peer-dep range is declared narrow (single major) to force explicit upgrade.

**Residual risk:** minor annoyance for tenant teams on npm install. Acceptable.

### R4 — Resumption opaque-token format churn (medium)

**Risk:** We encode `{v, storeKey, fencingToken}` into opaque payload.
A future change (e.g., adding region) breaks in-flight tokens.

**Mitigation:**
- `v: 1` versioning baked in. `parseResumption()` branches on version.
- When `v: 2` ships, `v: 1` tokens still parse (backward compat) until a
  deliberate deprecation cycle.
- Opaque-token expiry (`expiresAt`) means churn windows are bounded to TTL.

**Residual risk:** accepted. The opaque token is designed for this.

### R5 — Test isolation: sample app leaks state into other package tests (low)

**Risk:** Sample writes FS state; parallel test runs collide.

**Mitigation:**
- Sample uses `os.tmpdir() + uniqueId` for store paths. Cleanup in
  `afterEach`. Vitest `poolOptions.threads.singleThread: false` safe.

**Residual risk:** negligible.

### R6 — `onEvent` throwing inside user callback crashes invoke (low)

**Risk:** Tenant app's `onEvent` throws; pacta's fanout uncaught; agent
invocation fails with a confusing stack.

**Mitigation:**
- Multiplexer wraps every external callback invocation in try/catch; a thrown
  error becomes a `ctx.log.warn` entry with event type + error message.
  Invoke proceeds. This is best-effort semantics per S1 §4.2.

**Residual risk:** accepted. Documented in the guide.

### R7 — Strict mode too aggressive, breaks legit use cases (low)

**Risk:** Tenant app on `tier: 'tool'` legitimately needs `options.provider`
override; strict mode rejects.

**Mitigation:**
- Strict mode default = tier is `'service'`, not all tiers. Tools/webs
  default non-strict. Tenant apps can explicitly set `strict: true` or
  `strict: false` to override tier default.

**Residual risk:** negligible.

---

## 11. Acceptance Gates (aggregated from §4 + §6.6)

This PRD is acceptable to merge when **all of the following are green**:

| # | Gate | Source | Evidence |
|---|------|--------|----------|
| 1 | `npm run build` clean in `packages/agent-runtime/` | §4 criterion 1 | CI log |
| 2 | G-BOUNDARY-NO-CORTEX-VALUE-IMPORT | S1 §8, §6.6 | Test in `src/architecture.test.ts` |
| 3 | G-PORT-SYMBOLS (exact match S1 §8 export list) | S1 §8, §6.6 | Test in `src/gates/gates.test.ts` |
| 4 | G-LAYER (no bridge imports) | S1 §8, §6.6 | Test in `src/architecture.test.ts` |
| 5 | G-BUDGET-SINGLE-AUTHORITY | S3 §4, §6.6 | Unit test in `src/gates/gates.test.ts` |
| 6 | G-TOKEN-DEPTH-CAP | S3 §5, §6.6 | Unit test (uses PRD-059 adapters or stub) |
| 7 | G-PACTA-UNCHANGED | this PRD §6.6 | PR diff check in CI |
| 8 | G-SAMPLE-BUILDS | this PRD §6.6 | Sample test suite green |
| 9 | G-STRICT-MODE-REFUSAL | this PRD §6.6 | Unit test |
| 10 | G-EVENTS-MUTEX | this PRD §6.6 | Unit test |
| 11 | End-to-end sample test green (success criterion 3) | §4 | `samples/.../test/end-to-end.test.ts` |
| 12 | Resumption round-trip green (success criterion 9) | §4 | `samples/.../test/resumption.test.ts` |
| 13 | Abort cooperative (success criterion 8) | §4 | Unit test |
| 14 | Surface Advocate signoff on PR | S1 §11 | PR review comment |
| 15 | Roadmap A2 + A6 checkbox status updated in docs | §9 Wave 5 | PR diff to roadmap.md |

Surface Advocate review is non-negotiable per FCD Rule 3 (S1 references it
explicitly). Reviewer checks: the factory signature, exports, error taxonomy,
and middleware order match S1 verbatim. Any deviation is a new `/fcd-surface`
session, not a PR comment to resolve inline.

---

## 12. Judgment Calls (not frozen; flagged for implementer discretion)

These are decisions a commission agent may revise without a new surface
session, as long as the S1 contract holds.

1. **Event multiplexer backpressure behavior.** Default: 1000-event bounded
   queue, drop-oldest on overflow with a warn. If the implementer finds a
   realistic pact generating > 1000 events per invocation, raise the cap
   or make it configurable via `options` — but the field must be optional
   with a sane default.

2. **Resumption TTL default.** §6.4 D6 mentions expiresAt but does not pin a
   default value. Suggest 7 days; implementer may adjust based on Cortex
   `ctx.storage` retention norms in PRD-061.

3. **`wire-event-connector.ts` stub behavior when PRD-063 unmerged.** Plan:
   a no-op connector that logs "event connector not available" at warn once.
   Implementer may instead make the connector wiring conditional on a try/catch
   around a dynamic `await import('@method/pacta-provider-cortex/event-connector')`
   call. Either works; the contract (S6 gate G-AUDIT-SUPERSET still holds
   because audit path is always on).

4. **Sample app pact — exact schema + scope.** The sample is not binding on
   tenant apps. Use a schema Zod can validate in 20 lines. Scope = no Write
   / Bash tools; `ctx.notify.slack` via `onEvent` handler. Implementer owns
   the exact shape.

5. **README length.** Keep it under 200 lines. One install snippet, one
   usage snippet, one link to S1 decision.md, one link to the sample.
   Do NOT duplicate S1 in the README — link to it.

6. **Whether to re-export the `Resumption` type from the package barrel.**
   S1 §4.4 declares `Resumption` as a named type; §4.7 re-exports pacta
   types. The `Resumption` type is agent-runtime-owned; it IS in the barrel.
   But its fields (`sessionId`, `opaque`, `expiresAt`) are the only visible
   ones — the opaque internal shape is NOT exported.

---

## 13. Status

**Draft** 2026-04-14. Ready for review by Method team + Surface Advocate.

- Primary surface (S1) frozen 2026-04-14 — this PRD implements it verbatim.
- Consumed surfaces (S2, S3, S6, S7) frozen — dependencies stable.
- Implementation can start after PRD-057 merge; can run in parallel with PRD-059.
- Blocks: samples/cortex-incident-triage-agent/ + April 21 demo gate 3.1.

Changes after merge require the S1 contract to hold; any drift from S1 is a
new `/fcd-surface` session with migration plan and major version bump.
