# Realization Plan — `@methodts/pacta-provider-claude-agent-sdk`

> Source PRD: `.method/sessions/fcd-design-pacta-provider-claude-agent-sdk/prd.md`
> Spike findings: `spike-findings.md`, `spike-2-overhead.md`
> Plan date: 2026-04-19

## PRD Summary

Add a pacta provider that delegates the inner agent loop to
`@anthropic-ai/claude-agent-sdk` while preserving pacta's `Pact`
contract and middleware stack. Two modes:

- **Direct** — non-Cortex consumers (CLI, local dev) hit the Anthropic
  API directly via the SDK.
- **Cortex** — Cortex tenant apps inject a transport from
  `pacta-provider-cortex` that routes every SDK turn through a
  localhost proxy doing `ctx.llm.reserve()`/`settle()` (depends on
  Cortex ask O1) + `ctx.audit` per turn.

**Success criteria** (PRD §Success Criteria):
- AC-1: Direct-mode parity — provider runs an oneshot pact end-to-end
  against a mock fetch and returns `AgentResult` with usage + cost.
- AC-2: Cortex composition — sample tenant app using the provider with
  the Cortex transport calls `ctx.llm.reserve/settle` once per SDK turn.
- AC-3: Conformance — passes `@methodts/pacta-testkit/conformance` rows
  matching `pacta-provider-anthropic`'s capabilities surface.

## FCA Partition

