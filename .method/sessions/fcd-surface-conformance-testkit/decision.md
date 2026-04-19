---
type: co-design-record
surface: "CortexAgentConformance (S8)"
slug: "conformance-testkit"
date: "2026-04-14"
owner: "@methodts/pacta-testkit (conformance/ subpath extension)"
producer: "@methodts/pacta-testkit — conformance extension package (L3)"
consumer: "Cortex tenant apps (category: agent) running in their own CI"
direction: "producer → consumer (import assertion suite + MockCortexCtx); consumer → Cortex platform (upload compliance-report artifact)"
status: frozen
mode: "extension"
prd: "065 — Pacta conformance testkit for Cortex tenant apps"
related:
  - docs/roadmap-cortex-consumption.md §5 Group B item B8, §6 PRD-065
  - .method/sessions/fcd-surface-method-agent-port/decision.md (S1 — the surface under test)
  - .method/sessions/fcd-surface-cortex-service-adapters/decision.md (S3 — adapters tenant apps compose)
  - .method/sessions/fcd-surface-session-store/decision.md (S4 — resume contract)
  - .method/sessions/fcd-surface-job-backed-executor/decision.md (S5 — executor contract)
  - .method/sessions/fcd-surface-event-connector/decision.md (S6 — event connector)
  - t1-cortex-1 RFC-005 §12 (surface co-design discipline — general model)
  - packages/pacta-testkit/src/index.ts (existing testkit surface — this extends it)
  - packages/pacta-testkit/src/assertions.ts (existing assertion shape to mirror)
blocks: "PRD-065 implementation, Cortex tenant-app certification gate, sample app CI (samples/cortex-incident-triage-agent/), B8 roadmap closeout"
supersedes: "—"
---

# Co-Design Record — CortexAgentConformance (S8)

> *The assertion suite any Cortex-targeted agent tenant app runs in its own
> CI to claim compliance with `MethodAgentPort`. The testkit IS the
> conformance contract: if the suite passes, the app is certified; if a
> conformance check gets added later, existing apps either pass or
> explicitly waive. No silent drift.*
>
> **Position in the S-series:** S1 defines what a method agent IS
> (`MethodAgentPort`). S3 defines how adapters hook into Cortex. S4–S6
> define persistence / jobs / events. **S8 defines how we PROVE a tenant
> app satisfies all of the above.** The testkit is to Cortex agents what
> the standard library conformance suite is to a compiler: the boundary
> between "a thing that compiles" and "a thing we certify."

---

## 0. Scope

This surface freezes:

1. **`CortexAgentConformance` entry point** — one function a tenant app
   calls from its CI to run the whole suite against its own app module.
2. **`MockCortexCtx`** — the reference `ctx` impl the suite installs
   during conformance runs. Records every call; the suite reads the log
   to assert invariants.
3. **Fixture pact catalog** — three canonical pacts (incident-triage,
   feature-dev-commission, daily-report) that every tenant app must pass
   under the suite, plus an open-ended "custom pact" path.
4. **`ComplianceReport` schema** — the JSON artifact uploaded to
   Cortex after a successful run. Cortex reads this to issue/revoke
   the app's `agent` category certification.
5. **Plugin model** — how future surfaces (S4 session-store, S5
   job-executor, S6 event-connector, S7 methodology-source, S9 TBD)
   extend the conformance suite without modifying the core.

**Out of scope:**
- Runtime enforcement in Cortex (the platform trusts the signed report;
  it does not re-run the suite). That's a Cortex-side policy decision
  deferred to RFC-005 §12 Wave 2.
- Load / performance testing. Conformance is functional + structural.
  Performance gates live in a sibling suite (not designed here).
- Security penetration testing. Token-exchange depth is checked
  structurally (the agent DOES call `ctx.auth.exchangeForAgent` with
  `depth ≤ 2`), not adversarially (attempting to reach depth 3 through
  a crafted pact).

---

## 1. The Core Problem This Surface Solves

Every Cortex tenant app of `category: agent` declares in its manifest:

```yaml
category: agent
consumes:
  - "@methodts/agent-runtime"
```

Cortex needs a mechanical way to answer: *does this app actually satisfy
`MethodAgentPort`, or is it just claiming to?* Six things must hold:

1. **Port entry** — the app creates agents via `createMethodAgent`, not
   by instantiating `@methodts/pacta` directly. (G-BOUNDARY-ENTRY.)
2. **Budget handlers** — if any pact declares `requires.llm`, the app
   registers all three `LlmBudgetHandlers` (warning / critical / exceeded).
   PRD-068 §5.4.
3. **Audit event minimum** — every invocation emits at least the minimum
   audit event set: `started`, `turn_complete` (≥ 1), `completed` OR a
   terminal `error` / `budget_exhausted`. No silent completions.
4. **Token-exchange depth** — the app, when given a pact with a
   subagent step, performs exchange at depth 2 and never at depth 3.
   RFC-005 §4.1.5.
5. **Scope respect** — when `pact.scope.allowedTools` is set, the
   recorded tool calls are a subset of that list. No unauthorized tools.
6. **Checkpoint + resume** — if any pact declares `resumable`, the app
   can suspend mid-invocation, serialize a `Resumption`, and re-enter
   via `agent.resume(resumption)` with equivalent terminal state.

