# Cognitive Composition — Bridge Integration

Concern: how the bridge (L4) consumes `@methodts/pacta`'s `CognitiveModule` interface to
structure its cognitive agent loop with explicit module boundaries and typed composition.

**PRD:** `docs/prds/042-cognitive-composition-bridge-integration.md`
**Domain:** `packages/bridge/src/domains/sessions/`
**Source files:** `cognitive-provider.ts` (monolith), `cognitive-modules.ts` (modules)

---

## 1. Overview

The bridge cognitive provider (`cognitive-provider.ts`) implements a monolithic `runCycle()`
function where the Observer, ReasonerActor, and Monitor are entangled in a single closure.
State flows through mutable locals (`prevConf`, `readOnlyRun`, `writeGateFired`, etc.) with
no formal interfaces separating the modules.

PRD 042 extracts the monolith into two `CognitiveModule` implementations:

- **BridgeReasonerActorModule** -- the multi-tool inner loop (LLM call, parse, tool exec)
- **BridgeMonitorModule** -- anomaly detection, workspace saturation, token budget, write gate

The Observer remains inline (a workspace write at the top of `runCycle()`). The external
API (`createCognitiveSession`, `CognitiveSessionConfig`) is unchanged.

---

## 2. Module Boundary Definitions

Both modules implement `CognitiveModule<I, O, S, Mu, Kappa>` from
`packages/pacta/src/cognitive/algebra/module.ts`.

### BridgeReasonerActorModule

```
CognitiveModule<
  I     = string,                          // prompt text
  O     = BridgeReasonerActorMonitoring,   // output equals monitoring (see section 6)
  S     = BridgeReasonerActorState,        // foldedCtx, read/write counters, writeGateFired
  Mu    = BridgeReasonerActorMonitoring,   // prevConf, prevAction, tokens, cycleDone, etc.
  Kappa = BridgeMonitorControl             // forceReplan, restricted[], interventionMessage
>
```

**State (`BridgeReasonerActorState`):** `foldedCtx` (last 15 action summaries),
`promptSuccessfulReads`, `promptSuccessfulWrites`, `writeGateFired`. Note:
`prevSemanticKey` is a within-step local (reset at each `step()` call), not state.

**Monitoring (`BridgeReasonerActorMonitoring`):** `prevConf`, `prevAction`,
`consecutiveFailedParses`, `wsUtilization`, per-cycle token deltas, `writeGateFired`,
read/write counters, `cycleDone`, `lastOutput`.

### BridgeMonitorModule

```
CognitiveModule<
  I     = BridgeReasonerActorMonitoring,   // last cycle's RA monitoring (null on cycle 0)
  O     = BridgeMonitorControl,            // control directives for this cycle's RA
  S     = BridgeMonitorState,              // readOnlyRun, interventions, accumulatedInputTokens
  Mu    = MonitoringSignal,                // base type (anomaly flags)
  Kappa = ControlDirective                 // base type -- monitor accepts no meaningful control
>
```

**State (`BridgeMonitorState`):** `readOnlyRun` (consecutive read-only cycles),
`interventions` (total fired this prompt), `accumulatedInputTokens` (running total for
100k threshold). Reset to `initialState()` at the start of each `runCycle()` call.

**Output (`BridgeMonitorControl`):** `forceReplan`, `restricted` (tool names to
discourage), `interventionMessage` (workspace injection text, or null).

---

## 3. Composition Topology

The two modules are wired in a manual for-loop that preserves the monolith's
**monitor-first** execution order. This is not a formal operator call -- it is a direct
loop where each module's `step()` output is captured as a local variable.

```
runCycle(prompt)
  Observer: seed workspace with task
  for c = 0..maxCycles:
    Monitor.step(lastRAMonitoring)  -->  BridgeMonitorControl
    RA.step(prompt, raState, ctrl)  -->  BridgeReasonerActorMonitoring
```

### Cycle-lag diagram

```
Cycle 1: Monitor(noop) --> defaultCtrl    RA(defaultCtrl) --> monitoring_1
Cycle 2: Monitor(monitoring_1) --> ctrl_1   RA(ctrl_1) --> monitoring_2
Cycle 3: Monitor(monitoring_2) --> ctrl_2   RA(ctrl_2) --> monitoring_3
```

On cycle 0, `lastRAMonitoring` is null. The monitor returns a default control (no
interventions, no restrictions). From cycle 1 onward, the monitor reads the previous
cycle's RA monitoring signal.

---

## 4. Control Flow

### Within a single cycle

1. **Monitor reads** the previous cycle's RA monitoring signal
2. **Monitor produces** a `BridgeMonitorControl` as direct output
3. **RA receives** that control on the **same cycle** -- zero lag within a cycle
4. **RA runs** the inner `while (toolsThisCycle < maxToolsPerCycle)` loop with
   `control.forceReplan` and `control.restricted` applied immediately
5. **RA produces** a `BridgeReasonerActorMonitoring` signal for next cycle

### Signal timing

The effective lag is **1 cycle**: a signal emitted at cycle N is read by the monitor at
cycle N+1, which produces control applied to cycle N+1's RA execution. This matches the
monolith's timing exactly -- the inline monitor block runs at the top of each cycle
iteration, reading mutable locals set by the previous cycle's RA execution.

### Comparison to the monolith

The monolith's execution order within cycle N:

```
1. Monitor block (reads prevConf, prevAction from cycle N-1)
2. Context injection (forceReplan, restricted)
3. Inner while-loop (LLM call, parse, tool exec)
4. Update prevConf, prevAction (visible to cycle N+1's monitor)
```

The manual composition maps this 1:1. The monitor's output becomes the RA's control input
on the same cycle. The RA's monitoring output becomes the monitor's input on the next
cycle. No stored-state workaround is needed.

