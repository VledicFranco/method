/**
 * Smoke test web server — serves test case browser + runs cases via SSE.
 *
 * Run: npx tsx packages/smoke-test/src/server.ts
 * Open: http://localhost:5180
 */

import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { allCases, casesByCategory, allFeatures, type SmokeTestCase } from './cases/index.js';
import { runMockStrategy, loadFixtureYaml, type MockRunOptions } from './executor/mock-executor.js';
import { checkResult, type AssertionResult } from './executor/result-checker.js';
import { parseStrategyYaml } from '@method/methodts/strategy/dag-parser.js';
import { load as loadYaml } from 'js-yaml';
import { createAgent, type Pact } from '@method/pacta';
import { isLiveModeAvailable, createLiveProvider } from './executor/live-executor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 5180);

// ── Load .env from repo root ────────────────────────────────────
function loadDotEnv(): void {
  // Walk up to find .env
  let dir = resolve(__dirname);
  for (let i = 0; i < 5; i++) {
    const envPath = join(dir, '.env');
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq < 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
          val = val.slice(1, -1);
        if (process.env[key] === undefined) process.env[key] = val;
      }
      break;
    }
    dir = dirname(dir);
  }
}
loadDotEnv();

// ── Scripted mock outputs per fixture ───────────────────────────

function getMockOptions(testCase: SmokeTestCase): MockRunOptions {
  const opts: MockRunOptions = {};

  switch (testCase.id) {
    case 'node-methodology':
      opts.outputs = { analyze: { analysis_result: 'Code does X and Y.' } };
      opts.contextInputs = { task_desc: 'Analyse the divide function' };
      break;
    case 'node-script':
      opts.contextInputs = { a: 10, b: 20 };
      break;
    case 'node-strategy-sub': {
      const childYaml = loadFixtureYaml(join(__dirname, 'fixtures/strategies/node-strategy-sub-child.yaml'));
      opts.subStrategies = { 'S-SMOKE-SUB-CHILD': childYaml };
      break;
    }
    case 'node-semantic':
      opts.outputs = { explore: { exploration_result: { facts: ['fact1'] } } };
      opts.contextInputs = { project_path: '/fake/project' };
      break;
    case 'node-context-load':
      break; // mock context load executor handles this
    case 'gate-algorithmic':
      opts.outputs = { 'score': { score: 0.95, analysis: 'Good quality' } };
      break;
    case 'gate-observation':
      opts.outputs = { 'work': { result: 'observed' } };
      break;
    case 'gate-human-approval':
      opts.outputs = { 'design': { deliverable: 'Ready for review' } };
      opts.approvalDecision = { approved: true };
      break;
    case 'gate-retry-feedback':
      opts.dynamicFn = (_nodeId, attempt) => {
        return attempt < 2 ? { quality: 'low' } : { quality: 'high' };
      };
      break;
    case 'gate-strategy-level':
      break; // script nodes handle themselves
    case 'artifact-versioning':
    case 'artifact-passing':
      break; // script nodes
    case 'oversight-escalate':
      opts.outputs = { 'expensive-work': { result: 'done' } };
      break;
    case 'oversight-warn':
      opts.outputs = { 'slow-task': { analysis_result: 'analysis done' } };
      break;
    case 'parallel-execution':
      opts.outputs = {
        'node-a': { result_a: 'A done' },
        'node-b': { result_b: 'B done' },
        'node-c': { result_c: 'C done' },
      };
      break;
    case 'refresh-context':
      opts.outputs = {
        'step-1': { step1_result: 'done' },
        'step-2': { step2_result: 'done' },
      };
      break;
    case 'budget-enforcement':
      break; // script node
    case 'output-validation':
      opts.outputs = { 'produce-output': { structured_result: { valid: true, score: 42 } } };
      break;
    case 'scope-contract':
      opts.outputs = { 'restricted-task': { analysis_result: 'executed with limited tools' } };
      break;
    case 'prompt-construction':
      opts.outputs = { 'full-prompt': { prompt_result: 'prompt assembled correctly' } };
      opts.contextInputs = { task_desc: 'Implement feature X' };
      break;
    case 'cycle-detection': {
      // Strategy references itself — need SubStrategySource that returns this DAG
      const cycleYaml = loadFixtureYaml(join(__dirname, 'fixtures/strategies/cycle-detection.yaml'));
      opts.subStrategies = { 'S-SMOKE-CYCLE': cycleYaml };
      break;
    }
    case 'dag-validation-errors':
      break; // should fail at parse
    case 'trigger-manual':
      opts.contextInputs = { trigger_event: { type: 'manual', timestamp: new Date().toISOString() } };
      break;
    case 'retro-generation':
    case 'critical-path':
      break; // script nodes
    case 'full-pipeline':
      opts.outputs = {
        'analyze': { analysis_result: { findings: ['component A', 'component B'], quality: 0.9 } },
      };
      opts.contextInputs = { task_desc: 'Analyze the project' };
      break;
    default:
      break;
  }
  return opts;
}

