/**
 * Playground types — fidelity levels, eval reports, scenario definitions.
 */

import type { SchemaDefinition } from '@method/pacta';

// ── Fidelity Levels ──────────────────────────────────────────────

/** Simulation fidelity tier */
export type FidelityLevel = 'stub' | 'script' | 'virtual';

// ── Eval Report ──────────────────────────────────────────────────

export interface EvalReport {
  scenario: string;
  agent: string;
  behavioral: { toolsCorrect: boolean; sequenceCorrect: boolean };
  output: { schemaValid: boolean; qualityScore?: number };
  resources: { tokens: number; cost: number; turns: number; durationMs: number };
  reasoning: { planDetected: boolean; reflectionDetected: boolean; thinkToolUsed: boolean };
  robustness?: { faultInjected: string; recovered: boolean };
}

// ── Comparative Report ───────────────────────────────────────────

export interface ComparativeReport {
  scenario: string;
  agents: [string, string];
  reports: [EvalReport, EvalReport];
  diff: {
    toolSequenceSame: boolean;
    toolCountDelta: number;
    tokenDelta: number;
    costDelta: number;
    turnsDelta: number;
    durationDelta: number;
    bothCorrect: boolean;
    bothSchemaValid: boolean;
  };
}

// ── Scenario Assertions ──────────────────────────────────────────

export interface ScenarioAssertion {
  type: 'tools_called' | 'output_matches' | 'tokens_below';
  tools?: string[];
  schema?: SchemaDefinition<unknown>;
  maxTokens?: number;
}
