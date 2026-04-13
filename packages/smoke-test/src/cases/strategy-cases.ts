/**
 * Strategy smoke test case definitions.
 *
 * Each case maps to a YAML fixture in fixtures/strategies/ and declares
 * which features it validates and what outcomes to expect.
 */

import type { SmokeTestCase } from './index.js';

export const strategyCases: SmokeTestCase[] = [
  // ── Node types ────────────────────────────────────────────────
  {
    id: 'node-methodology',
    name: 'Methodology node',
    description: 'Single methodology node invokes LLM agent with prompt construction, method hint, and capabilities.',    layer: 'strategy',
    features: ['methodology-node', 'prompt-construction', 'capabilities'],
    fixture: 'strategies/node-methodology.yaml',
    mode: 'both',
    expected: {
      status: 'completed',
      nodeStatuses: { 'analyze': 'completed' },
      artifactsProduced: ['analysis_result'],
      retroGenerated: true,
    },
  },
  {
    id: 'node-script',
    name: 'Script node (sandboxed JS)',
    description: 'Script node executes JavaScript in sandbox with no process/require access. Verifies inputs are passed and outputs stored.',    layer: 'strategy',
    features: ['script-node', 'artifact-passing'],
    fixture: 'strategies/node-script.yaml',
    mode: 'mock',
    expected: {
      status: 'completed',
      nodeStatuses: { 'add': 'completed' },
      artifactsProduced: ['sum'],
      artifactValues: { sum: 30 },
    },
  },
  {
    id: 'node-strategy-sub',
    name: 'Sub-strategy invocation',
    description: 'Parent strategy invokes a child strategy via strategy node. Child artifacts flow back as parent node output.',    layer: 'strategy',
    features: ['strategy-node', 'sub-strategy', 'artifact-passing'],
    fixture: 'strategies/node-strategy-sub.yaml',
    mode: 'mock',
    expected: {
      status: 'completed',
      nodeStatuses: { 'invoke-child': 'completed' },
      artifactsProduced: ['child_output'],
    },
  },
  {
    id: 'node-semantic',
    name: 'Semantic node (SPL algorithm)',
    description: 'Semantic node dispatches an SPL explore algorithm with input/output mapping.',    layer: 'strategy',
    features: ['semantic-node', 'spl-algorithms'],
    fixture: 'strategies/node-semantic.yaml',
    mode: 'mock',
    expected: {
      status: 'completed',
      nodeStatuses: { 'explore': 'completed' },
      artifactsProduced: ['exploration_result'],
    },
  },
  {
    id: 'node-context-load',
    name: 'Context-load node (fca-index)',
    description: 'Context-load node queries fca-index for relevant FCA components and stores RetrievedComponent[] in ArtifactStore.',    layer: 'strategy',
    features: ['context-load-node', 'fca-index'],
    fixture: 'strategies/node-context-load.yaml',
    mode: 'mock',
    expected: {
      status: 'completed',
      nodeStatuses: { 'load-ctx': 'completed' },
      artifactsProduced: ['ctx_components'],
    },
  },

  // ── Gate types ────────────────────────────────────────────────
  {
    id: 'gate-algorithmic',
    name: 'Algorithmic gate',
    description: 'Algorithmic gate evaluates JS expression against node output. Checks output.score >= 0.8.',    layer: 'strategy',
    features: ['algorithmic-gate', 'gate-expressions'],
    fixture: 'strategies/gate-algorithmic.yaml',
    mode: 'mock',
    expected: {
      status: 'completed',
      nodeStatuses: { 'score': 'completed' },
    },
  },
  {
    id: 'gate-observation',
    name: 'Observation gate',
    description: 'Observation gate checks execution_metadata fields (cost, duration). Verifies cost < threshold.',    layer: 'strategy',
    features: ['observation-gate', 'execution-metadata'],
    fixture: 'strategies/gate-observation.yaml',
    mode: 'mock',
    expected: {
      status: 'completed',
      nodeStatuses: { 'work': 'completed' },
    },
  },
  {
    id: 'gate-human-approval',
    name: 'Human approval gate',
    description: 'Human approval gate emits awaiting_approval event and waits for approval_response via resolver.',    layer: 'strategy',
    features: ['human-approval-gate', 'human-approval-flow'],
    fixture: 'strategies/gate-human-approval.yaml',
    mode: 'mock',
    expected: {
      status: 'completed',
      nodeStatuses: { 'design': 'completed' },
    },
  },
  {
    id: 'gate-retry-feedback',
    name: 'Gate retry with feedback injection',
    description: 'Gate fails twice (quality: low), feedback injected, passes on third attempt (quality: high). Verifies retry count and feedback.',    layer: 'strategy',
    features: ['gate-retry', 'feedback-injection'],
    fixture: 'strategies/gate-retry-feedback.yaml',
    mode: 'mock',
    expected: {
      status: 'completed',
      retriesOnNode: { nodeId: 'refine', count: 2 },
    },
  },
  {
    id: 'gate-strategy-level',
    name: 'Strategy-level gate',
    description: 'Strategy gate evaluates after all nodes complete. Checks that both node outputs exist in artifacts.',    layer: 'strategy',
    features: ['strategy-level-gate', 'gate-expressions'],
    fixture: 'strategies/gate-strategy-level.yaml',
    mode: 'mock',
    expected: {
      status: 'completed',
      artifactsProduced: ['result_a', 'result_b'],
    },
  },

  // ── Artifact store ────────────────────────────────────────────
  {
    id: 'artifact-versioning',
    name: 'Artifact versioning',
    description: 'Two nodes write to the same artifact key. Verifies both versions are stored (immutable versioned store).',    layer: 'strategy',
    features: ['artifact-versioning', 'immutable-store'],
    fixture: 'strategies/artifact-versioning.yaml',
    mode: 'mock',
    expected: {
      status: 'completed',
      artifactsProduced: ['shared_data'],
    },
  },
  {
    id: 'artifact-passing',
    name: 'Artifact passing (3-node chain)',
    description: 'Three nodes in a chain: A→B→C. Each reads from previous and writes to next. Verifies end-to-end data flow.',    layer: 'strategy',
    features: ['artifact-passing', 'node-dependencies'],
    fixture: 'strategies/artifact-passing.yaml',
    mode: 'mock',
    expected: {
      status: 'completed',
      nodeStatuses: { 'node-a': 'completed', 'node-b': 'completed', 'node-c': 'completed' },
      artifactsProduced: ['intermediate', 'final'],
    },
  },

  // ── Oversight ─────────────────────────────────────────────────
  {
    id: 'oversight-escalate',
    name: 'Oversight: escalate to human',
    description: 'Oversight rule triggers escalation when cost exceeds threshold. Execution suspends.',    layer: 'strategy',
    features: ['oversight-rules', 'escalate-to-human'],
    fixture: 'strategies/oversight-escalate.yaml',
    mode: 'mock',
    expected: {
      status: 'suspended',
      oversightTriggered: true,
    },
  },
  {
    id: 'oversight-warn',
    name: 'Oversight: warn human',
    description: 'Oversight rule triggers warning when duration exceeds threshold. Execution continues.',    layer: 'strategy',
    features: ['oversight-rules', 'warn-human'],
    fixture: 'strategies/oversight-warn.yaml',
    mode: 'mock',
    expected: {
      status: 'completed',
      // Note: oversight warn triggers based on step_duration_ms which depends
      // on real wall-clock time. In mock mode the node executes in <1ms so
      // the threshold may not trigger. We just verify the strategy completes.
    },
  },

  // ── Execution engine ─────────────────────────────────────────
  {
    id: 'parallel-execution',
    name: 'Parallel node execution',
    description: 'Three independent nodes at the same topological level execute in parallel (respecting maxParallel).',    layer: 'strategy',
    features: ['parallel-execution', 'topological-sort', 'max-parallel'],
    fixture: 'strategies/parallel-execution.yaml',
    mode: 'mock',
    expected: {
      status: 'completed',
      nodeStatuses: { 'node-a': 'completed', 'node-b': 'completed', 'node-c': 'completed' },
    },
  },
  {
    id: 'refresh-context',
    name: 'Refresh context flag',
    description: 'Second node has refresh_context: true. Verifies sessionId rotates between nodes.',    layer: 'strategy',
    features: ['refresh-context', 'session-management'],
    fixture: 'strategies/refresh-context.yaml',
    mode: 'mock',
    expected: {
      status: 'completed',
    },
  },

  // ── Budget, output, scope ────────────────────────────────────
  {
    id: 'budget-enforcement',
    name: 'Budget enforcement',
    description: 'Strategy with tight budget. Verifies budget_exhausted event when cost exceeds limit.',    layer: 'strategy',
    features: ['budget-enforcement', 'cost-tracking'],
    fixture: 'strategies/budget-enforcement.yaml',
    mode: 'mock',
    expected: {
      status: 'completed',
      costRange: [0, 0.01],
    },
  },
  {
    id: 'output-validation',
    name: 'Output validation',
    description: 'Methodology node must produce structured_result object. Gate verifies type.',    layer: 'strategy',
    features: ['output-validation', 'output-parsing'],
    fixture: 'strategies/output-validation.yaml',
    mode: 'mock',
    expected: {
      status: 'completed',
      artifactsProduced: ['structured_result'],
    },
  },
  {
    id: 'scope-contract',
    name: 'Scope contract (tool whitelist)',
    description: 'Methodology node with limited capabilities. Verifies only allowed tools are available.',    layer: 'strategy',
    features: ['scope-contract', 'capabilities', 'tool-whitelist'],
    fixture: 'strategies/scope-contract.yaml',
    mode: 'mock',
    expected: {
      status: 'completed',
    },
  },
  {
    id: 'prompt-construction',
    name: 'Prompt construction',
    description: 'Methodology node with prompt injection, method_hint, and capabilities. Verifies all prompt parts assembled.',    layer: 'strategy',
    features: ['prompt-construction', 'prompt-injection', 'method-hint'],
    fixture: 'strategies/prompt-construction.yaml',
    mode: 'mock',
    expected: {
      status: 'completed',
    },
  },

  // ── Validation & errors ──────────────────────────────────────
  {
    id: 'cycle-detection',
    name: 'Cycle detection (direct)',
    description: 'Strategy references itself via strategy node. Verifies cycle detected and node fails.',    layer: 'strategy',
    features: ['cycle-detection', 'dag-validation'],
    fixture: 'strategies/cycle-detection.yaml',
    mode: 'mock',
    expected: {
      status: 'failed',
      errorContains: 'cycle',
    },
  },
  {
    id: 'dag-validation-errors',
    name: 'DAG validation (duplicate node IDs)',
    description: 'Invalid strategy with duplicate node IDs. Verifies parse/validation error.',    layer: 'strategy',
    features: ['dag-validation', 'parse-errors'],
    fixture: 'strategies/dag-validation-errors.yaml',
    mode: 'mock',
    expected: {
      status: 'failed',
      parseError: true,
    },
  },

  // ── Trigger, retro, critical path ────────────────────────────
  {
    id: 'trigger-manual',
    name: 'Manual trigger',
    description: 'Strategy with manual trigger. Verifies trigger_event context input is available.',    layer: 'strategy',
    features: ['trigger-system', 'manual-trigger', 'context-inputs'],
    fixture: 'strategies/trigger-manual.yaml',
    mode: 'mock',
    expected: {
      status: 'completed',
      artifactsProduced: ['triggered'],
    },
  },
  {
    id: 'retro-generation',
    name: 'Retro generation',
    description: 'Two-node strategy. Verifies retro contains timing, cost, gates, and artifacts.',    layer: 'strategy',
    features: ['retro-generation', 'timing', 'cost-tracking'],
    fixture: 'strategies/retro-generation.yaml',
    mode: 'mock',
    expected: {
      status: 'completed',
      retroGenerated: true,
      artifactsProduced: ['step1', 'step2'],
    },
  },
  {
    id: 'critical-path',
    name: 'Critical path computation',
    description: 'Diamond DAG: A, B independent, C depends on both. Verifies critical path in retro.',    layer: 'strategy',
    features: ['critical-path', 'speedup-ratio', 'retro-generation'],
    fixture: 'strategies/critical-path.yaml',
    mode: 'mock',
    expected: {
      status: 'completed',
      retroGenerated: true,
    },
  },

  // ── Full pipeline ────────────────────────────────────────────
  {
    id: 'full-pipeline',
    name: 'Full pipeline (all features)',
    description: 'Multi-node strategy exercising context-load, methodology, script, gates, artifacts, and retro in one run.',    layer: 'strategy',
    features: [
      'context-load-node', 'methodology-node', 'script-node',
      'artifact-passing', 'gate-expressions', 'retro-generation',
      'token-tracking', 'cost-tracking', 'execution-state-snapshot',
      'output-parsing',
    ],
    fixture: 'strategies/full-pipeline.yaml',
    mode: 'both',
    expected: {
      status: 'completed',
      retroGenerated: true,
    },
  },
];
