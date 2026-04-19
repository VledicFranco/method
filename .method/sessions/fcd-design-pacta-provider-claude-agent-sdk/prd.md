---
type: prd
title: "@methodts/pacta-provider-claude-agent-sdk — Cortex-pluggable agent loop"
date: "2026-04-19"
status: draft
domains: [pacta-provider-claude-agent-sdk, pacta-provider-cortex, agent-runtime]
surfaces:
  - S-AGENT-PROVIDER-CONTRACT (existing — re-validated)
  - S-CLAUDE-SDK-PROVIDER (new — factory + options)
  - S-ANTHROPIC-SDK-TRANSPORT (new — env-injection + lifecycle boundary; revised post-spike)
  - S-CORTEX-ANTHROPIC-TRANSPORT (new — Cortex-side adapter producing the transport)
related:
  - co-design/method-agent-port.md (S1)
  - .method/sessions/fcd-surface-cortex-service-adapters/decision.md (S3)
  - packages/pacta-provider-anthropic/ (sibling provider, owns its own loop today)
  - packages/pacta-provider-cortex/ (extension home for the Cortex transport)
---

# @methodts/pacta-provider-claude-agent-sdk — Cortex-pluggable agent loop

## Problem

`@methodts/pacta-provider-anthropic` re-implements the tool-use loop manually
(`invokeWithToolLoop` at `anthropic-provider.ts:149`). Anthropic now ships
`@anthropic-ai/claude-agent-sdk` — a maintained, higher-quality loop with
streaming, structured event emission, and sub-agent support. We want pacta
agents to be able to delegate the inner loop to that SDK while preserving
pacta's outer contract (`Pact`, `AgentProvider`, middleware stack).

A pacta-shaped wrapper around the SDK is straightforward for non-Cortex
consumers (CLI, local dev). The hard part is **Cortex** — RFC-005 §10.2
requires every LLM call to flow through `ctx.llm` for budget enforcement.
The SDK assumes direct API access. We need an integration that lets a
Cortex tenant app use the SDK's loop **without bypassing `ctx.llm`**.

## Constraints

- Must implement `AgentProvider` (and ideally `Streamable`) so the entire
  pacta middleware stack still composes around it
  (`packages/pacta/src/ports/agent-provider.ts`).
- Must preserve pacta's `Pact` semantics: budget caps, output schema, scope,
  reasoning policy, mode (oneshot only in v1 — see Out of scope).
- Must not import `@t1/cortex-sdk` from the SDK provider package
  (G-BOUNDARY): Cortex specifics live in `pacta-provider-cortex` only,
  per the existing `G-CORTEX-ONLY-PATH` gate.
- Must work in **two modes**:
  - **Direct mode** — non-Cortex; user supplies `apiKey` (or env var) and
    optionally a custom `fetch`. SDK calls Anthropic API directly.
  - **Cortex mode** — Cortex tenant app supplies a transport produced by
    `pacta-provider-cortex` that routes every API call through `ctx.llm`
    for budget tracking, `ctx.secrets` for keys, and `ctx.audit` for
    per-turn observability.
- Apache-2.0; npm-publishable as `@methodts/pacta-provider-claude-agent-sdk`,
  sibling to the other `pacta-provider-*` packages.
- **Version pinning**: peer-dep on `@anthropic-ai/claude-agent-sdk` so the
  consumer brings one version; document compatibility matrix.

## Success Criteria

1. **Direct mode parity** — `claudeAgentSdkProvider({ apiKey })` runs an
   incident-triage-style oneshot pact end-to-end against a mock fetch and
   returns an `AgentResult` with usage + cost, mapping the SDK's event
   stream to `AgentEvent`. Demonstrated by a unit test in the package.
2. **Cortex composition** — a sample Cortex tenant app composes:
   ```ts
   const provider = claudeAgentSdkProvider({
     transport: cortexAnthropicTransport(ctx),
   });
   const agent = createMethodAgent({ ctx, pact, provider });
   ```
   and `ctx.llm.reserve()`/`settle()` is called once per SDK turn (not just
   once per pact). Validated end-to-end in
   `samples/cortex-incident-triage-agent-sdk/` (new sample).
3. **Conformance** — runs the existing
   `@methodts/pacta-testkit/conformance` suite (PRD-065). New provider
   passes the same conformance rows that `pacta-provider-anthropic` passes.

