/**
 * CognitiveCycle — the 8-phase cognitive cycle orchestrator.
 *
 * Runs the cognitive cycle: OBSERVE -> ATTEND -> REMEMBER -> REASON ->
 * MONITOR -> CONTROL -> ACT -> LEARN. Phases 5-6 are default-interventionist
 * (only fire when monitoring signals cross thresholds). Phase 8 (LEARN) is
 * fire-and-forget with state-lock (errors don't corrupt reflector state).
 *
 * Grounded in: ACT-R production cycle, GWT broadcast-then-compete,
 * Nelson & Narens monitor/control metacognition.
 */

import type {
  CognitiveModule,
  ModuleId,
  MonitoringSignal,
  AggregatedSignals,
  ControlDirective,
  StepResult,
  StepError,
  TraceRecord,
  TraceSink,
  ControlPolicy,
  CognitiveEvent,
  CognitiveCyclePhase,
  CognitiveLEARNFailed,
  CognitiveCycleAborted,
  CognitiveConstraintViolation,
  CognitiveMonitorDirectiveApplied,
  WorkspaceManager,
  ReadonlyWorkspaceSnapshot,
  PartitionSystem,
  ContextSelector,
  PartitionMonitorContext,
  PartitionSignal,
  PartitionId,
  WorkspaceEntry,
  PartitionWriteAdapter,
} from '../algebra/index.js';

import { moduleId as createModuleId } from '../algebra/module.js';
import { createTypeResolver } from '../partitions/type-resolver.js';
import { checkConstraintViolations } from '../modules/constraint-classifier.js';

// ── Cycle Configuration ──────────────────────────────────────────

/** When the meta-level should intervene. */
export type ThresholdPolicy =
  | { type: 'predicate'; shouldIntervene: (signals: AggregatedSignals) => boolean }
  | { type: 'field'; rules: Array<{ source: ModuleId; field: string; operator: '<' | '>'; value: number }> };

/** Per-module and default error handling policies. */
export interface CycleErrorPolicy {
  default: 'abort' | 'skip';
  perModule?: Map<ModuleId, 'abort' | 'skip' | 'retry'>;
  maxRetries?: number; // default 1
}

/** Per-cycle resource bounds. */
export interface CycleBudget {
  maxProviderCallsPerCycle?: number;
  maxTokensPerCycle?: number;
  maxConsecutiveMetaInterventions?: number;
}

/** Full cycle configuration. */
export interface CycleConfig {
  thresholds: ThresholdPolicy;
  errorPolicy: CycleErrorPolicy;
  controlPolicy: ControlPolicy;
  cycleBudget?: CycleBudget;
  maxConsecutiveInterventions?: number; // default 3

  /**
   * PRD 044 — RFC 003 Phase 1: Partitioned workspace.
   * When provided, modules receive typed context via buildContext()
   * instead of monolithic workspace.snapshot(). Legacy path unchanged
   * when omitted.
   */
  partitionSystem?: PartitionSystem;

  /**
   * Per-module context selectors. When partitionSystem is provided,
   * each module gets context built from its selector. Falls back to
   * DEFAULT_MODULE_SELECTORS for modules without an explicit selector.
   */
  moduleSelectors?: Map<ModuleId, ContextSelector>;

  /**
   * PRD 045 — partition write adapters for write-path tracking.
   *
   * Map from module key (e.g., 'observer', 'reasoner') to the PartitionWriteAdapter
   * that was injected as that module's write port. The cycle reads tracking data after
   * each module step to update partitionLastWriteCycle for partition monitors.
   *
   * The composition root creates one adapter per module and passes it both to the module
   * factory (as its write port) and here (for cycle-level tracking).
   */
  partitionWriteAdapters?: Map<string, PartitionWriteAdapter>;
}

// ── Cycle Modules ────────────────────────────────────────────────