The existing `@methodts/pacta-testkit` already has `RecordingProvider`,
`MockToolProvider`, builders, and assertions. It tests pacta agents.
This surface extends it to test **Cortex-composed** pacta agents — i.e.,
`createMethodAgent`-produced agents against a mock `ctx`.

---

## 2. Why This is an Extension, Not a New Package

`@methodts/pacta-testkit` already exports:

- `RecordingProvider`, `MockToolProvider`
- `pactBuilder()`, `agentRequestBuilder()`
- `assertToolsCalled`, `assertBudgetUnder`, `assertOutputMatches`
- Cognitive helpers (`RecordingModule`, `assertModuleStepCalled`, etc.)

Splitting conformance into a separate package would:
- Duplicate the recording infrastructure
- Force tenant apps to depend on two testkits
- Fragment the assertion vocabulary

Instead, S8 adds a `conformance/` subpath to the existing package:

```
packages/pacta-testkit/
  src/
    index.ts                      (existing — re-exports Recording*, assertions)
    conformance/
      index.ts                    (NEW — conformance surface entry)
      mock-cortex-ctx.ts          (NEW — MockCortexCtx + CallRecorder)
      conformance-runner.ts       (NEW — runCortexAgentConformance)
      compliance-report.ts        (NEW — ComplianceReport schema + writer)
      fixtures/                   (NEW — canonical fixture pacts)
        incident-triage.ts
        feature-dev-commission.ts
        daily-report.ts
        index.ts
      plugins/                    (NEW — plugin registry + built-ins)
        plugin.ts                 (NEW — ConformancePlugin interface)
        s1-method-agent-port.ts   (built-in, required)
        s3-service-adapters.ts    (built-in, required)
      assertions-cortex.ts        (NEW — Cortex-specific assertion helpers)
```

The `conformance/` subpath is exported via `package.json#exports`:

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./conformance": "./dist/conformance/index.js",
    "./conformance/fixtures": "./dist/conformance/fixtures/index.js"
  }
}
```

Consumers import `from '@methodts/pacta-testkit/conformance'` — the
existing `from '@methodts/pacta-testkit'` surface is untouched.

---

## 3. Scope — What Flows

| Thing | Direction | Frequency | Cardinality |
|---|---|---|---|
| `runCortexAgentConformance(opts)` invocation | consumer → testkit | once per CI run | 1:1 |
| `ConformanceOptions` (app entry, pact overrides, plugins) | consumer → testkit | per run | 1:1 |
| `MockCortexCtx` instance | testkit → tenant-app composition root | per fixture run | 1:N per run |
| Recorded `ctx.*` call log | tenant app → testkit (via mock recorder) | per invocation | many:1 |
| `ConformanceResult` (per-check verdict + evidence) | testkit → consumer | per run | 1:1 |
| `ComplianceReport` artifact JSON | testkit → filesystem → Cortex platform | per run (on success) | 1:1 |
| `ConformancePlugin` registration | plugin module → runner | compose-time | N:1 |

---

## 4. Ownership

**Owner:** `@methodts/pacta-testkit` (producer of the `conformance/`
subpath). Same package, same versioning as the core testkit so that
canonical fixtures and the main assertion vocabulary stay in lockstep.
When pacta adds an `AgentEvent` variant, the same PR updates fixtures.

**Consumer:** Cortex tenant apps of `category: agent`. Run the suite
from their CI (`npm test -- conformance`). The generated
`ComplianceReport.json` is uploaded as a Cortex release artifact.

**Cortex platform:** consumes the report passively. Does not call the
testkit; reads the report's schema version and checksums, verifies
signatures, flips the app's `certified: boolean` flag.

Neither side may extend unilaterally. New conformance checks land as
**plugins** (see §9) which both sides adopt simultaneously via a
versioned `requiredPlugins` manifest.

---

## 5. Interface — TypeScript

**File (planned):** `packages/pacta-testkit/src/conformance/index.ts`

### 5.1 Entry point — `runCortexAgentConformance`

```typescript
/**
 * The single entry point a Cortex tenant app calls from CI.
 *
 * Typical usage in the app's own test file (samples/cortex-incident-triage-agent/test/conformance.test.ts):
 *
 *   import { describe, it } from 'vitest';
 *   import { runCortexAgentConformance } from '@methodts/pacta-testkit/conformance';
 *   import app from '../src/agent.js';  // default export receives ctx
 *
 *   describe('Cortex agent conformance', () => {
 *     it('meets MethodAgentPort contract', async () => {
 *       const report = await runCortexAgentConformance({
 *         app,
 *         appId: 'incident-triage',
 *         outputPath: './compliance-report.json',
 *       });
 *       if (!report.passed) throw new Error(report.summary);
 *     });
 *   });
 *
 * The function:
 *   1. For each fixture pact in opts.fixtures (default: the full catalog),
 *      instantiates a fresh MockCortexCtx + RecordingProvider,
 *      invokes the app handler through the mock ctx,
 *      captures the CallRecorder log.
 *   2. Runs every enabled ConformancePlugin against (app, ctx, recorder, result).
 *   3. Aggregates verdicts into a ComplianceReport, writes to opts.outputPath.
 *   4. Returns the report (with passed: boolean and per-check evidence).
 *
 * Never throws on failed checks — failure becomes report.passed=false.
 * Throws ConformanceRunError only on infrastructural faults
 * (missing app export, invalid config, plugin crash).
 */
