---
type: prd
title: "PRD-065 — Cortex Agent Conformance Testkit"
date: "2026-04-14"
status: implemented (PR #184, merged 2026-04-15)
version: "0.1.0"
size: S
domains:
  - pacta-testkit (conformance/ subpath)
surfaces:
  implements:
    - S8 — CortexAgentConformance (`.method/sessions/fcd-surface-conformance-testkit/decision.md`)
  consumes:
    - S1 — MethodAgentPort (`.method/sessions/fcd-surface-method-agent-port/decision.md`)
    - S3 — CortexServiceAdapters (`.method/sessions/fcd-surface-cortex-service-adapters/decision.md`)
related:
  - docs/roadmap-cortex-consumption.md (Group B / B8, §6 PRD-065)
  - .method/sessions/fcd-surface-conformance-testkit/decision.md
  - .method/sessions/fcd-surface-method-agent-port/decision.md
  - .method/sessions/fcd-surface-cortex-service-adapters/decision.md
  - packages/pacta-testkit/src/index.ts
blocks:
  - Cortex tenant-app certification (`certified: boolean`)
  - samples/cortex-incident-triage-agent/ CI gate
  - roadmap B8 closeout
---

# PRD-065 — Cortex Agent Conformance Testkit

## 0. Summary

Ship the `@methodts/pacta-testkit/conformance` subpath that lets a Cortex
tenant app of `category: agent` self-certify compliance with
`MethodAgentPort` (S1) and the `CortexServiceAdapters` (S3) in its own
CI. Produces a signed `ComplianceReport.json` that Cortex reads to flip
the app's `certified` flag. **Implements** the S8 freeze verbatim —
this PRD is an execution container for a frozen surface, not a new
design session.

Status: draft. Size: **S** (one package, one subpath, ~8 new files,
no cross-domain refactor).

---

## 1. Problem

Cortex RFC-005 §10.2 defines `category: agent` apps as Tier-2 services
that consume `@methodts/agent-runtime`. There is no mechanical way today
for Cortex to verify a tenant app actually satisfies `MethodAgentPort`
instead of merely declaring it in its manifest. Six invariants must
hold per invocation (port entry via `createMethodAgent`, LLM budget
handlers present, audit minimum-set emitted, token-exchange depth ≤ 2,
scope respected, resume roundtrip when declared) and none of them can
be asserted from outside the app without running it.

**Consequence without this PRD:** Cortex either (a) trusts the
manifest and silently ships non-conforming agents that violate
`ctx.llm` budget, leak across delegation boundaries, or break resume
semantics; or (b) forbids `category: agent` apps until a platform-side
harness exists — blocking both April 21 demos and Twins Wave 1.

---

## 2. Constraints

**From the S8 freeze (non-negotiable):**

1. **Subpath, not new package.** Ship as `@methodts/pacta-testkit/conformance`.
   Duplicating `RecordingProvider`, builders, and assertions in a second
   package is explicitly rejected (S8 §2).
2. **Required plugins cannot be disabled.** `s1MethodAgentPortPlugin`
   and `s3ServiceAdaptersPlugin` are mandatory. Any `opts.plugins` list
   that omits either throws `ConformanceRunError('INVALID_FIXTURE')` in
   the runner (S8 Q11). Tightening this set in the future is a **major**
   bump.
3. **Self-certification v1.** Cortex reads the signed artifact; the
   platform does not re-run the suite. External verification is Wave 2
   and uses the same entry point (no API change).
4. **Signed `ComplianceReport.json`.** Unsigned reports are produced (for
   local runs) but Cortex rejects them in production. Signature is
   detached; key material lives on the caller side.
5. **Runner-agnostic.** The entry point is a plain async function that
   returns a report — works under vitest, tap, `node:test`, or
   standalone. No test-framework dependency.
6. **No value imports from `@methodts/agent-runtime` in `conformance/`.**
   Peer dep only. Gate `G-BOUNDARY` enforces (S8 §11).

**Environmental:**

7. Package already exists at `packages/pacta-testkit/` with
   `RecordingProvider`, `MockToolProvider`, builders, and assertions.
   No reorganization of the existing `src/` — the conformance files
   land in a new `src/conformance/` directory.
8. The older `packages/testkit/` (dist-only remnant) is **out of scope**.
   Per S8, conformance extends the pacta testkit, not the legacy one.
9. `@methodts/pacta-testkit` is versioned as one unit; a major bump here
   affects the core testkit's consumers too. Bias toward additive
   changes within v0.x.

---

## 3. Success Criteria

The PRD is done when **all** of the following hold:

- **SC-1 — Runs in tenant-app CI:** `samples/cortex-incident-triage-agent/`
  (or an equivalent fixture app) imports
  `runCortexAgentConformance` from `@methodts/pacta-testkit/conformance`
  inside its own CI, passes the three canonical fixtures, and emits a
  `compliance-report.json` with `passed: true` and `schemaVersion: '1.0'`.
- **SC-2 — Emits a schema-valid `ComplianceReport.json`:** a round-trip
  test parses the produced report under the frozen `ComplianceReport`
  TS interface; all required fields present; signature field present
  when `opts.signer` is provided.
- **SC-3 — Cortex can read the artifact:** the Cortex team's fixture
  reader (stubbed here via a schema validator that mirrors the S8 §5.4
  interface) accepts the produced report without modification.
- **SC-4 — Required-plugin tightening is enforceable:** a negative test
  confirms that passing `plugins: []` (or omitting `s1MethodAgentPortPlugin`)
  throws `ConformanceRunError('INVALID_FIXTURE')`.
- **SC-5 — Gate assertions green:** G-BOUNDARY, G-PORT, G-LAYER,
  G-SCHEMA (from S8 §11) all pass under `npm --workspace=@methodts/pacta-testkit test`.
- **SC-6 — All six S1 checks validated:** each of C1–C6 has at least
  one positive fixture that passes and one negative fixture (in the
  suite's own tests, not in `DEFAULT_FIXTURES`) that fails with
  useful `evidence` strings.

---

## 4. Scope

### In scope

- New `src/conformance/` directory under `packages/pacta-testkit/`.
- `runCortexAgentConformance` entry point and `ConformanceOptions`.
- `createMockCortexCtx` factory with `CallRecorder` + delegation-depth
  tracking.
- Three canonical v1 fixtures: `incidentTriageFixture`,
  `featureDevCommissionFixture`, `dailyReportFixture`.
- `ConformancePlugin` interface + two built-in required plugins
  (`s1MethodAgentPortPlugin`, `s3ServiceAdaptersPlugin`).
- `ComplianceReport` schema + writer.
- Signature mechanism: detached Ed25519 (default) via pluggable
  `signer` callback.
- `package.json#exports` addition for `./conformance` and
  `./conformance/fixtures`.
- Gate tests at `src/conformance/__tests__/gates.test.ts`.
- README section and usage recipe for `samples/cortex-incident-triage-agent/`.

### Out of scope

- **New package.** Not creating `@methodts/pacta-conformance`. Explicit
  per S8 §2.
- **Platform-side sandbox re-run of the suite.** Wave 2.
- **S4/S5/S6/S7/S9 plugins.** Plugin interface ships here; concrete
  plugins ship with their own PRDs (061, 062, 063, 064).
- **Load / performance conformance.** Functional + structural only.
- **Security adversarial testing.** Structural depth check ≤ 2 only.
- **Running against non-Cortex hosts.** `MockCortexCtx` is specifically
  shaped to `CortexCtx`.
- **Revisiting the old `packages/testkit/`.** Dist-only remnant; leave
  untouched.
- **Custom-fixture certification.** `opts.fixtures` can be extended by
  tenant apps, but custom fixtures don't count toward core certification
  (S8 Q6).

---

## 5. Domain Map

One affected FCA artifact: the `pacta-testkit` package (L3). No new
domain. The conformance subpath adds a sub-surface to an existing
library and reaches two frozen ports (S1, S3) via **types only**.

```
Cortex tenant app (consumer)
        │  import { runCortexAgentConformance } from '@methodts/pacta-testkit/conformance'
        ▼
@methodts/pacta-testkit (producer, L3)
  ├── src/ (existing — Recording*, builders, assertions)      [untouched]
  └── src/conformance/ (NEW)
        │   type-only: import type { CortexCtx, MethodAgent, ... }
        │              from '@methodts/agent-runtime'  (peer)
        ├──► @methodts/pacta         (value — createAgent, event types)
        └──► @methodts/agent-runtime (type-only peer — MethodAgentPort shapes)

Cortex platform (passive reader of the signed JSON)
```

No new cross-domain wires. S1 and S3 are already frozen; we consume
their types. The only new surface is the public shape of
`@methodts/pacta-testkit/conformance` itself — **that shape is S8**, also
already frozen.

---

## 6. Architecture

### 6.1 Package.json — subpath exports (additive)

```json
{
  "name": "@methodts/pacta-testkit",
  "exports": {
    ".": "./dist/index.js",
    "./conformance": "./dist/conformance/index.js",
    "./conformance/fixtures": "./dist/conformance/fixtures/index.js"
  },
  "peerDependencies": {
    "@methodts/agent-runtime": "^0.1.0"
  },
  "peerDependenciesMeta": {
    "@methodts/agent-runtime": { "optional": true }
  }
}
```

`peerDependenciesMeta.optional = true` because non-conformance consumers
of `@methodts/pacta-testkit` (existing users of RecordingProvider) must
not be forced to install `@methodts/agent-runtime`. The conformance
runner throws `ConformanceRunError('MISSING_APP')` with actionable
message if the peer is absent at runtime.

### 6.2 Directory layout

```
packages/pacta-testkit/
  package.json                        [edit: add exports + peer dep]
  src/
    index.ts                          [unchanged]
    …existing files…                  [unchanged]
    conformance/
      index.ts                        (NEW, ~80 LOC) — barrel + public exports
      conformance-runner.ts           (NEW, ~250 LOC) — runCortexAgentConformance
      mock-cortex-ctx.ts              (NEW, ~350 LOC) — MockCortexCtx + CallRecorder
      compliance-report.ts            (NEW, ~120 LOC) — schema + writer + signer glue
      assertions-cortex.ts            (NEW, ~80 LOC)  — helpers reused by plugins
      plugin.ts                       (NEW, ~60 LOC)  — ConformancePlugin interface
      fixtures/
        index.ts                      (NEW) — DEFAULT_FIXTURES + re-exports
        incident-triage.ts            (NEW)
        feature-dev-commission.ts     (NEW)
        daily-report.ts               (NEW)
      plugins/
        index.ts                      (NEW) — DEFAULT_PLUGINS + re-exports
        s1-method-agent-port.ts       (NEW, ~180 LOC) — checks C1–C6
        s3-service-adapters.ts        (NEW, ~120 LOC) — adapter shape checks
      __tests__/
        gates.test.ts                 (NEW) — G-BOUNDARY / G-PORT / G-LAYER / G-SCHEMA
        runner.test.ts                (NEW) — positive + negative fixture runs
        mock-cortex-ctx.test.ts       (NEW) — recorder + depth tracking
        plugin-s1.test.ts             (NEW) — each of C1–C6 pass + fail
        plugin-s3.test.ts             (NEW)
        fixtures.test.ts              (NEW) — fixture invariants (structure-only)
```

Total: ~14 new files. All within one package. No touches outside.

### 6.3 Layering

- Layer: **L3** (same as rest of `@methodts/pacta-testkit`).
- Upstream deps (value): `@methodts/pacta` only.
- Upstream deps (type-only): `@methodts/agent-runtime` (peer).
- No import from `@methodts/bridge`, `@methodts/methodts`, `@methodts/mcp`,
  or any `@cortex/*` package.
- Gate `G-LAYER` in `__tests__/gates.test.ts` pins this.

---

## 7. `MockCortexCtx` — Shape + Call Recorder

Faithful implementation of the frozen S8 §5.2 interface, plus the
additional state the recorder needs. Concrete shape:

### 7.1 State

```typescript
interface MockCortexCtxState {
  readonly appId: string;
  readonly tier: 'service' | 'tool' | 'web';
  readonly parentToken: string;
  storage: Map<string, Readonly<Record<string, unknown>>>;
  llmScript: ScriptedLlmResponse[];       // FIFO
  callIndex: number;                      // monotonic
  currentDelegationDepth: number;         // starts 0
  tokenToDepth: Map<string, number>;      // `ext-token-d{N}` → N
  subscribers: Set<(call: RecordedCtxCall) => void>;  // plugin hook
}
```

### 7.2 Facade behaviour (exhaustive)

| Facade | Method | Behaviour | Recorded args |
|---|---|---|---|
| `app` | (readonly fields) | `{ id: state.appId, tier: state.tier }` | — |
| `llm` | `complete(req)` | Pop next `llmScript` entry; fire `handlers.*` if `simulateBudget` set; stamp `handlersRegistered: true` on the recorded call iff `req._handlers` metadata present; return `CompletionResult`. If script empty: throw `ConformanceRunError('INVALID_FIXTURE')`. | `{ tier, prompt, handlersRegistered, toolsRequested }` |
| `audit` | `event(e)` | Append `{ kind, actor?, subject?, payload? }` to recorder; return resolved void. Never rejects. | `{ kind, actor?, subject?, payload? }` |
| `events` | `publish(topic, payload)` | Record; return resolved void. | `{ topic, payload }` |
| `storage` | `get/put/delete` | Back onto `state.storage` Map with structurally cloned values. | `{ key, value? }` |
| `jobs` | `enqueue(job)` | Record; return `{ jobId: 'mock-job-' + at }`. | `{ kind, payload, runAfterMs? }` |
| `schedule` | `register(cron, handler)` | Record; return `{ scheduleId: 'mock-sched-' + at }`. | `{ cron, handler }` |
| `auth` | `exchangeForAgent(parent, scope)` | Look up parent's depth via `tokenToDepth.get(parent) ?? 0`; compute new depth = parent + 1; mint new synthetic token `ext-token-d{newDepth}`; store mapping; stamp `delegationDepth: newDepth` on recorded call; return `{ token, expiresAt: now + 3600_000 }`. | `{ parentToken, scope }` |
| `log` | `info/warn/error` | Record; no-op in console. | `{ level, msg, fields? }` |

### 7.3 Call recorder entry

Per S8 §5.2:

```typescript
interface RecordedCtxCall {
  readonly at: number;                      // monotonic
  readonly wallTimeMs: number;              // Date.now()
  readonly facade: keyof CortexCtx;
  readonly method: string;
  readonly args: Readonly<Record<string, unknown>>;   // structuredClone
  readonly result?: Readonly<Record<string, unknown>>;
  readonly error?: { readonly name: string; readonly message: string };
  readonly delegationDepth: number;         // current at time of call
}
```

`CallRecorder.where(facade)`, `.count(pred)`, `.firstIndexOf(pred)` are
pure functions over `calls: ReadonlyArray<RecordedCtxCall>`.

### 7.4 Factory

```typescript
export function createMockCortexCtx(opts: {
  readonly appId: string;
  readonly tier?: 'service' | 'tool' | 'web';
  readonly parentToken?: string;
}): MockCortexCtx;
```

`reset()` clears recorder + storage Map + llmScript without creating a
new instance (so plugin hooks survive between fixture runs if the
runner reuses the ctx — it doesn't by default, but the contract
supports it).

---

## 8. Fixture Catalog — Three v1 Canonical Pacts

### 8.1 `incidentTriageFixture`

- **Mode:** `oneshot`.
- **Pact shape:** `requires.llm`, `scope.allowedTools: ['Grep','Read','Slack']`,
  `budget: { maxCostUsd: 0.05, maxTurns: 4 }`, reasoning `effort: 'low'`.
- **Scripted LLM:** 2 turns. Turn 1 tool-use (`Grep`) → turn 2 final
  text summary. Total cost $0.04, no budget simulation events.
- **Exercises:** budget-handler registration (C2), audit minimum (C3),
  scope respect (C5), one-shot terminal (no-resume variant of C6 —
  vacuous pass).
- **Expectations:** `minAuditEvents: 3`; `requiredAuditKinds:
  ['method.agent.started', 'method.agent.turn_complete', 'method.agent.completed']`;
  `expectsDelegation: false`; `expectsScopeCheck: true`;
  `expectsResume: false`.

### 8.2 `featureDevCommissionFixture`

- **Mode:** `resumable`.
- **Pact shape:** `requires.llm + storage + jobs`, subagent delegation
  via `subagentDelegator` middleware (depth-2 commission), `budget:
  { maxCostUsd: 2.00, maxTurns: 40 }`, reasoning `effort: 'high'`.
- **Scripted LLM:** 6 turns — first 3 in segment A (script emits a
  `suspend` signal on turn 3), last 3 in segment B after `agent.resume`.
  One turn delegates to a depth-2 subagent.
- **Exercises:** all six checks. Primary vehicle for C4 (delegation)
  and C6 (resume roundtrip).
- **Expectations:** `minAuditEvents: 8` (started, ≥5 turn_complete,
  ≥1 suspend, completed); `requiredAuditKinds: ['method.agent.started',
  'method.agent.turn_complete', 'method.agent.suspended',
  'method.agent.resumed', 'method.agent.completed']`;
  `expectsDelegation: true`; `expectsScopeCheck: false`;
  `expectsResume: true`.

### 8.3 `dailyReportFixture`

- **Mode:** `oneshot`.
- **Pact shape:** `requires.llm + events + schedule`, **no tools** (pure
  LLM summarization), `budget: { maxCostUsd: 0.20, maxTurns: 2 }`,
  reasoning `effort: 'medium'`.
- **Scripted LLM:** 2 turns; second turn emits a summary that the app
  is expected to publish via `ctx.events.publish('daily-report', ...)`.
- **Exercises:** events publish, schedule registration (through the
  app's startup path), audit minimum, pure-LLM no-tools variant of C5
  (vacuous pass — no tool calls to be out of scope).
- **Expectations:** `minAuditEvents: 3`; `requiredAuditKinds:
  ['method.agent.started', 'method.agent.turn_complete',
  'method.agent.completed']`; `expectsDelegation: false`;
  `expectsScopeCheck: false`; `expectsResume: false`. Additional
  cross-cutting expectation (captured by S6 plugin when it lands, not
  by v1): `recorder.where('events').length >= 1`.

### 8.4 `DEFAULT_FIXTURES`

```typescript
export const DEFAULT_FIXTURES: ReadonlyArray<ConformanceFixture> = [
  incidentTriageFixture,
  featureDevCommissionFixture,
  dailyReportFixture,
];
```

---

## 9. `ComplianceReport.json` Schema (fully spec'd per S8 §5.4)

Wire format: **JSON**, UTF-8. Produced by `compliance-report.ts`.
Every field below is mandatory unless marked optional.

```typescript
interface ComplianceReport {
  schemaVersion: '1.0';
  generatedAt: string;                      // ISO-8601
  app: {
    id: string;
    version?: string;                       // from app package.json if readable
    pactaTestkitVersion: string;            // this package's version
  };
  passed: boolean;
  summary: string;                          // one-liner; human-readable
  fixtureRuns: Array<{
    fixtureId: 'incident-triage' | 'feature-dev-commission' | 'daily-report' | `custom:${string}`;
    passed: boolean;
    durationMs: number;
    callCounts: {
      audit: number;
      llm: number;
      storage: number;
      jobs: number;
      events: number;
      auth: number;
    };
    maxDelegationDepth: number;
    failedCheckIds: string[];
    recorderSnapshot?: RecordedCtxCall[];   // present iff opts.verbose
  }>;
  plugins: Array<{
    id: string;                             // 's1-method-agent-port', 's3-service-adapters', …
    version: string;                        // plugin semver
    passed: boolean;
    checks: Array<{
      id: string;                           // 'S1-C1-invokes-via-createMethodAgent', …
      description: string;
      passed: boolean;
      fixtureId: FixtureId;
      evidence?: string;                    // failure-only, short
    }>;
  }>;
  requiredPlugins: string[];                // default ['s1-method-agent-port', 's3-service-adapters']
  env: {
    nodeVersion: string;                    // process.version
    os: string;                             // `${platform}-${arch}`
    ci: boolean;                            // detected from env CI/GITHUB_ACTIONS/…
    commitSha?: string;                     // git rev-parse HEAD if available
  };
  signature?: {
    algorithm: 'ed25519' | 'ecdsa-p256';
    value: string;                          // base64
    keyId?: string;                         // kid for rotation
  };
}
```

### 9.1 Canonicalization (for signing)

Before signing, the report is serialized with:

- Fields sorted lexicographically at every object level.
- No extraneous whitespace (RFC 8785-style JCS-lite — simple JSON
  canonicalization).
- The `signature` field is **excluded** from the bytes presented to
  the signer; the signer signs the canonicalized representation of
  the report **without** `signature`, and `signature` is inserted
  after.

The runner exposes `canonicalizeReport(report: ComplianceReport):
Uint8Array` for symmetry with Cortex-side verification.

### 9.2 Evolution

Per S8 §5.4 evolution table (unchanged). Adding optional fields stays
at `schemaVersion: '1.0'`; adding required fields bumps to `1.1`;
renaming/removing bumps to `2.0`.

---

## 10. Plugin Interface (`ConformancePlugin`)

Verbatim from S8 §5.5, restated here so implementers can code against
one document:

```typescript
export interface ConformancePlugin {
  readonly id: string;                      // unique, stable
  readonly version: string;                 // semver
  readonly description: string;
  readonly requiresFixtures?: ReadonlyArray<FixtureId> | '*';   // default '*'
  readonly required: boolean;               // if true, a failed check fails the whole report
  run(input: PluginRunInput): Promise<ReadonlyArray<CheckVerdict>>;
}

export interface PluginRunInput {
  readonly fixture: ConformanceFixture;
  readonly fixtureRun: Omit<FixtureRunResult, 'failedCheckIds' | 'passed'>;
  readonly ctx: MockCortexCtx;
  readonly recorder: CallRecorder;
  readonly agentResult?: MethodAgentResult<unknown>;
  readonly invocationError?: Error;
}
```

### 10.1 Built-in plugins

- **`s1MethodAgentPortPlugin`** (`s1-method-agent-port`, `required: true`,
  `requiresFixtures: '*'`). Implements checks C1–C6 from S8 §6.
- **`s3ServiceAdaptersPlugin`** (`s3-service-adapters`, `required: true`,
  `requiresFixtures: '*'`). Asserts the adapter invariants from S3: every
  LLM call routed through `ctx.llm` (not a bypassing provider), token
  exchange invoked iff `pact.requires.auth`, audit emitter present for
  every `AgentEvent`.

### 10.2 Required-plugin enforcement

In the runner (not in the plugin):

```typescript
const DEFAULT_REQUIRED = ['s1-method-agent-port', 's3-service-adapters'] as const;
function validatePluginList(plugins: ReadonlyArray<ConformancePlugin>): void {
  const ids = new Set(plugins.map(p => p.id));
  const missing = DEFAULT_REQUIRED.filter(r => !ids.has(r));
  if (missing.length > 0) {
    throw new ConformanceRunError('INVALID_FIXTURE', {
      detail: `required plugins missing: ${missing.join(', ')}`,
    });
  }
  for (const p of plugins) {
    if (DEFAULT_REQUIRED.includes(p.id as any) && p.required === false) {
      throw new ConformanceRunError('INVALID_FIXTURE', {
        detail: `plugin "${p.id}" must remain required; cannot override`,
      });
    }
  }
}
```

### 10.3 Future plugin planning (informational)

Per S8 §9 — `s4-session-store` (PRD-061), `s5-job-executor` (PRD-062),
`s6-event-connector` (PRD-063), `s7-methodology-source` (PRD-064). All
ship as **optional** plugins whose `required` flag flips to true only
when the app manifest declares the corresponding capability
(enforced in Cortex's `requiredPlugins` reconciliation, not here).

---

## 11. Signature Mechanism

### 11.1 Default algorithm

**Ed25519**, detached signature over the canonicalized report bytes
(see §9.1). Chosen for:

- Deterministic signatures (no RNG required at sign time).
- 64-byte signatures — small artifact footprint.
- Available in Node `node:crypto` natively (Node ≥ 16), no external
  dependency.
- Already the preferred algorithm across the method ecosystem
  (registry signing, strategy signing).

### 11.2 Signer contract

```typescript
export type Signer = (canonicalBytes: Uint8Array) => Promise<string>;
// Returns base64-encoded signature. Runner wraps into { algorithm, value, keyId? }.
```

The caller is responsible for:
- Loading the signing key (from `op`, env var, KMS, HSM, file, etc.).
- Producing the base64 signature.
- Optionally providing `keyId` for rotation (recommended).

### 11.3 `keyId` source

Three conventions, none enforced by the runner (runner accepts any
string). Documented in the README:

1. **1Password reference:** `op://vault/item/kid` — resolved by the
   caller via `op run`.
2. **Environment variable:** `METHOD_CONFORMANCE_KEY_ID`.
3. **Inline:** a constant string committed to the tenant app's CI
   config (acceptable for non-rotating keys).

### 11.4 Convenience helper (non-required)

The testkit ships `createEd25519Signer(privateKeyPem: string, keyId?: string)`
as a one-liner for callers that have a PEM key on disk. It is a
convenience; callers may pass their own `signer` function and ignore
this helper entirely.

### 11.5 Verification

The runner does **not** verify signatures (out of scope, §12). Cortex
verifies on ingest using a registered public key per app. A separate
utility `verifyComplianceReport(report, publicKey): Promise<boolean>`
may ship later — not in this PRD.

---

## 12. Acceptance Gates

A wave is "done" when every gate below is green.

### 12.1 Wave 0 — Surfaces (already satisfied)

- S1 frozen ✓
- S3 frozen ✓
- S8 frozen ✓
- `.method/sessions/fcd-surface-conformance-testkit/decision.md` exists

No new surface co-design required — this PRD consumes the frozen
contracts.

### 12.2 Wave 1 — Implementation (this PRD)

| Gate | Check | Where |
|---|---|---|
| **G-BOUNDARY** | no value imports from `@methodts/agent-runtime` in `src/conformance/` | `__tests__/gates.test.ts` |
| **G-PORT** | public exports match frozen S8 §5 symbol set | `__tests__/gates.test.ts` |
| **G-LAYER** | no imports from `@methodts/bridge` or higher layers | `__tests__/gates.test.ts` |
| **G-SCHEMA** | runner output parses under `ComplianceReport` interface; `schemaVersion === '1.0'` | `__tests__/gates.test.ts` |
| **G-REQUIRED-PLUGINS** | runner rejects plugin list missing S1 or S3 | `__tests__/runner.test.ts` |
| **G-SIGNATURE-ROUNDTRIP** | when `signer` provided, `report.signature.algorithm` set; when absent, field absent | `__tests__/compliance-report.test.ts` |
| **G-FIXTURE-INTEGRITY** | each of the 3 fixtures has valid Pact, non-empty script, well-formed expectations | `__tests__/fixtures.test.ts` |

### 12.3 Wave 2 — Integration (this PRD — optional in v1 if sample not ready)

- **I-SAMPLE:** `samples/cortex-incident-triage-agent/test/conformance.test.ts`
  runs green. If the sample app doesn't exist yet at PRD merge time,
  ship a **stub sample app** (`packages/pacta-testkit/test-fixtures/sample-app.ts`)
  that passes all three fixtures. The real sample lands with PRD-058
  finalization.
- **I-CORTEX-READER:** a schema-validator test mirroring Cortex's
  ingest shape consumes the produced JSON without modification.

---

## 13. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Required-plugin tightening = major bump.** Adding a new S-plugin to `DEFAULT_REQUIRED` breaks every existing tenant report. | Medium (one per new S-surface) | High (forces tenant apps to rebuild CI) | **Policy:** new plugins always ship as `required: false` first; Cortex flips via its own `requiredPlugins` manifest; only after a deprecation window does the plugin flip to `required: true` in the testkit. Documented in S8 §10 and this PRD §10.3. |
| **Mock drift from real Cortex.** `MockCortexCtx` is a structural subset of `CortexCtx`; if Cortex's real `ctx.llm.complete` shape diverges, apps that pass conformance may fail in production. | High over 12+ months | Medium (caught in staging, not prod — but embarrassing) | (a) `CortexCtx` is a **type-only** peer import; TS compilation catches structural drift at testkit build time. (b) Cortex team owns the `CortexCtx` shape; method tracks via the S1 co-design record. (c) Wave 2 external verification (Cortex re-runs the suite) provides the ultimate mitigation. (d) Add a small integration test in method's CI that imports the `@cortex/sdk` types directly to catch drift at PR time. |
| **Unsigned reports leaking to production.** A tenant app forgets `opts.signer`; Cortex's production posture must reject — is it obviously wrong locally? | Low-medium | Low (Cortex rejects, but delays certification) | Emit a loud warning to `opts.ctx.log?.warn` (via the mock's log facade, then echo to stderr) when `signer` is absent AND `env.ci === true`. Document prominently in the README. |
| **Schema drift between `ComplianceReport` TS interface and canonicalization.** Field renames that bypass the schema table. | Low | High | `G-SCHEMA` gate + automated canonicalization golden file committed to the repo. Any TS change that alters the canonical output breaks the golden. |
| **Fixture over-constrains real apps.** A canonical fixture bakes in an implementation detail no Cortex agent should be required to match. | Medium | Medium | Every fixture's `minimumExpectations` uses **subset** matching for audit kinds. Required audit kinds are the S1 C3 minimum only. Tenant apps may emit more; that's always valid. |
| **Subpath exports not resolved in older Node/bundlers.** `package.json#exports` has sharp edges on Node < 16.17. | Low | Medium | Engines field pins `node >= 18`. CI matrix includes Node 18 and Node 20. |
| **Peer-dep optional confusion.** Non-conformance users of the testkit don't need `@methodts/agent-runtime`; warning from npm could alarm them. | Low | Low | `peerDependenciesMeta.optional = true` + README note. Runtime error (`ConformanceRunError('MISSING_APP')`) is friendly. |

---

## 14. Phase Plan

### Wave 0 — Surfaces (DONE — frozen upstream)

- S1 `MethodAgentPort` frozen
- S3 `CortexServiceAdapters` frozen
- S8 `CortexAgentConformance` frozen

Nothing to do in this PRD for Wave 0.

### Wave 1 — Implementation (this PRD)

Single wave, single package. Parallelization is limited to file-level.

1. **Scaffold** — create `src/conformance/` directory, `package.json`
   edits, `index.ts` skeleton. Build green with empty exports.
2. **`MockCortexCtx`** — implement + tests (`mock-cortex-ctx.test.ts`).
3. **`ComplianceReport` schema + canonicalization + signer plumbing** —
   implement + tests (`compliance-report.test.ts`).
4. **Plugin interface + S1/S3 built-in plugins** — implement + tests
   (`plugin-s1.test.ts`, `plugin-s3.test.ts`). Checks C1–C6.
5. **Three fixtures** — `incident-triage`, `feature-dev-commission`,
   `daily-report`. Tests (`fixtures.test.ts`).
6. **`runCortexAgentConformance`** — the runner that ties it all
   together. Tests (`runner.test.ts`) including negative cases.
7. **Gate tests** — `gates.test.ts` passes all gates from §12.2.
8. **Stub sample app** at `packages/pacta-testkit/test-fixtures/sample-app.ts`
   that exercises the full suite end-to-end.
9. **README update** — usage section, signer recipes, CI snippet.

### Wave 2 — Integration (follow-on, may ship with PRD-058)

- Replace stub sample with real `samples/cortex-incident-triage-agent/`.
- Cortex-side ingest-verification fixture added to method CI.

### Deferred (not this PRD)

- S4/S5/S6/S7 plugins (land with 061/062/063/064).
- Platform-side sandbox re-run (Wave 2 of S8, owned by Cortex).
- `verifyComplianceReport` utility.

---

## 15. Open Questions

All S8 open questions were resolved at freeze (Q1–Q12 in S8 §12). No
new open questions raised by this PRD. The sole operational decision
is the **stub-vs-real sample app** timing (§14 Wave 2) — tracked in the
implementation plan, not a design question.

---

## 16. Agreement

**Design freeze:** 2026-04-14.
**Owner:** `@methodts/pacta-testkit` maintainers.
**Size:** S.
**Unblocks:** `certified: boolean` flag for Cortex tenant apps,
`samples/cortex-incident-triage-agent/` CI gate, roadmap B8 closeout.
**Surface Advocate review:** required before `/fcd-plan` → `/fcd-commission`
per FCD Rule 3, since this PRD implements S8 directly.
