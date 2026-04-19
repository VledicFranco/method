---
type: co-design-record
surface: "MCPCortexTransport (S9)"
slug: "mcp-cortex-transport"
date: "2026-04-14"
owner: "@methodts/mcp"
producer: "@methodts/mcp (L3) — CortexToolRegistrationClient + MethodologyToolPublisher"
consumer: "Cortex platform tool registry (POST /v1/platform/apps/:appId/tools) via @cortex/sdk typed client (consumer-of-platform)"
direction: "method → Cortex platform API (outbound REST); Cortex → method (MCP tool dispatch over existing MCP JSON-RPC, out of scope here)"
status: needs-follow-up
mode: "new"
prd_ref: "PRD-066 (this surface), roadmap §4.2 item 12, roadmap item C1"
related:
  - docs/roadmap-cortex-consumption.md (§4.2 item 12, §7 Phase 5)
  - docs/arch/mcp-layer.md
  - packages/mcp/src/index.ts
  - packages/methodts/src/method/tool.ts (Tool<S>)
  - packages/methodts/src/method/step.ts (Step<S>, tools?: readonly string[])
  - packages/methodts/src/domain/role.ts (Role<S>)
  - .method/sessions/fcd-surface-method-agent-port/decision.md (S1 — ctx shape, CortexCtx.auth)
  - .method/sessions/fcd-surface-cortex-service-adapters/decision.md (S3 — adapter pattern reuse)
  - t1-repos/t1-cortex-1/docs/prds/043-app-registry-and-authz-api.md
  - t1-repos/t1-cortex-1/docs/prds/060-platform-foundation.md (§External apps via HTTP callback)
  - t1-repos/t1-cortex-1/docs/rfcs/RFC-005-app-platform-service-library.md §§1.1, 3, 3.4, D.2, D.4
follow_up_items:
  - CORTEX-Q1: Confirm `POST /v1/platform/apps/:appId/tools` accepts runtime updates (not deploy-time-only) for category:agent apps. See §9 Q1.
  - CORTEX-Q2: Confirm Layer-2 security autoprovision for newly-published tools (admin approval flow in RFC-005 §3.4.4 vs `pending-approval` stall). See §9 Q2.
  - CORTEX-Q3: Confirm deregistration endpoint (`DELETE /v1/platform/apps/:appId/tools/:name` or equivalent). Nothing in PRD-043/060 today. See §9 Q3.
blocks: "roadmap item C1 and any Cortex-hosted tenant app whose methodology set changes post-deploy."
---

# Co-Design Record — MCPCortexTransport (S9)

> *The transport that lets a Cortex-hosted methodology agent expose its*
> *methodology-derived tools through Cortex's platform tool registry, so that*
> *Cortex enforces operation-grammar authorization on every tool call — rather*
> *than `@methodts/mcp` trusting MCP stdio alone.*

---

## 0. Scope

This surface freezes (or marks follow-up where blocked on Cortex):

1. **`CortexToolRegistrationClient`** — thin, typed HTTP wrapper
   `@methodts/mcp` uses to POST/DELETE tools against
   `/v1/platform/apps/:appId/tools`.
2. **`MethodologyToolPublisher`** — composition that translates a loaded
   methodts `Methodology` into a set of Cortex `ToolDescriptor` +
   `OperationDef` registrations.
3. **The mapping function** from methodts `Step` + `Role` + referenced
   `Tool<S>` into a Cortex `operations[]` entry and a Cortex
   `tools[]` entry (RFC-005 §3, §3.4.1).
4. **Registration timing model** — what must be in the manifest at deploy
   time vs what `@methodts/mcp` pushes at runtime when a new methodology
   ships into a tenant app's registry.
5. **Deregistration policy** for superseded or unloaded methodologies.
6. **Runtime-discovered tool policy** — whether an agent mid-session may
   register new tools (spoiler: **forbidden** in Cortex model).
7. **Auth mechanism** — what token `@methodts/mcp` presents to call the
   registry (app service-account JWT via `ctx.auth`).

**Out of scope:**
- The MCP stdio/JSON-RPC protocol itself (`@modelcontextprotocol/sdk`) — that
  stays the dispatch mechanism Cortex calls *back* to invoke a tool. This
  surface only covers the **registration** direction.
- The internal dispatch adapter inside `@methodts/mcp` that turns a
  Cortex-issued `tool.call` into a methodts step/tool invocation — a
  separate adapter concern (co-design S10 if needed).
- Bridge proxy tools (`bridge_spawn`, `bridge_prompt`, …) — those are
  bridge-internal HTTP proxies, not methodology-derived, and do not go
  through the Cortex registry.
- Tenant-app provisioning (`POST /v1/platform/apps/provision`, PRD-060).

---

## 1. Context

### 1.1 Where `@methodts/mcp` is today

From `docs/arch/mcp-layer.md` + `packages/mcp/src/index.ts`:

- `@methodts/mcp` is a thin stdio MCP server (`@modelcontextprotocol/sdk`).
- It defines a **fixed** set of ~23 tools via `ListToolsRequestSchema`
  (registry listing, methodology/step lifecycle, theory lookup, bridge
  proxies, fca-index context queries).