## Scope

### In
- New package `packages/pacta-provider-claude-agent-sdk/` implementing
  `AgentProvider` + `Streamable` over `@anthropic-ai/claude-agent-sdk`.
- Extension to `packages/pacta-provider-cortex/`: a new export
  `cortexAnthropicTransport(ctx, opts)` that produces a `fetch`-shaped
  transport function meeting the new S-ANTHROPIC-WIRE-TRANSPORT surface.
- New sample `samples/cortex-incident-triage-agent-sdk/` exercising the
  full Cortex composition.
- Conformance testkit row for the new provider.

### Out
- **No changes to `pacta-provider-anthropic`.** It continues to own the
  manual-loop path. Both providers ship side-by-side.
- **No new methods on `AgentProvider`.** The contract is already frozen
  (S1 ratified 2026-04-18).
- **No CortexCtx shape change.** S3 (CortexServiceAdapters) stays as-is.
  The new `cortexAnthropicTransport` is an additive *export*, not an
  addition to S3.
- **No SDK-internal multi-agent orchestration in v1.** If the user wires
  sub-agents via the SDK, pacta sees them as opaque tool calls. Multi-agent
  modeling at the pacta layer is an S1 non-goal (already declared).
- **No streaming sub-agent events through `Streamable.stream()` in v1.**
  v1 maps SDK events to pacta `AgentEvent` for top-level events only;
  sub-agent event surfacing is Wave 2.

## Domain Map

```
                                 ┌─────────────────────────────────┐
                                 │  pacta (existing, frozen)       │
                                 │   AgentProvider, Streamable,    │
                                 │   Pact, AgentEvent              │
                                 └─────────┬───────────────────────┘
                                           │ implements
                                           ▼
       ┌────────────────────────────────────────────────────────────┐
       │  pacta-provider-claude-agent-sdk (NEW)                     │
       │   claudeAgentSdkProvider({ transport, ... })               │
       │     - Builds SDK options from Pact                         │
       │     - Runs `query()`/`run()` from @anthropic-ai/claude-    │
       │       agent-sdk and consumes its event stream              │
       │     - Maps SDK events → pacta AgentEvent                   │
       └─────────┬─────────────────────────────────┬────────────────┘
                 │ depends on (peer)               │ uses (config)
                 ▼                                 ▼
       ┌─────────────────────────────┐   ┌─────────────────────────────┐
       │ @anthropic-ai/claude-agent- │   │  S-ANTHROPIC-WIRE-TRANSPORT │
       │   sdk (external)            │   │   (fetch-shaped function)   │
       └─────────────────────────────┘   └────────────┬────────────────┘
                                                      │ produced by
                                                      ▼
                                         ┌─────────────────────────────┐
                                         │ pacta-provider-cortex (ext) │
                                         │   cortexAnthropicTransport  │
                                         │   (ctx, opts)               │
                                         │     - ctx.llm.reserve/settle│
                                         │     - ctx.secrets for key   │
                                         │     - ctx.audit per turn    │
                                         └────────────┬────────────────┘
                                                      │ requires
                                                      ▼
                                         ┌─────────────────────────────┐
                                         │ ctx.llm.reserve/settle      │
                                         │ (Cortex O1 ask — pending)   │
                                         └─────────────────────────────┘
```

**Cross-domain interactions:**
- `pacta-provider-claude-agent-sdk` ↔ `pacta` — implements existing port
  `AgentProvider` (S-AGENT-PROVIDER-CONTRACT, frozen — no change)
- `pacta-provider-claude-agent-sdk` ↔ `@anthropic-ai/claude-agent-sdk` —
  external dep boundary; **typed at the package's options surface**
  (S-CLAUDE-SDK-PROVIDER, new)
- `pacta-provider-claude-agent-sdk` ↔ `pacta-provider-cortex` — the
  transport boundary. The provider accepts a `transport` option; cortex
  package produces one. **The shape between them is the pluggable seam**
  (S-ANTHROPIC-WIRE-TRANSPORT, new)
- `pacta-provider-cortex` ↔ Cortex `ctx.llm`/`ctx.secrets`/`ctx.audit` —
  S-CORTEX-ANTHROPIC-TRANSPORT, new (consumes existing S3 facades)

