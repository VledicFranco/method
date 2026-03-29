/**
 * Cost Tracker — instrumentation for exp-interventionist-cost.
 *
 * Wraps cognitive cycle runs to capture per-phase token counts, wall-clock
 * latency, monitor invocation frequency, error detections, and total cost.
 * Outputs per-run metrics as JSON for statistical analysis.
 *
 * Design: the tracker is a TraceSink that receives TraceRecords from the
 * cognitive cycle engine. It accumulates metrics per cycle and per run,
 * then serializes to the results directory.
 */

import type { TraceSink, TraceRecord } from '../../../packages/pacta/src/cognitive/algebra/index.js';
import type { TokenUsage } from '../../../packages/pacta/src/pact.js';

// ── Per-Cycle Metrics ─────────────────────────────────────────────

export interface CycleMetrics {
  cycleNumber: number;
  phasesExecuted: string[];
  monitorFired: boolean;
  controlFired: boolean;
  totalTokens: number;
  monitorTokens: number;
  objectLevelTokens: number;
  durationMs: number;
  anomalyDetected: boolean;
  anomalyDetails: string[];
  /** Was this a useful intervention (led to strategy change or error fix)? */
  usefulIntervention: boolean;
  // ── v2 enriched fields ──────────────────────────────────────────
  /** Prediction error from MonitorV2 (max across signals). Null if not available. */
  predictionError: number | null;
  /** EVC intervention decision: true = intervened, false = skipped, null = no EVC policy. */
  evcDecision: boolean | null;
  /** Precision parameter from MonitorV2 (average across modules). Null if not available. */
  precision: number | null;
  /** Impasse type detected by ReasonerActorV2. Null if none. */
  impasseType: string | null;
}

// ── Per-Run Metrics ───────────────────────────────────────────────

export interface RunMetrics {
  /** Unique run identifier. */
  runId: string;
  /** Condition label: no-monitor | always-on | interventionist. */
  condition: string;
  /** Task identifier. */
  taskId: string;
  /** Task difficulty tier. */
  tier: number;
  /** Whether the task has an injected error. */
  hasInjectedError: boolean;
  /** Task completion success. */
  success: boolean;
  /** Validation reason. */
  reason: string;
  /** Total tokens across all cycles. */
  totalTokens: number;
  /** Tokens spent on monitor + control phases only. */
  monitorTokens: number;
  /** Tokens spent on object-level phases only. */
  objectLevelTokens: number;
  /** Token overhead factor: totalTokens / baseline (filled in post-hoc). */
  tokenOverheadFactor: number | null;
  /** Total wall-clock time in ms. */
  totalDurationMs: number;
  /** Number of cognitive cycles executed. */
  cycleCount: number;
  /** Number of cycles where MONITOR phase fired. */
  monitorInvocationCount: number;
  /** Number of anomalies detected by monitor. */
  anomaliesDetected: number;
  /** Number of interventions that were useful (led to behavior change). */
  usefulInterventions: number;
  /** Error detection rate: anomalies / injected errors (for injected-error tasks). */
  errorDetectionRate: number | null;
  /** Intervention precision: useful / total interventions. */
  interventionPrecision: number | null;
  /** Cost-effectiveness ratio: errorDetectionRate / tokenOverheadFactor. */
  costEffectivenessRatio: number | null;
  /** Per-cycle breakdown. */
  cycles: CycleMetrics[];
  /** Timestamp of run start. */
  startedAt: string;
  /** Timestamp of run end. */
  completedAt: string;
}

// ── Cost Tracker (TraceSink) ──────────────────────────────────────

export class CostTracker implements TraceSink {
  private traces: TraceRecord[] = [];
  private cycleTraces: Map<number, TraceRecord[]> = new Map();
  private currentCycle = 0;

  /** Reset for a new run. */
  reset(): void {
    this.traces = [];
    this.cycleTraces = new Map();
    this.currentCycle = 0;
  }

  /** Increment cycle counter (called by run harness between cycles). */
  nextCycle(): void {
    this.currentCycle++;
  }

  /** Get current cycle number. */
  getCycleNumber(): number {
    return this.currentCycle;
  }

