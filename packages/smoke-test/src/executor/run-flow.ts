// SPDX-License-Identifier: Apache-2.0
/**
 * RunFlow — enriched execution trace for strategy-layer cases.
 *
 * Populated by the mock executor (C-4) alongside the existing RunEvent output.
 * Consumed by the SVG DAG renderer (C-9) in the feature detail view.
 *
 * Only strategy-layer cases populate `flow`. Method and methodology cases
 * leave it undefined — the renderer defensively shows a step/phase list instead.
 *
 * Frozen in Wave 0 of PRD 056. Gate: G-FLOW-SCHEMA (TypeScript compilation).
 */

export interface RunFlow {
  nodes: Array<{
    id: string;
    type: 'methodology' | 'script' | 'strategy' | 'semantic' | 'context-load';
    status: 'completed' | 'failed' | 'suspended' | 'skipped';
    attempts: Array<{
      attempt: number;
      output: Record<string, unknown>;
      cost_usd: number;
      duration_ms: number;
      feedback?: string;
    }>;
    artifactsProduced: string[];
    artifactsConsumed: string[];
  }>;
  gates: Array<{
    id: string;
    afterNode: string;
    type: 'algorithmic' | 'observation' | 'human-approval' | 'strategy-level';
    expression?: string;
    passed: boolean;
    evaluationDetail?: string;
    retryFeedback?: string;
  }>;
  edges: Array<{ from: string; to: string; artifact?: string }>;
  oversightEvents: Array<{ type: 'escalate' | 'warn'; trigger: string; afterNode: string }>;
}
