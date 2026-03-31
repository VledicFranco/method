# Design: SLM-Compiled Modules in the Cognitive Cycle

**Status:** Proposal
**Date:** 2026-03-30
**Scope:** RFC 002 thesis test -- replace Monitor, Observer, Evaluator LLM calls with ONNX SLM inference
**Prerequisite:** Gate 4 FULL PASS (Monitor SLM validated), multi-module benchmark (R-08) codecs ready

## 1. Current Architecture Analysis

### 1.1 The Experiment Runner (run.ts, Condition C)

The cognitive condition runs a **5-module merged architecture** in a manual loop (not the 8-phase `CognitiveCycle` from `cycle.ts`):

```
for cycle = 0..14:
  1. OBSERVE  -- Observer (rule-based), cycle 0 only, writes task description to workspace
  2. MONITOR  -- Monitor (rule-based), every cycle, reads previous RA monitoring signal
  3. REASON+ACT -- ReasonerActor (single LLM call + tool execution), every cycle
```

Key observations:
- **Observer** fires once (cycle 0), processes the task description, computes novelty, writes to workspace. It is never called again -- subsequent inputs come from tool results written by ReasonerActor.
- **Monitor** fires every cycle. Input: `AggregatedSignals` map containing the previous cycle's `ReasonerActorMonitoring` signal. Output: `MonitorReport` with anomalies, restrictedActions, forceReplan. It is entirely rule-based (no LLM call).
- **Evaluator** does NOT exist in the experiment runner's loop. The `createEvaluator` module exists in the codebase and is wired in the formal `CognitiveCycle` (cycle.ts, Phase 5), but Condition C in `run.ts` does not use it.
- **ReasonerActor** is the only LLM call. It reads workspace snapshot, produces plan/reasoning/action, executes the tool, writes results back.

### 1.2 The Formal Cycle (cycle.ts)

The 8-phase `CognitiveCycle` orchestrator runs:
```
OBSERVE -> ATTEND -> REMEMBER -> REASON -> MONITOR -> CONTROL -> ACT -> LEARN
```

Phases 5-6 (MONITOR + CONTROL) are **default-interventionist** -- they only fire when monitoring signals cross thresholds. When they do fire, the Evaluator also runs as part of Phase 5. This is the target architecture for SLM integration, though the experiment runner uses a simplified loop.

### 1.3 Existing SLM Infrastructure

Phase 4 provides:
- `SLMInference` interface + `createHttpSLMInference` -- HTTP client to Python ONNX server
- `SLMProviderAdapter` -- decorator that tries SLM first, falls back to frontier LLM (2-line defense: parse check + confidence check)
- **3 DSL codecs** (encode/parse pairs):
  - Monitor: `encodeSignals(AggregatedSignals) -> string`, `parseDsl(string) -> MonitorReport | null`
  - Observer: `encodeObserverSignals(ObserverSignalInput[]) -> string`, `parseObserverDsl(string) -> ObserverReport | null`
  - Evaluator: `encodeEvaluatorSignals(EvaluatorSignalInput[]) -> string`, `parseEvaluatorDsl(string) -> EvaluatorReport | null`
- `serve-model.py` -- FastAPI server loading ONNX model, `POST /generate`, one instance per module on ports 8100/8101/8102

### 1.4 The Gap

The SLM infrastructure was validated in isolation (Gate 4 benchmarks). What does NOT exist yet:

1. **Signal translation layer.** The experiment runner produces `AggregatedSignals` (a Map of MonitoringSignals). The SLM codecs expect specific input types (`AggregatedSignals` for Monitor, `ObserverSignalInput[]` for Observer, `EvaluatorSignalInput[]` for Evaluator). The Monitor codec already handles AggregatedSignals. The Observer and Evaluator codecs require synthetic input types that are not produced by the current experiment loop.

2. **SLM-backed cognitive modules.** The existing `createMonitor`, `createObserver`, `createEvaluator` are rule-based. No SLM-backed alternatives exist that conform to the `CognitiveModule<I,O,S,Mu,Kappa>` interface.

