/**
 * Cluster registry — 8 clusters across 4 layers.
 *
 * Lifted from method-1/tmp/smoke-test-visualization-design.md §Clusters.
 * Narratives lifted from the same source (cluster headers in the
 * §Feature Inventory with Narratives section and from smoke-test-viz-mock.html).
 *
 * Inventory (PRD 056 §Surface 2):
 *   methodology: session-lifecycle, routing-transition
 *   method:      step-execution
 *   strategy:    node-types, gates-control-flow, data-flow-oversight, execution-engine
 *   agent:       agent-execution
 */

import type { Cluster } from './types.js';
import type { Layer } from '../layers/index.js';

export const clusterRegistry: Cluster[] = [
  // ── Methodology Layer ────────────────────────────────────────────
  {
    id: 'session-lifecycle',
    layerId: 'methodology',
    name: 'Session Lifecycle',
    narrative:
      'The methodology session is the top-level orchestration state machine. It tracks which methodology is active, which methods have been completed, what their outputs were, and whether the global objective has been satisfied. Session operations initialize, inspect, and terminate the methodology lifecycle.',
    featureIds: [
      'methodology-start',
      'methodology-list',
      'methodology-status',
      'session-isolation',
    ],
  },
  {
    id: 'routing-transition',
    layerId: 'methodology',
    name: 'Routing & Transition',
    narrative:
      'The transition function (delta-Phi) is the core of a methodology. It evaluates predicate conditions against the current state to decide which method should run next. Arms are evaluated in priority order — first match wins. When a method completes, the transition function re-evaluates to select the next method or declare the methodology complete.',
    featureIds: [
      'routing-inspection',
      'route-evaluation',
      'method-selection',
      'methodology-transition',
    ],
  },

  // ── Method Layer ─────────────────────────────────────────────────
  {
    id: 'step-execution',
    layerId: 'method',
    name: 'Step Execution',
    narrative:
      'Steps are the atomic units of work within a method. Each step has a role (who executes it), preconditions (what must be true before entry), postconditions (what must be true after completion), and execution semantics (agent or script). The step execution cycle is: inspect the current step, assemble its context, execute it, validate the output, and advance to the next step.',
    featureIds: [
      'step-current',
      'step-context',
      'step-advance',
      'step-validate',
      'step-preconditions',
    ],
  },

  // ── Strategy Layer ───────────────────────────────────────────────
  {
    id: 'node-types',
    layerId: 'strategy',
    name: 'Node Types',
    narrative:
      'A strategy DAG is composed of nodes, each representing a unit of work. Five node types are supported, each with different execution semantics. Methodology nodes invoke LLM agents, script nodes run deterministic JavaScript, strategy nodes delegate to nested sub-strategies, semantic nodes dispatch SPL algorithms, and context-load nodes retrieve FCA component information.',
    featureIds: [
      'methodology-node',
      'script-node',
      'strategy-node',
      'semantic-node',
      'context-load-node',
      'sub-strategy',
      'spl-algorithms',
      'fca-index',
    ],
  },
  {
    id: 'gates-control-flow',
    layerId: 'strategy',
    name: 'Gates & Control Flow',
    narrative:
      'Gates are quality checkpoints inserted after nodes. They evaluate conditions on node outputs or execution metadata before allowing the strategy to proceed. Failed gates can trigger retries with feedback injection, human approval flows, or strategy suspension.',
    featureIds: [
      'algorithmic-gate',
      'observation-gate',
      'human-approval-gate',
      'gate-retry',
      'strategy-level-gate',
      'gate-expressions',
      'execution-metadata',
      'human-approval-flow',
      'feedback-injection',
    ],
  },
  {
    id: 'data-flow-oversight',
    layerId: 'strategy',
    name: 'Data Flow & Oversight',
    narrative:
      'Nodes communicate through an artifact store. Oversight rules monitor execution metrics against thresholds. Together they provide data plumbing and safety controls.',
    featureIds: [
      'artifact-passing',
      'artifact-versioning',
      'oversight-rules',
      'escalate-to-human',
      'warn-human',
      'immutable-store',
      'node-dependencies',
    ],
  },
  {
    id: 'execution-engine',
    layerId: 'strategy',
    name: 'Execution Engine',
    narrative:
      'The engine handles scheduling, prompt assembly, session management, budget enforcement, validation, and retrospective generation.',
    featureIds: [
      'parallel-execution',
      'prompt-construction',
      'scope-contract',
      'budget-enforcement',
      'output-validation',
      'dag-validation',
      'retro-generation',
      'critical-path',
      'capabilities',
      'topological-sort',
      'max-parallel',
      'refresh-context',
      'session-management',
      'cost-tracking',
      'output-parsing',
      'tool-whitelist',
      'prompt-injection',
      'method-hint',
      'cycle-detection',
      'parse-errors',
      'trigger-system',
      'manual-trigger',
      'context-inputs',
      'timing',
      'speedup-ratio',
      'execution-state-snapshot',
    ],
  },

  // ── Agent Layer ──────────────────────────────────────────────────
  {
    id: 'agent-execution',
    layerId: 'agent',
    name: 'Agent Execution',
    narrative:
      'Agent-level features test the Pacta SDK — how individual LLM invocations behave. These are the lowest level: a single agent processing a prompt, using tools, validating output, and handling budget or reasoning policies.',
    featureIds: [
      'method-steps',
      'tool-use',
      'schema-retry',
      'context-compaction',
      'reflexion',
      'budget-exhausted',
      'data-flow',
      'token-tracking',
      'multi-turn',
      'agent-events',
      'graceful-stop',
      'validation-feedback',
      'context-policy',
      'long-context',
      'reasoning-policy',
      'reflect-on-failure',
    ],
  },
];

export function getCluster(id: string): Cluster {
  const cluster = clusterRegistry.find((c) => c.id === id);
  if (!cluster) throw new Error(`Cluster not found: ${id}`);
  return cluster;
}

export function clustersByLayer(layerId: Layer['id']): Cluster[] {
  return clusterRegistry.filter((c) => c.layerId === layerId);
}