export function runCortexAgentConformance(
  opts: ConformanceOptions,
): Promise<ComplianceReport>;

export interface ConformanceOptions {
  /**
   * The tenant app's default export — a function matching the Cortex
   * app handler signature: (ctx) => unknown | Promise<unknown>.
   * The conformance runner calls this exactly as Cortex would.
   */
  readonly app: (ctx: CortexCtx) => unknown | Promise<unknown>;

  /** The Cortex app id to stamp into ctx.app.id for each fixture run. */
  readonly appId: string;

  /**
   * Where to write the ComplianceReport JSON. Relative paths resolve
   * against process.cwd(). Default: './compliance-report.json'.
   */
  readonly outputPath?: string;

  /**
   * Override the fixture catalog. Default: all three canonical fixtures
   * (incident-triage, feature-dev-commission, daily-report).
   * Setting to [] means "run no fixtures" — only useful for testing the
   * conformance suite itself; produces a report with passed=false.
   */
  readonly fixtures?: ReadonlyArray<ConformanceFixture>;

  /**
   * Plugin list. Defaults to the built-in required plugins (S1, S3).
   * Adding S4/S5/S6 plugins is the extensibility path — see §9.
   *
   * Ordering is significant: plugins run in order; a later plugin sees
   * the results of earlier ones (but cannot mutate them).
   */
  readonly plugins?: ReadonlyArray<ConformancePlugin>;

  /**
   * Optional signer for the compliance report. If absent, the report
   * is written unsigned (Cortex rejects unsigned reports in production).
   * The signer receives the canonicalized report bytes; returns a
   * detached signature string (base64).
   */
  readonly signer?: (canonicalBytes: Uint8Array) => Promise<string>;

  /**
   * If true, include full call logs in the report (large). Default: false —
   * only summary counts + failed-check evidence are included.
   */
  readonly verbose?: boolean;
}

/** Infrastructure fault only. Check failures are report fields, not throws. */
export class ConformanceRunError extends Error {
  readonly code:
    | 'MISSING_APP'
    | 'INVALID_FIXTURE'
    | 'PLUGIN_CRASH'
    | 'IO_ERROR';
  readonly cause?: unknown;
}
```

### 5.2 `MockCortexCtx` + call recorder

```typescript
/**
 * Structural implementation of CortexCtx (from S1) that records every
 * facade call. The conformance suite installs this as the ctx passed to
 * the tenant app's handler; plugins read the recorder log to assert
 * invariants.
 *
 * Each facade's implementation is a small deterministic function
 * (deterministic so tests are reproducible):
 *   - ctx.llm.complete → returns canned CompletionResult from the fixture
 *     pact's scripted responses (RecordingProvider semantics).
 *   - ctx.audit.event → records; never rejects.
 *   - ctx.storage.get/put/delete → backed by an in-memory Map.
 *   - ctx.jobs.enqueue → records; returns a synthetic jobId.
 *   - ctx.auth.exchangeForAgent → returns a synthetic token; records the
 *     parent token to allow depth tracing.
 *   - ctx.events.publish → records.
 *   - ctx.schedule.register → records; returns synthetic scheduleId.
 *   - ctx.log.info/warn/error → records.
 */
export interface MockCortexCtx extends CortexCtx {
  readonly recorder: CallRecorder;

  /** Reset the recorder + in-memory storage between fixture runs. */
  reset(): void;

  /**
   * Programmatically inject a scripted completion response for the next
   * ctx.llm.complete call. Thin wrapper over RecordingProvider.
   */
  scriptLlmResponse(response: ScriptedLlmResponse): void;
}

export interface ScriptedLlmResponse {
  readonly text: string;
  readonly usage: TokenUsage;           // from @methodts/pacta
  readonly costUsd: number;
  readonly model?: string;              // default 'mock-claude-sonnet'
  readonly simulateBudget?:             // fires handlers if registered
    | { kind: 'none' }
    | { kind: 'warning'; percentUsed: number }
    | { kind: 'critical'; percentUsed: number }
    | { kind: 'exceeded'; percentUsed: 101 };
}

/**
 * Factory — the ONLY way to build a MockCortexCtx. Keeps construction
 * and plugin-extension hooks under our control.
 */
export function createMockCortexCtx(opts: {
  readonly appId: string;
  readonly tier?: 'service' | 'tool' | 'web';   // default 'service'
  readonly parentToken?: string;                 // default 'parent-token-0'
}): MockCortexCtx;

/**
 * Append-only log of every call the tenant app made through the mock ctx.
 * Facade names match CortexCtx field names — one call = one entry.
 * Plugins read this to assert invariants.
 */
export interface CallRecorder {
  readonly calls: ReadonlyArray<RecordedCtxCall>;

  /** Filter by facade — convenience for plugin authors. */
  where(facade: keyof CortexCtx): ReadonlyArray<RecordedCtxCall>;

  /** Count calls matching a predicate. */
  count(pred: (c: RecordedCtxCall) => boolean): number;

  /** Index of the first call matching a predicate, or -1. */
  firstIndexOf(pred: (c: RecordedCtxCall) => boolean): number;
}