3. **Evaluator in the experiment loop.** Condition C never calls an Evaluator. The SLM cycle needs to introduce it.

4. **Measurement harness.** The existing benchmark (`run-benchmark-multimodule.ts`) evaluates SLM accuracy on curated scenarios. No harness exists for running the SLM modules inside a real cognitive loop against the T01-T05 task matrix.


## 2. Design Decisions

### 2.1 Integration Strategy: B -- Parallel Path with Shared Interface

**Decision:** Create SLM-backed wrapper modules that implement the same `CognitiveModule<I,O,S,Mu,Kappa>` interfaces as the rule-based modules. The experiment runner selects between rule-based and SLM-backed via a flag. This preserves the existing rule-based path for A/B comparison and respects the algebra's composability.

**Rejected alternative (A):** Replace rule-based modules in-place. This would lose the rule-based baseline for comparison and violate the experiment protocol (need both conditions to measure).

### 2.2 Where SLMs Fire in the Cycle

```
for cycle = 0..14:
  1. SLM-OBSERVE  -- cycle 0 only (same as before), but SLM produces priority/focus/novelty
  2. SLM-MONITOR  -- every cycle, replaces rule-based monitor
  3. SLM-EVALUATE -- every cycle (NEW), runs after monitor, before reasoner-actor
  4. REASON+ACT   -- ReasonerActor, frontier LLM (unchanged)
```

The Evaluator is introduced as a new phase between Monitor and ReasonerActor. This mirrors the formal cycle where Evaluator is part of Phase 5 (MONITOR). Its `EvaluatorReport.action` field (`continue | replan | escalate`) feeds into ReasonerActor control alongside Monitor's `restrictedActions` and `forceReplan`.

### 2.3 Observer Scope Expansion

Currently the Observer fires once (cycle 0). For SLM evaluation we need it to fire every cycle to justify its existence in the SLM cost model. The SLM Observer will process the most recent tool result (what the ReasonerActor wrote to workspace last cycle) and produce a priority/focus/novelty assessment that influences workspace attention.

This is architecturally sound -- the formal cycle runs OBSERVE every cycle. The experiment runner was simplified for the baseline but should match the formal cycle for the SLM condition.

### 2.4 Frontier LLM Stays for Reasoner and Planner

The Reasoner-Actor stays as Claude Sonnet. The Planner module (not used in the simplified Condition C loop) stays as frontier LLM if/when added. SLMs replace only the three metacognitive judgment modules: Monitor, Observer, Evaluator.

This matches RFC 002's thesis exactly: routine metacognitive judgments (is this novel? is there an anomaly? are we making progress?) compile to SLMs, while open-ended reasoning and planning remain with frontier models.


## 3. Architecture

### 3.1 ASCII Diagram

```
                           COGNITIVE CYCLE (SLM VARIANT)
  ============================================================================

  cycle 0 only:                        every cycle:
  +------------------+                 +-------------------------------------------+
  |   SLM Observer   |                 |                                           |
  | (port 8101)      |                 |  +-----------------+                      |
  | IN:  task desc   |                 |  | SLM Monitor     |   IN: prev RA signal |
  |      -> ObsSigs  |                 |  | (port 8100)     |   -> AggregatedSigs  |
  | OUT: ObsReport   |                 |  | OUT: MonReport  |   -> DSL encode      |
  |      priority,   |                 |  |  anomalies,     |   -> SLM generate    |
  |      focus,      |                 |  |  restricted,    |   -> DSL parse       |
  |      novelty     |                 |  |  forceReplan    |                      |
  +--------+---------+                 |  +--------+--------+                      |
           |                           |           |                               |
           | write to workspace        |           v                               |
           v                           |  +-----------------+                      |
     [Workspace]                       |  | SLM Evaluator   |   IN: progress sigs  |
                                       |  | (port 8102)     |   -> EvalSigs        |
                                       |  | OUT: EvalReport |   -> DSL encode      |
                                       |  |  progress,      |   -> SLM generate    |
                                       |  |  confidence,    |   -> DSL parse       |
                                       |  |  action         |                      |
                                       |  +--------+--------+                      |
                                       |           |                               |
                                       |           v                               |
                                       |  +-------------------+                    |
                                       |  | Control Merge     |  Combine Monitor + |
                                       |  |                   |  Evaluator reports  |
                                       |  | -> restrictedActs |  into RA control   |
                                       |  | -> forceReplan    |  directive          |
                                       |  | -> strategy shift |                    |
                                       |  +--------+----------+                    |
                                       |           |                               |
                                       |           v                               |
                                       |  +-------------------+                    |
                                       |  | ReasonerActor     |  Frontier LLM      |
                                       |  | (Claude Sonnet)   |  (THE ONLY LLM     |
                                       |  |                   |   COST CENTER)      |
                                       |  | IN:  workspace    |                    |
                                       |  |      + control    |                    |
                                       |  | OUT: plan, action |                    |
                                       |  +-------------------+                    |
                                       +-------------------------------------------+

  SLM Servers (Python/ONNX, each a serve-model.py instance):

  +----------------+    +----------------+    +-------------------+
  | Monitor SLM    |    | Observer SLM   |    | Evaluator SLM     |
  | :8100          |    | :8101          |    | :8102             |
  | Qwen2.5-0.5B   |    | SmolLM2-135M   |    | SmolLM2-135M      |
  | POST /generate |    | POST /generate |    | POST /generate    |
  +----------------+    +----------------+    +-------------------+
```