---

## 5. Why Not `hierarchical()`

The `hierarchical(monitor, target)` operator in
`packages/pacta/src/cognitive/algebra/composition.ts` was designed for observational
hierarchical composition. Three problems prevent its use here:

**1. Execution order (2-cycle lag).** The operator runs target **before** monitor:

```typescript
// composition.ts — hierarchical() step implementation
const targetResult = await target.step(input, state.targetState, control.first);
// ... then monitor reacts to *previous* step's monitoring
const monitorInput = state.lastMonitoring ?? makeNoopMonitoring(target.id);
```

This creates a 2-cycle lag: signal at cycle N is stored in `lastMonitoring`, monitor
reads it at cycle N+1, but the monitor's output is discarded. The bridge needs
monitor-first ordering (1-cycle lag).

**2. Monitor output discarded.** The operator returns `OTarget` as the composed output.
The monitor's output (`OMonitor`) is not accessible to the target or the caller. The
bridge requires the monitor's `BridgeMonitorControl` to be passed to the RA as control
input on the same cycle.

**3. Unconstructable `ComposedControl`.** The operator requires
`ComposedControl<KappaTarget, KappaMonitor>` as control input. Since the monitor's
`Kappa` is `ControlDirective` (base type requiring `target` and `timestamp` fields) and
the bridge has no meaningful external control for the monitor, constructing a valid
`ComposedControl<BridgeMonitorControl, ControlDirective>` adds noise with no value.

The manual loop preserves the monolith's 1-cycle lag, gives the caller direct access to
monitor output, and avoids composition operator indirection.

---

## 6. How to Extend

### Swapping a module implementation

Both modules are created via factory functions (`createBridgeReasonerActorModule`,
`createBridgeMonitorModule`). To swap an implementation:

1. Write a new factory that returns the same `CognitiveModule<...>` type
2. Replace the factory call in `cognitive-provider.ts`'s `runCycle()`
3. TypeScript enforces interface compliance at compile time

### Adding new composition patterns (PRD 043)

The manual loop serves as the behavioral specification for a future `controlLoop()`
operator. To formalize it:

```typescript
// Hypothetical operator — PRD 043
function controlLoop<I, O, SM, ST, MuT, MuM, KappaT>(
  monitor: CognitiveModule<MuT, KappaT, SM, MuM, never>,
  target: CognitiveModule<I, O, ST, MuT, KappaT>,
): CognitiveModule<I, O, ...>
```

This operator would run monitor-first (unlike `hierarchical()`), pass the monitor's
output as the target's control input, and return the target's output. It could also
enable `parallel()` compositions where each branch has its own monitor-control loop.

### O=Mu for BridgeReasonerActorModule

The RA module currently sets `O = Mu = BridgeReasonerActorMonitoring`. This is
intentional for the hierarchical-only use case: the outer loop needs the monitoring
signal as the direct output. For `sequential()` or `parallel()` compositions where the
RA's output feeds another module's input, `O` and `Mu` should be separated (e.g.,
`O = string` for the task result, `Mu` for monitoring telemetry). This separation is
deferred to PRD 043.

---

## 7. Behavioral Fixes

All 11 behavioral fixes live inside the bridge modules (L4), not in `@methodts/pacta` (L3).
The canonical pacta modules remain lean and theory-grounded. Bridge-specific thresholds,
workspace injection patterns, and tool-aware heuristics belong at the application layer.

### ReasonerActor module (6 fixes)

| # | Fix | What it does |
|---|-----|-------------|
| 1 | Write-completion hint | After successful Write, injects salience 1.0 entry with pre-filled done action |
| 2 | Write gate counters | Tracks `promptSuccessfulReads` / `promptSuccessfulWrites`, resets after Write |
| 3 | Impasse detection | Exact-match `tool:input` key detects consecutive identical actions |
| 4 | Parse failure circuit-breaker | Aborts after 3 consecutive failed parses (`consecutiveFailedParses >= 3`) |
| 5 | Content block handling | `<content>` tag bypasses JSON escaping for Write operations |
| 6 | Truncation hint | After truncated Read, injects offset/limit guidance for continuation |

### Monitor module (5 fixes)

| # | Fix | What it does |
|---|-----|-------------|
| 7 | Anomaly detection | `prevConf < threshold` or `readOnlyRun >= stagThreshold` triggers replan |
| 8 | Workspace saturation | `wsUtilization >= 0.8` injects compression note |
| 9 | Token budget pressure | `accumulatedInputTokens > 100k` forces completion |
| 10 | Write gate intervention | `reads >= 3, writes == 0, !fired` restricts read-only tools |
| 11 | No-action stall message | Tailored intervention when `prevAction` is `no-action` or `parse-error` |

### Why not in pacta (L3)?

- Thresholds (0.8 saturation, 100k tokens, 3 reads) are bridge-tuned, not universal
- Workspace injection messages reference bridge-specific tool names (Read, Write, Glob)
- The write-completion hint pre-fills a `done` action -- a bridge session concept
- The content block handler is format-specific to the bridge's XML prompt template
- Convergence with canonical pacta modules is a future concern, not a current goal

---

## References

- PRD 042: `docs/prds/042-cognitive-composition-bridge-integration.md`
- PRD 030: `docs/prds/030-pacta-cognitive-composition.md` (algebra)
- PRD 043: parallel composition (future -- enables `controlLoop()` operator)
- RFC 001: `docs/rfcs/001-cognitive-composition.md`
- CognitiveModule interface: `packages/pacta/src/cognitive/algebra/module.ts`
- Composition operators: `packages/pacta/src/cognitive/algebra/composition.ts`
- Bridge monolith: `packages/bridge/src/domains/sessions/cognitive-provider.ts`
