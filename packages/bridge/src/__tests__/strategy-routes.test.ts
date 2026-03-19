/**
 * PRD 017: Strategy Pipelines — Retro Generator + Routes Tests (Phase 1d)
 *
 * Tests for retrospective generation, critical path computation,
 * YAML serialization, and Strategy HTTP routes via Fastify inject().
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import yaml from 'js-yaml';

import {
  generateRetro,
  computeCriticalPath,
  retroToYaml,
  saveRetro,
} from '../strategy/retro-generator.js';
import type { StrategyRetro } from '../strategy/retro-generator.js';
import type { StrategyExecutionResult, NodeResult } from '../strategy/strategy-executor.js';
import type { StrategyDAG } from '../strategy/strategy-parser.js';
import type { ArtifactBundle } from '../strategy/artifact-store.js';

// ── Test Fixtures ───────────────────────────────────────────────

function makeDAG(overrides?: Partial<StrategyDAG>): StrategyDAG {
  return {
    id: 'S-TEST',
    name: 'Test Strategy',
    version: '1.0',
    nodes: [
      {
        id: 'analyze',
        type: 'methodology',
        depends_on: [],
        inputs: ['task_description'],
        outputs: ['analysis'],
        gates: [
          { type: 'algorithmic', check: 'output.analysis !== undefined', max_retries: 3, timeout_ms: 5000 },
        ],
        config: { type: 'methodology', methodology: 'P2-SD', method_hint: 'M7-PRDS', capabilities: [] },
      },
      {
        id: 'implement',
        type: 'methodology',
        depends_on: ['analyze'],
        inputs: ['analysis'],
        outputs: ['code_changes'],
        gates: [
          { type: 'algorithmic', check: 'output.tests_passed === true', max_retries: 3, timeout_ms: 5000 },
        ],
        config: { type: 'methodology', methodology: 'P2-SD', method_hint: 'M1-IMPL', capabilities: [] },
      },
      {
        id: 'merge',
        type: 'script',
        depends_on: ['implement'],
        inputs: ['code_changes'],
        outputs: ['summary'],
        gates: [],
        config: { type: 'script', script: 'return { summary: "done" };' },
      },
    ],
    strategy_gates: [],
    capabilities: {},
    oversight_rules: [],
    context_inputs: [{ name: 'task_description', type: 'string' }],
    ...overrides,
  };
}

function makeNodeResult(id: string, overrides?: Partial<NodeResult>): NodeResult {
  return {
    node_id: id,
    status: 'completed',
    output: {},
    cost_usd: 0.10,
    duration_ms: 1000,
    num_turns: 3,
    gate_results: [],
    retries: 0,
    ...overrides,
  };
}

function makeExecutionResult(overrides?: Partial<StrategyExecutionResult>): StrategyExecutionResult {
  const artifacts: ArtifactBundle = {
    task_description: {
      artifact_id: 'task_description',
      version: 1,
      content: 'test task',
      producer_node_id: '__context__',
      timestamp: '2026-03-17T10:00:00.000Z',
    },
    analysis: {
      artifact_id: 'analysis',
      version: 1,
      content: { sections: ['A', 'B'] },
      producer_node_id: 'analyze',
      timestamp: '2026-03-17T10:01:00.000Z',
    },
    code_changes: {
      artifact_id: 'code_changes',
      version: 1,
      content: { files: ['a.ts'] },
      producer_node_id: 'implement',
      timestamp: '2026-03-17T10:02:00.000Z',
    },
    summary: {
      artifact_id: 'summary',
      version: 1,
      content: { summary: 'done' },
      producer_node_id: 'merge',
      timestamp: '2026-03-17T10:03:00.000Z',
    },
  };

  return {
    strategy_id: 'S-TEST',
    status: 'completed',
    node_results: {
      analyze: makeNodeResult('analyze', { cost_usd: 0.18, duration_ms: 5000 }),
      implement: makeNodeResult('implement', { cost_usd: 1.02, duration_ms: 15000 }),
      merge: makeNodeResult('merge', { cost_usd: 0.0, duration_ms: 50 }),
    },
    artifacts,
    gate_results: [
      { gate_id: 'analyze:gate[0]', type: 'algorithmic', passed: true, reason: 'Expression evaluated to truthy' },
      { gate_id: 'implement:gate[0]', type: 'algorithmic', passed: true, reason: 'Expression evaluated to truthy' },
    ],
    cost_usd: 1.20,
    started_at: '2026-03-17T10:00:00.000Z',
    completed_at: '2026-03-17T10:00:20.050Z',
    duration_ms: 20050,
    oversight_events: [],
    ...overrides,
  };
}

// ── Retro Generator Tests ──────────────────────────────────────

describe('generateRetro', () => {
  it('produces correct structure from execution result', () => {
    const dag = makeDAG();
    const result = makeExecutionResult();
    const retro = generateRetro(dag, result);

    assert.equal(retro.retro.strategy_id, 'S-TEST');
    assert.equal(retro.retro.generated_by, 'strategy-executor');
    assert.ok(retro.retro.generated_at);
    assert.equal(retro.retro.timing.started_at, '2026-03-17T10:00:00.000Z');
    assert.equal(retro.retro.timing.completed_at, '2026-03-17T10:00:20.050Z');
    assert.equal(retro.retro.execution_summary.nodes_total, 3);
    assert.equal(retro.retro.execution_summary.nodes_completed, 3);
    assert.equal(retro.retro.execution_summary.nodes_failed, 0);
  });

  it('calculates speedup_ratio correctly', () => {
    const dag = makeDAG();
    // sequential_time = 5000 + 15000 + 50 = 20050
    // actual_time = 20050
    // speedup_ratio = 20050 / 20050 = 1.0
    const result = makeExecutionResult();
    const retro = generateRetro(dag, result);
    assert.equal(retro.retro.execution_summary.speedup_ratio, 1.0);

    // Now test with better parallelization: actual_time < sequential_time
    const parallelResult = makeExecutionResult({
      duration_ms: 10000, // Faster than sequential
    });
    const parallelRetro = generateRetro(dag, parallelResult);
    // 20050 / 10000 ≈ 2.01 — speedup > 1.0 means parallelism helped
    assert.ok(parallelRetro.retro.execution_summary.speedup_ratio > 1.0);
  });

  it('populates cost per-node breakdown', () => {
    const dag = makeDAG();
    const result = makeExecutionResult();
    const retro = generateRetro(dag, result);

    assert.equal(retro.retro.cost.total_usd, 1.20);
    assert.equal(retro.retro.cost.per_node.length, 3);

    const analyzeNode = retro.retro.cost.per_node.find((n) => n.node === 'analyze');
    assert.ok(analyzeNode);
    assert.equal(analyzeNode.cost_usd, 0.18);

    const implementNode = retro.retro.cost.per_node.find((n) => n.node === 'implement');
    assert.ok(implementNode);
    assert.equal(implementNode.cost_usd, 1.02);
  });

  it('aggregates gate retry data correctly', () => {
    const dag = makeDAG();
    const result = makeExecutionResult({
      node_results: {
        analyze: makeNodeResult('analyze', {
          retries: 2,
          gate_results: [
            { gate_id: 'analyze:gate[0]', type: 'algorithmic', passed: false, reason: 'falsy' },
            { gate_id: 'analyze:gate[0]', type: 'algorithmic', passed: false, reason: 'falsy' },
            { gate_id: 'analyze:gate[0]', type: 'algorithmic', passed: true, reason: 'truthy' },
          ],
        }),
        implement: makeNodeResult('implement'),
        merge: makeNodeResult('merge'),
      },
      gate_results: [
        { gate_id: 'analyze:gate[0]', type: 'algorithmic', passed: false, reason: 'falsy' },
        { gate_id: 'analyze:gate[0]', type: 'algorithmic', passed: false, reason: 'falsy' },
        { gate_id: 'analyze:gate[0]', type: 'algorithmic', passed: true, reason: 'truthy' },
        { gate_id: 'implement:gate[0]', type: 'algorithmic', passed: true, reason: 'truthy' },
      ],
    });

    const retro = generateRetro(dag, result);
    assert.equal(retro.retro.gates.total, 4);
    assert.equal(retro.retro.gates.passed, 2);
    assert.equal(retro.retro.gates.failed_then_passed, 1);
    assert.equal(retro.retro.gates.retries.length, 1);
    assert.equal(retro.retro.gates.retries[0].node, 'analyze');
    assert.equal(retro.retro.gates.retries[0].attempts, 3);
    assert.equal(retro.retro.gates.retries[0].final, 'passed');
  });

  it('includes oversight events', () => {
    const dag = makeDAG();
    const result = makeExecutionResult({
      oversight_events: [
        {
          rule: { condition: 'total_cost_usd > 5.00', action: 'warn_human' },
          triggered_at: '2026-03-17T10:05:00.000Z',
          context: { total_cost_usd: 5.50 },
        },
      ],
    });

    const retro = generateRetro(dag, result);
    assert.equal(retro.retro.oversight_events.length, 1);
    assert.equal(retro.retro.oversight_events[0].rule_condition, 'total_cost_usd > 5.00');
    assert.equal(retro.retro.oversight_events[0].action, 'warn_human');
  });

  it('lists artifacts excluding context inputs', () => {
    const dag = makeDAG();
    const result = makeExecutionResult();
    const retro = generateRetro(dag, result);

    // Should not include task_description (produced by __context__)
    const contextArtifact = retro.retro.artifacts_produced.find((a) => a.id === 'task_description');
    assert.equal(contextArtifact, undefined);

    // Should include producer artifacts
    const analysis = retro.retro.artifacts_produced.find((a) => a.id === 'analysis');
    assert.ok(analysis);
    assert.equal(analysis.producer, 'analyze');
  });

  it('handles failed nodes in execution summary', () => {
    const dag = makeDAG();
    const result = makeExecutionResult({
      status: 'failed',
      node_results: {
        analyze: makeNodeResult('analyze', { status: 'completed' }),
        implement: makeNodeResult('implement', { status: 'failed', error: 'LLM error' }),
        merge: makeNodeResult('merge', { status: 'gate_failed' }),
      },
    });

    const retro = generateRetro(dag, result);
    assert.equal(retro.retro.execution_summary.nodes_completed, 1);
    assert.equal(retro.retro.execution_summary.nodes_failed, 2);
  });
});

// ── Critical Path Tests ────────────────────────────────────────

describe('computeCriticalPath', () => {
  it('finds the longest path through a linear DAG', () => {
    const dag = makeDAG();
    const nodeResults: Record<string, NodeResult> = {
      analyze: makeNodeResult('analyze', { duration_ms: 5000 }),
      implement: makeNodeResult('implement', { duration_ms: 15000 }),
      merge: makeNodeResult('merge', { duration_ms: 50 }),
    };

    const path = computeCriticalPath(dag, nodeResults);
    assert.deepEqual(path, ['analyze', 'implement', 'merge']);
  });

  it('finds the longest branch in a parallel DAG', () => {
    const dag = makeDAG({
      nodes: [
        {
          id: 'root',
          type: 'methodology',
          depends_on: [],
          inputs: [],
          outputs: ['root_out'],
          gates: [],
          config: { type: 'methodology', methodology: 'P2-SD', capabilities: [] },
        },
        {
          id: 'fast_branch',
          type: 'script',
          depends_on: ['root'],
          inputs: ['root_out'],
          outputs: ['fast_out'],
          gates: [],
          config: { type: 'script', script: 'return {};' },
        },
        {
          id: 'slow_branch',
          type: 'methodology',
          depends_on: ['root'],
          inputs: ['root_out'],
          outputs: ['slow_out'],
          gates: [],
          config: { type: 'methodology', methodology: 'P2-SD', capabilities: [] },
        },
      ],
    });

    const nodeResults: Record<string, NodeResult> = {
      root: makeNodeResult('root', { duration_ms: 1000 }),
      fast_branch: makeNodeResult('fast_branch', { duration_ms: 100 }),
      slow_branch: makeNodeResult('slow_branch', { duration_ms: 10000 }),
    };

    const path = computeCriticalPath(dag, nodeResults);
    assert.deepEqual(path, ['root', 'slow_branch']);
  });

  it('handles empty DAG', () => {
    const dag = makeDAG({ nodes: [] });
    const path = computeCriticalPath(dag, {});
    assert.deepEqual(path, []);
  });

  it('handles single node', () => {
    const dag = makeDAG({
      nodes: [
        {
          id: 'only',
          type: 'script',
          depends_on: [],
          inputs: [],
          outputs: [],
          gates: [],
          config: { type: 'script', script: 'return {};' },
        },
      ],
    });

    const nodeResults: Record<string, NodeResult> = {
      only: makeNodeResult('only', { duration_ms: 500 }),
    };

    const path = computeCriticalPath(dag, nodeResults);
    assert.deepEqual(path, ['only']);
  });
});

// ── YAML Serialization Tests ───────────────────────────────────

describe('retroToYaml', () => {
  it('produces valid YAML string', () => {
    const dag = makeDAG();
    const result = makeExecutionResult();
    const retro = generateRetro(dag, result);
    const yamlStr = retroToYaml(retro);

    assert.ok(typeof yamlStr === 'string');
    assert.ok(yamlStr.length > 0);

    // Parse back and verify it's valid YAML
    const parsed = yaml.load(yamlStr) as StrategyRetro;
    assert.ok(parsed.retro);
    assert.equal(parsed.retro.strategy_id, 'S-TEST');
    assert.equal(parsed.retro.generated_by, 'strategy-executor');
  });

  it('round-trips cost data through YAML', () => {
    const dag = makeDAG();
    const result = makeExecutionResult();
    const retro = generateRetro(dag, result);
    const yamlStr = retroToYaml(retro);
    const parsed = yaml.load(yamlStr) as StrategyRetro;

    assert.equal(parsed.retro.cost.total_usd, 1.20);
    assert.equal(parsed.retro.cost.per_node.length, 3);
  });
});

// ── Save Retro Tests ──────────────────────────────────────────

describe('saveRetro', () => {
  it('saves retro file with correct naming convention', async () => {
    const retroDir = join(tmpdir(), `test-retro-${Date.now()}`);
    const dag = makeDAG();
    const result = makeExecutionResult();
    const retro = generateRetro(dag, result);

    const filePath = await saveRetro(retro, retroDir);

    assert.ok(filePath.includes('retro-strategy-'));
    assert.ok(filePath.endsWith('.yaml'));

    // Verify file exists and contains valid YAML
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = yaml.load(content) as StrategyRetro;
    assert.equal(parsed.retro.strategy_id, 'S-TEST');

    // Cleanup
    await fs.rm(retroDir, { recursive: true, force: true });
  });

  it('increments sequence number for same date', async () => {
    const retroDir = join(tmpdir(), `test-retro-seq-${Date.now()}`);
    const dag = makeDAG();
    const result = makeExecutionResult();
    const retro = generateRetro(dag, result);

    const path1 = await saveRetro(retro, retroDir);
    const path2 = await saveRetro(retro, retroDir);

    assert.ok(path1.includes('-001.yaml'));
    assert.ok(path2.includes('-002.yaml'));

    // Cleanup
    await fs.rm(retroDir, { recursive: true, force: true });
  });

  it('creates directory if it does not exist', async () => {
    const retroDir = join(tmpdir(), `test-retro-mkdir-${Date.now()}`, 'nested', 'dir');
    const dag = makeDAG();
    const result = makeExecutionResult();
    const retro = generateRetro(dag, result);

    const filePath = await saveRetro(retro, retroDir);
    assert.ok(filePath);

    const stat = await fs.stat(retroDir);
    assert.ok(stat.isDirectory());

    // Cleanup
    await fs.rm(join(tmpdir(), `test-retro-mkdir-${Date.now()}`), { recursive: true, force: true }).catch(() => {});
  });
});

// ── Eviction Tests ─────────────────────────────────────────────

describe('evictStaleExecutions', () => {
  // We test eviction indirectly via the exported function.
  // The executions map is module-level, so we exercise it through routes.

  it('eviction function is callable without errors', async () => {
    const { evictStaleExecutions: evict } = await import('../strategy/strategy-routes.js');
    // Should not throw even when map is empty
    evict();
  });
});

// ── Retro Gate Matching Tests ──────────────────────────────────

describe('retro gate matching', () => {
  it('gate matching does not false-positive on substring node IDs', () => {
    const dag = makeDAG({
      nodes: [
        {
          id: 'a',
          type: 'methodology',
          depends_on: [],
          inputs: [],
          outputs: ['out_a'],
          gates: [
            { type: 'algorithmic', check: 'output.out_a !== undefined', max_retries: 3, timeout_ms: 5000 },
          ],
          config: { type: 'methodology', methodology: 'P2-SD', capabilities: [] },
        },
        {
          id: 'analyze',
          type: 'methodology',
          depends_on: [],
          inputs: [],
          outputs: ['out_analyze'],
          gates: [
            { type: 'algorithmic', check: 'output.out_analyze !== undefined', max_retries: 3, timeout_ms: 5000 },
          ],
          config: { type: 'methodology', methodology: 'P2-SD', capabilities: [] },
        },
      ],
    });

    // Node "a" has retries, and gate_results include gates for both "a" and "analyze"
    const result = makeExecutionResult({
      node_results: {
        a: {
          node_id: 'a',
          status: 'completed',
          output: {},
          cost_usd: 0.1,
          duration_ms: 1000,
          num_turns: 1,
          retries: 1,
          gate_results: [
            { gate_id: 'a:gate[0]', type: 'algorithmic', passed: false, reason: 'falsy' },
            { gate_id: 'a:gate[0]', type: 'algorithmic', passed: true, reason: 'truthy' },
          ],
        },
        analyze: {
          node_id: 'analyze',
          status: 'completed',
          output: {},
          cost_usd: 0.1,
          duration_ms: 1000,
          num_turns: 1,
          retries: 0,
          gate_results: [
            { gate_id: 'analyze:gate[0]', type: 'algorithmic', passed: true, reason: 'truthy' },
          ],
        },
      },
      gate_results: [
        { gate_id: 'a:gate[0]', type: 'algorithmic', passed: false, reason: 'falsy' },
        { gate_id: 'a:gate[0]', type: 'algorithmic', passed: true, reason: 'truthy' },
        { gate_id: 'analyze:gate[0]', type: 'algorithmic', passed: true, reason: 'truthy' },
      ],
    });

    const retro = generateRetro(dag, result);

    // Only node "a" had retries, so retries array should have exactly 1 entry
    assert.equal(retro.retro.gates.retries.length, 1);
    assert.equal(retro.retro.gates.retries[0].node, 'a');

    // The gate matching for node "a" should NOT have picked up "analyze:gate[0]"
    // With the old .includes() bug, node "a" would match "analyze:gate[0]" too
    assert.equal(retro.retro.gates.retries[0].attempts, 2); // 1 retry + 1 initial = 2
    assert.equal(retro.retro.gates.retries[0].final, 'passed');
  });
});

// ── Route Tests (via Fastify inject) ───────────────────────────

describe('Strategy Routes', () => {
  // We import Fastify and register routes for integration testing
  // without starting a real server.

  async function buildApp() {
    const Fastify = (await import('fastify')).default;
    const { registerStrategyRoutes } = await import('../strategy/strategy-routes.js');
    const app = Fastify({ logger: false });

    // Mock LLM provider that returns structured JSON
    const mockProvider = {
      async invoke() {
        return {
          result: '```json\n{"analysis": {"sections": ["A", "B"]}}\n```',
          is_error: false,
          duration_ms: 1000,
          duration_api_ms: 800,
          num_turns: 3,
          session_id: 'test-session',
          total_cost_usd: 0.10,
          usage: { input_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 50 },
          model_usage: {},
          permission_denials: [],
          stop_reason: 'end_turn',
          subtype: 'success',
        };
      },
      async invokeStreaming() {
        throw new Error('Not implemented in mock');
      },
    };

    const retroDir = join(tmpdir(), `test-retro-routes-${Date.now()}`);
    registerStrategyRoutes(app, mockProvider, { retroDir });

    return { app, retroDir };
  }

  const SIMPLE_STRATEGY_YAML = `
strategy:
  id: S-SIMPLE
  name: "Simple Test"
  version: "1.0"
  capabilities:
    basic: [Read]
  dag:
    nodes:
      - id: only_node
        type: script
        script: "return { result: 'hello' };"
        inputs: []
        outputs: [result]
`;

  it('POST /strategies/execute returns 202 with execution_id', async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/strategies/execute',
      payload: {
        strategy_yaml: SIMPLE_STRATEGY_YAML,
        context_inputs: {},
      },
    });

    assert.equal(response.statusCode, 202);
    const body = JSON.parse(response.body);
    assert.ok(body.execution_id);
    assert.ok(body.execution_id.startsWith('exec-S-SIMPLE-'));
    assert.equal(body.status, 'started');
  });

  it('POST /strategies/execute rejects missing yaml and path', async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/strategies/execute',
      payload: {},
    });

    assert.equal(response.statusCode, 400);
    const body = JSON.parse(response.body);
    assert.ok(body.error.includes('Missing required field'));
  });

  it('POST /strategies/execute rejects invalid YAML', async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/strategies/execute',
      payload: {
        strategy_yaml: 'not: valid: yaml: [[[',
      },
    });

    assert.equal(response.statusCode, 400);
  });

  it('GET /strategies/:id/status returns 404 for unknown id', async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/strategies/nonexistent/status',
    });

    assert.equal(response.statusCode, 404);
  });

  it('GET /strategies lists executions', async () => {
    const { app } = await buildApp();

    // Start an execution first
    await app.inject({
      method: 'POST',
      url: '/strategies/execute',
      payload: {
        strategy_yaml: SIMPLE_STRATEGY_YAML,
        context_inputs: {},
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/strategies',
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.ok(Array.isArray(body));
    assert.ok(body.length >= 1);
    assert.equal(body[0].strategy_id, 'S-SIMPLE');
  });

  it('GET /strategies/:id/status returns status for running execution', async () => {
    const { app } = await buildApp();

    const execResponse = await app.inject({
      method: 'POST',
      url: '/strategies/execute',
      payload: {
        strategy_yaml: SIMPLE_STRATEGY_YAML,
        context_inputs: {},
      },
    });

    const { execution_id } = JSON.parse(execResponse.body);

    // Give the async execution a moment to start
    await new Promise((r) => setTimeout(r, 100));

    const statusResponse = await app.inject({
      method: 'GET',
      url: `/strategies/${execution_id}/status`,
    });

    assert.equal(statusResponse.statusCode, 200);
    const body = JSON.parse(statusResponse.body);
    assert.equal(body.execution_id, execution_id);
    assert.equal(body.strategy_id, 'S-SIMPLE');
    assert.ok(['started', 'running', 'completed'].includes(body.status));
  });
});