### 3.2 Data Flow Detail

#### Monitor SLM

```
Input:  AggregatedSignals (Map<ModuleId, MonitoringSignal>)
        -- contains previous cycle's ReasonerActorMonitoring:
           { type: 'reasoner-actor', confidence, effortLevel, tokensThisStep,
             actionTaken, success, unexpectedResult, conflictDetected }

Encode: encodeSignals(signals) -> DSL string
        "SIGNALS:\n[reasoner-actor:reasoner-actor] conf=0.42 effort=medium action=Read ok=True"

SLM:    POST :8100/generate { input: dslString }
        -> { output: "ANOMALIES: ...\nESCALATE: ...\nRESTRICT: ...\nREPLAN: yes" }

Decode: parseDsl(output) -> MonitorReport
        { anomalies: [...], escalation: "...", restrictedActions: ["Read"], forceReplan: true }
```

No translation needed. The existing `encodeSignals` already accepts `AggregatedSignals` and the existing `parseDsl` returns `MonitorReport`. This is the cleanest integration point.

#### Observer SLM

```
Input:  The current cycle's new information:
        - cycle 0: task description
        - cycle N>0: last tool result content from workspace

Translate: Convert raw input to ObserverSignalInput[]
           [{ id: 'main', novelty: <heuristic>, processed: false, content: 'text'|'code'|'error'|'tool-output' }]

Encode: encodeObserverSignals(signals) -> DSL string
        "OBS-SIGNALS:\n[observer:main] novelty=0.50 processed=False content=text"

SLM:    POST :8101/generate { input: dslString }
        -> { output: "PRIORITY: high\nFOCUS: reasoner, planner\nNOVELTY: 0.85\nNOTE: ..." }

Decode: parseObserverDsl(output) -> ObserverReport
        { priority: 'high', focus: ['planner', 'reasoner'], novelty: 0.85, note: "..." }

Effect: ObserverReport.priority -> controls workspace attention salience boost
        ObserverReport.focus -> hints to ReasonerActor on what to attend to
        ObserverReport.novelty -> written to workspace as novelty metadata
```

**Translation layer needed:** The rule-based Observer takes `ObserverInput { content, source? }` and produces `ObserverOutput { observation, noveltyScore, filtered }`. The SLM Observer takes `ObserverSignalInput[]` and produces `ObserverReport { priority, focus, novelty, note }`. These are different types. The SLM wrapper must:
1. Convert the raw input into `ObserverSignalInput[]` (compute a heuristic novelty, classify content type)
2. Call the SLM
3. Map `ObserverReport` back to an `ObserverOutput`-compatible shape for workspace writing
4. Emit `ObserverMonitoring` signal for the monitor

#### Evaluator SLM

