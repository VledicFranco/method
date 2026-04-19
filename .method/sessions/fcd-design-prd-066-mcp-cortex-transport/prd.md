---
type: prd
title: "PRD-066 — MCP Transport for Cortex Tool Registry"
date: "2026-04-14"
status: implemented-partial (PR #185 — Track A only; Track B blocked on Cortex O5/O6/O7)
version: "0.1"
size: M
domains: [mcp, methodology, agent-runtime]
surfaces:
  - S9 (MCPCortexTransport) — implements, status `needs-follow-up`
  - S1 (MethodAgentPort) — consumes; requires additive amendment `CortexAuthFacade.issueServiceToken`
  - S7 (CortexMethodologySource) — consumes `methodology.updated` / `onChange`
blocked_by:
  - CORTEX-Q1 (O5): runtime tool registration vs deploy-time only
  - CORTEX-Q2 (O6): service-account token issuance (`ctx.auth.issueServiceToken`)
  - CORTEX-Q3 (O7): DELETE verb for tool deregistration
related:
  - .method/sessions/fcd-surface-mcp-cortex-transport/decision.md
  - .method/sessions/fcd-surface-methodology-source/decision.md
  - .method/sessions/fcd-surface-method-agent-port/decision.md
  - docs/roadmap-cortex-consumption.md §4.2 item 12, §10 (open questions O5/O6/O7)
  - packages/mcp/src/index.ts
  - t1-repos/t1-cortex-1/docs/prds/043-app-registry-and-authz-api.md
  - t1-repos/t1-cortex-1/docs/prds/060-platform-foundation.md
  - t1-repos/t1-cortex-1/docs/rfcs/RFC-005-app-platform-service-library.md §§1.1, 3, 3.4, D.2, D.4
---

# PRD-066 — MCP Transport for Cortex Tool Registry

> **Status: DRAFT-PARTIAL.** Designed as a two-track plan. Track A is the
> frozen-shape work that ships regardless of the three open Cortex questions;
> Track B contains the parts contingent on CORTEX-Q1/Q2/Q3 resolution. Do
> not start Track B implementation until the escalations below resolve.

---

## 1. Summary

`@methodts/mcp` today is a stdio MCP server with a fixed, engine-shaped toolset.
A Cortex-hosted methodology agent needs its methodology-derived Hoare tools
to land in Cortex's platform tool registry so the platform — not `@methodts/mcp`
— enforces operation-grammar authorization (RFC-005 §3.4). This PRD ships:
(a) a typed registration client + publisher, (b) a pure
`methodts → Cortex` mapping, (c) a forbidden-by-construction policy against
runtime-discovered tools, and (d) the service-account auth mechanism over
`ctx.auth`. What it **cannot** ship until Cortex answers is the runtime
registration/retraction behavior and the `cortex-app.yaml spec.methodology`
block.

---

## 2. Problem

Three gaps exist between `@methodts/mcp` and Cortex-as-OS:

1. **Authz gap.** Cortex expects tool definitions at the **platform** level
   (Layer-2 `default_policy`, RFC-005 §3.4.2). `@methodts/mcp` today trusts
   stdio-local MCP with no authz. A Cortex-hosted agent that calls a
   methodology tool over MCP therefore bypasses Cortex authz entirely.
2. **Tool-shape gap.** A methodology's Hoare-typed tools
   (`Tool<S>` in `packages/methodts/src/method/tool.ts`) are referenced by
   `Step.tools[]` inside the methodology YAML but never surfaced as MCP
   tools. Cortex cannot authorize what it cannot see.
3. **Endpoint reality gap.** The roadmap names `POST /v1/platform/apps/:id/tools`
   as the registration endpoint (PRD-043). **PRD-043 as shipped does not
   define it.** The real API is the legacy external-app path
   (RFC-005 §1.1, PRD-060 §1) backed by `AppRegistryRepo.updateCallback`
   (RFC-005 Appendix D.4). Whether that legacy endpoint accepts runtime
   updates with operation-grammar is an open question owned by Cortex.

Without this transport, Cortex-hosted agents either (a) operate with a
hand-curated static `spec.tools[]` block in `cortex-app.yaml` (loses the
`MethodologySource` dynamic-curation capability from S7), or (b) call tools
over MCP-local dispatch with no platform authz (violates RFC-005 §10
"no direct provider keys, no bypass of `ctx.*`" for the tool plane).

---

## 3. Constraints

- **C1. Runtime-discovered tools are forbidden.** RFC-005 §3.4 mandates
  pre-registered, Layer-2-approved authz. An agent may not invent a new
  tool mid-session. Enforced structurally (gate G-PORT).
- **C2. Auth is service-account, not user-delegated.** Tool registration
  is a platform-capability action, not an on-behalf-of action. The token
  presented on every call is a service-account JWT minted by
  `ctx.auth.issueServiceToken(scope)` — an additive extension to S1's
  `CortexAuthFacade` (see §6.2). Short-lived (≤15 min), pre-refreshed at
  `expiresAt - 30s`.
- **C3. No `@cortex/*` value imports in `@methodts/mcp`.** Cortex is injected
  as `ctx`; only `import type` is allowed. Gate G-LAYER.
- **C4. Registration transport is distinct from dispatch transport.**
  `@modelcontextprotocol/sdk` still handles `CallToolRequestSchema` (Cortex
  → agent); this surface is REST outbound (agent → Cortex). No code in
  `packages/mcp/src/cortex/**` may import `@modelcontextprotocol/sdk`.
  Gate G-BOUNDARY.
- **C5. Mapping is pure.** `methodtsToCortex()` is a pure function so the
  mapping table (§7.2) is testable without network I/O.
- **C6. Theory is the source of truth (DR-01).** The mapping is one-way
  methodts → Cortex. Cortex admin edits to Layer-2 policy do not mutate
  methodology YAML; they stay in Cortex's policy store.
- **C7. Standalone bridge mode must keep working.** `ctx === undefined`
  signals standalone mode — the publisher is never constructed, the
  existing stdio server operates as today.

---

## 4. Success Criteria

### Track A — ships regardless of Cortex answers

- **SA-1.** The pure `methodtsToCortex(input)` function exists, is
  exhaustively tested against a P2-SD fixture, and produces
  deterministic `operations[]` + `tools[]` with unique names
  (gate G-MAP).
- **SA-2.** `CortexToolRegistrationClient` constructs only when
  `ctx.auth.issueServiceToken` is present; throws `MissingCtxError`
  otherwise (gate assertion).
- **SA-3.** No import path from `CallToolRequestSchema` handlers reaches
  `publisher.publishMethodology` or `publisher.publishAll`
  (gate G-PORT, runtime-discovered-forbidden).
- **SA-4.** `@methodts/mcp` compiles with zero `@cortex/*` value imports
  and zero `@modelcontextprotocol/sdk` imports under
  `packages/mcp/src/cortex/**` (gates G-LAYER + G-BOUNDARY).
- **SA-5.** Standalone bridge mode (`ctx === undefined`) is unchanged —
  the full existing smoke-test suite passes without touching any Cortex
  code path.
- **SA-6.** Documentation describes the `cortex-app.yaml` v1 fallback
  (Model A): tenant apps hand-curate `spec.tools[]` from methodology
  YAML at deploy-time. The April-21 demos operate under this mode.

### Track B — contingent on O5/O6/O7

- **SB-1.** (blocked on Q1/Q2) `MethodologyToolPublisher` performs
  `publishAll()` at startup and `publishMethodology(id)` on
  `MethodologySource.onChange` events, with `mode: 'dynamic'`
  authorized by a `cortex-app.yaml spec.methodology.toolRegistration`
  block.
- **SB-2.** (blocked on Q3) `retractMethodology(id)` issues a `DELETE`
  scoped by `methodologyId` discriminator; falls back to
  `replaceAll` with omission only if Q3 = "no DELETE verb."
- **SB-3.** (blocked on Q2) New tools registered at runtime resolve to
  `state: 'active'` via a pre-approved `authzTemplate` rather than
  stalling in `pending-approval`.
- **SB-4.** `ctx.auth.issueServiceToken(scope)` is wired end-to-end
  with a ≤15-min TTL and pre-refresh at T-30s, against a live Cortex
  dev stack.

---

## 5. Scope

### In scope (Track A)

- `packages/mcp/src/cortex/` — new subdirectory: `index.ts`,
  `cortex-tool-registration-client.ts`, `methodology-tool-publisher.ts`,
  `mapping.ts` (pure), `types.ts`.
- The pure `methodtsToCortex()` mapping (§7.2) — deterministic, tested.
- `CortexToolRegistrationClient` interface + factory (shape frozen;
  retry/verb choice deferred to Track B for `retract`).
- `MethodologyToolPublisher` interface + factory (shape frozen;
  runtime dispatch of `publishMethodology` on change is Track B).
- Runtime-discovered-tools gate (G-PORT) — forbidden structurally.
- `MissingCtxError` wiring when `ctx.auth.issueServiceToken` absent.
- Standalone-mode pass-through (`ctx === undefined` ⇒ no Cortex wiring).
- Documentation of the Model A v1 fallback (hand-curated
  `spec.tools[]`).
- Architecture gates: G-BOUNDARY, G-PORT, G-LAYER, G-MAP.
- Mapping table (§7.2) and worked example (§7.3).

### In scope (Track B — design only; implementation blocked)

- Dynamic registration via `publishMethodology` on
  `MethodologySource.onChange`.
- `retractMethodology` DELETE semantics.
- `cortex-app.yaml spec.methodology.{pool, toolRegistration}` block
  (Cortex-owned schema; method declares what it needs it to contain).
- Layer-2 `authzTemplate` auto-approval.

### Out of scope

- The MCP stdio/JSON-RPC protocol itself (`@modelcontextprotocol/sdk`).
  Cortex → `@methodts/mcp` dispatch uses the existing stdio transport;
  that stays as-is.
- Cortex-side tool dispatch adapter (turning an incoming Cortex
  `tool.call` into a methodts step/tool invocation). Separate concern;
  co-design S10 if needed.
- Bridge proxy tools (`bridge_spawn`, `bridge_prompt`, …) — bridge-local
  HTTP proxies, not methodology-derived, not surfaced to Cortex authz.
- Tenant-app provisioning (`POST /v1/platform/apps/provision`, PRD-060).
- `cortex-app.yaml` parser + admin UI — Cortex owns these. Method only
  declares the contract of the block.
- A `@methodts/mcp` SDK for non-Cortex hosts. If another host emerges, a
  sibling client (renamed) is the pattern; no premature abstraction.
- Cortex-side tombstone semantics on DELETE (soft vs hard delete) —
  opaque to the client.

---

## 6. Domain Map

```
@methodts/mcp (producer)                          Cortex platform (consumer)
  ├─ cortex/cortex-tool-registration-client.ts  ──HTTP──►  POST/PUT/DELETE /v1/platform/apps/:id/tools
  │                                                        (AppRegistryRepo.updateCallback — RFC-005 D.4)
  ├─ cortex/methodology-tool-publisher.ts
  │      │
  │      ├── consumes MethodologySource (S7)  ←── @methodts/runtime/ports
  │      │      (list, getMethodology, onChange)
  │      │
  │      └── consumes CortexAuthFacade (S1)   ←── @methodts/agent-runtime
  │             (issueServiceToken — NEW, additive amendment)
  │
  └─ cortex/mapping.ts   (pure)               ──► CortexOperationDef[], CortexToolDescriptor[]
```

**Cross-domain surfaces touched:**

| Interaction | Surface | Direction | Status |
|---|---|---|---|
| `@methodts/mcp` ↔ Cortex platform registry | **S9 MCPCortexTransport** | method → Cortex (outbound REST) | `needs-follow-up` (implemented by this PRD) |
| `@methodts/mcp` ↔ `@methodts/runtime/ports` | **S7 MethodologySource** | consumer (reads `list`, `getMethodology`, subscribes `onChange`) | frozen (consumed as-is) |
| `@methodts/mcp` ↔ `@methodts/agent-runtime` | **S1 MethodAgentPort / CortexCtx.auth** | consumer (reads `issueServiceToken`) | frozen + **additive amendment required** (S1 §4.1 `CortexAuthFacade.issueServiceToken?`) |

---

## 7. Architecture

### 7.1 `CortexToolRegistrationClient` — surface

Owns: HTTP envelope — URL composition, auth header, retry budget,
409-upsert handling. Knows **nothing** about methodology semantics.

```typescript
export interface CortexToolRegistrationClient {
  /** Bootstrap: replace the full tool+operation set for this app. */
  replaceAll(payload: ToolRegistrationPayload): Promise<RegistrationResult>;

  /** Upsert a named batch — typically all tools for ONE methodology. */
  publish(methodologyId: string, payload: ToolRegistrationPayload): Promise<RegistrationResult>;

  /** Remove a batch keyed by the methodologyId discriminator. */
  retract(methodologyId: string): Promise<RetractionResult>;

  /** Probe current registry state — startup reconciliation. */
  list(): Promise<RegistrationSnapshot>;
}

export function createCortexToolRegistrationClient(
  options: CreateCortexToolRegistrationClientOptions,
): CortexToolRegistrationClient;
```

Full type definitions (payloads, options, results) frozen in S9 §5.2 —
not re-copied here to keep PRD-to-FCD single-source-of-truth.

**HTTP envelope (Track A design; Track B verbs contingent on Q1/Q3):**

- **URL:** `${baseUrl}/v1/platform/apps/${ctx.app.id}/tools`.
- **Auth:** `Authorization: Bearer <service-token>` from
  `ctx.auth.issueServiceToken(['platform:apps:${appId}:tools:write'])`.
  Client caches until `expiresAt - 30s`.
- **Verb choice (Track B open):** `PUT replaceAll`, `POST publish`,
  `DELETE retract` with `?scope.methodologyId=…`, `GET list`.
  Publisher exposes only verb-free intent; implementation chooses
  post-Q1/Q3.
- **Retry:** idempotent verbs retry on 5xx (exponential backoff to
  `maxAttempts`). 4xx never retry. 409 collapses to
  `registered: 0, updated: N` when body reports "already registered."
- **Fail-closed:** no `ctx.auth` ⇒ `MissingCtxError` at construction.

### 7.2 methodts Step/Tool → Cortex operation/tool mapping

**Frozen shape (Track A).** This is the pure function's specification.

| methodts concept | Cortex concept | Mapping rule |
|---|---|---|
| `Methodology.id` | `ToolDescriptor.name` prefix | `method.<methodology_id>.<tool_id>` — flat namespace per RFC-005 §3 |
| `Method.id` | *(elided by default)* | Emitted as `method.<methodology_id>.<method_id>.<tool_id>` only when two methods within the same methodology declare colliding tool ids |
| `Tool<S>.id` | `ToolDescriptor.name` suffix | 1:1 after sanitization (`:` → `.`) |
| `Tool<S>.name` | `ToolDescriptor.displayName?` | Optional display label |
| `Tool<S>.description` | `ToolDescriptor.description` + `OperationDef.description` | Same text; single source is the methodology YAML |
| `Tool<S>.category === 'write' \| 'execute'` | `OperationDef.write = true` | Truthfulness flag per RFC-005 §3.4.1. `execute` ⇒ `write: true` (observable side effects) |
| `Tool<S>.category === 'read' \| 'communicate'` | `OperationDef.write = false` | Reads cacheable. `communicate` is write-free in Cortex's sense (no platform state change) |
| `Tool<S>.precondition` | *(not mapped)* | Cortex authz is state-free; preconditions fire inside `@methodts/mcp`'s dispatch adapter; violation → MCP error, not Cortex authz failure |
| `Tool<S>.postcondition` | *(not mapped)* | Same; methodts runtime enforces post-dispatch |
| `Step<S>.tools[]` | *(not mapped directly)* | Cortex `operations[]` is flat. Step-level gating is enforced inside methodts at dispatch; Cortex only answers "can role R call operation O?" — role gating covers the coarser check |
| `Role<S>.id` | Suggested Layer-2 `default_policy` sidecar | Publisher emits a **suggested** `role → operations[]` mapping as `ToolRegistrationPayload.suggestedPolicy`. Admin approves (RFC-005 §3.4.2 + §3.4.4). Publisher **does not** write policy. |
| `OperationDef.transport` | Always `"mcp-tool"` | All methodology tools dispatch via MCP. Web/HTTP would be a separate surface. |
| `OperationDef.name` | `method.<methodology_id>.<tool_id>` | 1:1 with `ToolDescriptor.name`. One operation per tool → authz can differ per tool. |
| `inputSchema` / `outputSchema` | JSON Schema from methodology YAML | Emitted verbatim when declared; `{ type: 'object' }` + one-time warn otherwise. |

**Pure function signature:**

```typescript
export function methodtsToCortex(input: {
  readonly methodologyId: string;
  readonly tools: ReadonlyArray<Tool<unknown>>;
  readonly roleAuthorizations: ReadonlyArray<{
    readonly roleId: string;
    readonly authorizedToolIds: ReadonlyArray<string>;
  }>;
}): ToolRegistrationPayload;
```

### 7.3 Worked example

Methodology `P2-SD`, tool `read-prd`, category `read`:

```json
{
  "operations": [
    {
      "name": "method.P2-SD.read-prd",
      "description": "Load a PRD document and return its sections.",
      "transport": "mcp-tool",
      "write": false
    }
  ],
  "tools": [
    {
      "name": "method.P2-SD.read-prd",
      "operation": "method.P2-SD.read-prd",
      "displayName": "Read PRD",
      "description": "Load a PRD document and return its sections.",
      "inputSchema": { "type": "object", "properties": { "path": { "type": "string" } }, "required": ["path"] }
    }
  ],
  "suggestedPolicy": [
    { "role": "engineer", "operations": ["method.P2-SD.read-prd"] }
  ]
}
```

### 7.4 `MethodologyToolPublisher` — surface

```typescript
export interface MethodologyToolPublisher {
  publishAll(): Promise<PublishReport>;
  publishMethodology(methodologyId: string): Promise<PublishReport>;
  retractMethodology(methodologyId: string): Promise<RetractionResult>;
  dispose(options?: { readonly retractAll?: boolean }): Promise<void>;
}

export function createMethodologyToolPublisher(
  options: CreateMethodologyToolPublisherOptions,
): MethodologyToolPublisher;
```

Owns: the decision of *what to register*. Subscribes to
`MethodologySource.onChange` (S7) for `'updated' | 'added' | 'removed'`
changes; diffs prior snapshot; upserts + retracts.

**Lifecycle owned by the `@methodts/mcp` composition root** (stdio
`main()`), **not** by the MCP `Server` object — this is how §7.5's gate
enforces that no `CallToolRequest` handler can ever invoke the publisher.

### 7.5 Runtime-discovered-tools — forbidden by construction

- The publisher's API is **explicitly outside** the MCP dispatch loop.
- `CallToolRequestSchema` handlers never reference
  `publisher.publishMethodology` / `publishAll` / `retractMethodology`.
- Gate G-PORT asserts no import path from any `*tool*.ts` under
  `packages/mcp/src/` (excluding `cortex/`) touches the publisher.
- If a methodology genuinely needs a new tool, the admin edits the
  methodology YAML → `MethodologySource` emits `onChange` →
  `MethodologyToolPublisher` reacts **from the composition root**, not
  from a tool dispatch. The authorization remains the admin's.

### 7.6 Auth — via `ctx.auth.issueServiceToken` (S1 amendment)

S1's `CortexAuthFacade` gains **one additive optional method**:

```typescript
// additive amendment to S1 §4.1 — minor semver on @methodts/agent-runtime
export interface CortexAuthFacade {
  exchangeForAgent(parentToken: string, scope: ReadonlyArray<string>): Promise<{ readonly token: string; readonly expiresAt: number }>;
  /** NEW — used by S9. Service-account bearer for platform-capability actions. */
  issueServiceToken?(scope: ReadonlyArray<string>): Promise<{ readonly token: string; readonly expiresAt: number }>;
}
```

Why optional: not every consumer of S1 registers tools. Presence is
asserted at `createCortexToolRegistrationClient` construction time
(throws `MissingCtxError` if absent). Why service-account rather than
RFC 8693 exchange: tool registration administers the agent's own
toolset — a platform-capability action — not an on-behalf-of action.

### 7.7 Deployment model — v1 fallback (A) and v2 target (B)

**Model A — Deploy-time manifest only (v1 fallback, ships today).**

- The tenant app's `cortex-app.yaml` declares a static `spec.tools[]`
  hand-curated from the methodology YAML at deploy time.
- `MethodologyToolPublisher.mode = 'manifest'`.
- `publishAll()` is a no-op (or verifies the manifest matches the
  methodology — off by default).
- Adding/changing a methodology requires a redeploy + admin re-approval.
- **Loses** the S7 `MethodologySource` dynamic-curation capability
  inside Cortex — documented gap, not a design failure.
- **Covers the April-21 demos** (incident triage, feature dev) — both
  use a single static methodology per app.

**Model B — Runtime-bounded pool (v2 target, blocked on Q1/Q2).**

- The tenant app's `cortex-app.yaml` declares a **methodology pool**:
  ```yaml
  spec:
    tier: service
    methodology:
      pool:                           # allow-list of methodology ids
        - P0-META
        - P2-SD
      toolRegistration:
        mode: dynamic                 # "manifest" (A) | "dynamic" (B)
        maxTools: 64                  # upper bound enforced by platform
        authzTemplate: method-default # pre-approved Layer-2 template
  ```
- `MethodologyToolPublisher.mode = 'dynamic'`.
- `@methodts/mcp` POSTs/DELETEs tools at runtime within pool boundaries.
- Each runtime change resolves to Layer-2 via `authzTemplate` rather
  than stalling in `pending-approval`.
- Full S7 dynamic-curation capability available inside Cortex.
- **This PRD's Track B designs the shape;** implementation starts when
  Cortex confirms Q1 + Q2 (+ Q3 for correct retract).

---

## 8. Per-Domain Architecture

### 8.1 `@methodts/mcp` (L3)

```
packages/mcp/src/
  cortex/
    index.ts                            # barrel
    cortex-tool-registration-client.ts  # Track A: client shape + Track A HTTP envelope
    methodology-tool-publisher.ts       # Track A: shape + publishAll wiring; Track B: onChange subscribe
    mapping.ts                          # Track A: pure methodtsToCortex()
    types.ts                            # Track A: ToolRegistrationPayload et al.
  index.ts                              # Track A: conditional publisher construction (ctx?)
```

**Composition root changes (`packages/mcp/src/index.ts main()`):**

```typescript
async function main(ctx: CortexCtx | undefined) {
  const server = new Server({ name: 'method', version: '0.5.0' }, { capabilities: { tools: {} } });
  // existing handler registrations unchanged

  let publisher: MethodologyToolPublisher | null = null;
  if (ctx) {
    const client = createCortexToolRegistrationClient({
      ctx,
      baseUrl: process.env.CORTEX_PLATFORM_URL ?? 'http://cortex.t1.local',
    });
    publisher = createMethodologyToolPublisher({
      client,
      methodologySource: loadMethodologySource(),
      mode: process.env.METHOD_TOOL_REGISTRATION_MODE === 'manifest' ? 'manifest' : 'dynamic',
    });
    await publisher.publishAll();  // Track A: no-op in manifest mode; Track B: real publish
  }
  // ctx === undefined ⇒ standalone bridge mode — no Cortex wiring (C7).

  await server.connect(new StdioServerTransport());
}
```

### 8.2 `@methodts/agent-runtime` (L3) — additive amendment

Minor, backward-compatible addition to `CortexCtx.auth`:

```typescript
// packages/agent-runtime/src/index.ts (S1)
export interface CortexAuthFacade {
  exchangeForAgent(...): ...;
  issueServiceToken?(scope: ReadonlyArray<string>): Promise<{ readonly token: string; readonly expiresAt: number }>;  // NEW
}
```

Minor semver bump; no consumer breakage.

### 8.3 `@methodts/runtime/ports` (L3) — consumed unchanged

S7's `MethodologySource.onChange` is consumed as-is. The publisher attaches
one listener; filters on `kind === 'updated' | 'added' | 'removed'`.

---

## 9. Phase Plan

### Wave 0 — Surfaces (ships in this PRD)

- Freeze `CortexToolRegistrationClient`, `MethodologyToolPublisher`,
  `methodtsToCortex` (pure) — already done in S9, re-stated as Track A
  surfaces in this PRD.
- Additive amendment to S1 `CortexAuthFacade.issueServiceToken?` —
  minor bump on `@methodts/agent-runtime`.
- Gate assertions wired into `packages/mcp/src/architecture.test.ts`:
  G-BOUNDARY (no MCP SDK in `cortex/**`), G-PORT (publisher absent from
  dispatch paths), G-LAYER (no `@cortex/*` value imports), G-MAP
  (pure mapping unique-names).

### Wave 1 — Track A implementation (unblocked)

| Step | Deliverable |
|---|---|
| A1 | `packages/mcp/src/cortex/types.ts` — payload types verbatim from S9 §5.2 |
| A2 | `packages/mcp/src/cortex/mapping.ts` — pure `methodtsToCortex()` + P2-SD fixture test |
| A3 | `packages/mcp/src/cortex/cortex-tool-registration-client.ts` — shape + ctor `MissingCtxError` + injectable `fetch` |
| A4 | `packages/mcp/src/cortex/methodology-tool-publisher.ts` — shape; `publishAll` in `'manifest'` mode is a verifier (off by default); `onChange` subscription wired but emits warn-log only until Track B |
| A5 | `packages/mcp/src/cortex/index.ts` — barrel + composition-root wiring conditional on `ctx` |
| A6 | Architecture gates in `packages/mcp/src/architecture.test.ts` — G-BOUNDARY, G-PORT, G-LAYER, G-MAP |
| A7 | Docs: `docs/arch/mcp-layer.md` addendum covering Model A v1 fallback; `docs/guides/` entry for hand-curating `cortex-app.yaml spec.tools[]` from methodology YAML |
| A8 | Additive amendment to S1 in `packages/agent-runtime/src/index.ts`; no-op for existing consumers |

**Acceptance gates for Wave 1:** SA-1 through SA-6 (see §4) all green.
Existing `@methodts/smoke-test` suite passes unchanged.

### Wave 2 — Track B implementation (BLOCKED on O5/O6/O7)

Do **not** start Wave 2 until CORTEX-Q1/Q2/Q3 resolve. Gated steps:

| Step | Deliverable | Depends on |
|---|---|---|
| B1 | HTTP verb choice in client (`POST`/`PUT`/`DELETE`/`GET`) | Q1 (endpoint verbs) |
| B2 | `publishMethodology` emits real upsert on `MethodologySource.onChange` | Q1 (runtime updates OK) |
| B3 | `retractMethodology` uses `DELETE` with `scope.methodologyId` discriminator; fallback to `replaceAll` if Q3 = "no DELETE" | Q3 |
| B4 | `cortex-app.yaml spec.methodology.{pool, toolRegistration}` block — method-side contract doc + Cortex schema coordination | Q1 + Q2 |
| B5 | `state: 'active'` vs `'pending-approval'` handling based on `authzTemplate` resolution; surface `'pending-approval'` visibly on MCP-side hint | Q2 |
| B6 | End-to-end test against live Cortex dev stack (`t1-cortex-1`) with service-account token exchange | Q2 (issueServiceToken wired) |

**Acceptance gates for Wave 2:** SB-1 through SB-4 green.

---

## 10. Gate Assertions (Track A)

```typescript
// G-BOUNDARY: cortex transport isolated from MCP SDK
it('no @modelcontextprotocol/sdk imports in packages/mcp/src/cortex/**', () => {
  const violations = scanImports('packages/mcp/src/cortex', /^@modelcontextprotocol\/sdk/);
  assert.deepStrictEqual(violations, []);
});

// G-PORT: runtime-discovered tools blocked structurally
it('publisher never referenced from CallToolRequest handlers', () => {
  const handlerFiles = glob('packages/mcp/src/**/*tool*.ts').filter(f => !f.includes('/cortex/'));
  for (const file of handlerFiles) {
    const content = readFileSync(file, 'utf-8');
    assert.ok(!/publishMethodology|publishAll|retractMethodology/.test(content), file);
  }
});

// G-LAYER: no @cortex/* value imports in @methodts/mcp
it('no @cortex/* value imports in packages/mcp/src', () => {
  const valueImports = grepImports('packages/mcp/src', /^@cortex\//, { excludeTypeOnly: true });
  assert.deepStrictEqual(valueImports, []);
});

// G-MAP: pure mapping produces unique operation names
it('methodtsToCortex output is unique-named', () => {
  const payload = methodtsToCortex(fixtureMethodologyP2SD);
  const names = payload.operations.map(o => o.name);
  assert.strictEqual(names.length, new Set(names).size);
});
```

---

## 11. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **O5/O6/O7 remain unanswered past July 2026** — Track B cannot ship; Cortex-hosted agents stuck in Model A with static `spec.tools[]`. This would invalidate the PRD's premise (the whole point of this transport is runtime authz for methodology-derived tools). **Ignoring these blocks the PRD outright.** | HIGH | Escalation list in §12 explicit; Track A still delivers the mapping + auth wiring + gate fabric so Wave 2 is 1-2 days once answers land. |
| R2 | Cortex renames the registration endpoint or splits it across new ones (RFC-005 post-D.4 revision) | MEDIUM | Client's intent-level API (`replaceAll`, `publish`, `retract`, `list`) isolates verb/URL choices inside the implementation — no consumer-side change required. |
| R3 | `AppRegistryRepo.updateCallback`'s `toolsJson` blob shape is not operation-grammar-aware; accepting it means writing a legacy format that loses `write: boolean` and `transport: 'mcp-tool'` fidelity | MEDIUM | Raise as follow-up alongside Q1 — the operation-grammar upgrade path per RFC-005 §3.4 is the right vehicle. Until then, Model A (deploy-time manifest) preserves fidelity via `cortex-app.yaml spec.tools[]`. |
| R4 | Q2 resolves to "every new tool enters `pending-approval`" | MEDIUM | Surface `state: 'pending-approval'` on `RegistrationResult`; publisher logs and exposes an MCP-side "tool awaiting approval" hint. Dynamic pool still works, just with admin friction. |
| R5 | Tool-name migration breaks admin-written Layer-2 rules when mapping changes between `@methodts/mcp` minor versions | LOW-MEDIUM | Semver table in S9 §12: any rename publishes both names for one minor cycle, retract old at next major. Documented in `docs/arch/mcp-layer.md`. |
| R6 | Publisher races with multiple MCP server replicas racing to publish the same methodology on startup | LOW | `publish` is idempotent on Cortex side (per S9 §5.2, server diffs + 409 collapses). First-writer-wins; other replicas see 0 registered + N updated. |
| R7 | `ctx.auth.issueServiceToken` not yet implemented on Cortex side even after Q2 resolves | MEDIUM | S1 amendment is optional (`?`); `MissingCtxError` fail-closed at publisher construction means publisher simply doesn't attach — standalone mode semantics kick in. No silent auth-less registration. |

---

## 12. Open Escalations — to Cortex Team (BLOCK Track B)

The following must be answered before Wave 2 implementation starts.
Track against `follow_up_items` in `.method/sessions/fcd-surface-mcp-cortex-transport/decision.md`.

### CORTEX-Q1 (roadmap O5) — runtime vs deploy-time

**Question:** Does the endpoint referenced in the roadmap
(`POST /v1/platform/apps/:id/tools`, backed by
`AppRegistryRepo.updateCallback` per RFC-005 Appendix D.4) accept
**runtime updates** after the app is `active`, or is it deploy-time
only (redeploy required to change tools)?

**Needed because:** Model B cannot exist without runtime updates. If
Q1 = "deploy-time only," `MethodologyToolPublisher.mode` defaults to
`'manifest'` permanently inside Cortex, and S7's dynamic-curation
capability is unreachable through this transport in v1.

**Our default if unanswered:** Model A (deploy-time manifest). Ships
April-21 demos; punts Wave 2.

### CORTEX-Q2 (roadmap O6) — service-account token + auto-approval

**Question (two parts, one owner):**

(a) Is there a `ctx.auth.issueServiceToken(scope)` API (service-account
JWT for platform-capability actions like tool registration)? If not,
what is the correct auth mechanism for `@methodts/mcp` → registry calls?

(b) For a runtime-registered tool, does the platform accept a
template-based auto-approval (`authzTemplate: method-default` in the
manifest) that resolves the tool to `state: 'active'`, or does each
new tool enter `pending-approval` until an admin touches it?

**Needed because:** (a) is the foundation of C2 (service-account auth)
and of our additive S1 amendment; (b) determines whether dynamic mode
is usable or admin-gated per-change.

**Our default if unanswered:** Ship S1 amendment as optional
(`issueServiceToken?`); fail-closed via `MissingCtxError` at publisher
construction; surface `'pending-approval'` visibly on the
`RegistrationResult` and log once.

### CORTEX-Q3 (roadmap O7) — DELETE verb

**Question:** Does the registry expose a `DELETE` endpoint on
`/v1/platform/apps/:appId/tools/:name` (or a batched equivalent),
or is `POST` the only write path?

**Needed because:** `retractMethodology` needs a true DELETE for
per-batch deregistration. Without it, `retract` degrades to
`replaceAll` with the retracted subset omitted — costlier and racier
(two-writer windows expand the inconsistency window).

**Our default if unanswered:** Fall back to `replaceAll`-with-omission.
Document the degraded-behavior note in `docs/arch/mcp-layer.md` and
open a `@methodts/mcp` tracking issue for the upgrade.

### Secondary (not blocking, but worth raising alongside)

- **Q4 (S9 §9):** Does Cortex emit an event when an admin edits
  Layer-2 policy for a method-registered operation? Needed for
  `@methodts/mcp` to surface "tool approved" / "tool revoked" hints.
  **Default:** poll `list()` on a 5-min timer.
- **Q5 (S9 §9):** Does the registry honor `scope: { methodologyId }`
  on batched retracts, or must `@methodts/mcp` maintain its own
  tool→methodology index? **Default:** maintain index in publisher.

---

## 13. Acceptance — when can this PRD close?

- **Track A closes** when SA-1..SA-6 are green and `@methodts/mcp` ships
  with the four gates (G-BOUNDARY, G-PORT, G-LAYER, G-MAP) passing in
  CI. Status becomes `DRAFT` (no longer `DRAFT-PARTIAL`) but the
  document remains open until Track B.
- **Track B closes** only after Cortex resolves Q1/Q2/Q3, Wave 2
  implementation lands, and SB-1..SB-4 are green against a live Cortex
  dev stack. Status becomes `implemented`.

Until then, the PRD stays `DRAFT-PARTIAL` and this document is the
single pointer to the S9 open questions.
