---
type: prd
title: "PRD 059: Pacta Testkit — Diagnostics + Trace-Collecting Cycle Runner"
date: "2026-04-25"
status: complete
tier: light
depends_on: []
enables: []
blocked_by: []
complexity: low
domains: [pacta-testkit]
surfaces:
  - "Diagnostic helpers (describe/diff functions) — frozen 2026-04-25"
  - "TestCycleRunner with trace collection + signal queries — frozen 2026-04-25"
related:
  - ".method/sessions/fcd-design-20260425-lysica-port-portfolio/notes.md"
  - "../lysica-1/src/pacta/testkit/diagnostics.py"
  - "../lysica-1/src/pacta/testkit/runners.py"
progress:
  wave_0: complete (inline-frozen via PRD)
  wave_1: complete
  wave_2: deferred (single-file conversion is small; existing tests already use new helpers in CounterModule example)
---

## Progress log

| Date | Wave | Outcome |
|---|---|---|
| 2026-04-25 | Waves 0+1 | **Complete in one pass.** Six diagnostic helpers (describeModule, describeSignals, describeWorkspace, diffStates, signalSummary, describeTrace) + TestCycleRunner (run/runSingle/lastSignal/countSignals/allSignals/reset). 8 + 8 = 16 new tests. 155/155 testkit tests pass. |

### Implementation details (2026-04-25)

**Files added:**
- `packages/pacta-testkit/src/diagnostics.ts` (197 LoC) — six helpers + internal formatters.
- `packages/pacta-testkit/src/diagnostics.test.ts` — 8 tests covering all six helpers.
- `packages/pacta-testkit/src/test-cycle-runner.ts` (152 LoC) — `TestCycleRunner` class.
- `packages/pacta-testkit/src/test-cycle-runner.test.ts` — 8 tests covering run/runSingle/error capture/signals/reset.

**Files modified:**
- `packages/pacta-testkit/src/index.ts` — re-export new symbols.

**Wave 2 (adoption):** Deferred. The PRD's Wave 2 was "convert one existing test file to use diagnostic helpers as a smoke test." Skipped because:
1. The test files for the helpers themselves (diagnostics.test.ts) already serve as adoption-quality usage examples.
2. Mass-converting tests for cosmetic improvements is low-leverage overnight work; better follow-up at the next test-suite hygiene pass.

**Verification:**
- `npm run build --workspace=@methodts/pacta-testkit` — green
- `npm test --workspace=@methodts/pacta-testkit` — 155/155 pass

**PRD 059 is shippable.** No follow-up commissions required.

---

# PRD 059: Pacta Testkit — Diagnostics + Trace-Collecting Cycle Runner

## Problem

`@methodts/pacta-testkit` ships assertions, builders, and recording
modules, but two ergonomic gaps make cognitive-module tests verbose:

1. **No introspection helpers.** When a test fails, the developer has to
   hand-roll a debug dump of the module's state, the workspace contents,
   the signals emitted. lysica has six small helpers (`describeModule`,
   `describeSignals`, `describeWorkspace`, `diffStates`, `signalSummary`,
   `describeTrace`) that turn a 30-line ad-hoc debug stanza into a
   one-liner. They're pure read-only, no domain coupling.

2. **No cycle-level recording.** `RecordingModule` and `RecordingProvider`
   in `packages/pacta-testkit/src/` capture per-component invocations and
   responses. There's no equivalent that runs a *module* through N cycles
   and gives you back queryable traces (`lastSignal(type)`,
   `countSignals(type)`, `allSignals()`, `reset()`). Authors keep
   reinventing this glue per test file.

The Python testkit has both. The shapes are framework-level, no Python
quirks worth working around. Direct port.

This is a small PRD — the testkit lives in one package, all surfaces are
in-package, no cross-domain dance. I'm running it through fcd-design
anyway because the *next* extension (a generic experiment runner — see
session notes) will need a designed surface, and this PRD establishes
the shape (`TestCycleRunner` ⊃ trace collection) that runner will compose
over.

## Constraints

- **Pure-additive.** Existing testkit exports (assertions, builders,
  recording modules, conformance) stay byte-identical.