```
Input:  Synthesize from current cycle state:
        - progress: estimated from workspace growth / action success ratio
        - diminishing: true if last N actions were read-only or same pattern
        - steps: current cycle number
        - clarity: high/medium/low based on ReasonerActor confidence

Translate: Build EvaluatorSignalInput[]
           [{ id: 'main', progress: 0.37, diminishing: true, steps: 7, clarity: 'low' }]

Encode: encodeEvaluatorSignals(signals) -> DSL string
        "EVAL-SIGNALS:\n[evaluator:main] progress=0.37 diminishing=True steps=7 clarity=low"

SLM:    POST :8102/generate { input: dslString }
        -> { output: "PROGRESS: stagnant\nCONFIDENCE: 0.35\nACTION: replan\nNOTE: ..." }

Decode: parseEvaluatorDsl(output) -> EvaluatorReport
        { progress: 'stagnant', confidence: 0.35, action: 'replan', note: "..." }

Effect: EvaluatorReport.action == 'replan' -> set raControl.forceReplan = true
        EvaluatorReport.action == 'escalate' -> set raControl.strategy = 'think' + force replan
        EvaluatorReport.progress == 'diverging' -> restrict last action type
```

**Translation layer needed:** The rule-based Evaluator takes `EvaluatorInput { workspace, signals }` and produces `EvaluatorOutput { estimatedProgress, diminishingReturns }`. The SLM Evaluator takes `EvaluatorSignalInput[]` and produces `EvaluatorReport { progress, confidence, action, note }`. The SLM wrapper must synthesize the signal inputs from the cycle's available state.


## 4. File Changes

### 4.1 New Files

```
experiments/exp-slm/phase-5-cycle/
  src/
    slm-monitor-module.ts       SLM-backed Monitor implementing CognitiveModule interface
    slm-observer-module.ts      SLM-backed Observer implementing CognitiveModule interface
    slm-evaluator-module.ts     SLM-backed Evaluator implementing CognitiveModule interface
    signal-translators.ts       Translation functions:
                                  - aggregatedSignalsToObserverInputs()
                                  - cycleStateToEvaluatorInputs()
                                  - observerReportToOutput()
                                  - evaluatorReportToOutput()
    control-merge.ts            Merge Monitor + Evaluator reports into ReasonerActorControl
    slm-cycle-metrics.ts        Per-cycle metrics collection (latency, tokens, accuracy)
  run-slm-cycle.ts              Experiment runner (new file, NOT a flag on existing run.ts)
  results/                      Output directory for SLM cycle experiment results
  README.md                     Phase 5 documentation
```

### 4.2 Modified Files

None. The experiment is self-contained in `phase-5-cycle/`. It imports from:
- `packages/pacta/src/cognitive/modules/*` (existing module types)
- `experiments/exp-slm/phase-4-integration/src/*` (existing SLM infrastructure)
- `experiments/exp-cognitive-baseline/*` (task definitions, strategies)

No modifications to existing code. This is a new experiment phase, not a refactor.

### 4.3 Reused Files (imported as-is)

| File | What it provides |
|------|------------------|
| `phase-4-integration/src/slm-inference.ts` | `createHttpSLMInference`, `SLMInference` |
| `phase-4-integration/src/dsl-codec.ts` | `encodeSignals`, `parseDsl` |
| `phase-4-integration/src/observer-dsl-codec.ts` | `encodeObserverSignals`, `parseObserverDsl` |
| `phase-4-integration/src/evaluator-dsl-codec.ts` | `encodeEvaluatorSignals`, `parseEvaluatorDsl` |
| `exp-cognitive-baseline/task-01..05` | Task definitions |
| `exp-cognitive-baseline/strategies.ts` | CognitiveConfig, workspace/monitor/prompt strategies |
| `packages/pacta/src/cognitive/modules/reasoner-actor.ts` | ReasonerActor (frontier LLM, unchanged) |


## 5. Integration Point Design

### 5.1 SLM Monitor Module