/**
 * The 8 cognitive modules wired into the cycle.
 *
 * Since each module has different I/O/S/Mu/Kappa types, the cycle
 * orchestrator uses `CognitiveModule<any, any, any, any, any>` internally.
 * Type safety is maintained at module construction boundaries.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModule = CognitiveModule<any, any, any, any, any>;

export interface CycleModules {
  observer: AnyModule;
  memory: AnyModule;
  reasoner: AnyModule;
  actor: AnyModule;
  monitor: AnyModule;
  evaluator: AnyModule;
  planner: AnyModule;
  reflector: AnyModule;
}

// ── Cycle Result ─────────────────────────────────────────────────

export interface CycleResult {
  output: unknown;
  traces: TraceRecord[];
  signals: AggregatedSignals;
  cycleNumber: number;
  phasesExecuted: string[];
  aborted?: { phase: string; reason: string };
  /** PRD 045: Set when Evaluator emits TerminateSignal (goal-satisfied, goal-unreachable, or budget-exhausted). */
  terminated?: import('../algebra/goal-types.js').TerminateSignal;
}

// ── Cycle Runner ─────────────────────────────────────────────────

export interface CognitiveCycleRunner {
  run(
    input: unknown,
    workspace: WorkspaceManager,
    traceSinks: TraceSink[],
    onEvent?: (event: CognitiveEvent) => void,
  ): Promise<CycleResult>;
}

// ── Phase Names ──────────────────────────────────────────────────

const PHASES = [
  'OBSERVE',
  'ATTEND',
  'REMEMBER',
  'REASON',
  'MONITOR',
  'CONTROL',
  'ACT',
  'LEARN',
] as const;

export type CyclePhaseName = (typeof PHASES)[number];

// ── Threshold Evaluation ─────────────────────────────────────────

function shouldIntervene(policy: ThresholdPolicy, signals: AggregatedSignals): boolean {
  if (policy.type === 'predicate') {
    return policy.shouldIntervene(signals);
  }

  // Field-based threshold evaluation
  for (const rule of policy.rules) {
    const signal = signals.get(rule.source);
    if (!signal) continue;

    const value = (signal as unknown as Record<string, unknown>)[rule.field];
    if (typeof value !== 'number') continue;

    if (rule.operator === '<' && value < rule.value) return true;
    if (rule.operator === '>' && value > rule.value) return true;
  }

  return false;
}

// ── Error Policy Resolution ──────────────────────────────────────

function resolveErrorPolicy(
  policy: CycleErrorPolicy,
  moduleId: ModuleId,
): 'abort' | 'skip' | 'retry' {
  return policy.perModule?.get(moduleId) ?? policy.default;
}

// ── Simple hash for trace records ────────────────────────────────