  /** TraceSink implementation — receives trace records from the cognitive engine. */
  onTrace(record: TraceRecord): void {
    this.traces.push(record);

    if (!this.cycleTraces.has(this.currentCycle)) {
      this.cycleTraces.set(this.currentCycle, []);
    }
    this.cycleTraces.get(this.currentCycle)!.push(record);
  }

  /** Extract token usage from a trace record (0 if unavailable). */
  private getTokens(trace: TraceRecord): number {
    return trace.tokenUsage?.totalTokens ?? 0;
  }

  /** Check if a trace is from a meta-level phase. */
  private isMonitorPhase(trace: TraceRecord): boolean {
    return trace.phase === 'MONITOR' || trace.phase === 'CONTROL';
  }

  /** Build per-cycle metrics from accumulated traces. */
  buildCycleMetrics(): CycleMetrics[] {
    const cycles: CycleMetrics[] = [];

    for (const [cycleNum, cycleTraces] of this.cycleTraces) {
      const phases = [...new Set(cycleTraces.map(t => t.phase))];
      const monitorFired = phases.includes('MONITOR');
      const controlFired = phases.includes('CONTROL');

      const totalTokens = cycleTraces.reduce((sum, t) => sum + this.getTokens(t), 0);
      const monitorTokens = cycleTraces
        .filter(t => this.isMonitorPhase(t))
        .reduce((sum, t) => sum + this.getTokens(t), 0);
      const objectLevelTokens = totalTokens - monitorTokens;
      const durationMs = cycleTraces.reduce((sum, t) => sum + t.durationMs, 0);

      // Check for anomaly detection in monitoring signals
      const anomalyDetails: string[] = [];
      let anomalyDetected = false;
      // v2 enriched fields
      let predictionError: number | null = null;
      let precision: number | null = null;
      let impasseType: string | null = null;

      for (const trace of cycleTraces) {
        if (trace.phase === 'MONITOR' && trace.monitoring) {
          const mon = trace.monitoring as {
            anomalyDetected?: boolean;
            escalation?: string;
            predictionError?: number;
            precision?: number;
          };
          if (mon.anomalyDetected) {
            anomalyDetected = true;
            if (mon.escalation) anomalyDetails.push(mon.escalation);
          }
          // Extract v2 enriched fields from MonitorV2 monitoring signal
          if (typeof mon.predictionError === 'number') {
            predictionError = mon.predictionError;
          }
          if (typeof mon.precision === 'number') {
            precision = mon.precision;
          }
        }
        // Extract impasse from ReasonerActorV2 monitoring signal
        if (trace.phase === 'REASON' && trace.monitoring) {
          const raMon = trace.monitoring as { impasse?: { type: string } };
          if (raMon.impasse?.type) {
            impasseType = raMon.impasse.type;
          }
        }
      }

      // EVC decision: if monitor fired, the EVC policy decided to intervene
      const evcDecision = monitorFired ? true : (anomalyDetected ? false : null);

      cycles.push({
        cycleNumber: cycleNum,
        phasesExecuted: phases,
        monitorFired,
        controlFired,
        totalTokens,
        monitorTokens,
        objectLevelTokens,
        durationMs,
        anomalyDetected,
        anomalyDetails,
        // Useful intervention is determined post-hoc by comparing the next cycle's behavior
        usefulIntervention: false,
        // v2 enriched fields
        predictionError,
        evcDecision,
        precision,
        impasseType,
      });
    }

    // Mark useful interventions: an intervention is useful if the next cycle's
    // action differs from the current cycle's action (strategy actually changed).
    for (let i = 0; i < cycles.length - 1; i++) {
      if (cycles[i].anomalyDetected && cycles[i].monitorFired) {
        // Simple heuristic: if the next cycle executed different phases or
        // the output summary changed, the intervention was useful.
        const currentPhases = cycles[i].phasesExecuted.join(',');
        const nextPhases = cycles[i + 1].phasesExecuted.join(',');
        if (currentPhases !== nextPhases) {
          cycles[i].usefulIntervention = true;
        }
      }
    }

    return cycles;
  }