```typescript
// slm-monitor-module.ts -- sketch

interface SLMMonitorConfig {
  slm: SLMInference;
  confidenceThreshold: number;    // fallback to rule-based if SLM confidence < this
  fallbackModule: CognitiveModule<AggregatedSignals, MonitorReport, MonitorState, ...>;
}

function createSLMMonitor(config: SLMMonitorConfig):
  CognitiveModule<AggregatedSignals, MonitorReport, MonitorState, MonitorMonitoring, NoControl>
{
  // step(input: AggregatedSignals, state, control):
  //   1. dslInput = encodeSignals(input)
  //   2. slmResult = await slm.generate(dslInput)
  //   3. if slmResult.confidence < threshold -> fallback to rule-based step
  //   4. parsed = parseDsl(slmResult.tokens)
  //   5. if parsed === null -> fallback to rule-based step
  //   6. return { output: parsed, state: updateState(state, parsed), monitoring: ... }
}
```

The fallback is the existing rule-based `createMonitor`. Two defense lines (same pattern as `SLMProviderAdapter`). State tracking uses the same `MonitorState` shape so the module is a drop-in replacement.

### 5.2 SLM Observer Module

```typescript
// slm-observer-module.ts -- sketch

interface SLMObserverConfig {
  slm: SLMInference;
  confidenceThreshold: number;
  writePort: WorkspaceWritePort;
}

function createSLMObserver(config: SLMObserverConfig):
  CognitiveModule<ObserverInput, ObserverOutput, ObserverState, ObserverMonitoring, ObserverControl>
{
  // step(input: ObserverInput, state, control):
  //   1. signals = translateToObserverSignals(input, state)
  //   2. dslInput = encodeObserverSignals(signals)
  //   3. slmResult = await slm.generate(dslInput)
  //   4. if confidence < threshold or parse fails -> fall back to rule-based novelty heuristic
  //   5. report = parseObserverDsl(slmResult.tokens)
  //   6. write to workspace: { content: input.content, salience: report.novelty }
  //   7. return { output: mapToObserverOutput(report, input), state: updateState(...), monitoring: ... }
}
```