function simpleHash(input: unknown): string {
  const str = typeof input === 'string' ? input : JSON.stringify(input ?? '');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

// ── Build TraceRecord from StepResult ────────────────────────────

function buildTrace(
  moduleId: ModuleId,
  phase: string,
  startTime: number,
  result: StepResult<unknown, unknown, MonitoringSignal>,
  input: unknown,
): TraceRecord {
  // If the step itself produced a trace, use it
  if (result.trace) return result.trace;

  const endTime = Date.now();
  return {
    moduleId,
    phase,
    timestamp: startTime,
    inputHash: simpleHash(input),
    outputSummary: typeof result.output === 'string'
      ? result.output.slice(0, 100)
      : JSON.stringify(result.output).slice(0, 100),
    monitoring: result.monitoring,
    stateHash: simpleHash(result.state),
    durationMs: endTime - startTime,
    tokenUsage: undefined,
  };
}

// ── Default Module Selectors (PRD 044) ──────────────────────────

const DEFAULT_MODULE_SELECTORS: Record<string, ContextSelector> = {
  observer:  { sources: ['task'],                              budget: 1024,  strategy: 'all' },
  memory:    { sources: ['task', 'operational'],               budget: 2048,  strategy: 'salience' },
  reasoner:  { sources: ['task', 'constraint', 'operational'], budget: 8192,  strategy: 'salience' },
  actor:     { sources: ['operational', 'task'],               budget: 4096,  strategy: 'recency' },
  monitor:   { sources: ['constraint', 'operational'],         budget: 2048,  strategy: 'all' },
  evaluator: { sources: ['task', 'operational'],               budget: 2048,  strategy: 'salience' },
  planner:   { sources: ['task', 'constraint'],                budget: 4096,  strategy: 'salience' },
  reflector: { sources: ['task', 'operational'],               budget: 2048,  strategy: 'recency' },
};

/**
 * Build typed context for a module from the partition system.
 *
 * Resolution order (PRD 045):
 * 1. Module's own contextBinding (type-driven → TypeResolver → ContextSelector)
 * 2. Custom selectors from CycleConfig.moduleSelectors
 * 3. DEFAULT_MODULE_SELECTORS (hardcoded fallback)
 * 4. Full partition snapshot (last resort)
 */
function buildModuleContext(
  moduleKey: string,
  mod: AnyModule,
  partitions: PartitionSystem,
  customSelectors?: Map<ModuleId, ContextSelector>,
): ReadonlyWorkspaceSnapshot {
  // PRD 045: prefer module's contextBinding (type-driven pull)
  if (mod.contextBinding) {
    const resolver = createTypeResolver();
    const sources = resolver.resolve(mod.contextBinding.types);
    const selector: ContextSelector = {
      sources,
      types: mod.contextBinding.types,
      budget: mod.contextBinding.budget,
      strategy: mod.contextBinding.strategy,
    };
    return partitions.buildContext(selector);
  }

  // Fallback: custom selectors (by ModuleId), then defaults (by key)
  const selector = customSelectors?.get(mod.id)
    ?? DEFAULT_MODULE_SELECTORS[moduleKey];

  if (!selector) {
    return partitions.snapshot();
  }

  return partitions.buildContext(selector);
}

// ── Factory ──────────────────────────────────────────────────────

let cycleCounter = 0;

export function createCognitiveCycle(
  modules: CycleModules,
  config: CycleConfig,
): CognitiveCycleRunner {
  // Per-module state is maintained across runs
  const moduleStates = new Map<string, unknown>();
  const maxRetries = config.errorPolicy.maxRetries ?? 1;
  const maxConsecutiveInterventions = config.maxConsecutiveInterventions ?? 3;
  let consecutiveInterventions = 0;

  // Initialize all module states
  for (const [key, mod] of Object.entries(modules)) {
    moduleStates.set(key, mod.initialState());
  }

  return {
    async run(
      input: unknown,
      workspace: WorkspaceManager,
      traceSinks: TraceSink[],
      onEvent?: (event: CognitiveEvent) => void,
    ): Promise<CycleResult> {
      const cycleNumber = ++cycleCounter;
      const traces: TraceRecord[] = [];
      const signals: AggregatedSignals = new Map();
      const phasesExecuted: string[] = [];
      let aborted: { phase: string; reason: string } | undefined;

      // Reset workspace write quotas for this cycle
      workspace.resetCycleQuotas();
      config.partitionSystem?.resetCycleQuotas();

      // Track partition monitor state for post-ACT checking
      const partitionLastWriteCycle = new Map<PartitionId, number>();
      let consecutiveCriticalSignals = 0;

      function emitEvent(event: CognitiveEvent): void {
        onEvent?.(event);
      }

      function emitPhase(phase: string): void {
        const event: CognitiveCyclePhase = {
          type: 'cognitive:cycle_phase',
          phase,
          cycleNumber,
          timestamp: Date.now(),
        };
        emitEvent(event);
      }

      function forwardTrace(trace: TraceRecord): void {
        traces.push(trace);
        for (const sink of traceSinks) {
          sink.onTrace(trace);
        }
      }

      async function runModuleStep(
        key: string,
        mod: AnyModule,
        stepInput: unknown,
        control: ControlDirective,
        phase: string,
      ): Promise<StepResult<unknown, unknown, MonitoringSignal> | null> {
        const state = moduleStates.get(key);
        const policy = resolveErrorPolicy(config.errorPolicy, mod.id);
        let retries = 0;

        while (true) {
          try {
            const startTime = Date.now();
            const result = await mod.step(stepInput, state, control);

            // Update module state
            moduleStates.set(key, result.state);

            // Build and forward trace
            const trace = buildTrace(mod.id, phase, startTime, result, stepInput);
            forwardTrace(trace);

            // Record monitoring signal
            if (result.monitoring) {
              signals.set(mod.id, result.monitoring);
            }

            // Check for step error in result
            if (result.error) {
              if (policy === 'abort') {
                aborted = { phase, reason: result.error.message };
                const abortEvent: CognitiveCycleAborted = {
                  type: 'cognitive:cycle_aborted',
                  reason: result.error.message,
                  phase,
                  cycleNumber,
                  timestamp: Date.now(),
                };
                emitEvent(abortEvent);
                return null;
              }
              if (policy === 'retry' && retries < maxRetries) {
                retries++;
                continue;
              }
              // skip: return the result as-is (output may be degraded)
            }

            return result;
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);

            if (policy === 'retry' && retries < maxRetries) {
              retries++;
              continue;
            }

            if (policy === 'abort') {
              aborted = { phase, reason: message };
              const abortEvent: CognitiveCycleAborted = {
                type: 'cognitive:cycle_aborted',
                reason: message,
                phase,
                cycleNumber,
                timestamp: Date.now(),
              };
              emitEvent(abortEvent);
              return null;
            }

            // skip: return null to indicate the phase was skipped
            return null;
          }
        }
      }

      // Helper to make a default control directive for a module
      function defaultControl(mod: AnyModule): ControlDirective {
        return {
          target: mod.id,
          timestamp: Date.now(),
        };
      }

      // ── Phase 1: OBSERVE ──────────────────────────────────────
      emitPhase('OBSERVE');
      phasesExecuted.push('OBSERVE');

      const observerInput = { content: typeof input === 'string' ? input : JSON.stringify(input), source: 'user' };
      const observeResult = await runModuleStep(
        'observer', modules.observer, observerInput,
        defaultControl(modules.observer), 'OBSERVE',
      );
      if (aborted) return { output: undefined, traces, signals, cycleNumber, phasesExecuted, aborted };

      // ── Phase 2: ATTEND ───────────────────────────────────────
      emitPhase('ATTEND');
      phasesExecuted.push('ATTEND');

      const attended = workspace.attend(10);
      // ATTEND is a workspace operation, no module step

      // ── Phase 3: REMEMBER ─────────────────────────────────────
      emitPhase('REMEMBER');
      phasesExecuted.push('REMEMBER');

      const snapshot: ReadonlyWorkspaceSnapshot = config.partitionSystem
        ? buildModuleContext('memory', modules.memory, config.partitionSystem, config.moduleSelectors)
        : workspace.snapshot();
      const memoryInput = { snapshot };
      const memoryControl = {
        target: modules.memory.id,
        timestamp: Date.now(),
        retrievalStrategy: 'semantic' as const,
      };
      const memoryResult = await runModuleStep(
        'memory', modules.memory, memoryInput,
        memoryControl, 'REMEMBER',
      );
      if (aborted) return { output: undefined, traces, signals, cycleNumber, phasesExecuted, aborted };

      // ── Phase 4: REASON ───────────────────────────────────────
      emitPhase('REASON');
      phasesExecuted.push('REASON');

      const reasonSnapshot: ReadonlyWorkspaceSnapshot = config.partitionSystem
        ? buildModuleContext('reasoner', modules.reasoner, config.partitionSystem, config.moduleSelectors)
        : workspace.snapshot();
      const reasonerInput = { snapshot: reasonSnapshot };
      const reasonerControl = {
        target: modules.reasoner.id,
        timestamp: Date.now(),
        strategy: 'cot' as const,
        effort: 'medium' as const,
      };
      const reasonResult = await runModuleStep(
        'reasoner', modules.reasoner, reasonerInput,
        reasonerControl, 'REASON',
      );
      if (aborted) return { output: undefined, traces, signals, cycleNumber, phasesExecuted, aborted };

      // ── Phase 5: MONITOR (DEFAULT-INTERVENTIONIST) ────────────
      const interventionNeeded = shouldIntervene(config.thresholds, signals);
      const budgetAllowsIntervention = config.cycleBudget?.maxConsecutiveMetaInterventions === undefined
        || consecutiveInterventions < config.cycleBudget.maxConsecutiveMetaInterventions;

      // Capture Monitor output for forwarding to Actor (Change A: Monitor wiring fix)
      let monitorOutput: { restrictedActions?: string[]; forceReplan?: boolean } | undefined;

      if (interventionNeeded && budgetAllowsIntervention
          && consecutiveInterventions < maxConsecutiveInterventions) {
        emitPhase('MONITOR');
        phasesExecuted.push('MONITOR');

        const monitorResult = await runModuleStep(
          'monitor', modules.monitor, signals,
          defaultControl(modules.monitor), 'MONITOR',
        );
        if (aborted) return { output: undefined, traces, signals, cycleNumber, phasesExecuted, aborted };

        // Capture monitor output for Actor wiring
        monitorOutput = monitorResult?.output as { restrictedActions?: string[]; forceReplan?: boolean } | undefined;

        // NOTE: Evaluator now runs unconditionally in Phase 6a (EVALUATE).
        // Previously it ran here only when Monitor intervened. PRD 045 changes this.

        // ── Phase 6: CONTROL ──────────────────────────────────────
        emitPhase('CONTROL');
        phasesExecuted.push('CONTROL');

        const plannerSnapshot: ReadonlyWorkspaceSnapshot = config.partitionSystem
          ? buildModuleContext('planner', modules.planner, config.partitionSystem, config.moduleSelectors)
          : workspace.snapshot();
        const plannerInput = { workspace: plannerSnapshot };
        const plannerControl = {
          target: modules.planner.id,
          timestamp: Date.now(),
        };
        const plannerResult = await runModuleStep(
          'planner', modules.planner, plannerInput,
          plannerControl, 'CONTROL',
        );
        if (aborted) return { output: undefined, traces, signals, cycleNumber, phasesExecuted, aborted };

        // Validate directives against ControlPolicy
        const plannerOutput = plannerResult?.output as { directives?: ControlDirective[] } | undefined;
        if (plannerOutput?.directives) {
          for (const directive of plannerOutput.directives) {
            if (!config.controlPolicy.validate(directive)) {
              emitEvent({
                type: 'cognitive:control_policy_violation',
                directive,
                reason: 'Directive rejected by control policy',
                timestamp: Date.now(),
              });
            } else {
              emitEvent({
                type: 'cognitive:control_directive',
                directive,
                timestamp: Date.now(),
              });
            }
          }
        }

        consecutiveInterventions++;
      } else {
        // Reset consecutive intervention counter when no intervention needed
        if (!interventionNeeded) {
          consecutiveInterventions = 0;
        }
      }

      // ── Phase 6a: EVALUATE (UNCONDITIONAL — PRD 045) ──────────
      // Runs every cycle, not gated by shouldIntervene. Computes goal-state
      // discrepancy and may emit TerminateSignal. If terminated, skip ACT/LEARN.
      let terminateSignal: import('../algebra/goal-types.js').TerminateSignal | undefined;

      {
        emitPhase('EVALUATE');
        phasesExecuted.push('EVALUATE');

        const evalSnapshot: ReadonlyWorkspaceSnapshot = config.partitionSystem
          ? buildModuleContext('evaluator', modules.evaluator, config.partitionSystem, config.moduleSelectors)
          : workspace.snapshot();
        const evaluatorInput = { workspace: evalSnapshot, signals };
        const evaluatorControl = {
          target: modules.evaluator.id,
          timestamp: Date.now(),
          evaluationHorizon: 'trajectory' as const,
        };
        const evalResult = await runModuleStep(
          'evaluator', modules.evaluator, evaluatorInput,
          evaluatorControl, 'EVALUATE',
        );
        if (aborted) return { output: undefined, traces, signals, cycleNumber, phasesExecuted, aborted };

        // Check for TerminateSignal in evaluator output
        const evalOutput = evalResult?.output as { terminateSignal?: import('../algebra/goal-types.js').TerminateSignal } | undefined;
        if (evalOutput?.terminateSignal) {
          terminateSignal = evalOutput.terminateSignal;
        }
      }

      // If Evaluator emitted TerminateSignal, skip ACT/LEARN and return
      if (terminateSignal) {
        const output = reasonResult?.output ?? observeResult?.output;
        return {
          output,
          traces,
          signals,
          cycleNumber,
          phasesExecuted,
          aborted,
          terminated: terminateSignal,
        };
      }

      // ── Check cycle budget ────────────────────────────────────
      if (config.cycleBudget) {
        const budget = config.cycleBudget;

        if (budget.maxProviderCallsPerCycle !== undefined && traces.length > budget.maxProviderCallsPerCycle) {
          aborted = { phase: 'BUDGET', reason: 'Provider call budget exceeded' };
          emitEvent({
            type: 'cognitive:cycle_aborted',
            reason: 'Provider call budget exceeded',
            phase: 'BUDGET',
            cycleNumber,
            timestamp: Date.now(),
          });
          return { output: undefined, traces, signals, cycleNumber, phasesExecuted, aborted };
        }

        if (budget.maxTokensPerCycle !== undefined) {
          const totalTokens = traces.reduce(
            (sum, t) => sum + (t.tokenUsage?.totalTokens ?? 0), 0,
          );
          if (totalTokens > budget.maxTokensPerCycle) {
            aborted = { phase: 'BUDGET', reason: 'Token budget exceeded' };
            emitEvent({
              type: 'cognitive:cycle_aborted',
              reason: 'Token budget exceeded',
              phase: 'BUDGET',
              cycleNumber,
              timestamp: Date.now(),
            });
            return { output: undefined, traces, signals, cycleNumber, phasesExecuted, aborted };
          }
        }
      }

      // ── Phase 7: ACT ──────────────────────────────────────────
      emitPhase('ACT');
      phasesExecuted.push('ACT');

      const actSnapshot: ReadonlyWorkspaceSnapshot = config.partitionSystem
        ? buildModuleContext('actor', modules.actor, config.partitionSystem, config.moduleSelectors)
        : workspace.snapshot();
      const actorInput = { snapshot: actSnapshot };

      // Build Actor control — forward Monitor output when available (D5 wiring fix)
      // ControlDirective is the base type; restrictedActions/forceReplan are extension
      // fields consumed by module-specific control types (e.g. ReasonerActorControl).
      let actorControl: ControlDirective = defaultControl(modules.actor);
      if (monitorOutput) {
        actorControl = {
          ...actorControl,
          restrictedActions: monitorOutput.restrictedActions ?? [],
          forceReplan: monitorOutput.forceReplan ?? false,
        } as ControlDirective;
        const directiveEvent: CognitiveMonitorDirectiveApplied = {
          type: 'cognitive:monitor_directive_applied',
          restrictedActions: monitorOutput.restrictedActions ?? [],
          forceReplan: monitorOutput.forceReplan ?? false,
          source: 'monitor',
          targetModule: 'actor',
          timestamp: Date.now(),
        };
        emitEvent(directiveEvent);
      }

      const actResult = await runModuleStep(
        'actor', modules.actor, actorInput,
        actorControl, 'ACT',
      );
      if (aborted) return { output: undefined, traces, signals, cycleNumber, phasesExecuted, aborted };

      // ── Post-ACT Constraint Verification (always-on, D4) ──────
      // Runs unconditionally after every ACT phase — NOT gated by shouldIntervene.
      // Pure-function check against pinned workspace constraints.
      const pinnedEntries = workspace.snapshot().filter((e: any) => e.pinned);
      if (pinnedEntries.length > 0 && actResult?.output) {
        const actContent = typeof actResult.output === 'string'
          ? actResult.output : JSON.stringify(actResult.output);
        const violations = checkConstraintViolations(pinnedEntries, actContent);
        if (violations.length > 0) {
          for (const v of violations) {
            const violationEvent: CognitiveConstraintViolation = {
              type: 'cognitive:constraint_violation',
              constraint: v.constraint,
              violation: v.violation,
              pattern: v.pattern,
              timestamp: Date.now(),
            };
            emitEvent(violationEvent);
          }
        }
      }

      // ── Post-ACT Partition Write Tracking (PRD 045) ────────────────
      // Update partitionLastWriteCycle from write adapters so partition
      // monitors can detect stagnation accurately.
      if (config.partitionWriteAdapters) {
        for (const [_key, adapter] of config.partitionWriteAdapters) {
          for (const [partId] of adapter.getWrittenPartitions()) {
            partitionLastWriteCycle.set(partId, cycleNumber);
          }
          adapter.resetCycleTracking();
        }
      }

      // ── Post-ACT Partition Monitor Check (PRD 044) ──────────────
      // When partitionSystem is provided, run per-partition monitors and
      // aggregate signals by severity. This subsumes the inline constraint
      // check above for partitioned mode — but both paths coexist for
      // backward compatibility.
      if (config.partitionSystem && actResult?.output) {
        const actContent = typeof actResult.output === 'string'
          ? actResult.output : JSON.stringify(actResult.output);

        const monitorContext: PartitionMonitorContext = {
          cycleNumber,
          lastWriteCycle: partitionLastWriteCycle,
          actorOutput: actContent,
        };

        const partitionSignals = config.partitionSystem.checkPartitions(monitorContext);

        for (const sig of partitionSignals) {
          // Emit constraint violations as CognitiveConstraintViolation events
          // for backward compatibility with existing event consumers
          if (sig.type === 'constraint-violation') {
            const violationEvent: CognitiveConstraintViolation = {
              type: 'cognitive:constraint_violation',
              constraint: sig.detail,
              violation: sig.detail,
              pattern: 'partition-monitor',
              timestamp: Date.now(),
            };
            emitEvent(violationEvent);
          }

          // Critical signals → RESTRICT + REPLAN (same behavioral contract)
          if (sig.severity === 'critical') {
            consecutiveCriticalSignals++;
            // Force next cycle to intervene by injecting a high-severity signal
            signals.set(createModuleId('partition-monitor') as unknown as ModuleId, {
              source: createModuleId('partition-monitor') as unknown as ModuleId,
              timestamp: Date.now(),
              anomalyDetected: true,
              escalation: 'critical',
              partitionSignal: sig,
            } as unknown as MonitoringSignal);
          } else if (sig.severity === 'high' && consecutiveCriticalSignals >= 2) {
            // Persistent high signals also escalate
            signals.set(createModuleId('partition-monitor') as unknown as ModuleId, {
              source: createModuleId('partition-monitor') as unknown as ModuleId,
              timestamp: Date.now(),
              anomalyDetected: true,
              escalation: 'high',
              partitionSignal: sig,
            } as unknown as MonitoringSignal);
          }
        }
      }

      // ── Phase 8: LEARN (FIRE-AND-FORGET) ──────────────────────
      emitPhase('LEARN');
      phasesExecuted.push('LEARN');

      // Save reflector state before fire-and-forget step
      const reflectorStateBefore = moduleStates.get('reflector');

      const reflectorInput = { traces: [...traces] };
      const reflectorControl = {
        target: modules.reflector.id,
        timestamp: Date.now(),
        reflectionDepth: 'shallow' as const,
      };

      // Fire-and-forget: don't await, catch rejections
      const learnPromise = modules.reflector.step(
        reflectorInput,
        reflectorStateBefore,
        reflectorControl,
      ).then((result: StepResult<unknown, unknown, MonitoringSignal>) => {
        // Only update state on success
        moduleStates.set('reflector', result.state);

        // Build and forward trace
        const trace = buildTrace(
          modules.reflector.id, 'LEARN', Date.now(), result, reflectorInput,
        );
        forwardTrace(trace);

        if (result.monitoring) {
          signals.set(modules.reflector.id, result.monitoring);
        }
      }).catch((err: unknown) => {
        // State-lock: revert to pre-step state
        moduleStates.set('reflector', reflectorStateBefore);

        const error: StepError = {
          message: err instanceof Error ? err.message : String(err),
          recoverable: true,
          moduleId: modules.reflector.id,
          phase: 'LEARN',
        };

        const learnFailedEvent: CognitiveLEARNFailed = {
          type: 'cognitive:learn_failed',
          error,
          cycleNumber,
          timestamp: Date.now(),
        };
        emitEvent(learnFailedEvent);
      });

      // Stash the promise so callers can optionally await it in tests
      // but don't block the cycle return
      void learnPromise;

      // ── Return result ─────────────────────────────────────────
      const output = actResult?.output ?? observeResult?.output;
      return {
        output,
        traces,
        signals,
        cycleNumber,
        phasesExecuted,
        aborted,
      };
    },
  };
}
