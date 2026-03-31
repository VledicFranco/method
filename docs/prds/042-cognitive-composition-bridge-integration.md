---
title: "PRD 042: Cognitive Composition Bridge Integration"
status: implemented
date: "2026-03-30"
tier: "standard"
depends_on: [30, 35, 40, 41]
enables: [43]
blocked_by: []
complexity: "high"
domains_affected: ["bridge/sessions"]
---

# PRD 042: Cognitive Composition Bridge Integration

## Problem Statement

The bridge's cognitive session (`cognitive-provider.ts`) implemented the 8-phase cognitive cycle as a monolithic inline for-loop (~400 lines). All monitor logic (anomaly detection, workspace saturation, token budget, write gate), reasoner-actor logic (multi-tool inner loop, impasse detection, circuit-breaker, parse failure handling), and 11 behavioral fixes from PRDs 033/040/041 were tangled in a single function. This made the code:

- Untestable in isolation (monitor logic couldn't be unit-tested without the full session)
- Incompatible with the pacta `CognitiveModule<I,O,S,Mu,Kappa>` algebra (RFC 001)
- Resistant to composition (couldn't swap modules, add middleware, or use algebra operators)

## Objective

Extract the monolithic cognitive loop into formal `CognitiveModule` implementations that satisfy the pacta algebra's type contracts, enabling unit testing, module composition, and future integration with the cognitive composition engine.

## Architecture & Design

### Module Extraction

Two modules extracted from the monolith:

**BridgeReasonerActorModule** (`cognitive-modules.ts`, ~350 lines):
- Extracts the inner `while (toolsThisCycle < maxToolsPerCycle)` loop
- Preserves all 11 behavioral fixes: write-completion hint, write gate counters, impasse detection, parse failure circuit-breaker, content block handling, truncation hint
- Typed: `CognitiveModule<BridgeReasonerActorMonitoring, BridgeReasonerActorOutput, BridgeReasonerActorState, BridgeReasonerActorMonitoring, BridgeMonitorControl>`

**BridgeMonitorModule** (`cognitive-modules.ts`, ~150 lines):
- Extracts the inline monitor block: anomaly detection, workspace saturation, token budget, write gate
- Identity fix: uses `moduleId('monitor')` instead of `moduleId('observer')`
- Typed: `CognitiveModule<BridgeReasonerActorMonitoring, BridgeMonitorControl, BridgeMonitorState, MonitoringSignal, ControlDirective>`

### Composition Topology

Manual two-module loop in `cognitive-provider.ts` with monitor-first ordering:

```
for each cycle:
  1. Monitor.step(prevRA.monitoring) → control directives
  2. RA.step(input, control) → output + monitoring
  → monitoring feeds into next cycle's Monitor
```

Monitor sees the **previous** cycle's RA monitoring (1-cycle lag). This preserves the monolith's behavior exactly. The `hierarchical()` algebra operator was rejected because: (a) it has a 2-cycle lag, (b) it discards monitor output, (c) `ComposedControl` is unconstructable for the bridge's control types.

### CognitiveSink Integration

`CognitiveSink` (`cognitive-sink.ts`, 172 lines) bridges cognitive events to the Universal Event Bus. Per-session sink instance receives typed cognitive events (module steps, anomalies, workspace operations) and forwards them as `BridgeEvent` objects. Wired in `cognitive-provider.ts` at session creation.

## Scope

### In-Scope
- Extract BridgeReasonerActorModule and BridgeMonitorModule as `CognitiveModule` implementations
- Manual composition wiring in cognitive-provider.ts (monitor-first ordering)
- CognitiveSink for event bus integration
- Unit tests for both modules (12+ scenarios)
- Architecture documentation (`docs/arch/cognitive-composition.md`)

### Out-of-Scope
- Replacing manual loop with algebra operators (future — needs `controlLoop()` operator)
- Moving behavioral fixes to L3 pacta (they're L4 bridge-specific)
- Changing the cognitive session's external API (CognitiveSessionConfig/Options unchanged)

## Implementation Status

All phases implemented directly on master across multiple sessions.

### Phase 1-3: Module Type Definitions + Factories (COMPLETE)
- `cognitive-modules.ts`: BridgeReasonerActorModule + BridgeMonitorModule factories (617 lines)
- Type definitions: BridgeReasonerActorMonitoring, BridgeMonitorControl, state types
- All 11 behavioral fixes preserved inside module boundaries

### Phase 4: Composition Wiring (COMPLETE)
- `cognitive-provider.ts` refactored to instantiate modules and compose in a for-loop (272 lines, down from ~400)
- Monitor-first ordering with 1-cycle lag

### Phase 5: Architecture Documentation (COMPLETE)
- `docs/arch/cognitive-composition.md` — 7 sections covering module boundaries, composition topology, control flow, why not hierarchical(), extension points

### Tests (COMPLETE)
- `cognitive-modules.test.ts`: 12 unit test scenarios covering module step, stagnation, impasse, write gate, saturation, circuit-breaker, and composition integration
- `cognitive-sink.test.ts`: event forwarding tests

## Success Criteria

| Metric | Target | Result |
|--------|--------|--------|
| Both factories return CognitiveModule-satisfying types | TypeScript compile gate | PASS |
| RA step() with done action → cycleDone: true | Unit test | PASS |
| Monitor step() with stagnation → restricted actions | Unit test | PASS |
| Composition loop completes with mocked tools | Integration test | PASS |
| CognitiveSessionConfig/Options unchanged | Type check | PASS |
| npm test passes | Full suite | PASS (1350/1350) |