---

## Surfaces (Primary Deliverable)

### S1 (existing, no change) — `AgentProvider`

Frozen at `packages/pacta/src/ports/agent-provider.ts`. The new provider
implements this contract verbatim:

```typescript
interface AgentProvider {
  readonly name: string;
  capabilities(): ProviderCapabilities;
  invoke<T>(pact: Pact<T>, request: AgentRequest): Promise<AgentResult<T>>;
}
interface Streamable {
  stream(pact: Pact, request: AgentRequest): AsyncIterable<AgentEvent>;
}
```

No re-freeze needed. The new provider is a producer, pacta is the consumer.

### S2 (NEW) — `S-CLAUDE-SDK-PROVIDER` (factory + options)

The pacta-provider-claude-agent-sdk public surface. Trivial scope per
fcd-design 3.2 (single factory, simple options shape).

```typescript
// packages/pacta-provider-claude-agent-sdk/src/index.ts

export interface ClaudeAgentSdkProviderOptions {
  /** Default model (e.g. 'claude-sonnet-4-6'). Overridable per pact. */
  defaultModel?: string;

  /**
   * HTTP transport for SDK API calls. Default: globalThis.fetch.
   *
   * Cortex tenant apps inject `cortexAnthropicTransport(ctx)` here to
   * route every SDK turn through ctx.llm budget enforcement.
   *
   * The transport must conform to S-ANTHROPIC-WIRE-TRANSPORT.
   */
  transport?: AnthropicWireTransport;

  /**
   * API key. Ignored when `transport` handles auth (e.g. Cortex mode).
   * Falls back to ANTHROPIC_API_KEY env var.
   */
  apiKey?: string;

  /** Tool provider. SDK's built-in tools are merged with these. */
  toolProvider?: ToolProvider;

  /** Max agentic turns (defaults to pact.budget.maxTurns ?? 25). */
  maxTurns?: number;
}

export function claudeAgentSdkProvider(
  options: ClaudeAgentSdkProviderOptions = {},
): AgentProvider & Streamable;
```

**Producer:** pacta-provider-claude-agent-sdk
**Consumer:** any pacta agent composition (Cortex or non-Cortex)
**Status:** frozen
**Gate:** G-PORT — exports match the symbol set above; no Cortex SDK
imports in the package's `src/` (G-BOUNDARY).

### S3 (NEW) — `S-ANTHROPIC-SDK-TRANSPORT` (the pluggable seam)

> **Revised after spike (see `spike-findings.md`).** Original draft
> assumed the seam was `fetch`-shaped. The Claude Agent SDK actually
> spawns the `claude` CLI as a subprocess and does not expose a fetch
> hook. The CLI subprocess **does** honor `ANTHROPIC_BASE_URL` from its
> env, so the seam is process-env injection paired with a parent-side
> HTTP proxy.

The boundary between the SDK provider and any budget-tracking
middleware. The provider invokes `setup()` before each `query()`,
merges the returned `env` into `Options.env`, runs the SDK, then
invokes `teardown()` to release any resources (e.g., the local proxy).

```typescript
// packages/pacta-provider-claude-agent-sdk/src/transport.ts
// (re-exported from index.ts)

export interface AnthropicSdkTransport {
  /**
   * Prepare the transport for an SDK invocation.
   *
   * Returns env vars that must be merged into Options.env, plus a
   * teardown function the provider must call after the SDK completes
   * (success or error). Typical env vars:
   *   - ANTHROPIC_BASE_URL (Cortex mode: local proxy URL)
   *   - ANTHROPIC_API_KEY  (always — resolved from config or proxy auth)
   *
   * Implementations must be safe to call concurrently from multiple
   * agent invocations; each call returns an independent setup.
   */
  setup(): Promise<{
    env: Record<string, string>;
    teardown: () => Promise<void>;
  }>;
}
```

**Why this shape (not `fetch`)?** The SDK runs a subprocess; HTTP
calls happen inside it. The only seam the parent process can inject
is the subprocess's environment. The proxy is the actual interception
mechanism — the contract is the lifecycle that owns it.

**What this contract deliberately omits:**
- Per-turn callbacks — proxy implementation handles per-turn
  observability internally; surfacing it would couple the SDK provider
  to Cortex semantics.