export interface RecordedCtxCall {
  readonly at: number;                      // monotonic call index
  readonly wallTimeMs: number;              // Date.now() at call time
  readonly facade: keyof CortexCtx;         // 'llm' | 'audit' | ...
  readonly method: string;                  // 'complete' | 'event' | ...
  readonly args: Readonly<Record<string, unknown>>;  // structurally cloned
  readonly result?: Readonly<Record<string, unknown>>;  // undefined if void
  readonly error?: { readonly name: string; readonly message: string };
  readonly /** Depth-tracking — 0 at entry, +1 on exchangeForAgent */
    delegationDepth: number;
}
```

**Delegation-depth tracking detail:** `ctx.auth.exchangeForAgent` bumps a
counter stored on the recorder. Each exchange's returned "token" is a
tagged string (`ext-token-d1`, `ext-token-d2`) that, when re-presented
to the mock `ctx.auth.exchangeForAgent`, increments depth. Plugin S1
asserts `max(delegationDepth) ≤ 2`.

### 5.3 Fixture pacts — `ConformanceFixture`

```typescript
/**
 * A conformance fixture is a pact + a scripted provider recording + a
 * minimum assertion set that plugins run against the recorded execution.
 */
export interface ConformanceFixture {
  readonly id: FixtureId;
  readonly displayName: string;
  readonly pact: Pact<unknown>;                 // from @methodts/pacta
  readonly request: AgentRequest;               // the prompt the suite invokes with
  readonly script: ReadonlyArray<ScriptedResponse>;   // from RecordingProvider
  readonly scriptedLlm: ReadonlyArray<ScriptedLlmResponse>;  // mock-ctx.llm responses
  readonly minimumExpectations: FixtureExpectations;
}

export type FixtureId =
  | 'incident-triage'
  | 'feature-dev-commission'
  | 'daily-report'
  | `custom:${string}`;    // custom fixtures the tenant app ships

export interface FixtureExpectations {
  /** At least this many audit events must be emitted. Default 3 (started/turn_complete/completed). */
  readonly minAuditEvents: number;

  /** Exact list (ordered) of required audit event kinds. Subset match. */
  readonly requiredAuditKinds: ReadonlyArray<string>;

  /** Whether the fixture exercises token exchange (depth ≥ 1 must appear). */
  readonly expectsDelegation: boolean;

  /** Whether the fixture exercises scope enforcement (allowedTools is set). */
  readonly expectsScopeCheck: boolean;

  /** Whether the fixture exercises resume (pact.mode.type === 'resumable'). */
  readonly expectsResume: boolean;
}

/** Re-exported canonical fixtures. Each is a pure module — importable alone. */
export const incidentTriageFixture: ConformanceFixture;
export const featureDevCommissionFixture: ConformanceFixture;
export const dailyReportFixture: ConformanceFixture;

/** Aggregator — default `opts.fixtures` value. */
export const DEFAULT_FIXTURES: ReadonlyArray<ConformanceFixture>;
```

**Canonical fixture catalog (v1):**

| id | Pact shape | What it exercises |
|---|---|---|
| `incident-triage` | oneshot, `scope.allowedTools: ['Grep','Read','Slack']`, `requires.llm`, budget $0.05 | budget handlers, scope, audit minimum, one-shot no-resume |
| `feature-dev-commission` | resumable, subagent delegation depth 2, `requires.llm + storage + jobs`, budget $2.00 | resume + checkpoint, token exchange depth 2, storage, jobs, full audit |
| `daily-report` | oneshot, `requires.llm + events + schedule`, no tools (LLM-only summarization) | events publish, schedule registration, pure-LLM path |

Future fixtures (research-agent, code-review-agent) follow the same shape
and land via plugins (§9).

### 5.4 `ComplianceReport` schema

```typescript
/**
 * JSON artifact uploaded to Cortex. Wire format is stable — adding fields
 * is minor, narrowing/renaming is major. Cortex reads by schemaVersion.
 */
export interface ComplianceReport {
  /** Semver. Current: '1.0'. */
  readonly schemaVersion: '1.0';

  /** When the report was generated. ISO-8601. */
  readonly generatedAt: string;

  /** The app under test. */
  readonly app: {
    readonly id: string;
    readonly version?: string;            // from package.json of the app
    readonly pactaTestkitVersion: string; // version of this package
  };

  /** Overall verdict. true iff every required check passed on every fixture. */
  readonly passed: boolean;

  /** Human-readable one-liner. Included verbatim in Cortex admin UI. */
  readonly summary: string;

  /**
   * Per-fixture results. Each entry is one invocation of the app against
   * one fixture pact.
   */
  readonly fixtureRuns: ReadonlyArray<FixtureRunResult>;

  /**
   * Per-plugin verdicts aggregated across all fixtures.
   * plugins[i].id uniquely identifies the check.
   */
  readonly plugins: ReadonlyArray<PluginVerdict>;

  /**
   * Declared required plugin set for this report. Cortex rejects the
   * report if any plugin it expects is not in this list (or passed=false).
   * Defaults to ['s1-method-agent-port', 's3-service-adapters'].
   */
  readonly requiredPlugins: ReadonlyArray<string>;

  /**
   * Environment fingerprint. Lets Cortex detect stale reports.
   */
  readonly env: {
    readonly nodeVersion: string;
    readonly os: string;
    readonly ci: boolean;                 // detected from env
    readonly commitSha?: string;          // git HEAD at run time
  };

