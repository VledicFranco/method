// SPDX-License-Identifier: Apache-2.0
/**
 * Vitest cases for the mock executor's RunFlow enrichment (PRD 056 C-4).
 *
 * The RunFlow shape is frozen in Wave 0 at
 * `packages/smoke-test/src/executor/run-flow.ts` and populated by
 * `runMockStrategy` in `mock-executor.ts`. These cases exercise the flow
 * builder against real YAML fixtures covering:
 *
 *   A. Gate pass after retry — flow.gates has a passed gate, node has an
 *      attempt whose `feedback` was set.
 *   B. Oversight escalate — flow.oversightEvents contains an 'escalate' entry.
 *   C. Parallel execution — flow.nodes covers all 3 nodes and flow.edges is
 *      empty (no depends_on between them).
 *   D. Artifact passing — flow.edges reflects the DAG topology and carries
 *      artifact labels matching the parsed node inputs/outputs.
 */

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runMockStrategy, loadFixtureYaml } from './mock-executor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STRATEGY_DIR = join(__dirname, '..', 'fixtures', 'strategies');

describe('mock-executor RunFlow enrichment', () => {
  // ── Case A: gate pass + retry ────────────────────────────────
  it('populates flow.gates and attempt feedback on gate-retry-feedback', async () => {
    const yaml = loadFixtureYaml(join(STRATEGY_DIR, 'gate-retry-feedback.yaml'));
    // Dynamic output: first attempt low quality, second attempt high.
    // Gate check is `output.quality === "high"` so the gate must retry once.
    const { result, flow } = await runMockStrategy(yaml, {
      contextInputs: { task_desc: 'refine artifact' },
      dynamicFn: (_nodeId, attempt) =>
        attempt < 1 ? { quality: 'low' } : { quality: 'high' },
    });

    expect(result.status).toBe('completed');
    expect(flow).toBeDefined();
    if (!flow) throw new Error('flow was undefined');

    // The refine node should be present, completed, with ≥ 2 attempts.
    const refineNode = flow.nodes.find((n) => n.id === 'refine');
    expect(refineNode).toBeDefined();
    expect(refineNode?.status).toBe('completed');
    expect(refineNode?.type).toBe('methodology');
    expect(refineNode?.attempts.length).toBeGreaterThanOrEqual(2);

    // At least one attempt must carry retry feedback (methodts builds it
    // automatically from the failing gate on the first iteration).
    const attemptWithFeedback = refineNode?.attempts.find(
      (a) => a.feedback !== undefined,
    );
    expect(attemptWithFeedback).toBeDefined();
    expect(typeof attemptWithFeedback?.feedback).toBe('string');
    expect(attemptWithFeedback?.feedback?.length ?? 0).toBeGreaterThan(0);

    // flow.gates must contain a passed gate on the refine node. The gate
    // should also expose the retryFeedback string because retries > 0.
    const refineGate = flow.gates.find(
      (g) => g.afterNode === 'refine' && g.passed === true,
    );
    expect(refineGate).toBeDefined();
    expect(refineGate?.type).toBe('algorithmic');
    expect(refineGate?.expression).toBe('output.quality === "high"');
    expect(refineGate?.retryFeedback).toBeDefined();
    expect(typeof refineGate?.retryFeedback).toBe('string');
  });

  // ── Case B: oversight escalate ───────────────────────────────
  it('populates flow.oversightEvents on oversight-escalate', async () => {
    const yaml = loadFixtureYaml(join(STRATEGY_DIR, 'oversight-escalate.yaml'));
    const { result, flow } = await runMockStrategy(yaml, {
      contextInputs: { task_desc: 'run expensive work' },
      outputs: { 'expensive-work': { result: 'done' } },
    });

    // The fixture triggers `total_cost_usd > 0.001` which the escalate rule
    // converts into a suspension; methodts records the oversight event but
    // the strategy ends in 'suspended' state, not 'completed'.
    expect(result.status).toBe('suspended');
    expect(result.oversight_events.length).toBeGreaterThan(0);

    expect(flow).toBeDefined();
    if (!flow) throw new Error('flow was undefined');

    expect(flow.oversightEvents.length).toBeGreaterThan(0);
    const escalate = flow.oversightEvents.find((e) => e.type === 'escalate');
    expect(escalate).toBeDefined();
    // The rule condition in the fixture references total_cost_usd.
    expect(escalate?.trigger).toContain('total_cost_usd');
    // afterNode should resolve to the completed expensive-work node.
    expect(escalate?.afterNode).toBe('expensive-work');

    // The executed node should still be represented in flow.nodes with a
    // populated attempt.
    const node = flow.nodes.find((n) => n.id === 'expensive-work');
    expect(node).toBeDefined();
    expect(node?.attempts.length).toBeGreaterThanOrEqual(1);
  });

  // ── Case C: parallel execution ───────────────────────────────
  it('populates flow.nodes and flow.edges correctly on parallel-execution', async () => {
    const yaml = loadFixtureYaml(join(STRATEGY_DIR, 'parallel-execution.yaml'));
    const { result, flow } = await runMockStrategy(yaml, {
      contextInputs: { task_desc: 'parallel work' },
      outputs: {
        'node-a': { result_a: 'A done' },
        'node-b': { result_b: 'B done' },
        'node-c': { result_c: 'C done' },
      },
    });

    expect(result.status).toBe('completed');
    expect(flow).toBeDefined();
    if (!flow) throw new Error('flow was undefined');

    // All 3 parallel nodes must appear in flow.nodes.
    const ids = flow.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['node-a', 'node-b', 'node-c']);

    for (const node of flow.nodes) {
      expect(node.status).toBe('completed');
      expect(node.type).toBe('methodology');
      expect(node.attempts.length).toBeGreaterThanOrEqual(1);
    }

    // The fixture has no depends_on between nodes, so there must be no edges.
    expect(flow.edges).toEqual([]);

    // Each node has one algorithmic gate that passed.
    expect(flow.gates.length).toBe(3);
    for (const gate of flow.gates) {
      expect(gate.passed).toBe(true);
      expect(gate.type).toBe('algorithmic');
      expect(['node-a', 'node-b', 'node-c']).toContain(gate.afterNode);
    }

    // No oversight events on this fixture.
    expect(flow.oversightEvents).toEqual([]);
  });

  // ── Case D: artifact passing edges ───────────────────────────
  it('derives flow.edges with artifact labels from depends_on + inputs/outputs', async () => {
    const yaml = loadFixtureYaml(join(STRATEGY_DIR, 'artifact-passing.yaml'));
    const { result, flow } = await runMockStrategy(yaml);

    expect(result.status).toBe('completed');
    expect(flow).toBeDefined();
    if (!flow) throw new Error('flow was undefined');

    // 3 nodes, chained a → b → c via artifacts intermediate / final.
    expect(flow.nodes.map((n) => n.id)).toEqual(['node-a', 'node-b', 'node-c']);
    for (const node of flow.nodes) {
      expect(node.type).toBe('script');
      expect(node.status).toBe('completed');
    }

    // Edges: node-a → node-b (artifact intermediate), node-b → node-c (artifact final).
    expect(flow.edges.length).toBe(2);
    const edgeAB = flow.edges.find(
      (e) => e.from === 'node-a' && e.to === 'node-b',
    );
    const edgeBC = flow.edges.find(
      (e) => e.from === 'node-b' && e.to === 'node-c',
    );
    expect(edgeAB).toBeDefined();
    expect(edgeAB?.artifact).toBe('intermediate');
    expect(edgeBC).toBeDefined();
    expect(edgeBC?.artifact).toBe('final');

    // Artifact-produced/consumed lists reflect the parsed DAG.
    const nodeA = flow.nodes.find((n) => n.id === 'node-a')!;
    const nodeB = flow.nodes.find((n) => n.id === 'node-b')!;
    const nodeC = flow.nodes.find((n) => n.id === 'node-c')!;
    expect(nodeA.artifactsProduced).toContain('intermediate');
    expect(nodeA.artifactsConsumed).toEqual([]);
    expect(nodeB.artifactsProduced).toContain('final');
    expect(nodeB.artifactsConsumed).toContain('intermediate');
    expect(nodeC.artifactsProduced).toContain('done');
    expect(nodeC.artifactsConsumed).toContain('final');
  });
});