- Mid-stream cancellation — `Options.abortController` already covers
  this at the SDK layer.
- Request shape access — the proxy implementation is the only place
  that needs to parse Anthropic-shaped requests.

**Producer:** pacta-provider-claude-agent-sdk (defines the interface)
**Consumers:** pacta-provider-cortex (Cortex transport), test code, any
future budget/audit/replay middleware
**Status:** frozen (revised post-spike 2026-04-19)
**Gate:** G-PORT — `AnthropicSdkTransport` interface is part of the
package's public exports.

### S4 (NEW) — `S-CORTEX-ANTHROPIC-TRANSPORT` (cortex-side adapter)

The Cortex-side production of S-ANTHROPIC-SDK-TRANSPORT. Lives in
`pacta-provider-cortex` (extends the existing S3 family).

```typescript
// packages/pacta-provider-cortex/src/anthropic-transport.ts
// (re-exported from index.ts via subpath: pacta-provider-cortex/anthropic-transport)

import type { AnthropicSdkTransport } from '@methodts/pacta-provider-claude-agent-sdk';
import type { CortexCtx } from './ctx-types.js';

export interface CortexAnthropicTransportConfig {
  /**
   * Where to fetch the Anthropic API key. Defaults to ctx.secrets if
   * available; otherwise reads ANTHROPIC_API_KEY env var.
   */
  apiKey?:
    | { source: 'env'; name?: string }
    | { source: 'secret'; name: string }
    | { source: 'literal'; value: string };

  /**
   * Cost estimator: given an Anthropic request body, return the
   * predicted maxCostUsd to pass to ctx.llm.reserve(). Defaults to
   * a conservative per-model upper bound based on max_tokens.
   */
  estimateCost?: (req: AnthropicMessagesRequest) => number;

  /**
   * Mandatory budget handlers (matches CortexLLMProviderConfig from S3).
   * Wired into the same handler taxonomy so a tenant app sees a single
   * consistent budget surface across providers.
   */
  handlers: {
    onBudgetWarning: (e: BudgetEvent) => void;
    onBudgetCritical: (e: BudgetEvent) => void;
    onBudgetExceeded: (e: BudgetEvent) => void;
  };
}

/**
 * Produce a Cortex-aware AnthropicSdkTransport.
 *
 * `setup()` per SDK invocation:
 *   1. Spins up a localhost HTTP proxy on a random port
 *   2. Returns { env: { ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY }, teardown }
 *
 * The proxy handles each `/v1/messages?beta=true` POST from the CLI:
 *   1. Parses the Anthropic request body
 *   2. Calls ctx.llm.reserve(estimateCost(req))   // requires Cortex O1
 *   3. Forwards to api.anthropic.com using the resolved API key
 *   4. Parses response, computes actual cost from usage
 *   5. Calls ctx.llm.settle(handle, actualCost)   // requires Cortex O1
 *   6. Emits ctx.audit.event for the turn (PRD-065 schema)
 *   7. Streams the unmodified Response back to the SDK
 *
 * Initial `HEAD /` probes from the SDK are answered with 200.
 *
 * `teardown()` closes the proxy server. The provider invokes it in a
 * `finally` block so the port is released even on SDK errors.
 *
 * Errors map to the same taxonomy as cortexLLMProvider: budget exceeded
 * (BudgetExceededError → translated to a 429 with the SDK's expected
 * shape so the SDK aborts cleanly), auth failures (AuthError → 401),
 * rate limit (RateLimitError → passthrough 429), network (NetworkError
 * → 502).
 */
export function cortexAnthropicTransport(
  ctx: Pick<CortexCtx, 'llm' | 'audit' | 'secrets' | 'log'>,
  config: CortexAnthropicTransportConfig,
): AnthropicSdkTransport;
```

**Producer:** pacta-provider-cortex
**Consumer:** pacta-provider-claude-agent-sdk (via the S-ANTHROPIC-WIRE-TRANSPORT
seam)
**Status:** frozen pending O1 implementation in Cortex; the surface
itself is frozen, but the runtime depends on `ctx.llm.reserve()`/`settle()`
which is Cortex-side ask **O1** (pending — see
`ov-t1/projects/t1-cortex/method-integration.md` §3.3).
**Gate:** G-CORTEX-ONLY-PATH (existing) — only `pacta-provider-cortex`
imports `@t1/cortex-sdk`. Plus G-PORT — the export shape above.