  /**
   * Detached signature. Absent when opts.signer not provided; Cortex
   * flags unsigned reports and refuses certification in production.
   */
  readonly signature?: {
    readonly algorithm: 'ed25519' | 'ecdsa-p256';
    readonly value: string;                // base64
    readonly keyId?: string;               // kid for rotation
  };
}

export interface FixtureRunResult {
  readonly fixtureId: FixtureId;
  readonly passed: boolean;
  readonly durationMs: number;
  readonly callCounts: {
    readonly audit: number;
    readonly llm: number;
    readonly storage: number;
    readonly jobs: number;
    readonly events: number;
    readonly auth: number;
  };
  readonly maxDelegationDepth: number;
  readonly failedCheckIds: ReadonlyArray<string>;
  /** Only present when opts.verbose === true. */
  readonly recorderSnapshot?: ReadonlyArray<RecordedCtxCall>;
}

export interface PluginVerdict {
  readonly id: string;                      // 's1-method-agent-port', etc.
  readonly version: string;                 // plugin's own semver
  readonly passed: boolean;
  readonly checks: ReadonlyArray<CheckVerdict>;
}

export interface CheckVerdict {
  readonly id: string;                      // stable check id, e.g., 'S1-C1-invokes-via-createMethodAgent'
  readonly description: string;
  readonly passed: boolean;
  readonly fixtureId: FixtureId;
  readonly evidence?: string;               // short explanation, failure-only
}
```

**Schema evolution rules (hard contract with Cortex):**

| Change | schemaVersion bump | Cortex posture |
|---|---|---|
| Add new optional field | none (still 1.0) | Ignores unknown fields |
| Add new plugin verdict | none | `requiredPlugins` acts as the versioning handle |
| Add new required field | `1.1` | Old Cortex rejects with "schema too new" — apps upgrade |
| Rename or remove field | `2.0` | Both sides update simultaneously |

### 5.5 Plugin model — `ConformancePlugin`

```typescript
/**
 * The extensibility point. Every future surface that needs conformance
 * (S4 session-store, S5 job-executor, S6 event-connector, S7 methodology,
 * S9+) adds a plugin. The core runner knows nothing about specific
 * surfaces — it only orchestrates plugins.
 *
 * Plugins run AFTER each fixture invocation, in the order the caller
 * declares. A plugin reads the recorded call log and the AgentResult,
 * produces a set of CheckVerdicts.
 */
export interface ConformancePlugin {
  /** Stable id. Appears in ComplianceReport.plugins[].id. */
  readonly id: string;

  /** Plugin semver. Reported to Cortex for compatibility checks. */
  readonly version: string;

  /**
   * Human description. Shown in CI output and in Cortex admin UI when
   * a plugin fails.
   */
  readonly description: string;

  /**
   * Fixtures this plugin requires. The runner skips plugin evaluation on
   * a fixture that isn't in this set (or runs all fixtures when '*').
   * Default: '*'.
   */
  readonly requiresFixtures?: ReadonlyArray<FixtureId> | '*';

  /**
   * Whether this plugin is required for certification. Required plugins
   * failing cause report.passed=false. Optional plugins failing cause
   * warnings only (report.passed stays true if required set passes).
   *
   * S1 and S3 plugins are required (core MethodAgentPort + adapter shape).
   * S4/S5/S6 plugins are required only if the tenant app declares the
   * corresponding capability in its manifest — the plugin self-checks.
   */
  readonly required: boolean;

  /**
   * Run the plugin's checks. Must not throw on failed checks — return
   * them as CheckVerdicts with passed=false. Throw only for
   * infrastructural faults (unexpected recorder shape, etc.).
   */
  run(input: PluginRunInput): Promise<ReadonlyArray<CheckVerdict>>;
}

export interface PluginRunInput {
  readonly fixture: ConformanceFixture;
  readonly fixtureRun: Omit<FixtureRunResult, 'failedCheckIds' | 'passed'>;
  readonly ctx: MockCortexCtx;              // for scripted-state introspection
  readonly recorder: CallRecorder;
  readonly agentResult?: MethodAgentResult<unknown>;  // from the invocation
  readonly invocationError?: Error;         // if the app threw
}

/** Built-in required plugins, exported for explicit composition. */
export const s1MethodAgentPortPlugin: ConformancePlugin;   // checks C1–C6 §6
export const s3ServiceAdaptersPlugin: ConformancePlugin;   // adapter shape checks

/**
 * Aggregator — default plugin list when opts.plugins not provided.
 * Equivalent to [s1MethodAgentPortPlugin, s3ServiceAdaptersPlugin].
 */