Translation: `ObserverInput.content` -> classify as text/code/error/tool-output, compute heuristic novelty from state.previousContent, set `processed: false` (it's new input). The SLM then decides priority, focus modules, and refined novelty.

### 5.3 SLM Evaluator Module

```typescript
// slm-evaluator-module.ts -- sketch

interface SLMEvaluatorConfig {
  slm: SLMInference;
  confidenceThreshold: number;
}

function createSLMEvaluator(config: SLMEvaluatorConfig):
  CognitiveModule<EvaluatorInput, EvaluatorOutput, EvaluatorState, EvaluatorMonitoring, EvaluatorControl>
{
  // step(input: EvaluatorInput, state, control):
  //   1. signals = translateToEvaluatorSignals(input, state)
  //   2. dslInput = encodeEvaluatorSignals(signals)
  //   3. slmResult = await slm.generate(dslInput)
  //   4. if confidence < threshold or parse fails -> fall back to rule-based evaluation
  //   5. report = parseEvaluatorDsl(slmResult.tokens)
  //   6. return { output: mapToEvaluatorOutput(report), state: updateState(...), monitoring: ... }
}
```

Translation: Synthesize `EvaluatorSignalInput` from `EvaluatorInput.signals` (extract progress from reasoner confidence trend, diminishing from read-only cycle count, steps from state.cycleCount, clarity from last confidence value).

### 5.4 Control Merge

```typescript
// control-merge.ts -- sketch

function mergeMetacognitiveReports(
  monitorReport: MonitorReport,
  evaluatorReport: EvaluatorReport | null,  // null if evaluator was skipped
  currentControl: ReasonerActorControl,
  config: MonitorStrategy,
): ReasonerActorControl {
  // Priority: Evaluator.action='escalate' > Monitor.forceReplan > Evaluator.action='replan' > Monitor.restrictedActions
  //
  // If evaluator says 'escalate' -> force replan + strategy='think' (strongest intervention)
  // If monitor says forceReplan -> honor it (same as current behavior)
  // If evaluator says 'replan' but monitor is quiet -> force replan only
  // If evaluator says 'continue' -> pass through monitor's restrictions only
  //
  // Evaluator confidence modulates: low confidence evaluator report is discounted
  // (treat as 'continue' if evaluator confidence < 0.3)
}
```


## 6. Experiment Runner Design

### 6.1 New Runner: `run-slm-cycle.ts`

**Decision:** A new file, NOT a `--slm` flag on the existing `run.ts`.

Rationale:
- `run.ts` is already complex (3 conditions, pattern flags, memory flags, 700+ lines)
- The SLM cycle has fundamentally different dependencies (HTTP clients, Python servers)
- Experiment protocol requires independent runners that can be invoked in isolation
- The SLM runner will import task definitions and strategies from the baseline

### 6.2 Runner Structure

```
Usage: npx tsx experiments/exp-slm/phase-5-cycle/run-slm-cycle.ts [options]

Options:
  --condition  slm-cognitive | rule-cognitive | flat   (default: all three)
  --task       T01 | T02 | T03 | T04 | T05           (default: all)
  --runs       N                                       (default: 5)
  --config     baseline | v2-minimal | ...             (default: baseline)
  --monitor-url   http://localhost:8100
  --observer-url  http://localhost:8101
  --evaluator-url http://localhost:8102

Conditions:
  A. flat           -- same as run.ts Condition A (anthropicProvider, no cycle)
  B. rule-cognitive -- same as run.ts Condition C (rule-based monitor + observer)
  C. slm-cognitive  -- SLM monitor + SLM observer + SLM evaluator + frontier ReasonerActor
```

The runner includes `flat` and `rule-cognitive` for direct comparison in the same execution environment.

### 6.3 Startup Sequence

```
1. Parse CLI args
2. Verify SLM servers are reachable (health check all 3 ports)
3. If any server unreachable and slm-cognitive requested -> error with instructions
4. For each (condition x task x run):
     a. Create VirtualToolProvider with task.initialFiles
     b. Wire modules based on condition
     c. Run the cognitive loop (max 15 cycles)
     d. Validate result
     e. Collect metrics
5. Write results to phase-5-cycle/results/slm-cycle-{timestamp}.json
6. Print comparison table
```


## 7. Measurement Plan

### 7.1 Primary Metrics (per task per condition)

| Metric | How Measured | Purpose |
|--------|-------------|---------|
| **Success rate** | `task.validate(vfs.files)` | Does the SLM cycle solve the same tasks? |
| **LLM token usage** | Sum of ReasonerActor `tokensThisStep` across all cycles | SLM calls are $0, only frontier calls count |
| **Total cost** | LLM tokens * model price | Expected: SLM cycle ~ same cost as rule-based (Monitor/Observer/Evaluator were already free) |
| **Cycles to completion** | Count of cycles before `done` action | Fewer = more efficient metacognition |
| **Wall-clock latency** | `Date.now()` delta per condition | SLM HTTP calls add latency vs rule-based |

### 7.2 SLM-Specific Metrics (per cycle per SLM module)

| Metric | How Measured | Purpose |
|--------|-------------|---------|
| **SLM latency** | `slmResult.latencyMs` | HTTP round-trip + ONNX inference |
| **SLM confidence** | `slmResult.confidence` | Track calibration drift in-cycle |
| **Parse success** | `parseDsl(output) !== null` | DSL format adherence under real inputs |
| **Fallback rate** | Count of fallbacks / total SLM calls | How often does the SLM fail to produce usable output? |
| **SLM input/output tokens** | `slmResult.inputTokenCount`, `slmResult.outputTokenCount` | SLM compute cost (not $ cost, but compute budget) |

### 7.3 Behavioral Comparison Metrics

| Metric | How Measured | Purpose |
|--------|-------------|---------|
| **Monitor agreement** | Run both SLM and rule-based monitor on same signals, compare `forceReplan` and `restrictedActions` | Does SLM monitor agree with rule-based? |
| **Intervention count** | Count of cycles where monitor/evaluator triggered an intervention | SLM may intervene at different points |
| **Stagnation recovery** | Cycles between first stagnation detection and next write action | Does SLM recover from stagnation faster? |
| **Action sequence similarity** | Levenshtein distance between SLM and rule-based tool call sequences | Are the agents taking similar paths? |

### 7.4 Task Matrix

Same T01-T05 matrix as exp-cognitive-baseline:

| Task | Type | Key Challenge |
|------|------|---------------|
| T01 | Circular dependency resolution | Search + restructure |
| T02 | Test-first bug fix | Constraint adherence |
| T03 | Config migration | Multi-file coordination |
| T04 | API versioning | Constraint-heavy (never modify) |
| T05 | Dead code removal | Search + safe deletion |

Target: N=5 runs per task per condition = 75 total runs (3 conditions x 5 tasks x 5 runs).

### 7.5 Success Criteria

From RFC 002 and Gate 4 precedent:

| Criterion | Target | Rationale |
|-----------|--------|-----------|
| SLM cycle success rate | >= rule-based - 5% | SLM should not degrade task completion |
| SLM fallback rate | <= 20% | SLM should handle 80%+ of metacognitive calls |
| Monitor agreement rate | >= 80% | SLM monitor should agree with rule-based on critical decisions |
| Wall-clock overhead | <= 500ms per SLM call | HTTP round-trip should not bottleneck the cycle |
| Token reduction vs flat | >= 30% (same as rule-based) | SLM cycle should maintain the cognitive cycle's token efficiency |


## 8. Fallback Behavior

Each SLM module has a 2-line defense (established pattern from `SLMProviderAdapter`):

1. **Line 1: Parse failure.** If the SLM output is not valid DSL, fall back to the rule-based module for this cycle. Log the parse failure.
2. **Line 2: Low confidence.** If the SLM's reported confidence is below the escalation threshold (configurable, default 0.5), fall back to the rule-based module. Log the escalation.

Fallback is **per-cycle, per-module**. The SLM tries again next cycle. This means the cycle can run with a mix of SLM and rule-based modules in the same execution -- the SLM does not need to be perfect to be useful.

Critical: The fallback modules are the existing rule-based implementations, NOT a frontier LLM. The Monitor, Observer, and Evaluator never needed LLM calls in the rule-based path, so the fallback costs $0 just like the SLM path. The difference is behavioral quality, not cost.


## 9. Serving Configuration

### 9.1 Model Servers

| Module | Port | Model | ONNX Path | VRAM |
|--------|------|-------|-----------|------|
| Monitor | 8100 | Qwen2.5-Coder-0.5B (LoRA r=16, stagnation-augmented) | `phase-3-training/models/monitor-stagnation/onnx/` | ~1.5 GB |
| Observer | 8101 | SmolLM2-135M (Full FT, observer-v2 corpus) | `phase-3-training/models/observer-v2/onnx/` | ~0.5 GB |
| Evaluator | 8102 | SmolLM2-135M (Full FT, evaluator-v2 corpus) | `phase-3-training/models/evaluator-v2/onnx/` | ~0.5 GB |

Total VRAM: ~2.5 GB. Fits on the RTX 2080 Ti (11 GB) with room to spare.

### 9.2 Startup Commands

```bash
# Terminal 1: Monitor
SLM_MODEL_DIR=experiments/exp-slm/phase-3-training/models/monitor-stagnation/onnx \
  PORT=8100 python experiments/exp-slm/phase-4-integration/scripts/serve-model.py

# Terminal 2: Observer
SLM_MODEL_DIR=experiments/exp-slm/phase-3-training/models/observer-v2/onnx \
  PORT=8101 python experiments/exp-slm/phase-4-integration/scripts/serve-model.py

# Terminal 3: Evaluator
SLM_MODEL_DIR=experiments/exp-slm/phase-3-training/models/evaluator-v2/onnx \
  PORT=8102 python experiments/exp-slm/phase-4-integration/scripts/serve-model.py

# Terminal 4: Run experiment
npx tsx experiments/exp-slm/phase-5-cycle/run-slm-cycle.ts --runs 5
```

### 9.3 Pre-trained Model Status

| Module | Model Trained | ONNX Exported | Benchmark Validated |
|--------|--------------|---------------|---------------------|
| Monitor | YES (R-09, stagnation-augmented) | YES | YES (100% success, Gate 4) |
| Observer | NEEDS TRAINING | NO | NO |
| Evaluator | NEEDS TRAINING | NO | NO |

**Critical dependency:** Observer and Evaluator SLMs require training before the cycle experiment can run. The DSL codecs and corpus generation scripts exist (phase-2-dsl), but the models have not been trained yet. This is the primary blocking work item.


## 10. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Observer/Evaluator SLMs not yet trained | **High (blocking)** | Corpus generators exist. Training is ~15 min per model on chobits. Can run Monitor-only variant first. |
| SLM HTTP latency adds up (3 calls per cycle x 15 cycles) | Medium | SLM inference is ~10-50ms per call. 45 calls x 50ms = 2.25s overhead. Acceptable vs LLM call latency (1-5s). |
| SLM input distribution drift | Medium | Real cycle inputs may differ from training corpus. Fallback mechanism handles this. Monitor fallback rate as key metric. |
| Observer fires every cycle (new behavior) changes cognitive dynamics | Medium | This matches the formal cycle design. Compare rule-based-every-cycle vs rule-based-cycle0-only as a sub-experiment. |
| Evaluator introduction changes intervention patterns | Medium | Measure intervention count separately. The evaluator adds signal, it doesn't remove any existing signal. |
| Three SLM servers complicate local dev setup | Low | Document startup. Consider a single multi-model server later if experiment succeeds. |


## 11. Effort Estimate

| Work Item | Est. Hours | Dependencies |
|-----------|-----------|--------------|
| Train Observer SLM (corpus gen + training + ONNX export) | 3h | chobits GPU access |
| Train Evaluator SLM (corpus gen + training + ONNX export) | 3h | chobits GPU access |
| `slm-monitor-module.ts` (wrapper + fallback) | 2h | None (Monitor SLM exists) |
| `slm-observer-module.ts` (wrapper + translation + fallback) | 3h | Observer SLM trained |
| `slm-evaluator-module.ts` (wrapper + translation + fallback) | 3h | Evaluator SLM trained |
| `signal-translators.ts` | 2h | None |
| `control-merge.ts` | 1h | None |
| `slm-cycle-metrics.ts` | 1h | None |
| `run-slm-cycle.ts` (experiment runner) | 4h | All modules |
| Run experiment (N=5 x 5 tasks x 3 conditions) | 3h compute | All above |
| Analysis and write-up | 2h | Results |
| **Total** | **~27h** | |

### Critical Path

```
Train Observer SLM ──┐
                     ├──> SLM wrapper modules ──> Experiment runner ──> Run ──> Analysis
Train Evaluator SLM ─┘
```

Training is the gate. Module wrappers and the runner can be developed in parallel with training using mock SLMs.


## 12. Open Questions

1. **Should the SLM Observer fire every cycle or only cycle 0?** Architecturally every cycle is correct (matches formal cycle). But the SLM was trained on single-shot novelty classification, not sequential context tracking. If it fires every cycle, it will see tool results it was never trained on. Mitigation: include tool-result examples in Observer training corpus.

2. **Should the Evaluator SLM receive the full signal history or only current cycle?** The training corpus uses single-snapshot inputs. Multi-turn state tracking is beyond what the 135M model can learn. Decision: single-snapshot per cycle (current state only), consistent with training.

3. **What is the right confidence threshold for fallback?** Gate 4 used 0.5 as the escalation threshold. Real cycle inputs may be harder than the benchmark. Consider starting at 0.4 and tuning based on fallback rate data.

4. **Should we run a Monitor-only variant first?** Since the Monitor SLM is the only one with a trained model, we could run a partial experiment (SLM Monitor + rule-based Observer/Evaluator) immediately, then add the other modules when trained. This reduces risk and provides early signal.

---

**Recommendation:** Start with item 4 -- run a Monitor-only SLM cycle variant immediately using the existing trained model. This validates the integration pattern with minimal new training. Then train Observer and Evaluator SLMs and run the full 3-module experiment.