### Surface Summary

| Surface | Owner | Producer → Consumer | Status | Gate |
|---|---|---|---|---|
| `AgentProvider` (S1, existing) | pacta | provider → pacta core | frozen | G-PORT |
| `S-CLAUDE-SDK-PROVIDER` | pacta-provider-claude-agent-sdk | self → composition root | frozen | G-PORT, G-BOUNDARY (no cortex-sdk) |
| `S-ANTHROPIC-SDK-TRANSPORT` | pacta-provider-claude-agent-sdk | self → any transport impl | frozen (revised post-spike) | G-PORT |
| `S-CORTEX-ANTHROPIC-TRANSPORT` | pacta-provider-cortex | cortex → SDK provider via seam | frozen (runtime blocked on O1) | G-CORTEX-ONLY-PATH, G-PORT |

**Entities:** none new. Existing canonical types (`Pact`, `AgentEvent`,
`AgentResult`, `BudgetEvent`, `CortexCtx`) are reused unchanged.

---

## Per-Domain Architecture

### Domain: `pacta-provider-claude-agent-sdk` (NEW)

**Layer:** L3 — protocol adapter, sibling to the other `pacta-provider-*`
packages.

**Internal structure:**

```
packages/pacta-provider-claude-agent-sdk/
├── src/
│   ├── index.ts                # public exports (S2, S3 types)
│   ├── factory.ts              # claudeAgentSdkProvider() (S2)
│   ├── transport.ts            # AnthropicWireTransport type (S3)
│   ├── event-mapper.ts         # SDK message → pacta AgentEvent
│   ├── pact-to-sdk-options.ts  # Pact → SDK query() options
│   ├── architecture.test.ts    # G-PORT, G-BOUNDARY, G-LAYER gates
│   └── factory.test.ts         # unit tests with mock transport
├── package.json
└── README.md
```

**Port implementations:**
- Implements `AgentProvider` + `Streamable` (S1): `factory.ts` returns the
  shape; delegates to the SDK and event-mapper.
- Defines `AnthropicWireTransport` type (S3): `transport.ts`.
- Defines `ClaudeAgentSdkProviderOptions` (S2): `factory.ts`.

**Port consumption:**
- Optional `transport: AnthropicWireTransport` from caller. Default:
  thin wrapper around `globalThis.fetch` that adds the `Authorization` /
  `x-api-key` header from `apiKey`.

**Verification:**
- Unit tests with a recording mock transport; assert that the SDK is
  invoked with correct options and that events are mapped correctly.
- Conformance: runs `@methodts/pacta-testkit/conformance` rows for
  oneshot mode, tool use, output schema, budget cap (predictive only).
- Architecture gates: G-PORT, G-BOUNDARY (no `@t1/cortex-sdk` import),
  G-LAYER (no upward imports of `@methodts/runtime` or `@methodts/bridge`).

**Migration path:** none — net new package. Existing
`pacta-provider-anthropic` stays on the manual-loop path indefinitely.
The README documents the choice criteria:

> Use **`pacta-provider-anthropic`** when you need fine-grained control
> over the inner loop (custom tool execution semantics, mid-loop budget
> verdicts, custom retry policy).
>
> Use **`pacta-provider-claude-agent-sdk`** when the SDK's loop is
> sufficient and you want SDK improvements (streaming, sub-agents, new
> reasoning modes) automatically.

### Domain: `pacta-provider-cortex` (extension)

**New file:** `src/anthropic-transport.ts` implementing the
`cortexAnthropicTransport` factory (S4).

**Subpath export:** `package.json#exports` adds:
```json
"./anthropic-transport": {
  "types": "./dist/anthropic-transport.d.ts",
  "default": "./dist/anthropic-transport.js"
}
```

This avoids forcing every consumer of `pacta-provider-cortex` to also
install `@anthropic-ai/claude-agent-sdk`. The peer-dep is declared
optional; the subpath import resolves the type from the SDK package
when actually used.

**Architecture gate update:** `architecture.test.ts` already enforces
G-CORTEX-ONLY-PATH. Add a row asserting the new file lives only in
`anthropic-transport.ts` and is not imported from the LLM-provider path
(keeps the two adapters independent).