  /** Build complete run metrics. */
  buildRunMetrics(params: {
    runId: string;
    condition: string;
    taskId: string;
    tier: number;
    hasInjectedError: boolean;
    success: boolean;
    reason: string;
    startedAt: Date;
  }): RunMetrics {
    const completedAt = new Date();
    const cycles = this.buildCycleMetrics();

    const totalTokens = cycles.reduce((sum, c) => sum + c.totalTokens, 0);
    const monitorTokens = cycles.reduce((sum, c) => sum + c.monitorTokens, 0);
    const objectLevelTokens = cycles.reduce((sum, c) => sum + c.objectLevelTokens, 0);
    const totalDurationMs = cycles.reduce((sum, c) => sum + c.durationMs, 0);
    const monitorInvocationCount = cycles.filter(c => c.monitorFired).length;
    const anomaliesDetected = cycles.filter(c => c.anomalyDetected).length;
    const usefulInterventions = cycles.filter(c => c.usefulIntervention).length;

    const interventionPrecision = monitorInvocationCount > 0
      ? usefulInterventions / monitorInvocationCount
      : null;

    return {
      runId: params.runId,
      condition: params.condition,
      taskId: params.taskId,
      tier: params.tier,
      hasInjectedError: params.hasInjectedError,
      success: params.success,
      reason: params.reason,
      totalTokens,
      monitorTokens,
      objectLevelTokens,
      tokenOverheadFactor: null, // Filled in post-hoc during analysis
      totalDurationMs,
      cycleCount: cycles.length,
      monitorInvocationCount,
      anomaliesDetected,
      usefulInterventions,
      errorDetectionRate: null, // Filled in post-hoc for injected-error tasks
      interventionPrecision,
      costEffectivenessRatio: null, // Filled in post-hoc during analysis
      cycles,
      startedAt: params.startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
    };
  }

  /** Get raw traces for debugging. */
  getAllTraces(): TraceRecord[] {
    return [...this.traces];
  }
}

// ── Budget Guardian ───────────────────────────────────────────────

/**
 * Tracks cumulative API spend across all runs and aborts the experiment
 * if budget limits are exceeded.
 */
export class BudgetGuardian {
  private totalTokens = 0;
  private conditionTokens: Map<string, number> = new Map();
  private runCount = 0;

  constructor(
    private readonly maxTotalBudgetUsd: number = 17.0,
    private readonly maxConditionBudgetUsd: number = 6.0,
    private readonly abortThreshold: number = 0.70,
  ) {}

  /** Estimate USD cost from token count (Sonnet pricing, 3:1 input:output ratio). */
  private estimateCostUsd(tokens: number): number {
    const inputTokens = tokens * 0.75;  // ~75% input
    const outputTokens = tokens * 0.25; // ~25% output
    const inputCost = (inputTokens / 1_000_000) * 3;   // $3/M input
    const outputCost = (outputTokens / 1_000_000) * 15; // $15/M output
    return inputCost + outputCost;
  }

  /** Record a completed run's token usage. Throws if budget exceeded. */
  recordRun(condition: string, tokens: number): void {
    this.totalTokens += tokens;
    this.runCount++;

    const conditionTotal = (this.conditionTokens.get(condition) ?? 0) + tokens;
    this.conditionTokens.set(condition, conditionTotal);

    const totalCost = this.estimateCostUsd(this.totalTokens);
    const conditionCost = this.estimateCostUsd(conditionTotal);

    if (totalCost > this.maxTotalBudgetUsd * this.abortThreshold) {
      throw new BudgetExceededError(
        `Total cost estimate $${totalCost.toFixed(2)} exceeds ${this.abortThreshold * 100}% ` +
        `of $${this.maxTotalBudgetUsd} budget after ${this.runCount} runs`,
      );
    }

    if (conditionCost > this.maxConditionBudgetUsd) {
      throw new BudgetExceededError(
        `Condition "${condition}" cost estimate $${conditionCost.toFixed(2)} exceeds ` +
        `$${this.maxConditionBudgetUsd} per-condition budget`,
      );
    }
  }

  /** Get current spend summary. */
  summary(): { totalTokens: number; estimatedCostUsd: number; runCount: number } {
    return {
      totalTokens: this.totalTokens,
      estimatedCostUsd: this.estimateCostUsd(this.totalTokens),
      runCount: this.runCount,
    };
  }
}

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}