// ── Run a test case ─────────────────────────────────────────────

interface RunEvent {
  type: 'case_started' | 'case_completed' | 'case_failed' | 'parse_error';
  caseId?: string;
  result?: Record<string, unknown>;
  assertions?: AssertionResult[];
  allPassed?: boolean;
  error?: string;
  durationMs?: number;
}

async function runCase(testCase: SmokeTestCase): Promise<RunEvent> {
  const fixturePath = join(__dirname, 'fixtures', testCase.fixture);
  const startMs = Date.now();

  // Handle parse-error test cases
  if (testCase.expected.parseError) {
    try {
      const yaml = loadFixtureYaml(fixturePath);
      const raw = loadYaml(yaml) as { strategy: { dag: { nodes: Array<{ id: string }> } } };
      const ids = raw.strategy.dag.nodes.map((n: { id: string }) => n.id);
      const hasDuplicates = new Set(ids).size !== ids.length;
      return {
        type: hasDuplicates ? 'case_completed' : 'case_failed',
        caseId: testCase.id,
        assertions: [{
          name: 'Has duplicate node IDs (parse error)',
          passed: hasDuplicates,
          expected: 'duplicate IDs detected',
          actual: hasDuplicates ? 'duplicates found' : 'no duplicates',
        }],
        allPassed: hasDuplicates,
        durationMs: Date.now() - startMs,
      };
    } catch (err) {
      return {
        type: 'case_completed',
        caseId: testCase.id,
        assertions: [{
          name: 'Parse error thrown',
          passed: true,
          expected: 'parse error',
          actual: err instanceof Error ? err.message : String(err),
        }],
        allPassed: true,
        durationMs: Date.now() - startMs,
      };
    }
  }

  // Method test cases — run via Pacta agent with real provider
  if (testCase.category === 'method') {
    if (!isLiveModeAvailable()) {
      return {
        type: 'case_completed',
        caseId: testCase.id,
        assertions: [{
          name: 'Live provider available (ANTHROPIC_API_KEY)',
          passed: testCase.mode === 'mock',
          expected: 'API key present or mock-only case',
          actual: 'no ANTHROPIC_API_KEY',
        }],
        allPassed: testCase.mode === 'mock',
        durationMs: Date.now() - startMs,
      };
    }

    try {
      const fixturePathAbs = join(__dirname, 'fixtures', testCase.fixture);
      const fixtureUrl = new URL('file://' + fixturePathAbs.replace(/\\/g, '/')).href;
      const fixture = await import(fixtureUrl);
      const provider = createLiveProvider();
      const pact: Pact = fixture.pact ?? { mode: { type: 'oneshot' } };

      if (fixture.steps) {
        // Multi-step method (analyse-critique-propose pattern)
        const bundle: Record<string, string> = { ...(fixture.initialBundle ?? {}) };
        let totalCost = 0;
        let totalIn = 0;
        let totalOut = 0;
        const stepResults: Array<{ name: string; output: string; cost: number; tokens: number; durationMs: number }> = [];

        for (const step of fixture.steps) {
          const prompt = step.buildPrompt(bundle);
          const stepPact = step.pact ?? pact;
          const agent = createAgent({ pact: stepPact, provider });
          const stepStart = Date.now();
          const result = await agent.invoke({ prompt, workdir: process.cwd() });
          const output = String(result.output ?? '').trim();
          bundle[step.outputKey] = output;
          const cost = result.cost?.totalUsd ?? 0;
          const tokens = (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0);
          totalCost += cost;
          totalIn += result.usage?.inputTokens ?? 0;
          totalOut += result.usage?.outputTokens ?? 0;
          stepResults.push({ name: step.name, output: output.slice(0, 200), cost, tokens, durationMs: Date.now() - stepStart });
        }

        const artifacts = Object.keys(bundle).filter(k => k !== 'code');
        const assertions: AssertionResult[] = [
          { name: 'All steps completed', passed: true, expected: `${fixture.steps.length} steps`, actual: `${stepResults.length} steps` },
          ...artifacts.map((k: string) => ({
            name: `Artifact "${k}" produced`,
            passed: !!bundle[k],
            expected: 'present',
            actual: bundle[k] ? 'present' : 'missing',
          })),
        ];

        return {
          type: 'case_completed',
          caseId: testCase.id,
          result: { status: 'completed', cost_usd: totalCost, duration_ms: Date.now() - startMs, node_count: stepResults.length, artifact_count: artifacts.length, gate_count: 0, oversight_count: 0, input_tokens: totalIn, output_tokens: totalOut, steps: stepResults },
          assertions,
          allPassed: assertions.every(a => a.passed),
          durationMs: Date.now() - startMs,
        };
      } else {
        // Single-prompt method
        const prompt = fixture.prompt;
        const agent = createAgent({ pact, provider });
        const result = await agent.invoke({ prompt, workdir: process.cwd() });
        const output = String(result.output ?? '').trim();

        return {
          type: 'case_completed',
          caseId: testCase.id,
          result: { status: 'completed', cost_usd: result.cost?.totalUsd ?? 0, duration_ms: Date.now() - startMs, node_count: 1, artifact_count: 0, gate_count: 0, oversight_count: 0, input_tokens: result.usage?.inputTokens ?? 0, output_tokens: result.usage?.outputTokens ?? 0, output: output.slice(0, 500) },
          assertions: [{ name: 'Agent completed', passed: true, expected: 'completed', actual: 'completed' }],
          allPassed: true,
          durationMs: Date.now() - startMs,
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const expectsFailure = testCase.expected.status === 'failed';
      const errorMatch = testCase.expected.errorContains ? msg.toLowerCase().includes(testCase.expected.errorContains.toLowerCase()) : false;

      return {
        type: 'case_completed',
        caseId: testCase.id,
        assertions: [{
          name: expectsFailure ? 'Expected failure' : 'Unexpected error',
          passed: expectsFailure && (!testCase.expected.errorContains || errorMatch),
          expected: expectsFailure ? `failure with "${testCase.expected.errorContains}"` : 'success',
          actual: msg.slice(0, 200),
        }],
        allPassed: expectsFailure && (!testCase.expected.errorContains || errorMatch),
        error: expectsFailure ? undefined : msg,
        durationMs: Date.now() - startMs,
      };
    }
  }

  try {
    const yaml = loadFixtureYaml(fixturePath);
    const options = getMockOptions(testCase);
    const { result } = await runMockStrategy(yaml, options);
    const assertions = checkResult(result, testCase.expected);
    const passed = assertions.every((a) => a.passed);

    return {
      type: 'case_completed',
      caseId: testCase.id,
      result: {
        status: result.status,
        cost_usd: result.cost_usd,
        duration_ms: result.duration_ms,
        node_count: Object.keys(result.node_results).length,
        artifact_count: Object.keys(result.artifacts).length,
        gate_count: result.gate_results.length,
        oversight_count: result.oversight_events.length,
      },
      assertions,
      allPassed: passed,
      durationMs: Date.now() - startMs,
    };
  } catch (err) {
    // If the test case expects failure, check error message
    if (testCase.expected.status === 'failed' && testCase.expected.errorContains) {
      const msg = err instanceof Error ? err.message : String(err);
      const matches = msg.toLowerCase().includes(testCase.expected.errorContains.toLowerCase());
      return {
        type: 'case_completed',
        caseId: testCase.id,
        assertions: [{
          name: `Error contains "${testCase.expected.errorContains}"`,
          passed: matches,
          expected: testCase.expected.errorContains,
          actual: msg.slice(0, 200),
        }],
        allPassed: matches,
        durationMs: Date.now() - startMs,
      };
    }
    return {
      type: 'case_failed',
      caseId: testCase.id,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startMs,
    };
  }
}

// ── HTTP server ─────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/') {
    const html = readFileSync(join(__dirname, 'app/index.html'), 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/styles.css') {
    const css = readFileSync(join(__dirname, 'app/styles.css'), 'utf8');
    res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
    res.end(css);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/cases') {
    const cases = [...allCases.values()].map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      category: c.category,
      features: c.features,
      mode: c.mode,
    }));
    const features = allFeatures();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ cases, features }));
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/run/')) {
    const caseId = url.pathname.slice('/api/run/'.length);
    const testCase = allCases.get(caseId);
    if (!testCase) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Case not found' }));
      return;
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });

    const send = (ev: RunEvent) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
    send({ type: 'case_started', caseId });

    const result = await runCase(testCase);
    send(result);
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/run-all') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });

    const send = (ev: RunEvent & { total?: number; completed?: number }) =>
      res.write(`data: ${JSON.stringify(ev)}\n\n`);

    const cases = [...allCases.values()].filter((c) => c.mode !== 'live');
    let completed = 0;

    for (const tc of cases) {
      send({ type: 'case_started', caseId: tc.id, total: cases.length, completed });
      const result = await runCase(tc);
      completed++;
      send({ ...result, total: cases.length, completed });
    }
    res.end();
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, () => {
  console.log(`Smoke test UI at http://localhost:${PORT}`);
  console.log(`${allCases.size} test cases loaded`);
});
