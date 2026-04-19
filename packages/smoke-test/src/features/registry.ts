// SPDX-License-Identifier: Apache-2.0
/**
 * Feature registry — catalog of every smoke-testable capability in the
 * method runtime, grouped into 8 clusters across 4 layers.
 *
 * Lifted from method-1/tmp/smoke-test-visualization-design.md §Feature
 * Inventory with Narratives and method-1/tmp/smoke-test-viz-mock.html
 * (CLUSTERS and CASES blocks). Feature IDs match the canonical tags used
 * by SmokeTestCase.features[] so that G-FEATURE-REF resolves at startup.
 *
 * Narratives are extracted to narratives.ts (D-2) to keep this file
 * focused on structure.
 *
 * coverage/coveringCaseIds are seeded to 'gap'/[] here; computeCoverage()
 * overwrites both from the live case registry at server startup.
 */

import type { Feature } from './types.js';
import type { SmokeTestCase } from '../cases/index.js';
import { featureNarratives } from './narratives.js';

/** Helper — seed a feature with gap/[] defaults. */
function feature(input: {
  id: string;
  layerId: Feature['layerId'];
  clusterId: string;
  name: string;
  endpoints?: string[];
  proposedTest?: Feature['proposedTest'];
}): Feature {
  const narrative = featureNarratives[input.id];
  if (!narrative) {
    throw new Error(`featureNarratives missing entry for ${input.id}`);
  }
  return {
    id: input.id,
    layerId: input.layerId,
    clusterId: input.clusterId,
    name: input.name,
    narrative,
    endpoints: input.endpoints,
    coverage: 'gap',
    coveringCaseIds: [],
    proposedTest: input.proposedTest,
  };
}

