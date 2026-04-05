/**
 * CLM Metrics — per-stage and aggregate metric collection.
 */

import type {
  StageMetrics,
  GateMetrics,
  PipelineMetrics,
  AggregateMetrics,
} from './types.js';

// ── Per-Pipeline Collector ───────────────────────────────────

export interface MetricsCollector {
  recordStage(metrics: StageMetrics): void;
  recordGate(metrics: GateMetrics): void;
  finalize(success: boolean, totalLatencyMs: number): PipelineMetrics;
}

export function createMetricsCollector(pipelineId: string): MetricsCollector {
  const stages: StageMetrics[] = [];
  const gates: GateMetrics[] = [];

  return {
    recordStage(metrics: StageMetrics): void {
      stages.push(metrics);
    },

    recordGate(metrics: GateMetrics): void {
      gates.push(metrics);
    },

    finalize(success: boolean, totalLatencyMs: number): PipelineMetrics {
      const gatePassRate = gates.length > 0
        ? gates.filter(g => g.pass).length / gates.length
        : 1.0;
      const escalationRate = stages.length > 0
        ? stages.filter(s => s.escalated).length / stages.length
        : 0;

      return {
        pipelineId,
        totalLatencyMs,
        stages: [...stages],
        gates: [...gates],
        gatePassRate,
        escalationRate,
        endToEndSuccess: success,
      };
    },
  };
}

// ── Aggregate Collector (across multiple runs) ───────────────

export interface AggregateCollector {
  addRun(metrics: PipelineMetrics): void;
  getAggregate(): AggregateMetrics;
}

export function createAggregateCollector(): AggregateCollector {
  const runs: PipelineMetrics[] = [];

  return {
    addRun(metrics: PipelineMetrics): void {
      runs.push(metrics);
    },

    getAggregate(): AggregateMetrics {
      const totalRuns = runs.length;
      if (totalRuns === 0) {
        return {
          totalRuns: 0,
          successRate: 0,
          gateEffectiveness: 0,
          meanLatencyMs: 0,
          escalationRate: 0,
        };
      }

      const successRate = runs.filter(r => r.endToEndSuccess).length / totalRuns;
      const meanLatencyMs = runs.reduce((s, r) => s + r.totalLatencyMs, 0) / totalRuns;
      const escalationRate = runs.reduce((s, r) => s + r.escalationRate, 0) / totalRuns;

      // Gate effectiveness: fraction of gate checks that passed
      const totalGates = runs.reduce((s, r) => s + r.gates.length, 0);
      const passedGates = runs.reduce(
        (s, r) => s + r.gates.filter(g => g.pass).length, 0,
      );
      const gateEffectiveness = totalGates > 0 ? passedGates / totalGates : 1.0;

      return {
        totalRuns,
        successRate,
        gateEffectiveness,
        meanLatencyMs,
        escalationRate,
      };
    },
  };
}