**Migration path:** none — additive subpath export. Existing exports
unchanged.

### Domain: `agent-runtime` (composition)

No code change required. The new provider plugs in via the existing
`createMethodAgent({ ctx, pact, provider })` factory. Documentation
update only — `samples/cortex-incident-triage-agent-sdk/` shows the new
composition.

### Layer Stack Cards

#### Card: `claudeAgentSdkProvider`

1. **Domain:** new — `pacta-provider-claude-agent-sdk`
2. **Ports:**
   - Produces: `AgentProvider`, `Streamable`, `AnthropicWireTransport`
   - Consumes: `@anthropic-ai/claude-agent-sdk` (peer dep)
3. **Config:** `ClaudeAgentSdkProviderOptions` (S2)
4. **Auth:** delegated to transport (direct: API key; Cortex: ctx.secrets)
5. **Observability:** SDK events → pacta `AgentEvent` stream

#### Card: `cortexAnthropicTransport`

1. **Domain:** existing — `pacta-provider-cortex` (extension)
2. **Ports:**
   - Produces: `AnthropicWireTransport` (S3 implementation)
   - Consumes: `ctx.llm` (reserve/settle — O1), `ctx.secrets`, `ctx.audit`
3. **Config:** `CortexAnthropicTransportConfig` (S4)
4. **Auth:** API key from ctx.secrets or env
5. **Observability:** ctx.audit per turn, ctx.log for transport-level errors

---

## Phase Plan

### Wave 0 — Surfaces (1-2 days)

- Add `packages/pacta-provider-claude-agent-sdk/` skeleton with
  `index.ts` exporting `S-CLAUDE-SDK-PROVIDER` types and
  `S-ANTHROPIC-WIRE-TRANSPORT` (no implementation yet — types only).
- Add `packages/pacta-provider-cortex/src/anthropic-transport.ts` with
  the `cortexAnthropicTransport` signature (no body yet).
- Add subpath export to `pacta-provider-cortex/package.json`.
- Add architecture gates: G-PORT for both new export shapes,
  G-BOUNDARY in claude-agent-sdk's `architecture.test.ts` forbidding
  `@t1/cortex-sdk` imports.

**Acceptance:** types compile; gates green; no implementation.

### Wave 1 — Direct mode (non-Cortex) (3-5 days)

- Implement `claudeAgentSdkProvider` factory with the default
  direct-mode transport (no proxy — just resolves env vars from
  `apiKey` config or `ANTHROPIC_API_KEY`).
- **Apply cost-suppression defaults** to the SDK invocation per spike 2
  findings: `tools: []`, `settingSources: []`, `agents: {}`, sanitized
  `env`, minimal `systemPrompt`. Tenant overrides per-pact only when
  opting into broader behavior.
- Implement `pact-to-sdk-options.ts` mapping (model, system, tools,
  maxTurns, etc.) — the bridge between pact-declared scope and the
  SDK's options surface.
- Implement `event-mapper.ts` (SDK events → pacta AgentEvent).
- **G-COST gate** in `architecture.test.ts`: assert the provider's
  default options object suppresses all four cost vectors identified
  in spike 2. Catches regressions if a future PR removes a default.
- Unit tests with mock transport: oneshot, tool use, error paths,
  budget cap (predictive).
- Conformance testkit row added, including a per-request body
  ceiling assertion (~12 KB excluding tenant tools/messages).
- README documents the **cost cliff**: which knobs cost what if a
  tenant opts in to broader behavior.

**Acceptance:** all unit tests pass; conformance rows for direct mode
pass; G-COST green; per-request body ceiling enforced; CI green;
package builds.

**Blocks unlocked:** none — non-Cortex consumers can adopt immediately.

### Wave 2 — Cortex transport (depends on Cortex O1) (2-3 days)

- Implement `cortexAnthropicTransport` body using `ctx.llm.reserve()`/
  `settle()` (O1).
- Add `samples/cortex-incident-triage-agent-sdk/` with full composition.
- Conformance rows for Cortex mode.
- Integration tests against `MockCortexCtx`.
- Update `co-design/CHANGES.md` amendment log noting the additive
  surface (no S3 amendment — pure addition to pacta-provider-cortex).

