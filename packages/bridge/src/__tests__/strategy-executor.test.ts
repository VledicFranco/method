/**
 * PRD 017: Strategy Pipelines — DAG Executor Tests (Phase 1c)
 *
 * Tests for Strategy YAML parsing, DAG validation, topological sort,
 * and end-to-end Strategy execution with mock LLM provider.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseStrategyYaml,
  parseStrategyObject,
  validateStrategyDAG,
  topologicalSort,
} from '../strategy/strategy-parser.js';
import type { StrategyYaml, StrategyDAG } from '../strategy/strategy-parser.js';
import { StrategyExecutor } from '../strategy/strategy-executor.js';
import type { StrategyExecutorConfig } from '../strategy/strategy-executor.js';
import type { LlmProvider, LlmRequest, LlmResponse, LlmStreamEvent } from '../strategy/llm-provider.js';

// ── Test Fixtures ───────────────────────────────────────────────

const TEST_STRATEGY_YAML = `
strategy:
  id: S-TEST-3NODE
  name: "Test 3-Node Strategy"
  version: "1.0"
  context:
    inputs:
      - { name: task_description, type: string }
  capabilities:
    read_only: [Read, Glob, Grep]
    implementation: [Read, Write, Edit, Bash, Glob, Grep]
  dag:
    nodes:
      - id: analyze
        type: methodology
        methodology: P2-SD
        method_hint: M7-PRDS
        capabilities: [read_only]
        inputs: [task_description]
        outputs: [analysis]
        gates:
          - type: algorithmic
            check: "output.analysis !== undefined"
      - id: implement
        type: methodology
        methodology: P2-SD
        method_hint: M1-IMPL
        capabilities: [implementation]
        inputs: [analysis]
        outputs: [code_changes]
        depends_on: [analyze]
        gates:
          - type: algorithmic
            check: "output.tests_passed === true"
            max_retries: 2
      - id: summarize
        type: script
        script: "return { summary: 'Completed: ' + JSON.stringify(inputs.code_changes) };"
        inputs: [code_changes]
        outputs: [summary]
        depends_on: [implement]
  oversight:
    rules:
      - { condition: "total_cost_usd > 5.00", action: warn_human }
`;

// ── Mock LLM Provider ──────────────────────────────────────────

function makeMockResponse(overrides: Partial<LlmResponse> = {}): LlmResponse {
  return {
    result: '```json\n{"status": "ok"}\n```',
    is_error: false,
    duration_ms: 100,
    duration_api_ms: 80,
    num_turns: 1,
    session_id: 'mock-session',
    total_cost_usd: 0.05,
    usage: {
      input_tokens: 100,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 50,
    },
    model_usage: {},
    permission_denials: [],
    stop_reason: 'end_turn',
    subtype: 'success',
    ...overrides,
  };
}

class MockLlmProvider implements LlmProvider {
  private responses: Map<string, LlmResponse> = new Map();
  public invocations: LlmRequest[] = [];

  setResponse(promptContains: string, response: LlmResponse): void {
    this.responses.set(promptContains, response);
  }

  async invoke(request: LlmRequest): Promise<LlmResponse> {
    this.invocations.push(request);

    // Find matching response by checking if prompt contains any key
    for (const [key, response] of this.responses) {
      if (request.prompt.includes(key)) return response;
    }

    // Default response
    return makeMockResponse();
  }

  async invokeStreaming(
    _request: LlmRequest,
    _onEvent: (event: LlmStreamEvent) => void,
  ): Promise<LlmResponse> {
    throw new Error('Not implemented');
  }
}

function makeExecutorConfig(overrides: Partial<StrategyExecutorConfig> = {}): StrategyExecutorConfig {
  return {
    maxParallel: 3,
    defaultGateRetries: 3,
    defaultTimeoutMs: 600000,
    retroDir: '.method/retros',
    ...overrides,
  };
}

// ── Helper: build a StrategyYaml object programmatically ────────

function makeStrategyYaml(overrides: Partial<StrategyYaml['strategy']> = {}): StrategyYaml {
  return {
    strategy: {
      id: 'S-TEST',
      name: 'Test Strategy',
      version: '1.0',
      capabilities: {
        read_only: ['Read', 'Glob'],
        impl: ['Read', 'Write', 'Edit'],
      },
      dag: {
        nodes: [
          {
            id: 'node-a',
            type: 'methodology',
            methodology: 'P2-SD',
            method_hint: 'M1-IMPL',
            capabilities: ['read_only'],
            inputs: ['task'],
            outputs: ['result_a'],
            gates: [
              {
                type: 'algorithmic',
                check: 'output.result_a !== undefined',
              },
            ],
          },
        ],
      },
      ...overrides,
    },
  };
}

// ── Parser Tests ───────────────────────────────────────────────

describe('parseStrategyYaml', () => {
  it('parses a valid Strategy YAML string into StrategyDAG', () => {
    const dag = parseStrategyYaml(TEST_STRATEGY_YAML);

    assert.equal(dag.id, 'S-TEST-3NODE');
    assert.equal(dag.name, 'Test 3-Node Strategy');
    assert.equal(dag.version, '1.0');
    assert.equal(dag.nodes.length, 3);
    assert.equal(dag.context_inputs.length, 1);
    assert.equal(dag.context_inputs[0].name, 'task_description');
  });

  it('parses nodes with correct types and dependencies', () => {
    const dag = parseStrategyYaml(TEST_STRATEGY_YAML);

    const analyze = dag.nodes.find((n) => n.id === 'analyze')!;
    assert.equal(analyze.type, 'methodology');
    assert.deepEqual(analyze.depends_on, []);
    assert.deepEqual(analyze.inputs, ['task_description']);
    assert.deepEqual(analyze.outputs, ['analysis']);
    assert.equal(analyze.config.type, 'methodology');
    if (analyze.config.type === 'methodology') {
      assert.equal(analyze.config.methodology, 'P2-SD');
      assert.equal(analyze.config.method_hint, 'M7-PRDS');
      assert.deepEqual(analyze.config.capabilities, ['read_only']);
    }

    const implement = dag.nodes.find((n) => n.id === 'implement')!;
    assert.deepEqual(implement.depends_on, ['analyze']);
    assert.deepEqual(implement.inputs, ['analysis']);
    assert.deepEqual(implement.outputs, ['code_changes']);

    const summarize = dag.nodes.find((n) => n.id === 'summarize')!;
    assert.equal(summarize.type, 'script');
    assert.deepEqual(summarize.depends_on, ['implement']);
    assert.equal(summarize.config.type, 'script');
    if (summarize.config.type === 'script') {
      assert.ok(summarize.config.script.includes('JSON.stringify'));
    }
  });

  it('applies default retries and timeout to gates', () => {
    const dag = parseStrategyYaml(TEST_STRATEGY_YAML);

    // analyze gate: no explicit retries/timeout → defaults
    const analyzeGate = dag.nodes.find((n) => n.id === 'analyze')!.gates[0];
    assert.equal(analyzeGate.max_retries, 3); // default for algorithmic
    assert.equal(analyzeGate.timeout_ms, 5000); // default timeout

    // implement gate: explicit max_retries=2
    const implementGate = dag.nodes.find((n) => n.id === 'implement')!.gates[0];
    assert.equal(implementGate.max_retries, 2);
    assert.equal(implementGate.timeout_ms, 5000);
  });

  it('parses capabilities and oversight rules', () => {
    const dag = parseStrategyYaml(TEST_STRATEGY_YAML);

    assert.deepEqual(dag.capabilities['read_only'], ['Read', 'Glob', 'Grep']);
    assert.deepEqual(dag.capabilities['implementation'], ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep']);

    assert.equal(dag.oversight_rules.length, 1);
    assert.equal(dag.oversight_rules[0].condition, 'total_cost_usd > 5.00');
    assert.equal(dag.oversight_rules[0].action, 'warn_human');
  });

  it('parses a Strategy with script nodes', () => {
    const yamlStr = `
strategy:
  id: S-SCRIPT
  name: "Script Strategy"
  version: "1.0"
  dag:
    nodes:
      - id: compute
        type: script
        script: "return { total: inputs.a + inputs.b };"
        inputs: [a, b]
        outputs: [total]
`;
    const dag = parseStrategyYaml(yamlStr);
    assert.equal(dag.nodes.length, 1);
    assert.equal(dag.nodes[0].type, 'script');
    assert.equal(dag.nodes[0].config.type, 'script');
    if (dag.nodes[0].config.type === 'script') {
      assert.ok(dag.nodes[0].config.script.includes('inputs.a + inputs.b'));
    }
  });

  it('parses strategy_gates', () => {
    const yamlStr = `
strategy:
  id: S-SGATES
  name: "Strategy Gates Test"
  version: "1.0"
  dag:
    nodes:
      - id: work
        type: methodology
        methodology: P2-SD
        outputs: [result]
    strategy_gates:
      - id: final_check
        depends_on: [work]
        type: algorithmic
        check: "artifacts.result !== undefined"
`;
    const dag = parseStrategyYaml(yamlStr);
    assert.equal(dag.strategy_gates.length, 1);
    assert.equal(dag.strategy_gates[0].id, 'final_check');
    assert.deepEqual(dag.strategy_gates[0].depends_on, ['work']);
    assert.equal(dag.strategy_gates[0].gate.type, 'algorithmic');
    assert.equal(dag.strategy_gates[0].gate.check, 'artifacts.result !== undefined');
    assert.equal(dag.strategy_gates[0].gate.max_retries, 0); // forced to 0: strategy gates are single-shot
  });
});

describe('parseStrategyObject', () => {
  it('transforms a pre-parsed YAML object into StrategyDAG', () => {
    const obj = makeStrategyYaml();
    const dag = parseStrategyObject(obj);

    assert.equal(dag.id, 'S-TEST');
    assert.equal(dag.name, 'Test Strategy');
    assert.equal(dag.nodes.length, 1);
    assert.deepEqual(dag.capabilities['read_only'], ['Read', 'Glob']);
  });

  it('handles empty optional fields gracefully', () => {
    const obj: StrategyYaml = {
      strategy: {
        id: 'S-MINIMAL',
        name: 'Minimal',
        version: '0.1',
        dag: {
          nodes: [
            { id: 'a', type: 'script', script: 'return {};' },
          ],
        },
      },
    };

    const dag = parseStrategyObject(obj);
    assert.equal(dag.nodes.length, 1);
    assert.deepEqual(dag.strategy_gates, []);
    assert.deepEqual(dag.capabilities, {});
    assert.deepEqual(dag.oversight_rules, []);
    assert.deepEqual(dag.context_inputs, []);
    assert.deepEqual(dag.nodes[0].depends_on, []);
    assert.deepEqual(dag.nodes[0].inputs, []);
    assert.deepEqual(dag.nodes[0].outputs, []);
    assert.deepEqual(dag.nodes[0].gates, []);
  });
});

// ── Validation Tests ───────────────────────────────────────────

describe('validateStrategyDAG', () => {
  it('valid DAG passes validation', () => {
    const dag = parseStrategyYaml(TEST_STRATEGY_YAML);
    const result = validateStrategyDAG(dag);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it('detects cyclic dependency (A -> B -> A)', () => {
    const obj: StrategyYaml = {
      strategy: {
        id: 'S-CYCLE',
        name: 'Cycle',
        version: '1.0',
        dag: {
          nodes: [
            { id: 'a', type: 'script', script: 'return {};', depends_on: ['b'] },
            { id: 'b', type: 'script', script: 'return {};', depends_on: ['a'] },
          ],
        },
      },
    };
    const dag = parseStrategyObject(obj);
    const result = validateStrategyDAG(dag);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.toLowerCase().includes('cyclic')));
  });

  it('detects missing depends_on reference', () => {
    const obj: StrategyYaml = {
      strategy: {
        id: 'S-BAD-REF',
        name: 'Bad Ref',
        version: '1.0',
        dag: {
          nodes: [
            { id: 'a', type: 'script', script: 'return {};', depends_on: ['nonexistent'] },
          ],
        },
      },
    };
    const dag = parseStrategyObject(obj);
    const result = validateStrategyDAG(dag);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('unknown node "nonexistent"')));
  });

  it('detects duplicate node IDs', () => {
    const obj: StrategyYaml = {
      strategy: {
        id: 'S-DUP',
        name: 'Dup',
        version: '1.0',
        dag: {
          nodes: [
            { id: 'a', type: 'script', script: 'return {};' },
            { id: 'a', type: 'script', script: 'return {};' },
          ],
        },
      },
    };
    const dag = parseStrategyObject(obj);
    const result = validateStrategyDAG(dag);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('Duplicate node ID')));
  });

  it('detects invalid capability reference', () => {
    const obj: StrategyYaml = {
      strategy: {
        id: 'S-BAD-CAP',
        name: 'Bad Cap',
        version: '1.0',
        capabilities: {
          read_only: ['Read'],
        },
        dag: {
          nodes: [
            {
              id: 'a',
              type: 'methodology',
              methodology: 'P2-SD',
              capabilities: ['nonexistent_cap'],
            },
          ],
        },
      },
    };
    const dag = parseStrategyObject(obj);
    const result = validateStrategyDAG(dag);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('undefined capability set "nonexistent_cap"')));
  });

  it('detects gate expression syntax error', () => {
    const obj: StrategyYaml = {
      strategy: {
        id: 'S-BAD-GATE',
        name: 'Bad Gate',
        version: '1.0',
        dag: {
          nodes: [
            {
              id: 'a',
              type: 'methodology',
              methodology: 'P2-SD',
              gates: [
                { type: 'algorithmic', check: 'output.result ===' }, // syntax error
              ],
            },
          ],
        },
      },
    };
    const dag = parseStrategyObject(obj);
    const result = validateStrategyDAG(dag);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('invalid check expression')));
  });

  it('returns multiple errors at once', () => {
    const obj: StrategyYaml = {
      strategy: {
        id: 'S-MULTI-ERR',
        name: 'Multi Err',
        version: '1.0',
        capabilities: {},
        dag: {
          nodes: [
            {
              id: 'a',
              type: 'methodology',
              methodology: 'P2-SD',
              capabilities: ['nonexistent'],
              depends_on: ['ghost'],
              gates: [
                { type: 'algorithmic', check: '!!!' }, // syntax error
              ],
            },
            {
              id: 'a', // duplicate ID
              type: 'script',
              script: 'return {};',
            },
          ],
        },
      },
    };
    const dag = parseStrategyObject(obj);
    const result = validateStrategyDAG(dag);
    assert.equal(result.valid, false);
    // Should have at least 3 errors: duplicate ID, missing depends_on, bad capability
    assert.ok(result.errors.length >= 3, `Expected >= 3 errors, got ${result.errors.length}: ${result.errors.join('; ')}`);
  });

  it('detects invalid strategy_gates depends_on reference', () => {
    const obj: StrategyYaml = {
      strategy: {
        id: 'S-BAD-SG',
        name: 'Bad Strategy Gate',
        version: '1.0',
        dag: {
          nodes: [
            { id: 'a', type: 'script', script: 'return {};' },
          ],
          strategy_gates: [
            { id: 'sg1', depends_on: ['nonexistent'], type: 'algorithmic', check: 'true' },
          ],
        },
      },
    };
    const dag = parseStrategyObject(obj);
    const result = validateStrategyDAG(dag);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('Strategy gate "sg1"') && e.includes('unknown node')));
  });
});

// ── Topological Sort Tests ──────────────────────────────────────

describe('topologicalSort', () => {
  it('linear chain: A -> B -> C produces [[A], [B], [C]]', () => {
    const obj: StrategyYaml = {
      strategy: {
        id: 'S-LINEAR',
        name: 'Linear',
        version: '1.0',
        dag: {
          nodes: [
            { id: 'A', type: 'script', script: 'return {};' },
            { id: 'B', type: 'script', script: 'return {};', depends_on: ['A'] },
            { id: 'C', type: 'script', script: 'return {};', depends_on: ['B'] },
          ],
        },
      },
    };
    const dag = parseStrategyObject(obj);
    const levels = topologicalSort(dag);

    assert.equal(levels.length, 3);
    assert.deepEqual(levels[0], ['A']);
    assert.deepEqual(levels[1], ['B']);
    assert.deepEqual(levels[2], ['C']);
  });

  it('diamond: A -> B, A -> C, B -> D, C -> D produces [[A], [B, C], [D]]', () => {
    const obj: StrategyYaml = {
      strategy: {
        id: 'S-DIAMOND',
        name: 'Diamond',
        version: '1.0',
        dag: {
          nodes: [
            { id: 'A', type: 'script', script: 'return {};' },
            { id: 'B', type: 'script', script: 'return {};', depends_on: ['A'] },
            { id: 'C', type: 'script', script: 'return {};', depends_on: ['A'] },
            { id: 'D', type: 'script', script: 'return {};', depends_on: ['B', 'C'] },
          ],
        },
      },
    };
    const dag = parseStrategyObject(obj);
    const levels = topologicalSort(dag);

    assert.equal(levels.length, 3);
    assert.deepEqual(levels[0], ['A']);
    // B and C should be at the same level (order may vary)
    assert.equal(levels[1].length, 2);
    assert.ok(levels[1].includes('B'));
    assert.ok(levels[1].includes('C'));
    assert.deepEqual(levels[2], ['D']);
  });

  it('independent nodes at same level', () => {
    const obj: StrategyYaml = {
      strategy: {
        id: 'S-INDEP',
        name: 'Independent',
        version: '1.0',
        dag: {
          nodes: [
            { id: 'X', type: 'script', script: 'return {};' },
            { id: 'Y', type: 'script', script: 'return {};' },
            { id: 'Z', type: 'script', script: 'return {};' },
          ],
        },
      },
    };
    const dag = parseStrategyObject(obj);
    const levels = topologicalSort(dag);

    assert.equal(levels.length, 1);
    assert.equal(levels[0].length, 3);
    assert.ok(levels[0].includes('X'));
    assert.ok(levels[0].includes('Y'));
    assert.ok(levels[0].includes('Z'));
  });

  it('single node produces [[node]]', () => {
    const obj: StrategyYaml = {
      strategy: {
        id: 'S-SINGLE',
        name: 'Single',
        version: '1.0',
        dag: {
          nodes: [
            { id: 'only', type: 'script', script: 'return {};' },
          ],
        },
      },
    };
    const dag = parseStrategyObject(obj);
    const levels = topologicalSort(dag);

    assert.equal(levels.length, 1);
    assert.deepEqual(levels[0], ['only']);
  });

  it('throws on cyclic DAG', () => {
    const dag: StrategyDAG = {
      id: 'S-CYCLE',
      name: 'Cycle',
      version: '1.0',
      nodes: [
        {
          id: 'a',
          type: 'script',
          depends_on: ['b'],
          inputs: [],
          outputs: [],
          gates: [],
          config: { type: 'script', script: 'return {};' },
        },
        {
          id: 'b',
          type: 'script',
          depends_on: ['a'],
          inputs: [],
          outputs: [],
          gates: [],
          config: { type: 'script', script: 'return {};' },
        },
      ],
      strategy_gates: [],
      capabilities: {},
      oversight_rules: [],
      context_inputs: [],
    };

    assert.throws(
      () => topologicalSort(dag),
      /cycle/i,
    );
  });
});

// ── Executor Integration Tests ──────────────────────────────────

describe('StrategyExecutor', () => {
  it('3-node Strategy end-to-end: methodology -> methodology -> script', async () => {
    const provider = new MockLlmProvider();

    // Set up mock responses for each node
    provider.setResponse('node "analyze"', makeMockResponse({
      result: '```json\n{"analysis": "code needs refactoring"}\n```',
      total_cost_usd: 0.10,
      num_turns: 3,
      duration_ms: 2000,
    }));

    provider.setResponse('node "implement"', makeMockResponse({
      result: '```json\n{"tests_passed": true, "code_changes": {"files": ["a.ts"]}}\n```',
      total_cost_usd: 0.25,
      num_turns: 5,
      duration_ms: 5000,
    }));

    const config = makeExecutorConfig();
    const executor = new StrategyExecutor(provider, config);
    const dag = parseStrategyYaml(TEST_STRATEGY_YAML);

    const result = await executor.execute(dag, { task_description: 'refactor module X' });

    assert.equal(result.strategy_id, 'S-TEST-3NODE');
    assert.equal(result.status, 'completed');

    // All 3 nodes completed
    assert.equal(Object.keys(result.node_results).length, 3);
    assert.equal(result.node_results['analyze'].status, 'completed');
    assert.equal(result.node_results['implement'].status, 'completed');
    assert.equal(result.node_results['summarize'].status, 'completed');

    // Cost tracked
    assert.ok(result.cost_usd > 0, 'cost should be tracked');

    // Artifacts flow correctly
    assert.ok(result.artifacts['analysis'], 'analysis artifact should exist');
    assert.ok(result.artifacts['code_changes'], 'code_changes artifact should exist');
    assert.ok(result.artifacts['summary'], 'summary artifact should exist');

    // Script node output: the 'summary' output key maps to the string value
    // from { summary: 'Completed: ...' } returned by the script
    const summaryContent = result.artifacts['summary'].content;
    assert.ok(
      typeof summaryContent === 'string' &&
      summaryContent.includes('Completed:'),
      'summary artifact should contain the script output string',
    );
  });

  it('parallel execution: two independent nodes', async () => {
    // Create a provider with built-in delay
    class DelayProvider implements LlmProvider {
      public invocationOrder: string[] = [];

      async invoke(request: LlmRequest): Promise<LlmResponse> {
        // Extract node name from prompt
        const match = request.prompt.match(/node "(\w+)"/);
        const nodeName = match ? match[1] : 'unknown';
        this.invocationOrder.push(nodeName);

        // Simulate 50ms work
        await new Promise((resolve) => setTimeout(resolve, 50));

        return makeMockResponse({
          result: `\`\`\`json\n{"output_${nodeName}": true}\n\`\`\``,
          total_cost_usd: 0.05,
        });
      }

      async invokeStreaming(): Promise<LlmResponse> {
        throw new Error('Not implemented');
      }
    }

    const delayProvider = new DelayProvider();
    const config = makeExecutorConfig({ maxParallel: 5 });
    const executor = new StrategyExecutor(delayProvider, config);

    // Two independent nodes + one dependent
    const yamlStr = `
strategy:
  id: S-PARALLEL
  name: "Parallel Test"
  version: "1.0"
  dag:
    nodes:
      - id: alpha
        type: methodology
        methodology: P2-SD
        outputs: [out_alpha]
      - id: beta
        type: methodology
        methodology: P2-SD
        outputs: [out_beta]
      - id: merge
        type: script
        script: "return { merged: true };"
        inputs: [out_alpha, out_beta]
        outputs: [merged]
        depends_on: [alpha, beta]
`;

    const dag = parseStrategyYaml(yamlStr);
    const startTime = Date.now();
    const result = await executor.execute(dag, {});
    const wallTime = Date.now() - startTime;

    assert.equal(result.status, 'completed');
    assert.equal(Object.keys(result.node_results).length, 3);

    // Both alpha and beta should have been invoked (order may vary since they're parallel)
    assert.ok(
      delayProvider.invocationOrder.includes('alpha'),
      'alpha should have been invoked',
    );
    assert.ok(
      delayProvider.invocationOrder.includes('beta'),
      'beta should have been invoked',
    );

    // Wall time should be less than 50ms * 3 (sequential would be ~150ms+)
    // With parallel alpha+beta, it should be ~100ms+ (50ms for alpha|beta parallel + 0ms for script)
    // Using a generous threshold to avoid flaky tests
    assert.ok(
      wallTime < 300,
      `Wall time ${wallTime}ms should be less than sequential (300ms threshold)`,
    );
  });

  it('gate failure with retry: first attempt fails, second succeeds', async () => {
    let callCount = 0;

    class RetryProvider implements LlmProvider {
      async invoke(_request: LlmRequest): Promise<LlmResponse> {
        callCount++;
        if (callCount === 1) {
          // First attempt: gate will fail (tests_passed is false)
          return makeMockResponse({
            result: '```json\n{"tests_passed": false, "analysis": "needs work"}\n```',
            total_cost_usd: 0.05,
          });
        }
        // Second attempt: gate will pass
        return makeMockResponse({
          result: '```json\n{"tests_passed": true, "analysis": "looks good"}\n```',
          total_cost_usd: 0.05,
        });
      }
      async invokeStreaming(): Promise<LlmResponse> {
        throw new Error('Not implemented');
      }
    }

    const config = makeExecutorConfig();
    const executor = new StrategyExecutor(new RetryProvider(), config);

    const yamlStr = `
strategy:
  id: S-RETRY
  name: "Retry Test"
  version: "1.0"
  dag:
    nodes:
      - id: work
        type: methodology
        methodology: P2-SD
        outputs: [result]
        gates:
          - type: algorithmic
            check: "output.tests_passed === true"
            max_retries: 3
`;

    const dag = parseStrategyYaml(yamlStr);
    const result = await executor.execute(dag, {});

    assert.equal(result.status, 'completed');
    assert.equal(result.node_results['work'].status, 'completed');
    assert.equal(result.node_results['work'].retries, 1);
    assert.equal(callCount, 2, 'Provider should have been called twice (1 initial + 1 retry)');
  });

  it('gate failure exhausts retries: node status is gate_failed', async () => {
    class AlwaysFailProvider implements LlmProvider {
      async invoke(): Promise<LlmResponse> {
        return makeMockResponse({
          result: '```json\n{"tests_passed": false}\n```',
          total_cost_usd: 0.02,
        });
      }
      async invokeStreaming(): Promise<LlmResponse> {
        throw new Error('Not implemented');
      }
    }

    const config = makeExecutorConfig();
    const executor = new StrategyExecutor(new AlwaysFailProvider(), config);

    const yamlStr = `
strategy:
  id: S-EXHAUST
  name: "Exhaust Retries"
  version: "1.0"
  dag:
    nodes:
      - id: flaky
        type: methodology
        methodology: P2-SD
        outputs: [result]
        gates:
          - type: algorithmic
            check: "output.tests_passed === true"
            max_retries: 2
`;

    const dag = parseStrategyYaml(yamlStr);
    const result = await executor.execute(dag, {});

    assert.equal(result.status, 'failed');
    assert.equal(result.node_results['flaky'].status, 'gate_failed');
    assert.equal(result.node_results['flaky'].retries, 2);
  });

  it('script node executes correctly: inputs flow in, output stored', async () => {
    const config = makeExecutorConfig();
    const executor = new StrategyExecutor(new MockLlmProvider(), config);

    const yamlStr = `
strategy:
  id: S-SCRIPT-EXEC
  name: "Script Execution"
  version: "1.0"
  context:
    inputs:
      - { name: count, type: number }
  dag:
    nodes:
      - id: compute
        type: script
        script: "return { doubled: inputs.count * 2, label: 'result' };"
        inputs: [count]
        outputs: [doubled, label]
`;

    const dag = parseStrategyYaml(yamlStr);
    const result = await executor.execute(dag, { count: 21 });

    assert.equal(result.status, 'completed');
    assert.equal(result.node_results['compute'].status, 'completed');

    // The output is stored as artifacts
    const doubledArtifact = result.artifacts['doubled'];
    assert.ok(doubledArtifact, 'doubled artifact should exist');
    assert.equal(doubledArtifact.content, 42);

    const labelArtifact = result.artifacts['label'];
    assert.ok(labelArtifact, 'label artifact should exist');
    assert.equal(labelArtifact.content, 'result');
  });

  it('artifact dependency filtering: node receives only declared inputs', async () => {
    // Track what the second node receives
    let secondNodePrompt = '';

    class TrackingProvider implements LlmProvider {
      async invoke(request: LlmRequest): Promise<LlmResponse> {
        if (request.prompt.includes('node "second"')) {
          secondNodePrompt = request.prompt;
        }
        return makeMockResponse({
          result: '```json\n{"data": "from_node"}\n```',
          total_cost_usd: 0.01,
        });
      }
      async invokeStreaming(): Promise<LlmResponse> {
        throw new Error('Not implemented');
      }
    }

    const config = makeExecutorConfig();
    const executor = new StrategyExecutor(new TrackingProvider(), config);

    const yamlStr = `
strategy:
  id: S-FILTER
  name: "Filter Test"
  version: "1.0"
  context:
    inputs:
      - { name: secret, type: string }
      - { name: public_data, type: string }
  dag:
    nodes:
      - id: first
        type: methodology
        methodology: P2-SD
        inputs: [secret]
        outputs: [processed]
      - id: second
        type: methodology
        methodology: P2-SD
        inputs: [public_data]
        outputs: [result]
        depends_on: [first]
`;

    const dag = parseStrategyYaml(yamlStr);
    const result = await executor.execute(dag, {
      secret: 'top-secret-value',
      public_data: 'public-info',
    });

    assert.equal(result.status, 'completed');

    // The second node's prompt should contain public_data but NOT secret
    assert.ok(secondNodePrompt.includes('public_data'), 'should receive public_data');
    assert.ok(secondNodePrompt.includes('public-info'), 'should receive public_data value');
    assert.ok(!secondNodePrompt.includes('top-secret-value'), 'should NOT receive secret value');
  });

  it('oversight rule triggers on high cost', async () => {
    class ExpensiveProvider implements LlmProvider {
      async invoke(): Promise<LlmResponse> {
        return makeMockResponse({
          result: '```json\n{"done": true}\n```',
          total_cost_usd: 3.00, // Expensive!
        });
      }
      async invokeStreaming(): Promise<LlmResponse> {
        throw new Error('Not implemented');
      }
    }

    const config = makeExecutorConfig();
    const executor = new StrategyExecutor(new ExpensiveProvider(), config);

    const yamlStr = `
strategy:
  id: S-COSTLY
  name: "Costly Strategy"
  version: "1.0"
  dag:
    nodes:
      - id: expensive_a
        type: methodology
        methodology: P2-SD
        outputs: [out_a]
      - id: expensive_b
        type: methodology
        methodology: P2-SD
        outputs: [out_b]
      - id: final
        type: script
        script: "return { done: true };"
        depends_on: [expensive_a, expensive_b]
        outputs: [result]
  oversight:
    rules:
      - { condition: "total_cost_usd > 5.00", action: warn_human }
`;

    const dag = parseStrategyYaml(yamlStr);
    const result = await executor.execute(dag, {});

    // Both expensive nodes cost $3 each = $6 total > $5 threshold
    assert.equal(result.status, 'completed'); // warn_human doesn't suspend
    assert.ok(
      result.oversight_events.length > 0,
      'should have triggered oversight event',
    );
    assert.equal(result.oversight_events[0].rule.action, 'warn_human');
    assert.equal(result.oversight_events[0].rule.condition, 'total_cost_usd > 5.00');
  });

  it('context inputs stored as initial artifacts', async () => {
    const config = makeExecutorConfig();
    const executor = new StrategyExecutor(new MockLlmProvider(), config);

    const yamlStr = `
strategy:
  id: S-CTX
  name: "Context Test"
  version: "1.0"
  context:
    inputs:
      - { name: project_name, type: string }
      - { name: target_version, type: string }
  dag:
    nodes:
      - id: use_ctx
        type: script
        script: "return { msg: inputs.project_name + ' v' + inputs.target_version };"
        inputs: [project_name, target_version]
        outputs: [msg]
`;

    const dag = parseStrategyYaml(yamlStr);
    const result = await executor.execute(dag, {
      project_name: 'method',
      target_version: '2.0',
    });

    assert.equal(result.status, 'completed');

    // Context inputs should be in artifacts
    assert.ok(result.artifacts['project_name'], 'project_name should be in artifacts');
    assert.equal(result.artifacts['project_name'].content, 'method');
    assert.equal(result.artifacts['project_name'].producer_node_id, '__context__');

    // Script output should have used the context inputs
    const msg = result.artifacts['msg'];
    assert.ok(msg, 'msg artifact should exist');
    assert.equal(msg.content, 'method v2.0');
  });

  it('escalate_to_human oversight rule suspends execution', async () => {
    class FailingProvider implements LlmProvider {
      private callCount = 0;
      async invoke(): Promise<LlmResponse> {
        this.callCount++;
        return makeMockResponse({
          result: '```json\n{"fail": true}\n```',
          total_cost_usd: 0.01,
        });
      }
      async invokeStreaming(): Promise<LlmResponse> {
        throw new Error('Not implemented');
      }
    }

    const config = makeExecutorConfig();
    const executor = new StrategyExecutor(new FailingProvider(), config);

    const yamlStr = `
strategy:
  id: S-ESCALATE
  name: "Escalate Test"
  version: "1.0"
  dag:
    nodes:
      - id: retry_node
        type: methodology
        methodology: P2-SD
        outputs: [result]
        gates:
          - type: algorithmic
            check: "output.success === true"
            max_retries: 5
      - id: after_node
        type: script
        script: "return { final: true };"
        depends_on: [retry_node]
        outputs: [final]
  oversight:
    rules:
      - { condition: "gate_failures >= 3 on same step", action: escalate_to_human }
`;

    const dag = parseStrategyYaml(yamlStr);
    const result = await executor.execute(dag, {});

    assert.equal(result.status, 'suspended');
    assert.ok(result.oversight_events.length > 0);
    assert.equal(result.oversight_events[0].rule.action, 'escalate_to_human');
    // The after_node should NOT have executed
    assert.ok(
      !result.node_results['after_node'] ||
      result.node_results['after_node'].status === 'pending',
      'after_node should not have executed',
    );
  });

  it('getState() returns null before execution', () => {
    const config = makeExecutorConfig();
    const executor = new StrategyExecutor(new MockLlmProvider(), config);
    assert.equal(executor.getState(), null);
  });

  it('getState() returns state during/after execution', async () => {
    const config = makeExecutorConfig();
    const executor = new StrategyExecutor(new MockLlmProvider(), config);

    const yamlStr = `
strategy:
  id: S-STATE
  name: "State Test"
  version: "1.0"
  dag:
    nodes:
      - id: simple
        type: script
        script: "return { done: true };"
        outputs: [result]
`;

    const dag = parseStrategyYaml(yamlStr);
    await executor.execute(dag, {});

    const state = executor.getState();
    assert.ok(state, 'state should exist after execution');
    assert.equal(state!.strategy_id, 'S-STATE');
    assert.ok(state!.started_at);
    assert.ok(state!.completed_at);
    assert.ok(state!.levels.length > 0);
  });

  it('invalid DAG throws during execution', async () => {
    const config = makeExecutorConfig();
    const executor = new StrategyExecutor(new MockLlmProvider(), config);

    const dag: StrategyDAG = {
      id: 'S-INVALID',
      name: 'Invalid',
      version: '1.0',
      nodes: [
        {
          id: 'a',
          type: 'script',
          depends_on: ['nonexistent'],
          inputs: [],
          outputs: [],
          gates: [],
          config: { type: 'script', script: 'return {};' },
        },
      ],
      strategy_gates: [],
      capabilities: {},
      oversight_rules: [],
      context_inputs: [],
    };

    await assert.rejects(
      () => executor.execute(dag, {}),
      /Invalid Strategy DAG/,
    );
  });

  it('strategy gate failure causes failed status', async () => {
    const config = makeExecutorConfig();
    const executor = new StrategyExecutor(new MockLlmProvider(), config);

    const yamlStr = `
strategy:
  id: S-SG-FAIL
  name: "Strategy Gate Fail"
  version: "1.0"
  dag:
    nodes:
      - id: work
        type: script
        script: "return { count: 5 };"
        outputs: [count]
    strategy_gates:
      - id: minimum_count
        depends_on: [work]
        type: algorithmic
        check: "artifacts.count > 100"
`;

    const dag = parseStrategyYaml(yamlStr);
    const result = await executor.execute(dag, {});

    // Node completed but strategy gate failed
    assert.equal(result.node_results['work'].status, 'completed');
    assert.equal(result.status, 'failed');
    assert.ok(
      result.gate_results.some((gr) => gr.gate_id === 'strategy:minimum_count' && !gr.passed),
      'strategy gate should have failed',
    );
  });

  it('methodology node with empty methodology field fails validation', () => {
    const obj: StrategyYaml = {
      strategy: {
        id: 'S-EMPTY-METH',
        name: 'Empty Methodology',
        version: '1.0',
        dag: {
          nodes: [
            {
              id: 'bad_node',
              type: 'methodology',
              methodology: '',
              outputs: ['result'],
            },
          ],
        },
      },
    };

    const dag = parseStrategyObject(obj);
    const validation = validateStrategyDAG(dag);
    assert.equal(validation.valid, false);
    assert.ok(
      validation.errors.some((e) => e.includes('non-empty "methodology" field')),
      `Expected methodology validation error, got: ${validation.errors.join('; ')}`,
    );
  });

  it('methodology node with missing methodology field fails validation', () => {
    const obj: StrategyYaml = {
      strategy: {
        id: 'S-MISSING-METH',
        name: 'Missing Methodology',
        version: '1.0',
        dag: {
          nodes: [
            {
              id: 'bad_node',
              type: 'methodology',
              // methodology field omitted — parser defaults to ''
              outputs: ['result'],
            },
          ],
        },
      },
    };

    const dag = parseStrategyObject(obj);
    const validation = validateStrategyDAG(dag);
    assert.equal(validation.valid, false);
    assert.ok(
      validation.errors.some((e) => e.includes('non-empty "methodology" field')),
      `Expected methodology validation error, got: ${validation.errors.join('; ')}`,
    );
  });

  it('LLM response without JSON code block is handled gracefully', async () => {
    class PlainTextProvider implements LlmProvider {
      async invoke(): Promise<LlmResponse> {
        return makeMockResponse({
          result: 'I completed the task successfully. Everything looks good.',
          total_cost_usd: 0.03,
        });
      }
      async invokeStreaming(): Promise<LlmResponse> {
        throw new Error('Not implemented');
      }
    }

    const config = makeExecutorConfig();
    const executor = new StrategyExecutor(new PlainTextProvider(), config);

    const yamlStr = `
strategy:
  id: S-PLAIN
  name: "Plain Response"
  version: "1.0"
  dag:
    nodes:
      - id: work
        type: methodology
        methodology: P2-SD
        outputs: [output]
`;

    const dag = parseStrategyYaml(yamlStr);
    const result = await executor.execute(dag, {});

    // Should complete — output is the raw text
    assert.equal(result.status, 'completed');
    assert.equal(result.node_results['work'].status, 'completed');
    assert.ok(result.node_results['work'].output.result, 'should have raw result');
  });

  it('context continuity with refresh_context flag', async () => {
    // Test that:
    // 1. Without refresh_context: nodes 1 & 2 use the SAME session (continuous context)
    // 2. With refresh_context=true on node 2: node 3 gets a FRESH session
    //
    // Track sessionId and refreshSessionId in invocations to verify behavior

    class SessionTrackingProvider implements LlmProvider {
      public invocations: LlmRequest[] = [];

      async invoke(request: LlmRequest): Promise<LlmResponse> {
        this.invocations.push(request);

        // Extract node name from prompt for debugging
        const match = request.prompt.match(/node "(\w+)"/);
        const nodeName = match ? match[1] : 'unknown';

        return makeMockResponse({
          result: `\`\`\`json\n{"node": "${nodeName}", "done": true}\n\`\`\``,
          total_cost_usd: 0.02,
          session_id: request.refreshSessionId || request.resumeSessionId || request.sessionId,
        });
      }

      async invokeStreaming(): Promise<LlmResponse> {
        throw new Error('Not implemented');
      }
    }

    const provider = new SessionTrackingProvider();
    const config = makeExecutorConfig();
    const executor = new StrategyExecutor(provider, config);

    const yamlStr = `
strategy:
  id: S-CONTEXT-TEST
  name: "Context Continuity Test"
  version: "1.0"
  dag:
    nodes:
      - id: analyze
        type: methodology
        methodology: P2-SD
        outputs: [analysis]
      - id: design
        type: methodology
        methodology: P2-SD
        depends_on: [analyze]
        inputs: [analysis]
        outputs: [design]
        refresh_context: false
      - id: validate
        type: methodology
        methodology: P2-SD
        depends_on: [design]
        inputs: [design]
        outputs: [validation]
        refresh_context: true
`;

    const dag = parseStrategyYaml(yamlStr);

    // Verify refresh_context fields were parsed correctly
    const analyzeNode = dag.nodes.find((n) => n.id === 'analyze')!;
    const designNode = dag.nodes.find((n) => n.id === 'design')!;
    const validateNode = dag.nodes.find((n) => n.id === 'validate')!;

    assert.equal(analyzeNode.refresh_context, false, 'analyze node should default to false');
    assert.equal(designNode.refresh_context, false, 'design node explicitly set to false');
    assert.equal(validateNode.refresh_context, true, 'validate node explicitly set to true');

    const result = await executor.execute(dag, {});

    // Verify execution completed successfully
    assert.equal(result.status, 'completed');
    assert.equal(result.node_results['analyze'].status, 'completed');
    assert.equal(result.node_results['design'].status, 'completed');
    assert.equal(result.node_results['validate'].status, 'completed');

    // Verify invocation tracking
    assert.equal(provider.invocations.length, 3, 'should have 3 invocations (one per node)');

    const analyzeInv = provider.invocations[0];
    const designInv = provider.invocations[1];
    const validateInv = provider.invocations[2];

    // Both analyze and design should use the same session (design uses resumeSessionId or same sessionId)
    // validate should have refreshSessionId set (creating a new session)
    assert.ok(
      analyzeInv.sessionId,
      'analyze invocation should have sessionId',
    );

    // Design continues the same session (resumeSessionId is not explicitly used in the test,
    // but sessionId should be maintained for continuity)
    // Actually, per the commission, we use refreshSessionId when refresh_context=true
    // So: analyze gets sessionId, design gets same sessionId (no refresh), validate gets refreshSessionId
    assert.ok(
      designInv.sessionId === analyzeInv.sessionId,
      `design should use same session as analyze: design=${designInv.sessionId} vs analyze=${analyzeInv.sessionId}`,
    );

    assert.ok(
      validateInv.refreshSessionId,
      'validate invocation should have refreshSessionId set (because refresh_context=true)',
    );

    assert.notEqual(
      validateInv.refreshSessionId,
      analyzeInv.sessionId,
      'validate refreshSessionId should be different from analyze sessionId',
    );
  });
});

// ── Timeout Tests (isolated to avoid cascading cancellations) ──

describe('StrategyExecutor — timeout enforcement', () => {
  it('provider that completes within timeout succeeds', async () => {
    // Verify that the timeout race doesn't interfere with normal execution.
    // Provider resolves in ~10ms, timeout is 5000ms — provider wins the race.
    class QuickProvider implements LlmProvider {
      async invoke(_request: LlmRequest): Promise<LlmResponse> {
        await new Promise((r) => setTimeout(r, 10));
        return makeMockResponse({
          result: '```json\n{"fast": true}\n```',
          total_cost_usd: 0.01,
        });
      }
      async invokeStreaming(): Promise<LlmResponse> {
        throw new Error('Not implemented');
      }
    }

    const config = makeExecutorConfig({ defaultTimeoutMs: 5000 });
    const executor = new StrategyExecutor(new QuickProvider(), config);

    const yamlStr = `
strategy:
  id: S-FAST
  name: "Fast Test"
  version: "1.0"
  dag:
    nodes:
      - id: quick_node
        type: methodology
        methodology: P2-SD
        outputs: [result]
`;

    const dag = parseStrategyYaml(yamlStr);
    const result = await executor.execute(dag, {});

    assert.equal(result.status, 'completed');
    assert.equal(result.node_results['quick_node'].status, 'completed');
  });

  it('provider that rejects immediately is caught as node failure', async () => {
    // Verify that provider errors (not timeouts) are also properly caught.
    class FailingProvider implements LlmProvider {
      async invoke(_request: LlmRequest): Promise<LlmResponse> {
        throw new Error('Connection refused');
      }
      async invokeStreaming(): Promise<LlmResponse> {
        throw new Error('Not implemented');
      }
    }

    const config = makeExecutorConfig({ defaultTimeoutMs: 5000 });
    const executor = new StrategyExecutor(new FailingProvider(), config);

    const yamlStr = `
strategy:
  id: S-FAIL
  name: "Fail Test"
  version: "1.0"
  dag:
    nodes:
      - id: fail_node
        type: methodology
        methodology: P2-SD
        outputs: [result]
`;

    const dag = parseStrategyYaml(yamlStr);
    const result = await executor.execute(dag, {});

    assert.equal(result.status, 'failed');
    assert.equal(result.node_results['fail_node'].status, 'failed');
    assert.ok(
      result.node_results['fail_node'].error?.includes('Connection refused'),
      `Expected connection error, got: ${result.node_results['fail_node'].error}`,
    );
  });
});