export const DEFAULT_PLUGINS: ReadonlyArray<ConformancePlugin>;
```

---

## 6. The Six Core Conformance Checks (S1 plugin)

`s1MethodAgentPortPlugin` ships these checks. Every tenant app must pass
all six on every applicable fixture.

| id | What it asserts | How (read from recorder / result) |
|---|---|---|
| `S1-C1-invokes-via-createMethodAgent` | The app produced a `MethodAgent` handle, not a raw pacta `Agent`. | `agentResult.appId` is set AND `agentResult.auditEventCount` is defined (both are MethodAgentResult-only fields). |
| `S1-C2-budget-handlers-registered` | When `fixture.pact.requires?.llm` (or equivalent), the app called the LLM through the mock with registered handlers. | `recorder.where('llm').every(c => c.args.handlersRegistered === true)` — the mock llm facade stamps this flag iff handlers were passed in. |
| `S1-C3-audit-minimum-set` | Required audit kinds (`method.agent.started`, ≥1 `turn_complete`, terminal `completed`/`error`/`budget_exhausted`) were emitted. | Check `recorder.where('audit')` against `fixture.minimumExpectations.requiredAuditKinds`. |
| `S1-C4-token-exchange-depth` | When `expectsDelegation`, max depth is exactly 2 — not 0, not 3+. | `max(recorder.where('auth').map(c => c.delegationDepth)) === 2`. |
| `S1-C5-scope-respect` | When `expectsScopeCheck`, every `llm.complete` call's toolset is a subset of `pact.scope.allowedTools`. | Inspect provider recording (tool_use events) against `fixture.pact.scope.allowedTools`. |
| `S1-C6-resume-roundtrip` | When `expectsResume`, the app can suspend, serialize a `Resumption`, and re-enter producing an equivalent terminal state. | Runner invokes once with `scriptedLlm` set to suspend partway, asserts `result.resumption` present; invokes again via `agent.resume(result.resumption)`; checks that the second terminal result has `resumption === undefined` and the combined audit log covers both segments. |

Each check emits a `CheckVerdict`. Failures include `evidence` explaining
what was expected vs. observed (e.g., "max delegation depth was 3, expected ≤ 2; violating call at index 7").

---

## 7. Self-Certification vs. External Verification

**Self-certification model (v1, frozen here):**

1. Tenant app runs the suite in its own CI.
2. Suite writes `compliance-report.json` to the app's workspace.
3. App's release pipeline uploads the report as a release artifact to
   Cortex via the existing `POST /v1/platform/apps/:id/releases` endpoint
   (which already accepts arbitrary signed artifacts).
4. Cortex reads the report:
   - Verifies `signature` against a trusted key registered per-app.
   - Checks `schemaVersion` compatibility.
   - Checks `passed === true`.
   - Checks `requiredPlugins` is a superset of Cortex's current
     platform-required set.
5. If all checks pass, Cortex flips `certified: true` on the app record
   and allows deployment as `category: agent`.

**External-verification (Wave 2, NOT in this surface):** Cortex itself
re-runs the suite in a sandbox before certification. The testkit entry
point is already callable from a non-CI context (the runner is pure), so
this mode requires no API change — only a Cortex-side harness.

**Why this split:**
- v1 makes the testkit the source of truth; Cortex trusts it. Fast.
- Wave 2 adds defense-in-depth once the surface is stable.
- No API change between modes — plugin and fixture catalogs are
  forward-compatible.

---

## 8. Producer / Consumer Mapping

### 8.1 Producer

- **Package:** `@methodts/pacta-testkit` (L3, existing) — `conformance/`
  subpath is new.
- **Entry file:** `packages/pacta-testkit/src/conformance/index.ts`
- **Runner:** `packages/pacta-testkit/src/conformance/conformance-runner.ts`
- **MockCortexCtx:** `packages/pacta-testkit/src/conformance/mock-cortex-ctx.ts`
- **Report schema + writer:** `packages/pacta-testkit/src/conformance/compliance-report.ts`
- **Fixtures:** `packages/pacta-testkit/src/conformance/fixtures/*.ts`
- **Built-in plugins:** `packages/pacta-testkit/src/conformance/plugins/*.ts`
- **Dependencies:** `@methodts/pacta` (types + `createAgent`),
  `@methodts/agent-runtime` (peer — needed for the `MethodAgentPort`
  type shape the mock implements). The peer dep is version-ranged; a
  mismatched agent-runtime throws `ConformanceRunError`.

### 8.2 Consumer

- **Package:** Cortex tenant app of `category: agent`. Reference
  implementation at `samples/cortex-incident-triage-agent/`.
- **Usage file (planned):**
  `samples/cortex-incident-triage-agent/test/conformance.test.ts`
- **CI wiring:** the tenant app's CI workflow runs the conformance test
  as part of `npm test`, then uploads `compliance-report.json` to Cortex
  on release.
- **Cortex platform (secondary consumer):** reads the uploaded report
  via `GET /v1/platform/apps/:id/releases/:id/artifacts/compliance-report.json`;
  certification logic lives in Cortex, not here.

### 8.3 Wiring sketch (for readers)

```typescript
// samples/cortex-incident-triage-agent/test/conformance.test.ts
import { describe, it } from 'vitest';
import { runCortexAgentConformance, incidentTriageFixture } from '@methodts/pacta-testkit/conformance';
import app from '../src/agent.js';

describe('Cortex agent conformance', () => {
  it('meets MethodAgentPort contract for incident-triage', async () => {
    const report = await runCortexAgentConformance({
      app,
      appId: 'incident-triage',
      fixtures: [incidentTriageFixture],   // single-fixture gate for quick feedback
      outputPath: './compliance-report.json',
      signer: await loadSignerFromCi(),
    });
    if (!report.passed) {
      throw new Error(`Conformance failed: ${report.summary}`);
    }
  });
});
```

---

## 9. Plugin Model — How Future Surfaces Extend the Suite

Each future surface lands as a plugin. The template is fixed:

```typescript
// packages/pacta-testkit/src/conformance/plugins/s4-session-store.ts
import type { ConformancePlugin, PluginRunInput, CheckVerdict } from '../plugin.js';

export const s4SessionStorePlugin: ConformancePlugin = {
  id: 's4-session-store',
  version: '1.0.0',
  description: 'Checkpoint + resume via ctx.storage — PRD-061',
  requiresFixtures: ['feature-dev-commission'],  // only when pact is resumable
  required: false,     // required only if app declares requires.storage
  async run(input: PluginRunInput): Promise<ReadonlyArray<CheckVerdict>> {
    // Read recorder for ctx.storage calls, assert invariants:
    //  - every put is paired with a later get on the same key (resume roundtrip)
    //  - no storage calls after agent.dispose()
    //  - namespace is a subpath of `agent/${appId}`
    return [/* CheckVerdicts */];
  },
};
```

Tenant apps register it in `opts.plugins`:

```typescript
import { DEFAULT_PLUGINS, s4SessionStorePlugin } from '@methodts/pacta-testkit/conformance';
// ...
plugins: [...DEFAULT_PLUGINS, s4SessionStorePlugin],
```

**Plugin planning map (informational — one plugin per frozen S-surface):**

| Plugin id | Surface | PRD | Required trigger |
|---|---|---|---|
| `s1-method-agent-port` | S1 MethodAgentPort | 060 | always |
| `s3-service-adapters` | S3 CortexServiceAdapters | 059 | always |
| `s4-session-store` | S4 CortexSessionStore | 061 | pact declares `resumable` or `requires.storage` |
| `s5-job-executor` | S5 JobBackedExecutor | 062 | pact declares `requires.jobs` |
| `s6-event-connector` | S6 CortexEventConnector | 063 | pact declares `requires.events` |
| `s7-methodology-source` | S7 CortexMethodologySource | 064 | app loads methodologies from ctx.storage |
| `s9-?` | reserved for future | — | — |

Cortex publishes a `requiredPlugins` list in its platform manifest; a
report missing a required plugin is rejected. This prevents silent drift
when new surfaces freeze — existing apps must adopt the new plugin
(or explicitly waive with `required: false` in their own config, which
also shows in the report).

---

## 10. Compatibility Guarantees (semver)

`@methodts/pacta-testkit` is semver-versioned as one unit (core + conformance).

| Change | Semver bump |
|---|---|
| Add new optional field to `ConformanceOptions` | minor |
| Add new built-in plugin to `DEFAULT_PLUGINS` | **major** (existing reports newly fail; apps must adopt or override) |
| Add new fixture to `DEFAULT_FIXTURES` | **major** (same reason) |
| Add optional `ConformancePlugin` exported for opt-in | minor |
| Add new check to an existing plugin, same id and plugin version | **major** |
| Add new check with new check id under existing plugin, new plugin version | minor (plugin version bumps; apps opt in by bumping peer) |
| Widen `ComplianceReport` with optional field | minor |
| Narrow / rename / remove `ComplianceReport` field | **major** + schemaVersion bump |
| Narrow `MockCortexCtx` shape (remove a facade) | **major** |
| Widen `MockCortexCtx` (add a facade) | minor |

`@methodts/agent-runtime` is a **peer dependency** of this package. The
testkit declares a range; a mismatched runtime produces
`ConformanceRunError('PLUGIN_CRASH')` with actionable detail.

---

## 11. Gate Assertions

Added to `packages/pacta-testkit/src/conformance/__tests__/gates.test.ts`
(new file, mirrors existing testkit test pattern).

```typescript
// G-BOUNDARY: conformance/ does NOT import from @methodts/agent-runtime at runtime
describe('G-BOUNDARY: conformance extension stays pacta-testkit-only for value imports', () => {
  it('no value import from @methodts/agent-runtime in conformance/', () => {
    const files = glob('packages/pacta-testkit/src/conformance/**/*.ts');
    const violations: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      const valueImports = [...content.matchAll(
        /^\s*import\s+(?!type\b)[^;]*from\s+['"]@method\/agent-runtime/gm
      )];
      if (valueImports.length > 0) violations.push(file);
    }
    assert.deepStrictEqual(violations, []);
  });
});