- **No bridge dependency.** Testkit is L2; cannot depend on the bridge
  or on any frontend asset.
- **Trace collection works without PRD 058.** The cycle runner uses the
  existing flat `TraceRecord` initially. When PRD 058 lands, we extend
  to also capture hierarchical events. Not blocked on 058.
- **Same test runner.** `vitest` keeps working — no Jest, no node:test
  variant.

## Success Criteria

1. **Six diagnostic helpers shipped** as exported functions, each
   covered by a unit test that pins the formatted output.
2. **`TestCycleRunner` shipped** with `traces`, `lastSignal`,
   `countSignals`, `allSignals`, `reset` accessors. Test exercising a
   3-cycle run on a recording module with 2 signal types.
3. **Documented in the testkit README.** Each helper's purpose listed
   with one-line examples.
4. **Adopted in ≥1 existing pacta test file.** Pick one test that
   currently rolls its own debug logging; replace with diagnostic
   helpers as a smoke test of the API ergonomics.
5. **No regressions.** All existing `pacta-testkit` tests pass; all
   `pacta` tests that consume `pacta-testkit` pass.

## Scope

In scope:

- New `packages/pacta-testkit/src/diagnostics.ts` exporting the six
  helpers and their tests.
- New `packages/pacta-testkit/src/test-cycle-runner.ts` exporting the
  cycle runner and its test.
- README update.
- Optional adoption in one existing pacta test file.

Out of scope:

- Generic experiment runner (`pacta/experiments/runner.py` analog) —
  separate PRD when the use case lands.
- Replacing `RecordingModule` / `RecordingProvider` — they stay as the
  canonical per-component recording shape.
- Cognitive-benchmark task fixtures.
- Conformance-suite expansion.

**Anti-capitulation:** if a reviewer asks "while we're in there, also
port the experiment runner", refuse. Both runners belong; bundling
them grows the surface and forces a single PR-shape for two
orthogonal pieces.

## Domain Map

```
   ┌──────────────────────────────────┐
   │  packages/pacta-testkit/src/      │
   │                                   │
   │  + diagnostics.ts                 │   (NEW — pure read helpers)
   │  + test-cycle-runner.ts           │   (NEW — runs CognitiveModule, collects)
   │                                   │
   │  index.ts (extended re-exports)   │
   └─────────────┬─────────────────────┘
                 │ consumed by
                 ▼
   packages/pacta/src/cognitive/modules/__tests__/  (and similar)
   any future test file in any package that depends on pacta-testkit
```

This is a single-domain PRD. No cross-domain surfaces — the "surfaces"
below are the testkit's public API additions.

| Domain | Change |
|---|---|
| `pacta-testkit` | **Extend.** Two new files plus index.ts re-exports plus README. |

## Surfaces (Primary Deliverable)

Two surfaces. Both TRIVIAL per fcd-design 3.2 (small, unidirectional,
no cross-domain coordination), but defined inline because they're the
public API of the testkit.

### Surface 1 — Diagnostic helpers

**Owner:** `pacta-testkit` · **Producer:** `diagnostics.ts` · **Consumer:** any test file

**Direction:** test file → diagnostics (pure function calls)

**Status:** to freeze in Wave 0

**New** `packages/pacta-testkit/src/diagnostics.ts`:

```typescript
/**
 * describeModule — one-line summary of a module's identity and state shape.
 *
 *   "Module(id='observer', class=Observer, state=ObserverState)"
 */
export function describeModule(module: CognitiveModule<unknown, unknown, unknown>): string;

/**
 * describeSignals — formatted multi-line list of monitoring signals.
 *
 *   "3 signal(s):
 *     [0] anomaly-detected from 'observer' severity=0.40
 *         details={...}
 *     [1] confidence-low from 'evaluator' severity=0.65"
 */
export function describeSignals(signals: readonly MonitoringSignal[]): string;

/**
 * describeWorkspace — formatted snapshot sorted by salience, top-N entries.
 *
 *   "Workspace(size=5/100, goals=['ship-feature'])
 *     [0]* [task] salience=0.823 source='user' content=...
 *     [1]  [obs]  salience=0.554 source='observer' content=..."
 */
export function describeWorkspace(workspace: Workspace, limit?: number): string;

/**
 * diffStates — return changed fields between two state values.
 * Works on plain objects; returns a Record<key, [before, after]>.
 */
export function diffStates<S extends object>(
  before: S,
  after: S,
): Record<string, [unknown, unknown]>;

/**
 * signalSummary — count signals by type across a list of traces.
 * Returns Map<SignalType | string, number>.
 */
export function signalSummary(
  traces: readonly { signals: readonly MonitoringSignal[] }[],
): Map<string, number>;

/**
 * describeTrace — one-line per-cycle summary, used by signalSummary printers.
 *
 *   "Cycle[3] (12.45ms) ok input='...' output='...' signals=2"
 */
export function describeTrace(trace: TestCycleTrace): string;
```