- None of those tools are methodology-derived per se — they are the
  *engine* tools an agent uses to drive a methodology. The methodology's
  own Hoare-typed tools (`packages/methodts/src/method/tool.ts`) are
  declared inside the methodology YAML and referenced by `Step.tools[]`
  (by id). They are **not** currently surfaced as MCP tools.

Consequence: for a Cortex-hosted methodology agent, two gaps exist.

- (a) The Cortex host expects tool definitions at the **platform** level
  (operation-grammar authz per RFC-005 §3.4); `@methodts/mcp` today trusts
  stdio-local MCP with no authz check.
- (b) The methodology's own Hoare tools never became MCP tools, so the
  agent currently manipulates state via `step_context`/`step_validate`
  prompts rather than per-tool MCP invocations. A Cortex deployment is
  a good moment to flip this.

This surface solves (a). It makes (b) possible and recommends it as the
default in §4.

### 1.2 Where Cortex's tool registration is today (reality vs roadmap)

**Reality check against PRD-043:** PRD-043 as shipped defines only
`POST /v1/apps` (admin registration) and `POST /v1/authz/check`
(decision API). It does **not** define
`POST /v1/platform/apps/:appId/tools`.

**Where the endpoint actually comes from:**
- RFC-005 §1.1 explicitly names `POST /v1/platform/apps/:appId/tools`
  as the "external apps via HTTP callback" registration path — the
  existing pre-RFC-005 mechanism. The endpoint exists today; PRD-043 is
  not its spec.
- PRD-060 §1 reaffirms it under "External apps via HTTP callback
  (`POST /v1/platform/apps`, `POST /v1/platform/apps/:appId/tools`)".
- RFC-005 Appendix D.4 documents it indirectly via
  `AppRegistryRepo.updateCallback(appId, callbackUrl, toolsJson)`.
- The endpoint's canonical spec lives in the *legacy* external-app path
  (pre-RFC-005). It predates the manifest-driven `cortex-app.yaml` flow.

**Implication for this surface:** the endpoint exists, the
**request body** is *partially* specified by `AppRegistryRepo.updateCallback`
(a `toolsJson` blob), but the **operation-grammar mapping** that
RFC-005 §3.4 introduces is **not yet** formalized on that endpoint.
The Cortex team must decide whether this endpoint (a) stays legacy +
deploy-time and new apps use `cortex-app.yaml` exclusively, or (b) is
upgraded to accept runtime operation-grammar updates.

This is the root of the "needs-follow-up" status. See §9 for the three
open questions that pin down §3's registration timing model.

### 1.3 Why a new client port, not "just fetch()"

Three reasons:

1. **Separation of registration from dispatch.** The current
   `@modelcontextprotocol/sdk` server object handles *both*
   `ListToolsRequestSchema` (registration) and `CallToolRequestSchema`
   (dispatch). In Cortex, dispatch still flows through MCP JSON-RPC
   (Cortex → agent), but **registration** moves to the platform's REST
   registry (agent → Cortex). These are two different transports. A
   dedicated client keeps the concerns apart.
2. **Typed mapping is non-trivial.** A methodts `Step.tools[]` references
   `Tool<S>` ids that must be expanded into Cortex `tools[]` entries,
   *and* each referenced tool must land in a Cortex `operations[]` entry
   with the right `write` flag. Putting that in an ad-hoc fetch call
   would bury the mapping in the MCP server's startup path.
3. **Auth lives on `ctx`, not in env vars.** `@methodts/mcp` today assumes
   `BRIDGE_URL` + no auth. Cortex-mode requires an app service-account
   JWT from `ctx.auth.issueServiceToken()` (per S1 `CortexCtx.auth`).
   Plumbing that through the MCP server's module-scope fetches is
   hostile; a client with ctor-injected `ctx` is clean.

---

## 2. Name Validation

Proposed surface name: **`MCPCortexTransport`** (session slug:
`mcp-cortex-transport`). The public classes are:

- `CortexToolRegistrationClient` — the typed HTTP client.
- `MethodologyToolPublisher` — the composition that turns a methodology
  into a set of registrations.

Considered and rejected:

- `CortexMCPAdapter` — ambiguous (is it dispatch, registration, or both?).
- `MCPRegistrationClient` — loses the "Cortex" information; there is no
  MCP-level "registration" outside this host's model.
- `ToolRegistry` — reads as if `@methodts/mcp` *owns* a registry; it does
  not. Cortex owns the registry; `@methodts/mcp` registers into it.
- `CortexToolGateway` — implies bidirectional dispatch; registration
  direction is one-way A → B.

`CortexToolRegistrationClient` is the component that talks HTTP.
`MethodologyToolPublisher` is the thing that *decides what to register*.
Separation mirrors `pacta-provider-cortex` (S3) where the provider (what
to call) is distinct from the adapter (how to call).

---

## 3. Registration Timing Model

This is the core decision the surface must make. Three candidate models,
only one is chosen.

### 3.1 Candidate models