// G-PORT: the conformance subpath exports the frozen entry-point set
describe('G-PORT: conformance surface is stable', () => {
  it('exports expected symbols', async () => {
    const mod = await import('@methodts/pacta-testkit/conformance');
    const expected = [
      'runCortexAgentConformance',
      'createMockCortexCtx',
      'incidentTriageFixture', 'featureDevCommissionFixture', 'dailyReportFixture',
      'DEFAULT_FIXTURES', 'DEFAULT_PLUGINS',
      's1MethodAgentPortPlugin', 's3ServiceAdaptersPlugin',
      'ConformanceRunError',
    ];
    for (const name of expected) assert.ok(name in mod, `missing export: ${name}`);
  });
});

// G-LAYER: pacta-testkit remains L3 — no imports from @methodts/bridge
describe('G-LAYER: conformance does not reach to L4', () => {
  it('no bridge imports', () => {
    const violations = scanImports('packages/pacta-testkit/src/conformance', /^@method\/bridge/);
    assert.deepStrictEqual(violations, []);
  });
});

// G-SCHEMA: ComplianceReport produced by the runner parses under its own declared schema
describe('G-SCHEMA: ComplianceReport is schema-valid', () => {
  it('default-options run produces a schemaVersion-1.0 report', async () => {
    const report = await runCortexAgentConformance({
      app: passingSampleApp,
      appId: 'gate-test',
      outputPath: tmpPath(),
    });
    assert.strictEqual(report.schemaVersion, '1.0');
    assert.strictEqual(typeof report.passed, 'boolean');
    assert.ok(Array.isArray(report.plugins));
  });
});
```

---

## 12. Open Questions — Resolution Table

| # | Question | Resolution |
|---|---|---|
| Q1 | Separate package or subpath of pacta-testkit? | **Subpath (`@methodts/pacta-testkit/conformance`).** Avoids duplicate infrastructure; the shared recording primitives belong in one place. §2. |
| Q2 | Does the platform call the testkit, or only read the report? | **Only read (v1).** Self-certification. Wave 2 may add sandboxed platform-side re-runs — same entry point. §7. |
| Q3 | Schema format — JSON, protobuf, or YAML? | **JSON.** Matches Cortex artifact convention; trivial to sign; no compile step. `ComplianceReport` is a plain TS interface with runtime shape matching. §5.4. |
| Q4 | Required audit event set — exhaustive or minimum? | **Minimum (3 kinds + 1 terminal).** Apps that emit more always pass; apps that emit fewer fail C3. Exhaustive would over-constrain pacta variation. §6. |
| Q5 | How do we run the suite in vitest vs. tap vs. node:test? | **Runner-agnostic.** `runCortexAgentConformance` returns a `ComplianceReport`; the caller asserts on `report.passed`. The existing testkit is already runner-agnostic (descriptive `throw new Error(...)`), and this extension preserves that. §5.1. |
| Q6 | Fixture catalog — who decides what's canonical? | **Method team.** Fixtures ship with the testkit; new fixtures require a new `/fcd-surface` session. Tenant apps may add custom fixtures via `opts.fixtures: [...DEFAULT_FIXTURES, myCustom]` but custom fixtures don't count for certification of core conformance — they're app-internal regression checks. §5.3. |
| Q7 | Plugin registration — manifest or runtime? | **Runtime (`opts.plugins`).** Declarative manifests add a layer with no benefit; the CI script IS the manifest. Cortex's required-plugin check enforces the compliance invariant at the platform boundary, not in the testkit. §9. |
| Q8 | How does a check fail without noisy logs? | **`CheckVerdict.evidence` is short.** Plugins compose short strings; `recorderSnapshot` is the full log and only included when `opts.verbose === true`. §5.4. |
| Q9 | Does `MockCortexCtx` need to support tier `'tool'` and `'web'`? | **`'service'` default; others via factory opts.** All three category tiers supported for completeness. Most fixtures run `'service'`; some future fixtures (Cortex MCP-tool integration) will need `'tool'`. §5.2. |
| Q10 | Does the suite verify signer keys or just sign? | **Signs only.** Key registration and verification are Cortex-side. The testkit accepts a `signer` callback; the caller controls keys. §5.1, §7. |
| Q11 | Can a tenant app pass with `required` plugins disabled? | **No — `required: true` plugins cannot be disabled via opts.** The `opts.plugins` list can only ADD to the required set; dropping `s1MethodAgentPortPlugin` or `s3ServiceAdaptersPlugin` throws `ConformanceRunError('INVALID_FIXTURE')`. Enforcement in the runner, not the plugin. §5.5. |
| Q12 | How does `S1-C6-resume-roundtrip` handle non-resumable apps? | **Skipped via `expectsResume: false`.** Non-resumable fixtures mark the expectation false; check C6 becomes vacuous (passed=true, evidence='skipped — fixture not resumable'). §6. |

No questions remain open. **Status: frozen.**

---

## 13. Non-Goals

- **Runtime enforcement inside Cortex.** Cortex trusts the signed report
  (v1). Sandbox re-execution is deferred.
- **Load / performance conformance.** Functional + structural only.
  Performance gates are a sibling suite.
- **Security adversarial testing.** Structural checks (depth ≤ 2), not
  penetration (crafting pacts to reach depth 3).
- **Compatibility across multiple `@methodts/agent-runtime` majors.** The
  testkit version's peer range pins one major; cross-major testing
  belongs in an integration-test project.
- **Running conformance against non-Cortex hosts.** `MockCortexCtx`
  implements `CortexCtx` specifically. A future "generic ctx" conformance
  kit is a different surface.

---

## 14. Agreement

**Frozen:** 2026-04-14
**Owner:** `@methodts/pacta-testkit` (conformance/ subpath)
**Unblocks:** PRD-065 implementation, sample app CI integration
(`samples/cortex-incident-triage-agent/test/conformance.test.ts`),
Cortex `certified: boolean` flag, roadmap B8 closeout.

**Changes after freeze require:**
- Additive optional field → inline note + minor version bump.
- New plugin (optional, `required: false`) → minor.
- New required plugin or new built-in fixture → major + new
  `/fcd-surface` session + migration plan.
- Schema narrowing / rename / removal → major + `schemaVersion` bump +
  simultaneous Cortex-side update.

**Reviewers (implicit via FCD discipline):** Method team (pacta-testkit
maintainers), Cortex team (RFC-005 certification owners). Surface
Advocate review required before PRD-065 merge per FCD Rule 3.