export const featureRegistry: Feature[] = [
  // ── Methodology Layer — Session Lifecycle ────────────────────────
  feature({
    id: 'methodology-start',
    layerId: 'methodology',
    clusterId: 'session-lifecycle',
    name: 'Session Start',
    endpoints: ['methodology_start'],
  }),
  feature({
    id: 'methodology-list',
    layerId: 'methodology',
    clusterId: 'session-lifecycle',
    name: 'Methodology Listing',
    endpoints: ['methodology_list'],
  }),
  feature({
    id: 'methodology-status',
    layerId: 'methodology',
    clusterId: 'session-lifecycle',
    name: 'Session Status',
    endpoints: ['methodology_status'],
  }),
  feature({
    id: 'session-isolation',
    layerId: 'methodology',
    clusterId: 'session-lifecycle',
    name: 'Session Isolation',
    endpoints: ['methodology_start', 'methodology_status'],
  }),

  // ── Methodology Layer — Routing & Transition ─────────────────────
  feature({
    id: 'routing-inspection',
    layerId: 'methodology',
    clusterId: 'routing-transition',
    name: 'Routing Inspection',
    endpoints: ['methodology_get_routing'],
  }),
  feature({
    id: 'route-evaluation',
    layerId: 'methodology',
    clusterId: 'routing-transition',
    name: 'Route Evaluation',
    endpoints: ['methodology_route'],
  }),
  feature({
    id: 'method-selection',
    layerId: 'methodology',
    clusterId: 'routing-transition',
    name: 'Method Selection',
    endpoints: ['methodology_select'],
  }),
  feature({
    id: 'methodology-transition',
    layerId: 'methodology',
    clusterId: 'routing-transition',
    name: 'Method Transition',
    endpoints: ['methodology_transition'],
  }),

  // ── Method Layer — Step Execution ────────────────────────────────
  feature({
    id: 'step-current',
    layerId: 'method',
    clusterId: 'step-execution',
    name: 'Step Inspection',
    endpoints: ['step_current'],
  }),
  feature({
    id: 'step-context',
    layerId: 'method',
    clusterId: 'step-execution',
    name: 'Context Assembly',
    endpoints: ['step_context'],
  }),
  feature({
    id: 'step-advance',
    layerId: 'method',
    clusterId: 'step-execution',
    name: 'Step Advancement',
    endpoints: ['step_advance'],
  }),
  feature({
    id: 'step-validate',
    layerId: 'method',
    clusterId: 'step-execution',
    name: 'Output Validation',
    endpoints: ['step_validate'],
  }),
  feature({
    id: 'step-preconditions',
    layerId: 'method',
    clusterId: 'step-execution',
    name: 'Precondition Display',
    endpoints: ['step_current'],
  }),

  // ── Strategy Layer — Node Types ──────────────────────────────────
  feature({
    id: 'methodology-node',
    layerId: 'strategy',
    clusterId: 'node-types',
    name: 'Methodology Node',
    endpoints: ['strategy_execute'],
  }),
  feature({
    id: 'script-node',
    layerId: 'strategy',
    clusterId: 'node-types',
    name: 'Script Node',
    endpoints: ['strategy_execute'],
  }),
  feature({
    id: 'strategy-node',
    layerId: 'strategy',
    clusterId: 'node-types',
    name: 'Strategy Node (sub-strategy)',
    endpoints: ['strategy_execute'],
  }),
  feature({
    id: 'semantic-node',
    layerId: 'strategy',
    clusterId: 'node-types',
    name: 'Semantic Node',
    endpoints: ['strategy_execute'],
  }),
  feature({
    id: 'context-load-node',
    layerId: 'strategy',
    clusterId: 'node-types',
    name: 'Context Load Node',
    endpoints: ['strategy_execute'],
  }),
  feature({
    id: 'sub-strategy',
    layerId: 'strategy',
    clusterId: 'node-types',
    name: 'Sub-strategy Invocation',
    endpoints: ['strategy_execute'],
  }),
  feature({
    id: 'spl-algorithms',
    layerId: 'strategy',
    clusterId: 'node-types',
    name: 'SPL Algorithm Dispatch',
    endpoints: ['strategy_execute'],
  }),
  feature({
    id: 'fca-index',
    layerId: 'strategy',
    clusterId: 'node-types',
    name: 'FCA Index Query',
    endpoints: ['strategy_execute'],
  }),

  // ── Strategy Layer — Gates & Control Flow ────────────────────────
  feature({
    id: 'algorithmic-gate',
    layerId: 'strategy',
    clusterId: 'gates-control-flow',
    name: 'Algorithmic Gate',
    endpoints: ['strategy_execute'],
  }),
  feature({
    id: 'observation-gate',
    layerId: 'strategy',
    clusterId: 'gates-control-flow',
    name: 'Observation Gate',
    endpoints: ['strategy_execute'],
  }),
  feature({
    id: 'human-approval-gate',
    layerId: 'strategy',
    clusterId: 'gates-control-flow',
    name: 'Human Approval Gate',
    endpoints: ['strategy_execute'],
  }),
  feature({
    id: 'gate-retry',
    layerId: 'strategy',
    clusterId: 'gates-control-flow',
    name: 'Gate Retry + Feedback',
    endpoints: ['strategy_execute'],
  }),
  feature({
    id: 'strategy-level-gate',
    layerId: 'strategy',
    clusterId: 'gates-control-flow',
    name: 'Strategy-Level Gate',
    endpoints: ['strategy_execute'],
  }),
  feature({
    id: 'gate-expressions',
    layerId: 'strategy',
    clusterId: 'gates-control-flow',
    name: 'Gate Expression Language',
  }),
  feature({
    id: 'execution-metadata',
    layerId: 'strategy',
    clusterId: 'gates-control-flow',
    name: 'Execution Metadata',
  }),
  feature({
    id: 'human-approval-flow',
    layerId: 'strategy',
    clusterId: 'gates-control-flow',
    name: 'Human Approval Flow',
  }),
  feature({
    id: 'feedback-injection',
    layerId: 'strategy',
    clusterId: 'gates-control-flow',
    name: 'Feedback Injection',
  }),

  // ── Strategy Layer — Data Flow & Oversight ───────────────────────
  feature({
    id: 'artifact-passing',
    layerId: 'strategy',
    clusterId: 'data-flow-oversight',
    name: 'Artifact Passing',
    endpoints: ['strategy_execute'],
  }),
  feature({
    id: 'artifact-versioning',
    layerId: 'strategy',
    clusterId: 'data-flow-oversight',
    name: 'Artifact Versioning',
    endpoints: ['strategy_execute'],
  }),
  feature({
    id: 'oversight-rules',
    layerId: 'strategy',
    clusterId: 'data-flow-oversight',
    name: 'Oversight Rules',
    endpoints: ['strategy_execute'],
  }),
  feature({
    id: 'escalate-to-human',
    layerId: 'strategy',
    clusterId: 'data-flow-oversight',
    name: 'Oversight: Escalate',
    endpoints: ['strategy_execute'],
  }),
  feature({
    id: 'warn-human',
    layerId: 'strategy',
    clusterId: 'data-flow-oversight',
    name: 'Oversight: Warn',
    endpoints: ['strategy_execute'],
  }),
  feature({
    id: 'immutable-store',
    layerId: 'strategy',
    clusterId: 'data-flow-oversight',
    name: 'Immutable Artifact Store',
  }),
  feature({
    id: 'node-dependencies',
    layerId: 'strategy',
    clusterId: 'data-flow-oversight',
    name: 'Node Dependencies',
  }),

  // ── Strategy Layer — Execution Engine ────────────────────────────
  feature({
    id: 'parallel-execution',
    layerId: 'strategy',
    clusterId: 'execution-engine',
    name: 'Parallel Execution',
    endpoints: ['strategy_execute'],
  }),
  feature({
    id: 'prompt-construction',
    layerId: 'strategy',
    clusterId: 'execution-engine',
    name: 'Prompt Assembly',
    endpoints: ['strategy_execute'],
  }),
  feature({
    id: 'scope-contract',
    layerId: 'strategy',
    clusterId: 'execution-engine',
    name: 'Scope Contract',
    endpoints: ['strategy_execute'],
  }),
  feature({
    id: 'budget-enforcement',
    layerId: 'strategy',
    clusterId: 'execution-engine',
    name: 'Budget Enforcement',
    endpoints: ['strategy_execute'],
  }),
  feature({
    id: 'output-validation',
    layerId: 'strategy',
    clusterId: 'execution-engine',
    name: 'Output Validation',
    endpoints: ['strategy_execute'],
  }),
  feature({
    id: 'dag-validation',
    layerId: 'strategy',
    clusterId: 'execution-engine',
    name: 'DAG Validation',
    endpoints: ['strategy_execute'],
  }),
  feature({
    id: 'retro-generation',
    layerId: 'strategy',
    clusterId: 'execution-engine',
    name: 'Retro Generation',
    endpoints: ['strategy_execute'],
  }),
  feature({
    id: 'critical-path',
    layerId: 'strategy',
    clusterId: 'execution-engine',
    name: 'Critical Path',
    endpoints: ['strategy_execute'],
  }),
  feature({
    id: 'capabilities',
    layerId: 'strategy',
    clusterId: 'execution-engine',
    name: 'Node Capabilities',
  }),
  feature({
    id: 'topological-sort',
    layerId: 'strategy',
    clusterId: 'execution-engine',
    name: 'Topological Sort',
  }),
  feature({
    id: 'max-parallel',
    layerId: 'strategy',
    clusterId: 'execution-engine',
    name: 'Max Parallel Setting',
  }),
  feature({
    id: 'refresh-context',
    layerId: 'strategy',
    clusterId: 'execution-engine',
    name: 'Refresh Context',
  }),
  feature({
    id: 'session-management',
    layerId: 'strategy',
    clusterId: 'execution-engine',
    name: 'Strategy Session Management',
  }),
  feature({
    id: 'cost-tracking',
    layerId: 'strategy',
    clusterId: 'execution-engine',
    name: 'Cost Tracking',
  }),
  feature({
    id: 'output-parsing',
    layerId: 'strategy',
    clusterId: 'execution-engine',
    name: 'Output Parsing',
  }),
  feature({
    id: 'tool-whitelist',
    layerId: 'strategy',
    clusterId: 'execution-engine',
    name: 'Tool Whitelist',
  }),
  feature({
    id: 'prompt-injection',
    layerId: 'strategy',
    clusterId: 'execution-engine',
    name: 'Prompt Injection',
  }),
  feature({
    id: 'method-hint',
    layerId: 'strategy',
    clusterId: 'execution-engine',
    name: 'Method Hint',
  }),
  feature({
    id: 'cycle-detection',
    layerId: 'strategy',
    clusterId: 'execution-engine',
    name: 'Cycle Detection',
  }),
  feature({
    id: 'parse-errors',
    layerId: 'strategy',
    clusterId: 'execution-engine',
    name: 'Parse Error Reporting',
  }),
  feature({
    id: 'trigger-system',
    layerId: 'strategy',
    clusterId: 'execution-engine',
    name: 'Trigger System',
  }),
  feature({
    id: 'manual-trigger',
    layerId: 'strategy',
    clusterId: 'execution-engine',
    name: 'Manual Trigger',
  }),
  feature({
    id: 'context-inputs',
    layerId: 'strategy',
    clusterId: 'execution-engine',
    name: 'Context Inputs',
  }),
  feature({
    id: 'timing',
    layerId: 'strategy',
    clusterId: 'execution-engine',
    name: 'Node Timing',
  }),
  feature({
    id: 'speedup-ratio',
    layerId: 'strategy',
    clusterId: 'execution-engine',
    name: 'Parallel Speedup Ratio',
  }),
  feature({
    id: 'execution-state-snapshot',
    layerId: 'strategy',
    clusterId: 'execution-engine',
    name: 'Execution State Snapshot',
  }),

  // ── Agent Layer — Agent Execution ────────────────────────────────
  feature({
    id: 'method-steps',
    layerId: 'agent',
    clusterId: 'agent-execution',
    name: 'Multi-Step Chain',
  }),
  feature({
    id: 'tool-use',
    layerId: 'agent',
    clusterId: 'agent-execution',
    name: 'Tool Use',
  }),
  feature({
    id: 'schema-retry',
    layerId: 'agent',
    clusterId: 'agent-execution',
    name: 'Schema Retry',
  }),
  feature({
    id: 'context-compaction',
    layerId: 'agent',
    clusterId: 'agent-execution',
    name: 'Context Compaction',
  }),
  feature({
    id: 'reflexion',
    layerId: 'agent',
    clusterId: 'agent-execution',
    name: 'Reflexion',
  }),
  feature({
    id: 'budget-exhausted',
    layerId: 'agent',
    clusterId: 'agent-execution',
    name: 'Budget Exhausted',
  }),
  feature({
    id: 'data-flow',
    layerId: 'agent',
    clusterId: 'agent-execution',
    name: 'Inter-Step Data Flow',
  }),
  feature({
    id: 'token-tracking',
    layerId: 'agent',
    clusterId: 'agent-execution',
    name: 'Token Tracking',
  }),
  feature({
    id: 'multi-turn',
    layerId: 'agent',
    clusterId: 'agent-execution',
    name: 'Multi-Turn Conversation',
  }),
  feature({
    id: 'agent-events',
    layerId: 'agent',
    clusterId: 'agent-execution',
    name: 'Agent Event Stream',
  }),
  feature({
    id: 'graceful-stop',
    layerId: 'agent',
    clusterId: 'agent-execution',
    name: 'Graceful Stop',
  }),
  feature({
    id: 'validation-feedback',
    layerId: 'agent',
    clusterId: 'agent-execution',
    name: 'Validation Feedback',
  }),
  feature({
    id: 'context-policy',
    layerId: 'agent',
    clusterId: 'agent-execution',
    name: 'Context Policy',
  }),
  feature({
    id: 'long-context',
    layerId: 'agent',
    clusterId: 'agent-execution',
    name: 'Long Context Support',
  }),
  feature({
    id: 'reasoning-policy',
    layerId: 'agent',
    clusterId: 'agent-execution',
    name: 'Reasoning Policy',
  }),
  feature({
    id: 'reflect-on-failure',
    layerId: 'agent',
    clusterId: 'agent-execution',
    name: 'Reflect On Failure',
  }),
];

export function getFeature(id: string): Feature {
  const feat = featureRegistry.find((f) => f.id === id);
  if (!feat) throw new Error(`Feature not found: ${id}`);
  return feat;
}

export function featuresByCluster(clusterId: string): Feature[] {
  return featureRegistry.filter((f) => f.clusterId === clusterId);
}

/**
 * Compute feature coverage from the current case registry.
 *
 * For each feature, finds cases whose `features[]` contains the feature ID.
 * Sets `coverage` to 'covered' if any case covers it, 'gap' otherwise.
 * Populates `coveringCaseIds` with the list of matching case IDs.
 *
 * Mutates the feature entries in place. Idempotent — safe to re-run.
 *
 * Implementation preserved from the Wave 0 stub.
 */
export function computeCoverage(cases: SmokeTestCase[]): void {
  for (const feat of featureRegistry) {
    const covering = cases.filter((c) => c.features.includes(feat.id));
    feat.coveringCaseIds = covering.map((c) => c.id);
    feat.coverage = covering.length > 0 ? 'covered' : 'gap';
  }
}