| # | Model | What it means for method | Works today? |
|---|-------|--------------------------|--------------|
| A | **Deploy-time only (manifest)** | Every methodology a tenant app will ever run must be listed in `cortex-app.yaml` before `cortex-app deploy`. Adding a methodology requires a redeploy + admin re-approval (RFC-005 §3.4.4). | Yes (matches RFC-005 §3 `spec.tools`). |
| B | **Deploy-time + hot-reload (bounded)** | The manifest declares a *methodology pool* (allowed methodology ids, max tool count, max scope). `@methodts/mcp` can POST/DELETE tools at runtime, but only within the pool boundaries. Each runtime change triggers a Layer-2 autopolicy from a pre-approved template (§3.4.4). | Likely — but requires CORTEX-Q1 + CORTEX-Q2 confirmation. |
| C | **Fully dynamic** | Any methodology anywhere, no manifest ceiling, admin approval per tool at runtime. | No — incompatible with RFC-005 §3.4.4 `pending-approval` and `immutable: true` security blocks. |

### 3.2 Decision

**Model B** is the target; **Model A** is the v1 fallback if CORTEX-Q1
returns "deploy-time only."

- **Model B is correct-by-design** because methodologies genuinely are
  pluggable — the `MethodologySource` port (from the
  `fcd-surface-methodology-source` decision referenced in the task) is
  explicitly designed to enable per-app methodology curation. If Cortex
  locks everything at deploy-time, `MethodologySource`'s dynamic
  capability is unreachable inside Cortex. That conflict (called out
  explicitly by the task) is what drives the follow-up status.
- **Model A is acceptable as v1** because the April-21 demos use a
  single static methodology per agent app (incident triage, feature
  dev). The roadmap item 12 is Phase 5 (Jul–Sep), giving four months to
  resolve CORTEX-Q1/Q2 before blocking anything critical.

### 3.3 Manifest contract (always required, both models)

Regardless of Model A vs B, the tenant app's `cortex-app.yaml` MUST
declare a **methodology pool** block under `spec`:

```yaml
spec:
  tier: service
  methodology:
    pool:                            # the allow-list of methodology ids
      - P0-META
      - P2-SD
    toolRegistration:
      mode: dynamic                  # "manifest" (A) | "dynamic" (B)
      maxTools: 64                   # upper bound; platform enforces
      authzTemplate: method-default  # pre-approved Layer-2 template for
                                     # any tool this app publishes at runtime
```

- `mode: manifest` forces `@methodts/mcp` to fail-closed if it finds a
  tool not already in `spec.tools[]`.
- `mode: dynamic` authorizes runtime POSTs, bounded by `maxTools` and
  `authzTemplate`.

This block is part of S9 (this surface) as the **contract on the
consumer side of the manifest** — even though the Cortex team owns the
`cortex-app.yaml` schema, method declares what it needs it to contain.
If Cortex rejects the block name, this doc updates; the behavior
doesn't.

### 3.4 Registration lifecycle events

```
  [startup]  @methodts/mcp boots with ctx
       │
       ▼
  MethodologyToolPublisher.publishAll(ctx, activeMethodologies)
       │
       ├─► for each methodology in pool:
       │     compile → Cortex { operations[], tools[] }
       │     CortexToolRegistrationClient.upsert(appId, payload)
       │
       ▼
  [steady state] Cortex dispatches tool calls via MCP stdio
       │
       ▼
  [methodology change]  MethodologySource notifies methodologyReloaded(id)
       │
       ▼
  publishMethodology(ctx, id)   // diff-based upsert + delete-removed
       │
       ▼
  [shutdown]  publisher.dispose() — optionally tombstone all app tools
```

---

## 4. Methodology → Cortex Mapping

### 4.1 Source concepts (methodts)

From `packages/methodts/src/method/`:

- `Methodology` — top-level YAML-loaded artifact.
- `Method` — a named strategy within a methodology (e.g., `M1-MDES`).
- `Step<S>` — a node in a method's DAG. Carries
  `role: string`, `precondition`, `postcondition`,
  `tools?: readonly string[]` (id references into the method's tool set).
- `Tool<S>` (Hoare-typed) —
  `{ id, name, description, precondition, postcondition,
     category: "read" | "write" | "execute" | "communicate" }`.
- `Role<S>` — who is allowed to execute which steps.

### 4.2 Target concepts (Cortex, RFC-005 §3, §3.4.1, Appendix D.2)

- `OperationDef` (RFC-005 §3.4.1) —
  `{ name, description, transport: "mcp-tool"|"http"|"agent-operation",
     route?, write?: boolean }`. This is the authz granularity.
- `ToolDescriptor` (RFC-005 Appendix D.2 + §3 YAML) —
  `{ name, operation, inputSchema, outputSchema? }`. The tool binds to an
  operation and declares its I/O contract.
- Layer-2 `default_policy` (§3.4.2) — role→operation mapping, **admin-owned**,
  **not** method-owned.

### 4.3 Mapping table (key rows)

| methodts concept | Cortex concept | Mapping rule |
|---|---|---|
| `Methodology.id` | `ToolDescriptor.name` prefix | `method.<methodology_id>.<tool_id>` — flat namespace per RFC-005 §3 (no nesting); methodology id is the tenant's discriminator |
| `Method.id` | *(embedded in tool name)* | Appears as `method.<methodology_id>.<method_id>.<tool_id>` only if two methods in the same methodology expose clashing tool ids. Default: elided. |
| `Tool<S>.id` | `ToolDescriptor.name` suffix | 1:1 after sanitization (Cortex disallows `:` — replace with `.`) |
| `Tool<S>.name` | `ToolDescriptor.displayName`? | Displayed in Cortex tool picker. Optional on Cortex side — emit if present. |
| `Tool<S>.description` | `ToolDescriptor.description` + `OperationDef.description` | Same text on both sides; single source of truth is the methodology YAML |
| `Tool<S>.category = "write"` or `"execute"` | `OperationDef.write = true` | Truthfulness declaration per RFC-005 §3.4.1. `"execute"` → write true because of observable side effects. |
| `Tool<S>.category = "read"` or `"communicate"` | `OperationDef.write = false` | Reads are cacheable; platform honors scope-claim cache. `"communicate"` is write-free in the Cortex sense (no platform state change). |
| `Tool<S>.precondition` | *(not mapped)* | Cortex authz is state-free (role+operation). Preconditions stay inside methodts and fire at dispatch time inside `@methodts/mcp`'s adapter. A precondition violation returns an MCP error; it is **not** a Cortex authz failure. |
| `Tool<S>.postcondition` | *(not mapped)* | Same reason. Enforced by methodts runtime post-dispatch. |
| `Step<S>.tools[]` | *(not mapped directly)* | Cortex `operations[]` is flat. The step-level authorization (only these tools at this step) is enforced by methodts at dispatch; Cortex only sees "can role R call operation O?" Role gating below covers the coarser check. |
| `Role<S>.id` | `CortexRules` role id | At registration time, `MethodologyToolPublisher` emits a **suggested Layer-2 default_policy** as a sidecar JSON artifact the admin approves (RFC-005 §3.4.2 + §3.4.4). Publisher **does not** write to policy — it *proposes*. |
| `OperationDef.transport` | Always `"mcp-tool"` | All methodology tools dispatch through MCP. Web/HTTP operations would be a separate surface. |
| `OperationDef.name` | `method.<methodology_id>.<tool_id>` | 1:1 with `ToolDescriptor.name`. Each tool gets its own operation so authz can differ per tool. |
| `inputSchema` / `outputSchema` | JSON Schema from methodts | If the methodology YAML declares JSON schemas on a tool (current YAML parser slot), emit verbatim. Else emit a generic `{ type: object }` and let MCP handle validation. |

### 4.4 Worked example

Methodology `P2-SD` method `M1-IMPL`, step `σ_A1` references tool
`read-prd`:

```typescript
// methodts side (as loaded from YAML)
const tool: Tool<SoftwareDeliveryState> = {
  id: "read-prd",
  name: "Read PRD",
  description: "Load a PRD document and return its sections.",
  precondition: prdExistsAt(path),
  postcondition: prdLoaded,
  category: "read",
};
```

Becomes in Cortex:

```json
// PUT payload row — a single tool published
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
  ]
}
```

---

## 5. TypeScript Surface

### 5.1 File locations

```
packages/mcp/src/
  cortex/
    index.ts                            # barrel
    cortex-tool-registration-client.ts  # §5.2
    methodology-tool-publisher.ts       # §5.3
    mapping.ts                          # pure fns: methodtsToCortex()
    types.ts                            # ToolRegistrationPayload, etc.
```

### 5.2 `CortexToolRegistrationClient`

```typescript
/**
 * Typed HTTP client for Cortex's platform tool registry.
 *
 * OWNS: the HTTP envelope — URL composition, auth header, retry budget,
 * 409-upsert handling. NOTHING about methodology semantics.
 *
 * FAILS CLOSED: if the ctx.auth facade is absent, construction throws
 * MissingCtxError. There is no "register without auth" fallback.
 */
export interface CortexToolRegistrationClient {
  /**
   * Upsert the full tool+operation set for this app. Idempotent on the
   * Cortex side — server diffs and applies. Prefer `publish` for
   * per-methodology batches; this exists for bootstrapping.
   */
  replaceAll(payload: ToolRegistrationPayload): Promise<RegistrationResult>;

  /**
   * Publish (upsert) a named batch — typically all tools for ONE
   * methodology. Cortex supports partial upsert via the
   * `scope: { methodologyId }` discriminator on each operation
   * (emitted automatically by the publisher).
   */
  publish(methodologyId: string, payload: ToolRegistrationPayload): Promise<RegistrationResult>;

  /**
   * Remove a batch. `methodologyId` is the same discriminator used on
   * `publish`. No-op if the batch is absent.
   */
  retract(methodologyId: string): Promise<RetractionResult>;

  /** Probe current registry state — used at startup for reconciliation. */
  list(): Promise<RegistrationSnapshot>;
}

export interface ToolRegistrationPayload {
  readonly operations: ReadonlyArray<CortexOperationDef>;
  readonly tools: ReadonlyArray<CortexToolDescriptor>;
  /** Suggested Layer-2 default_policy. Publisher emits; admin approves. */
  readonly suggestedPolicy?: ReadonlyArray<{ readonly role: string; readonly operations: ReadonlyArray<string> }>;
}

export interface CortexOperationDef {
  readonly name: string;
  readonly description: string;
  readonly transport: 'mcp-tool' | 'http' | 'agent-operation';
  readonly write?: boolean;
  /** Scope discriminator used for batched retract. NOT part of RFC-005. */
  readonly scope?: { readonly methodologyId: string };
}

export interface CortexToolDescriptor {
  readonly name: string;
  readonly operation: string;
  readonly displayName?: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema?: Readonly<Record<string, unknown>>;
}

export interface RegistrationResult {
  readonly registered: number;
  readonly updated: number;
  readonly deprecated: number;
  /** Cortex decision: 'active' | 'pending-approval' (see RFC-005 §3.4.4). */
  readonly state: 'active' | 'pending-approval';
  readonly requestId: string;
}

export interface RetractionResult {
  readonly retracted: number;
  readonly notFound: number;
}

export interface RegistrationSnapshot {
  readonly toolNames: ReadonlyArray<string>;
  readonly operationNames: ReadonlyArray<string>;
  readonly byMethodology: Readonly<Record<string, ReadonlyArray<string>>>;
}

export interface CreateCortexToolRegistrationClientOptions {
  readonly ctx: {
    readonly app: { readonly id: string };
    readonly auth: { readonly issueServiceToken: () => Promise<{ readonly token: string; readonly expiresAt: number }> };
    readonly log?: { readonly info: (msg: string, f?: object) => void; readonly warn: (msg: string, f?: object) => void; readonly error: (msg: string, f?: object) => void };
  };
  readonly baseUrl: string;                      // e.g. 'https://cortex.t1.local'
  readonly fetch?: typeof fetch;                  // injectable for tests
  readonly retryBudget?: { readonly maxAttempts: number; readonly baseDelayMs: number };
}

export function createCortexToolRegistrationClient(
  options: CreateCortexToolRegistrationClientOptions,
): CortexToolRegistrationClient;
```

HTTP envelope details:

- **URL:** `${baseUrl}/v1/platform/apps/${ctx.app.id}/tools`.
- **Verb:** `PUT` for `replaceAll`, `POST` for `publish`, `DELETE` with
  query `?scope.methodologyId=…` for `retract`, `GET` for `list`. PRD-043
  today uses `POST`; upgrade path is opaque to this surface because the
  client exposes only the verb-free intent — the implementation chooses.
- **Auth:** `Authorization: Bearer <service-token>`. Token minted by
  `ctx.auth.issueServiceToken()` per call; client caches until
  `expiresAt - 30s`.
- **Retry:** idempotent verbs retry on 5xx (exponential backoff to
  `maxAttempts`). 4xx never retry. 409 (upsert conflict on
  `replaceAll`) is collapsed to "registered: 0, updated: N" when the
  body reports "already registered."

### 5.3 `MethodologyToolPublisher`

```typescript
/**
 * Composes a MethodologySource (per ports/methodology-source.ts) with
 * a CortexToolRegistrationClient. Subscribes to methodologyReloaded
 * events and keeps the Cortex registry in sync with the loaded
 * methodology set.
 *
 * Lifecycle owned by the @methodts/mcp composition root (stdio server
 * main()), NOT by the MCP Server object. Starts before
 * server.connect(transport); stops in process shutdown.
 */
export interface MethodologyToolPublisher {
  /**
   * Initial sync: publish every methodology the source currently
   * exposes. Call once at startup. Honors manifest `toolRegistration.mode`.
   */
  publishAll(): Promise<PublishReport>;

  /**
   * Publish or re-publish a single methodology. Diff-aware: retracts
   * tools present in the prior snapshot but absent in the new one.
   */
  publishMethodology(methodologyId: string): Promise<PublishReport>;

  /**
   * Retract every tool in the given methodology. No-op if already absent.
   */
  retractMethodology(methodologyId: string): Promise<RetractionResult>;

  /** Dispose: clears handlers; optionally retract all (configurable). */
  dispose(options?: { readonly retractAll?: boolean }): Promise<void>;
}

export interface PublishReport {
  readonly methodologyId: string;
  readonly toolsPublished: number;
  readonly toolsRetracted: number;
  readonly policySuggestionsEmitted: number;
  readonly state: 'active' | 'pending-approval';
}

export interface CreateMethodologyToolPublisherOptions {
  readonly client: CortexToolRegistrationClient;
  readonly methodologySource: MethodologySource;               // from ports/methodology-source.ts
  readonly mode: 'manifest' | 'dynamic';                        // from cortex-app.yaml spec.methodology.toolRegistration.mode
  readonly manifestTools?: ReadonlyArray<CortexToolDescriptor>; // required when mode === 'manifest'
  readonly ctxLog?: CreateCortexToolRegistrationClientOptions['ctx']['log'];
}

export function createMethodologyToolPublisher(
  options: CreateMethodologyToolPublisherOptions,
): MethodologyToolPublisher;
```

### 5.4 Pure mapping function

```typescript
/**
 * Pure — no I/O. Given a loaded methodology and its methods, returns the
 * registration payload. This is what gates should assert on.
 */
export function methodtsToCortex(input: {
  readonly methodologyId: string;
  readonly tools: ReadonlyArray<Tool<unknown>>;         // Hoare tools — methodts
  readonly roleAuthorizations: ReadonlyArray<{
    readonly roleId: string;
    readonly authorizedToolIds: ReadonlyArray<string>;
  }>;
}): ToolRegistrationPayload;
```

The pure function is the **specification** — implementations can be
tested without touching Cortex. It embodies §4.3's mapping table as
executable code.

---

## 6. Deregistration Model

- **Explicit per-methodology retract** when `MethodologySource` emits
  `methodologyRetracted(id)` or returns a smaller set on reload.
- **Diff-aware publish** on `publishMethodology` — any tool ids absent
  from the new set but present in the prior snapshot are DELETE'd.
- **Optional retract-all on shutdown** controlled by
  `dispose({ retractAll })`. Default is `false` because the tenant app's
  container usually restarts into the same methodology set; tombstoning
  on every restart would churn Cortex's audit log.
- **Cortex-side tombstone semantics** are not this surface's concern —
  `DELETE` returns `retracted` count and that's the whole contract. If
  Cortex soft-deletes (keeps for audit) or hard-deletes, `@methodts/mcp`
  sees identical behavior.

**Follow-up (CORTEX-Q3):** Confirm a `DELETE` verb on
`/v1/platform/apps/:appId/tools/:name` (or equivalent batch endpoint).
PRD-043 and PRD-060 do not define it. Without it, `retract` becomes a
`replaceAll` with the retracted subset omitted — costlier and racier.

---

## 7. Runtime-Discovered Tools Policy

**Forbidden at the Cortex layer.** An agent may not invent a new tool
mid-session and call it.

Reasoning:

1. RFC-005 §3.4 — authz is pre-registered, Layer-2-approved, and
   immutable within an environment.
2. RFC-005 §3.4.4 — any tool not matched by a Layer-2 `default_policy`
   entry fails authz, regardless of transport.
3. The methodology YAML is the source of truth. Anything an agent can
   legitimately invoke during a step is already in `Step.tools[]` and
   therefore in the registration payload.

**What an agent can do instead:**
- Call `methodology_transition` / `methodology_load_method` to enter a
  new method, which brings its pre-registered tool set with it.
- Use `bridge_spawn` (if allowed by the app's manifest) to delegate to
  a sub-agent whose own app has different pre-registered tools.

**What this surface rejects:** any API shape that mutates the registry
from *inside* an MCP tool dispatch path. The publisher's API is
explicitly outside the MCP dispatch loop — only the composition root
calls it, and only on `methodologyReloaded` events from
`MethodologySource`.

A gate (see §8) asserts no code path from
`CallToolRequestSchema`-handling reaches `publisher.publishMethodology`.

---

## 8. Auth Mechanism

The token `@methodts/mcp` presents on every call to the registry is:

- **Subject:** the tenant app's service account (NOT a user).
- **Issuer:** Cortex (`ctx.auth.issueServiceToken()`).
- **Scope:** `platform:apps:${appId}:tools:write`.
- **Lifetime:** short (≤ 15 min), refreshed on demand. The client
  pre-refreshes at `expiresAt - 30s` under its own retry lock.
- **Header:** `Authorization: Bearer <jwt>`.

Why service-account, not user-delegated:

- Tool registration is a platform-capability action, not a
  user-on-behalf-of action. RFC-005 §4.1.5's RFC 8693 exchange is for
  *operation invocation* (acting on behalf of the human who triggered
  the agent), not for *administering the agent's own toolset*.
- The service-account token is what the tenant app already owns as part
  of its deployment identity. This surface does not introduce new auth
  material.

**MissingCtxError** thrown at publisher construction if
`ctx.auth?.issueServiceToken` is absent. No env-var fallback. No
"unauthenticated for dev" mode (tests inject a fake `ctx.auth`).

Relationship to S1:

- S1 (`MethodAgentPort`) defined `CortexCtx.auth` with
  `exchangeForAgent(parentToken, scope)` for RFC 8693. S9 needs a
  sibling: `issueServiceToken()` → service-account JWT. This is an
  **extension** of `CortexCtx.auth`, **not** a new port. Propose the
  following additive amendment to S1 (minor semver, additive field):

```typescript
// Amendment to CortexAuthFacade from
// .method/sessions/fcd-surface-method-agent-port/decision.md §4.1
export interface CortexAuthFacade {
  exchangeForAgent(parentToken: string, scope: ReadonlyArray<string>): Promise<{ readonly token: string; readonly expiresAt: number }>;
  /** NEW — used by S9 MCPCortexTransport. Service-account bearer token. */
  issueServiceToken?(scope: ReadonlyArray<string>): Promise<{ readonly token: string; readonly expiresAt: number }>;
}
```

Optional (`?`) because not every consumer of S1 needs it. Presence is
asserted at `createCortexToolRegistrationClient` call time.

---

## 9. Open Questions — Cortex Follow-Ups

| # | Question | Blocks | Default if unanswered |
|---|---|---|---|
| Q1 | Does `POST /v1/platform/apps/:appId/tools` accept runtime updates after the app is `active`, or is it deploy-time-only (redeploy required to change tools)? | §3 Model B | Assume deploy-time-only → fall back to Model A; methodology set fixed at manifest. Methodologies added post-deploy cannot surface their tools via Cortex authz — they execute via MCP-local dispatch only (less safe) or fail. |
| Q2 | Layer-2 `default_policy` for a runtime-registered tool — does the platform accept a template-based auto-approval (`authzTemplate`) or does each new tool enter `pending-approval` until admin touches it? | §3.3, §5.2 | Assume `pending-approval`. Tools stay unreachable until approved. The publisher logs and surfaces `state: 'pending-approval'` on the `RegistrationResult`; `@methodts/mcp` then surfaces a visible "tool awaiting approval" MCP-side hint. |
| Q3 | Deregistration endpoint — is there a `DELETE` on tools, or is `POST` the only write? | §6 | Fall back to `replaceAll` with omitted entries. Costly but correct. |
| Q4 | Does Cortex emit an event when an admin edits Layer-2 policy for a method-registered operation? | Observability | `@methodts/mcp` polls `list()` on a slow timer (e.g., 5 min) to reconcile. Out of scope here beyond noting the hook. |
| Q5 | Does the registry honor the `scope: { methodologyId }` discriminator for batched retracts, or must method maintain its own tool→methodology index? | §5.2 `retract` | Publisher maintains an in-memory index keyed by `methodologyId` and lists concrete names on `DELETE`. One extra round-trip at retract; tolerable. |

These five must be answered before this surface leaves
`needs-follow-up`. CORTEX-Q1 and CORTEX-Q2 are the two that directly
drive the "design conflict with methodts" that the task flagged — if
Cortex is deploy-time-only, the `MethodologySource` dynamic capability
is *not* consumable from a Cortex-hosted agent via this transport, and
the agent must either (a) live with a static methodology pool, or
(b) handle some methodologies outside Cortex's authz (local MCP only,
not Cortex-gated).

---

## 10. Gate Assertions

To be added in `packages/mcp/src/architecture.test.ts` (package-local
gate) and mirrored into the bridge's architecture.test.ts for
cross-package visibility.

```typescript
// G-BOUNDARY: cortex transport code does not import from @modelcontextprotocol/sdk
// (registration transport is distinct from dispatch transport)
describe('G-BOUNDARY: cortex transport isolates from MCP SDK', () => {
  it('no import of @modelcontextprotocol/sdk in packages/mcp/src/cortex/**', () => {
    const violations = scanImports('packages/mcp/src/cortex', /^@modelcontextprotocol\/sdk/);
    assert.deepStrictEqual(violations, []);
  });
});

// G-PORT: the publisher is only called from the composition root, never
// from inside a CallToolRequest handler
describe('G-PORT: runtime-discovered tools are blocked structurally', () => {
  it('publishMethodology is not referenced from any CallToolRequest handler', () => {
    const handlerFiles = glob('packages/mcp/src/**/*tool*.ts').filter(f => !f.includes('/cortex/'));
    for (const file of handlerFiles) {
      const content = readFileSync(file, 'utf-8');
      assert.ok(!/publishMethodology|publishAll|retractMethodology/.test(content),
        `${file} references the publisher — dispatch path must not register tools`);
    }
  });
});

// G-LAYER: @methodts/mcp does not import from @cortex/* at runtime
describe('G-LAYER: @methodts/mcp keeps Cortex as injected ctx', () => {
  it('no value import from @cortex/* in packages/mcp/src', () => {
    const valueImports = grepImports('packages/mcp/src', /^@cortex\//, { excludeTypeOnly: true });
    assert.deepStrictEqual(valueImports, []);
  });
});

// G-MAP: the pure mapping fn never produces duplicate operation names
describe('G-MAP: methodtsToCortex output is unique-named', () => {
  it('no two operations share a name', () => {
    const payload = methodtsToCortex(fixtureMethodologyP2SD);
    const names = payload.operations.map(o => o.name);
    assert.strictEqual(names.length, new Set(names).size);
  });
});
```

---

## 11. Producer / Consumer Mapping

### 11.1 Producer

- **Package:** `@methodts/mcp` (L3).
- **Entry file (new):** `packages/mcp/src/cortex/index.ts`.
- **Composition root:** `packages/mcp/src/index.ts`'s `main()` — construct
  the client + publisher **before** `server.connect(transport)`. The
  existing stdio wiring is unchanged.
- **Wiring:** tenant-app composition root receives `ctx`, calls
  `createCortexToolRegistrationClient({ ctx, baseUrl })` and
  `createMethodologyToolPublisher({ client, methodologySource, mode })`,
  then `await publisher.publishAll()`.

### 11.2 Consumer

- **Service:** Cortex platform (`modules/api` in `t1-cortex-1`).
- **Endpoint:** `POST /v1/platform/apps/:appId/tools` (legacy external-app
  path per RFC-005 §1.1, PRD-060 §1). `DELETE`/`GET` pending CORTEX-Q3/Q5.
- **Authz:** admin-only today (per PRD-043 style); upgrade to
  "service-account with `platform:apps:${appId}:tools:write` scope" is
  part of Q1/Q2 resolution.
- **Downstream consumers of the registered tools:** Cortex's
  `McpServerInterpreter` (RFC-005 §1072 table row 7) dispatches to the
  MCP server — i.e., back into `@methodts/mcp`'s existing
  `CallToolRequestSchema` handler, which translates the call into a
  methodts step/tool invocation. That dispatch path is **not** this
  surface.

### 11.3 Wiring sketch (for readers)

```typescript
// packages/mcp/src/index.ts — new lines at the top of main()
import { createCortexToolRegistrationClient, createMethodologyToolPublisher } from './cortex/index.js';
import { loadMethodologySource } from './methodology-source-loader.js'; // already exists (port)

async function main(ctx: CortexCtx | undefined) {
  const server = new Server({ name: 'method', version: '0.5.0' }, { capabilities: { tools: {} } });
  // ... existing handler registrations unchanged ...

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
    await publisher.publishAll();
  }
  // ctx undefined == standalone bridge mode; no Cortex registry.

  await server.connect(new StdioServerTransport());
  // on shutdown: await publisher?.dispose({ retractAll: false });
}
```

---

## 12. Compatibility (semver, @methodts/mcp)

| Change | Bump |
|---|---|
| Add optional field to `ToolRegistrationPayload` | minor |
| Add a new method on `CortexToolRegistrationClient` with default impl | minor |
| Tighten mapping (e.g., stricter name sanitization) | minor + release-note (tools re-register under new names → deprecate-cycle required; see below) |
| Change mapping of `Tool<S>.category` → `OperationDef.write` | major (changes authz surface) |
| Rename or remove any exported symbol | major |

**Tool-name migration rule:** any change that alters a tool's Cortex name
between `@methodts/mcp` versions MUST publish both the old and new names
for one minor version cycle, then retract the old name at the next major
bump. Cortex Layer-2 `default_policy` references operations by name; a
silent rename breaks authz for every admin rule that references the old
name.

---

## 13. Non-Goals

- Cortex-side tool dispatch (Cortex → `@methodts/mcp` over MCP JSON-RPC).
- `cortex-app.yaml` authoring tools. Method documents what the block
  needs to contain; Cortex owns the parser and admin UI.
- Bridge-proxy tools registration. These are `@methodts/bridge`-local;
  Cortex does not see them.
- Tool schema generation beyond "pass through whatever the methodology
  YAML declares." If a methodology tool has no `inputSchema`, the
  publisher emits `{ type: 'object' }` and logs a warning once.
- A `@methodts/mcp` SDK for non-Cortex external hosts. If another host
  emerges, a sibling `CortexToolRegistrationClient` (renamed) is the
  pattern; this surface doesn't abstract across hosts prematurely.

---

## 14. Agreement

**Status:** `needs-follow-up` — frozen on everything not contingent on
CORTEX-Q1/Q2/Q3. Those three questions must be answered by the Cortex
team before `@methodts/mcp` implementation starts (PRD-066 / roadmap C1).

**Path-forward decision tree:**

- If CORTEX-Q1 = "runtime updates OK": Model B, surface freezes as-is,
  implementation can begin in Phase 5 per roadmap.
- If CORTEX-Q1 = "deploy-time only": Model A only. Surface still freezes,
  but `MethodologyToolPublisher.mode` defaults to `'manifest'`; dynamic
  mode becomes a *future* follow-up surface. The `MethodologySource`
  dynamic capability is not reachable through the Cortex transport in
  v1 — a documented gap, not a design failure.

**Frozen (for both branches):**
- The TypeScript surface (§5).
- The mapping table (§4.3).
- The auth mechanism (§8).
- The runtime-discovered-tools policy (§7 — forbidden regardless of Q1).
- The deregistration *shape* (§6) — details pinned after Q3.

**Changes after follow-up resolution:**
- If Q1/Q2/Q3 answers fit the frozen shape: flip status to `frozen`,
  no surface changes, just fill in §3.3's manifest-block finalized
  names with whatever Cortex prefers.
- If answers require any surface change: new `/fcd-surface` session
  with migration plan.

**Unblocks on transition to `frozen`:** PRD-066, roadmap item C1
(Phase 5 — MCP + multi-app + cognitive). Until then, `@methodts/mcp`
continues to register tools in-process via the bridge (the existing
stdio model), and Cortex-hosted agents ship with a **static** tool
set declared in `cortex-app.yaml spec.tools[]` hand-curated from the
methodology YAML. The existing demos (incident triage, feature dev)
can operate under that constraint.

**Reviewers (implicit via FCD discipline):**
- Method team: `@methodts/mcp` maintainers, `@methodts/methodts` owners
  (mapping correctness).
- Cortex team: RFC-005 authors, platform registry owners
  (CORTEX-Q1/Q2/Q3 answers).
- Surface Advocate review required before PRD-066 merge per FCD Rule 3.