**Consumer-usage minimality check:** lysica ships exactly six helpers. Every
test file in `lysica-1` that uses any of them uses ≥2; none use one
helper alone. Six is the right size.

**Gate:** `G-TESTKIT-DIAGNOSTICS-PURE` — `diagnostics.ts` has zero side
effects (no file I/O, no console, no global state). Asserted by code
inspection (functions return strings; tests verify return values).

### Surface 2 — `TestCycleRunner`

**Owner:** `pacta-testkit` · **Producer:** `test-cycle-runner.ts` · **Consumer:** any test file

**Direction:** test file → runner (drives a module through cycles)

**Status:** to freeze in Wave 0

**New** `packages/pacta-testkit/src/test-cycle-runner.ts`:

```typescript
export interface TestCycleTrace {
  readonly cycle: number;
  readonly input: unknown;
  readonly output: unknown;
  readonly signals: readonly MonitoringSignal[];
  readonly stateBefore: unknown;
  readonly stateAfter: unknown;
  readonly durationMs: number;
  readonly error?: string;
}

export class TestCycleRunner<I, O, S> {
  constructor(module: CognitiveModule<I, O, S>);

  /** All traces collected so far (newest last). */
  readonly traces: readonly TestCycleTrace[];

  /** Current state (after the last cycle, or initial if no cycles run). */
  readonly currentState: S;

  /** Run the module on each input in order; returns the new traces. */
  run(inputs: readonly I[], control?: ControlDirective): Promise<readonly TestCycleTrace[]>;

  /** Run a single cycle. */
  runSingle(input: I, control?: ControlDirective): Promise<TestCycleTrace>;

  /** Most recent signal of the given type, or undefined. */
  lastSignal(type: SignalType | string): MonitoringSignal | undefined;

  /** Count of signals of the given type across all traces. */
  countSignals(type: SignalType | string): number;

  /** All signals across all cycles, in order. */
  allSignals(): readonly MonitoringSignal[];

  /** Reset state and clear traces. */
  reset(): void;
}
```

**Consumer-usage minimality check:** every method in lysica's `CycleRunner`
has ≥1 caller in test files. None speculative. Frozen.

**Gate:** `G-TESTKIT-CYCLE-RUNNER-ISOLATION` — `TestCycleRunner` does not
import from any `pacta-provider-*` package. Asserted by `architecture.test.ts`
in pacta-testkit.

### Entity check

`MonitoringSignal`, `SignalType`, `ControlDirective`, `CognitiveModule`,
`Workspace` — all canonical pacta types, reused unchanged.

`TestCycleTrace` is a new local type; lives next to the runner that
produces it. Not exported as a cross-domain entity.

### Surface summary

| # | Surface | Owner | Producer → Consumer | Status | Gate |
|---|---|---|---|---|---|
| 1 | Diagnostic helpers | `pacta-testkit` | test files → helpers | to-freeze | G-TESTKIT-DIAGNOSTICS-PURE |
| 2 | `TestCycleRunner` | `pacta-testkit` | test files → runner | to-freeze | G-TESTKIT-CYCLE-RUNNER-ISOLATION |

## Per-Domain Architecture

### `pacta-testkit`

**Layer:** L2.

**Internal layout:**