| Commission | Domain | Wave | Title | Depends On | Consumed Ports | Produced Ports |
|---|---|---|---|---|---|---|
| C-1 | `pacta-provider-claude-agent-sdk` | 1 | Direct mode (factory + event mapper + cost defaults) | (Wave 0) | S-AGENT-PROVIDER (frozen) | S-CLAUDE-SDK-PROVIDER, S-ANTHROPIC-SDK-TRANSPORT |
| C-2 | `pacta-provider-cortex` | 2 | Cortex transport (proxy + ctx.llm reserve/settle + ctx.audit) | C-1 (consumes the SDK transport interface) | S-ANTHROPIC-SDK-TRANSPORT, ctx.llm, ctx.audit, ctx.secrets | S-CORTEX-ANTHROPIC-TRANSPORT |
| C-3 | `pacta-provider-claude-agent-sdk` | 2 | Streaming (`Streamable.stream()` impl) | C-1 (extends factory) | S-AGENT-PROVIDER (Streamable), S-CLAUDE-SDK-PROVIDER | (extends C-1's exports) |
| C-4 | `samples` | 3 | New `cortex-incident-triage-agent-sdk/` sample | C-1 + C-2 | S-CLAUDE-SDK-PROVIDER, S-CORTEX-ANTHROPIC-TRANSPORT | — |

**Wave assignment notes:**
- C-2 and C-3 run in parallel (different domains, no conflict).
- C-4 sequenced last (depends on both providers being functional).

---

## Wave 0 — Shared Surfaces (orchestrator-applied)

Mandatory pre-flight before Wave 1. Single commit on the orchestrator's
branch, no implementation, types-only + gate scaffolding.

### Files created/modified

1. **`packages/pacta-provider-claude-agent-sdk/package.json`** (new)
   - `@methodts/pacta-provider-claude-agent-sdk@0.1.0`
   - Apache-2.0
   - peerDependencies: `@methodts/pacta`, `@anthropic-ai/claude-agent-sdk`
   - publishConfig: provenance public

2. **`packages/pacta-provider-claude-agent-sdk/src/index.ts`** (new)
   - Exports the type surface: `ClaudeAgentSdkProviderOptions`,
     `AnthropicSdkTransport`, `claudeAgentSdkProvider` (signature only,
     body throws "not implemented" — Wave 1 fills in)

3. **`packages/pacta-provider-claude-agent-sdk/src/transport.ts`** (new)
   - `AnthropicSdkTransport` interface verbatim from PRD §S3

4. **`packages/pacta-provider-claude-agent-sdk/src/architecture.test.ts`** (new)
   - **G-PORT** — `index.ts` exports the symbol set declared in PRD §S2
   - **G-BOUNDARY** — no source file imports from `@t1/cortex-sdk`
   - **G-LAYER** — no upward imports of `@methodts/runtime` or
     `@methodts/bridge`
   - **G-COST (placeholder)** — assertion exists but allows the
     stub-throw shape; Wave 1 fills in the actual cost-defaults check

5. **`packages/pacta-provider-claude-agent-sdk/tsconfig.json`** (new)
   - References pacta + types per the existing pattern

6. **`packages/pacta-provider-claude-agent-sdk/README.md`** (new, brief)
   - One paragraph + "Wave 1 implementation pending"

7. **`packages/pacta-provider-cortex/src/anthropic-transport.ts`** (new)
   - `cortexAnthropicTransport` factory **signature** (body throws
     "not implemented" — Wave 2 fills in)
   - Imports `AnthropicSdkTransport` from `@methodts/pacta-provider-claude-agent-sdk`

8. **`packages/pacta-provider-cortex/src/index.ts`** (modified)
   - Re-export `cortexAnthropicTransport` and its config types

9. **`packages/pacta-provider-cortex/package.json`** (modified)
   - Add subpath export `./anthropic-transport`
   - Add `@methodts/pacta-provider-claude-agent-sdk` as optional peerDep

10. **Workspace registration**
    - Add `packages/pacta-provider-claude-agent-sdk` to root tsconfig
      project references list (`tsconfig.json`)
    - Root `package.json` workspaces glob already covers `packages/*`
      (no change)

### Verification

- `npm install` — lockfile updated
- `npm run build` — TypeScript compiles, all project references resolve
- `npm test` — existing 12-package suite still passes (G-COST and
  G-PORT pass in stub-allowing mode for the new package)

### Status of port records

Surfaces inlined in the PRD count as "frozen at PRD" per fcd-design 3.2
(STANDARD complexity protocol). No separate `/fcd-surface` records
needed — the PRD itself is the co-design record. References:

- S-AGENT-PROVIDER: `packages/pacta/src/ports/agent-provider.ts`
  (existing, frozen at S1 ratification)
- S-CLAUDE-SDK-PROVIDER: PRD §S2 (this PRD)
- S-ANTHROPIC-SDK-TRANSPORT: PRD §S3 (this PRD, revised post-spike)
- S-CORTEX-ANTHROPIC-TRANSPORT: PRD §S4 (this PRD)

---

## Wave 1 — Direct mode (1 commission)

### C-1 — Direct-mode `claudeAgentSdkProvider`

```yaml
id: C-1
title: "Direct-mode claudeAgentSdkProvider implementation"
domain: pacta-provider-claude-agent-sdk
wave: 1
scope:
  allowed_paths:
    - "packages/pacta-provider-claude-agent-sdk/src/**"
    - "packages/pacta-provider-claude-agent-sdk/README.md"
  forbidden_paths:
    - "packages/pacta-provider-claude-agent-sdk/package.json"
    - "packages/pacta-provider-claude-agent-sdk/tsconfig.json"
    - "packages/*/src/ports/*"
    - "packages/pacta/src/**"
    - "packages/pacta-provider-cortex/**"
    - "packages/agent-runtime/**"
depends_on: []   # Wave 0 satisfies all dependencies
parallel_with: []
consumed_ports:
  - name: S-AGENT-PROVIDER
    status: frozen
    record: "packages/pacta/src/ports/agent-provider.ts"
  - name: S-CLAUDE-SDK-PROVIDER
    status: frozen
    record: ".method/sessions/fcd-design-pacta-provider-claude-agent-sdk/prd.md#S2"
  - name: S-ANTHROPIC-SDK-TRANSPORT
    status: frozen
    record: ".method/sessions/fcd-design-pacta-provider-claude-agent-sdk/prd.md#S3"
produced_ports:
  - name: S-CLAUDE-SDK-PROVIDER (impl)
  - name: S-ANTHROPIC-SDK-TRANSPORT (impl — direct-mode default)
deliverables:
  - "src/factory.ts (claudeAgentSdkProvider)"
  - "src/pact-to-sdk-options.ts (Pact → SDK Options mapper with cost-suppression defaults)"
  - "src/event-mapper.ts (SDK message stream → pacta AgentEvent)"
  - "src/direct-transport.ts (default direct-mode AnthropicSdkTransport)"
  - "src/factory.test.ts (unit tests with mock transport)"
  - "src/event-mapper.test.ts"
  - "src/pact-to-sdk-options.test.ts"
documentation_deliverables:
  - "README.md — usage examples, cost-cliff documentation per spike-2-overhead.md"
acceptance_criteria:
  - "AC-1.1: factory.test.ts demonstrates oneshot pact returns AgentResult with usage + cost (PRD AC-1)"
  - "AC-1.2: G-COST architecture test asserts default Options applies tools=[], settingSources=[], agents={} (PRD R-1b mitigation)"
  - "AC-1.3: per-request body size ≤ 12 KB excluding tenant content (conformance row, spike-2 ceiling)"
  - "AC-1.4: pacta-testkit conformance rows pass for capabilities, modes:[oneshot], output validation"
  - "AC-1.5: README documents the cost cliff and per-knob overhead from spike-2-overhead.md"
estimated_tasks: 7
branch: "feat/claude-agent-sdk-c1-direct-mode"
status: pending
```

---

## Wave 2 — Cortex transport + Streaming (2 parallel commissions)

### C-2 — `cortexAnthropicTransport`

```yaml
id: C-2
title: "Cortex-aware AnthropicSdkTransport (proxy + ctx.llm + audit)"
domain: pacta-provider-cortex
wave: 2
scope:
  allowed_paths:
    - "packages/pacta-provider-cortex/src/anthropic-transport.ts"
    - "packages/pacta-provider-cortex/src/anthropic-transport.test.ts"
    - "packages/pacta-provider-cortex/src/index.ts"
    - "packages/pacta-provider-cortex/README.md"
    - "co-design/CHANGES.md"
  forbidden_paths:
    - "packages/pacta-provider-cortex/package.json"
    - "packages/pacta-provider-cortex/src/llm-provider.ts"
    - "packages/pacta-provider-cortex/src/audit-middleware.ts"
    - "packages/pacta-provider-cortex/src/token-exchange-middleware.ts"
    - "packages/pacta-provider-cortex/src/ctx-types.ts"
    - "packages/*/src/ports/*"
    - "packages/pacta-provider-claude-agent-sdk/**"
depends_on: [C-1]
parallel_with: [C-3]
consumed_ports:
  - name: S-ANTHROPIC-SDK-TRANSPORT
    status: frozen
    record: "packages/pacta-provider-claude-agent-sdk/src/transport.ts (post-Wave 0)"
  - name: ctx.llm.reserve/settle
    status: pending-cortex (O1)
    note: "Wave 2 ships in degraded mode if O1 not landed — uses per-call complete() instead of held reservation"
  - name: ctx.audit, ctx.secrets
    status: frozen (S3 surfaces)
produced_ports:
  - name: S-CORTEX-ANTHROPIC-TRANSPORT (impl)
deliverables:
  - "src/anthropic-transport.ts — proxy server lifecycle + setup()/teardown()"
  - "src/anthropic-transport.ts — request parser (Anthropic /v1/messages body)"
  - "src/anthropic-transport.ts — ctx.llm reserve/settle wiring (O1)"
  - "src/anthropic-transport.ts — ctx.audit per-turn emission"
  - "src/anthropic-transport.test.ts — unit tests with MockCortexCtx"
documentation_deliverables:
  - "README.md — anthropic-transport section + usage with claudeAgentSdkProvider"
  - "co-design/CHANGES.md — amendment-log entry noting additive S-CORTEX-ANTHROPIC-TRANSPORT (no S3 amendment, pure addition)"
acceptance_criteria:
  - "AC-2.1: anthropic-transport.test.ts proves ctx.llm.reserve()/settle() called once per /v1/messages POST (PRD AC-2)"
  - "AC-2.2: ctx.audit.event() emitted per turn with usage payload (matches PRD-065 schema)"
  - "AC-2.3: HEAD / probe handled (200) per spike-1 finding"
  - "AC-2.4: budget-exceeded → 429 response shape that SDK aborts cleanly on"
  - "AC-2.5: G-CORTEX-ONLY-PATH still passes (only this file imports nothing from cortex-sdk yet — uses ctx-types)"
estimated_tasks: 6
branch: "feat/claude-agent-sdk-c2-cortex-transport"
status: pending
```

### C-3 — Streaming via `Streamable.stream()`

```yaml
id: C-3
title: "Streaming: Streamable.stream() implementation"
domain: pacta-provider-claude-agent-sdk
wave: 2
scope:
  allowed_paths:
    - "packages/pacta-provider-claude-agent-sdk/src/factory.ts"
    - "packages/pacta-provider-claude-agent-sdk/src/event-mapper.ts"
    - "packages/pacta-provider-claude-agent-sdk/src/streaming.test.ts"
  forbidden_paths:
    - "packages/pacta-provider-claude-agent-sdk/src/transport.ts"
    - "packages/pacta-provider-claude-agent-sdk/src/architecture.test.ts"
    - "packages/pacta-provider-claude-agent-sdk/package.json"
    - "packages/*/src/ports/*"
    - "packages/pacta/**"
    - "packages/pacta-provider-cortex/**"
depends_on: [C-1]
parallel_with: [C-2]
consumed_ports:
  - name: S-AGENT-PROVIDER (Streamable)
    status: frozen
    record: "packages/pacta/src/ports/agent-provider.ts"
  - name: S-CLAUDE-SDK-PROVIDER
    status: frozen
    record: "packages/pacta-provider-claude-agent-sdk/src/index.ts (post-C-1)"
produced_ports:
  - name: Streamable (impl on the same provider value)
deliverables:
  - "factory.ts — Streamable.stream() that wraps query() and yields AgentEvents as they arrive"
  - "event-mapper.ts — extend with streaming-event branch (SDK partial messages)"
  - "streaming.test.ts — assert event ordering + backpressure"
documentation_deliverables:
  - "README.md (in C-1's deliverable, append a Streaming section)"
acceptance_criteria:
  - "AC-3.1: stream() yields AgentEvents in topological order (turn_started, tool_use, tool_result, assistant_text, completion)"
  - "AC-3.2: top-level events surfaced; sub-agent events appear as opaque tool_call events (S1 §10 non-goal)"
  - "AC-3.3: aborting via Pact's AbortController cleanly tears down the SDK process"
estimated_tasks: 3
branch: "feat/claude-agent-sdk-c3-streaming"
status: pending
```

---

## Wave 3 — Sample app (1 commission)

### C-4 — `samples/cortex-incident-triage-agent-sdk/`

```yaml
id: C-4
title: "Sample: incident-triage Cortex tenant using the SDK provider"
domain: samples
wave: 3
scope:
  allowed_paths:
    - "samples/cortex-incident-triage-agent-sdk/**"
  forbidden_paths:
    - "packages/**"
    - "co-design/**"
depends_on: [C-1, C-2]
parallel_with: []
consumed_ports:
  - name: S-CLAUDE-SDK-PROVIDER
    status: frozen + impl (post-C-1)
  - name: S-CORTEX-ANTHROPIC-TRANSPORT
    status: frozen + impl (post-C-2)
  - name: createMethodAgent (S1)
    status: frozen
deliverables:
  - "src/agent.ts — composition of createMethodAgent + claudeAgentSdkProvider + cortexAnthropicTransport"
  - "src/pacts/incident-triage.ts — pact definition (mode: oneshot, scope: read_only)"
  - "test/end-to-end.test.ts — runs against MockCortexCtx, asserts AC-2 on the assembled stack"
  - "test/mock-ctx.ts — adapted from samples/cortex-incident-triage-agent/"
  - "README.md — explains how this differs from the manual-loop sibling sample"
  - "package.json — Apache-2.0, private (sample, not published)"
documentation_deliverables:
  - "README.md (sample-level)"
acceptance_criteria:
  - "AC-4.1: end-to-end.test.ts runs `agent.invoke()` against MockCortexCtx and returns expected output"
  - "AC-4.2: ctx.llm.reserve/settle called the expected number of times for the test pact"
  - "AC-4.3: PRD AC-2 met end-to-end on the assembled stack"
estimated_tasks: 5
branch: "feat/claude-agent-sdk-c4-sample"
status: pending
```

---

## Acceptance Gates (cumulative)

Mapped from PRD §Success Criteria:

| PRD AC | Mapped to | Verified by |
|---|---|---|
| AC-1 (direct-mode parity) | C-1 (AC-1.1, AC-1.4) | C-1 unit tests + conformance row |
| AC-2 (Cortex composition) | C-2 (AC-2.1, AC-2.2) + C-4 (AC-4.1, AC-4.2) | C-2 unit tests + C-4 end-to-end |
| AC-3 (conformance) | C-1 (AC-1.4), C-3 (AC-3.1) | conformance testkit rows |

---

## Verification Report

| Gate | Status |
|---|---|
| Single-domain commissions | PASS — each touches exactly one domain |
| No wave domain conflicts | PASS — Wave 2 has C-2 (cortex) + C-3 (claude-agent-sdk); different domains |
| DAG acyclic | PASS — C-1 → {C-2, C-3} → C-4 |
| Surfaces enumerated | PASS — 4 surfaces, all frozen inline in PRD |
| Scope complete | PASS — every commission has allowed + forbidden paths |
| Criteria traceable | PASS — every commission AC traces to a PRD AC |
| PRD coverage | PASS — all 3 PRD ACs mapped |
| Task bounds | PASS — sizes 7, 6, 3, 5 (all in 3-8 range) |
| Wave 0 non-empty | PASS — 10 surface artifacts |
| All consumed ports frozen | PASS — except O1 (ctx.llm.reserve/settle) which is the documented degraded-mode fallback for C-2 |

**Overall: 10/10 gates pass.**

### Risks recap (from PRD)

- **R-1 (SDK seam)** — RESOLVED by spike 1
- **R-1b (per-request overhead)** — RESOLVED by spike 2; mitigation in C-1 acceptance criteria
- **R-2 (O1 dependency for C-2)** — degraded-mode fallback documented
- **R-3 (SDK version drift)** — peer-dep cascade rule from CHANGES.md
- **R-4 (SDK runs own tools)** — `tools: []` default in C-1; tenant overrides per-pact

---

## Status Tracker

Total: 4 commissions, 4 waves (Wave 0 + 3 implementation waves)
Completed: 0 / 4