**Acceptance:** sample app runs end-to-end against MockCortexCtx;
ctx.llm.reserve()/settle() called once per SDK turn; ctx.audit emits
expected events; CI green.

**Blocked on:** Cortex O1 (`ctx.llm.reserve()`/`settle()`).
Per the integration doc, O1 is needed by 2026-05-26. If O1 slips,
Wave 2 ships with a degraded transport that calls `ctx.llm.complete()`
once per request without holding a reservation (cost may exceed budget
mid-pact; logged as a known limitation).

### Wave 3 — Streaming + sub-agent surfacing (2 days)

- Implement `Streamable.stream()` to expose top-level SDK events
  through the pacta `AgentEvent` stream as they fire.
- v1 surfaces only the top-level pact's events; sub-agent events from
  the SDK are summarized as opaque `tool_call` events with the sub-agent
  name. (Full sub-agent event surfacing deferred — needs S1 amendment
  if we ever want it.)

**Acceptance:** streaming integration test against mock transport
emits events in order; backpressure handled.

### Risks

- **R-1: SDK transport seam (RESOLVED 2026-04-19 by spike).** The SDK
  spawns the `claude` CLI as a subprocess; no fetch hook exists. The
  CLI honors `ANTHROPIC_BASE_URL` from its env. The viable seam is
  process-env injection + parent-side HTTP proxy. Spike confirmed
  end-to-end: see `spike-findings.md`. Adds ~1 day to Wave 2 vs. the
  fetch-based design.

- **R-1b (RESOLVED 2026-04-19 by spike 2 — see `spike-2-overhead.md`).**
  The 100 KB+ baseline is **not system-prompt overhead** as originally
  hypothesized. The system field ships ~150 chars by default. The bulk
  is split across: built-in Claude Code tools (~80 KB, suppressed by
  `tools: []`), filesystem-loaded settings (~76 KB, suppressed by
  `settingSources: []`), and account-attached MCP servers (~33 KB,
  not present in a fresh Cortex env). With all suppressions, the floor
  is ~5-8 KB per request — a **96% reduction**.
  **Mitigation lands in Wave 1:** the provider factory applies all
  suppression knobs as defaults; a new `G-COST` gate locks them in;
  conformance row asserts a per-request body ceiling (12 KB excluding
  tenant-supplied tools/messages); README documents the cost cliff if
  tenants opt in to broader behavior.

- **R-2: O1 (ctx.llm.reserve/settle) ships later than 2026-05-26.**
  Wave 2 ships in degraded mode (per-call complete instead of held
  reservation). Documented as a known limitation. Fully resolved when
  O1 lands.

- **R-3: SDK event taxonomy drift between versions.** Pin
  `@anthropic-ai/claude-agent-sdk` as peer-dep with a tight range; bump
  via the same peer-dep cascade rule pacta uses for itself
  (CHANGES.md §Peer-dependency cascade).

- **R-4: SDK runs its own tools (Read/Bash/etc.) bypassing pacta's
  ToolProvider.** v1 documents this; the SDK's tools are visible in
  the event stream but not gated by pacta scope. Mitigation: configure
  the SDK with `permission_mode: 'plan'` or override the SDK's tool
  list with pacta's `ToolProvider.list()` — both shipped in Wave 1.

---

## Cortex-side dependencies (read-only — these are blockers, not work
items in this PRD)

- **O1 — `ctx.llm.reserve()` / `settle()`** — required for full Wave 2.
  Already filed as a Cortex ask in `method-integration.md` §3.3.
- **`ctx.secrets.get(name)`** — assumed to exist for API-key resolution.
  If it doesn't, fall back to `ANTHROPIC_API_KEY` env var or accept
  literal key in config (degraded — exposes key in app config).

No new Cortex asks introduced by this PRD.

---

## Notes for downstream `/fcd-plan`

- This PRD has 3 commission-able units (one per wave). Wave 0 is a
  single surface-only commission; Wave 1 is single-domain pure
  implementation; Wave 2 spans pacta-provider-cortex + samples and
  needs O1 to be marked landed before kickoff.
- All surfaces are typed inline above — no separate `/fcd-surface`
  sessions required. The SDK provider + transport seam are TRIVIAL/
  STANDARD per fcd-design 3.2.
- Conformance testkit (S8) row additions are part of Waves 1 and 2,
  not a separate commission.