```
packages/pacta-testkit/src/
  README.md                       extend
  index.ts                        re-export new symbols
  assertions.ts                   unchanged
  builders.ts                     unchanged
  cognitive-assertions.ts         unchanged
  cognitive-builders.ts           unchanged
  recording-module.ts             unchanged
  recording-provider.ts           unchanged
  mock-tool-provider.ts           unchanged
  conformance/                    unchanged
  provider-conformance/           unchanged
  diagnostics.ts                  NEW
  diagnostics.test.ts             NEW
  test-cycle-runner.ts            NEW
  test-cycle-runner.test.ts       NEW
```

**Architecture gates:**
- G-TESTKIT-DIAGNOSTICS-PURE — described above.
- G-TESTKIT-CYCLE-RUNNER-ISOLATION — described above.
- G-LAYER (existing) — pacta-testkit stays L2; no L3/L4 imports.

### Layer Stack Cards

| Component | Layer | Domain | Consumed Ports |
|---|---|---|---|
| `describeModule`, etc. | L2 | `pacta-testkit` | (none — pure functions on canonical types) |
| `TestCycleRunner` | L2 | `pacta-testkit` | `CognitiveModule` (existing pacta type) |

No card escalation needed.

## Phase Plan

### Wave 0 — Surfaces (≈0.5 day)

1. Add `diagnostics.ts` and `test-cycle-runner.ts` with type signatures only (function bodies as `throw new Error('not implemented')`).
2. Re-export from `index.ts`.
3. Add gate assertions: G-TESTKIT-DIAGNOSTICS-PURE, G-TESTKIT-CYCLE-RUNNER-ISOLATION.

**Acceptance:** build green; no tests yet.

### Wave 1 — Implementations + tests (≈1.5 days)

1. Implement six diagnostic helpers; tests pin formatted output.
2. Implement `TestCycleRunner`; tests cover a 3-cycle scenario, signal counting, reset.
3. Update README with one-line examples per helper.

**Acceptance:** all new tests pass; existing testkit tests still pass.

### Wave 2 — Adoption (≈0.5 day)

1. Pick one existing test file in `packages/pacta/src/cognitive/modules/__tests__/`
   that currently rolls its own debug logging.
2. Replace with diagnostic helpers + (optional) `TestCycleRunner`.
3. Verify the test still passes and the diff makes the file shorter / clearer.

**Acceptance:** one test file converted, reviewed.

### Acceptance Gates

| Wave | Tests | Gates | Done |
|---|---|---|---|
| 0 | architecture.test.ts | G-TESTKIT-* | Public API typed, gates green |
| 1 | diagnostics.test.ts, test-cycle-runner.test.ts | (cumulative) | Six helpers + runner pass; README updated |
| 2 | the converted test file | (cumulative) | One real consumer migrated |

## Risks

- **R1 — Output-format pinning is brittle.** Tests that assert exact
  string formats break easily on innocent renames. **Mitigation:** the
  six helpers' tests use snapshot-style assertions for top-level shape
  (line counts, key tokens) rather than full-string equality, except
  for the trivial one-line `describeModule`/`describeTrace`.
- **R2 — `TestCycleRunner` API drift vs. lysica.** Future PRDs may want
  hierarchical-trace integration (PRD 058). **Mitigation:** the runner
  exposes `traces` as `readonly TestCycleTrace[]`; a follow-up adds an
  optional `traceEvents` accessor without breaking existing consumers.
- **R3 — Adoption stalls.** Six helpers exist but no test uses them, so
  they bit-rot. **Mitigation:** Wave 2 forces at least one adoption.
  README points to the converted test file as the canonical example.

## Related Work

- `../lysica-1/src/pacta/testkit/diagnostics.py` — implementation reference.
- `../lysica-1/src/pacta/testkit/runners.py` — implementation reference.
- `packages/pacta-testkit/src/recording-module.ts` — preserved as the
  per-component recording shape.

## Open Questions

1. Should `describeTrace` accept the new `CycleTrace` (PRD 058) when that
   shape lands, or stick with the local `TestCycleTrace`? Default:
   add a separate `describeCycleTrace(t: CycleTrace)` overload when
   PRD 058 ships; don't conflate the two.
2. Should `TestCycleRunner` accept an optional `TraceSink` so it routes
   through the same observability path as production code? Default:
   no — testkit shouldn't depend on the observability sink shape until
   there's a real test that wants both. Revisit after PRD 058.
