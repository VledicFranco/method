/**
 * Phase 1 — Baseline cost measurement script.
 *
 * Runs the LLM Monitor on a representative set of inputs and measures:
 * - Tokens per invocation (input + output)
 * - Latency per call
 * - Estimated cost per call and aggregate
 *
 * Writes results to results/baseline-cost.json.
 * This establishes the cost baseline the SLM will optimize against.
 *
 * Run: npx tsx experiments/exp-slm/phase-1-llm-monitor/scripts/measure-baseline.ts
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLlmMonitor } from '../src/llm-monitor.js';
import { buildMonitorUserPrompt, MONITOR_SYSTEM_PROMPT } from '../src/llm-monitor-prompt.js';
import type {
  ProviderAdapter,
  ProviderAdapterResult,
  AggregatedSignals,
  MonitoringSignal,
  MonitorReport,
  NoControl,
  TokenUsage,
} from '../src/types.js';
import { moduleId } from '../src/types.js';

// ── Paths ───────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, '..', 'results');
const OUTPUT_PATH = join(RESULTS_DIR, 'baseline-cost.json');
const FIXTURES_DIR = join(__dirname, '..', '..', 'shared', 'fixtures');

// ── Pricing Constants ───────────────────────────────────────────

// Claude 3 Haiku pricing (per token, USD) — representative LLM cost
const INPUT_COST_PER_TOKEN = 0.00000025;   // $0.25 per 1M input tokens
const OUTPUT_COST_PER_TOKEN = 0.00000125;  // $1.25 per 1M output tokens

// ── Token Estimation ────────────────────────────────────────────

/**
 * Estimate token count from a string. Rough approximation: ~4 chars per token.
 * Real tokenizers vary, but this gives a consistent baseline for comparison.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ── Mock Provider (Token-Counting) ──────────────────────────────

/**
 * Creates a mock ProviderAdapter that measures prompt size and simulates
 * realistic response sizes. The focus is on token counting, not LLM output.
 */
function createMeasuringAdapter(): ProviderAdapter & { lastMeasurement: { inputTokens: number; outputTokens: number } } {
  const adapter = {
    lastMeasurement: { inputTokens: 0, outputTokens: 0 },

    async invoke(snapshot: any, config: any): Promise<ProviderAdapterResult> {
      // Measure input: system prompt + user prompt
      const systemPrompt = config.systemPrompt ?? '';
      const userPrompt = snapshot[0]?.content as string ?? '';
      const inputTokens = estimateTokens(systemPrompt) + estimateTokens(userPrompt);

      // Simulate a realistic response
      const response: MonitorReport = {
        anomalies: [],
        escalation: undefined,
        restrictedActions: [],
        forceReplan: false,
      };
      const responseStr = JSON.stringify({ ...response, escalation: null });
      const outputTokens = estimateTokens(responseStr);

      adapter.lastMeasurement = { inputTokens, outputTokens };

      const usage: TokenUsage = {
        inputTokens,
        outputTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: inputTokens + outputTokens,
      };

      return {
        output: responseStr,
        usage,
        cost: {
          totalUsd: inputTokens * INPUT_COST_PER_TOKEN + outputTokens * OUTPUT_COST_PER_TOKEN,
          perModel: {
            'claude-3-haiku': {
              tokens: usage,
              costUsd: inputTokens * INPUT_COST_PER_TOKEN + outputTokens * OUTPUT_COST_PER_TOKEN,
            },
          },
        },
      };
    },
  };
  return adapter;
}

// ── Representative Inputs ───────────────────────────────────────

interface MeasurementInput {
  name: string;
  signals: AggregatedSignals;
}

function buildRepresentativeInputs(): MeasurementInput[] {
  const inputs: MeasurementInput[] = [];

  // Try to load fixtures
  const fixturesPath = join(FIXTURES_DIR, 'sample-signals.json');
  if (existsSync(fixturesPath)) {
    try {
      const raw = readFileSync(fixturesPath, 'utf-8');
      const fixtures = JSON.parse(raw) as Array<{ name: string; signals: Record<string, any> }>;
      for (const f of fixtures) {
        const signals: AggregatedSignals = new Map();
        for (const [key, val] of Object.entries(f.signals)) {
          signals.set(moduleId(key), val as MonitoringSignal);
        }
        inputs.push({ name: `fixture-${f.name}`, signals });
      }
    } catch {
      console.warn('  Warning: Could not load fixtures, using generated inputs only.');
    }
  }

  // Always include generated representative inputs
  // 1. Minimal — empty signals
  inputs.push({ name: 'empty', signals: new Map() });

  // 2. Single reasoner, normal
  const singleNormal: AggregatedSignals = new Map();
  singleNormal.set(moduleId('reasoner'), {
    type: 'reasoner', source: moduleId('reasoner'), timestamp: Date.now(),
    confidence: 0.85, conflictDetected: false, effortLevel: 'medium',
  } as unknown as MonitoringSignal);
  inputs.push({ name: 'single-reasoner-normal', signals: singleNormal });

  // 3. Reasoner + actor, normal
  const twoModules: AggregatedSignals = new Map();
  twoModules.set(moduleId('reasoner'), {
    type: 'reasoner', source: moduleId('reasoner'), timestamp: Date.now(),
    confidence: 0.7, conflictDetected: false, effortLevel: 'medium',
  } as unknown as MonitoringSignal);
  twoModules.set(moduleId('actor'), {
    type: 'actor', source: moduleId('actor'), timestamp: Date.now(),
    actionTaken: 'Edit', success: true, unexpectedResult: false,
  } as unknown as MonitoringSignal);
  inputs.push({ name: 'reasoner-actor-normal', signals: twoModules });

  // 4. Full cycle — all 5 core modules reporting
  const fullCycle: AggregatedSignals = new Map();
  fullCycle.set(moduleId('observer'), {
    type: 'observer', source: moduleId('observer'), timestamp: Date.now(),
    inputProcessed: true, noveltyScore: 0.6,
  } as unknown as MonitoringSignal);
  fullCycle.set(moduleId('memory'), {
    type: 'memory', source: moduleId('memory'), timestamp: Date.now(),
    retrievalCount: 3, relevanceScore: 0.8,
  } as unknown as MonitoringSignal);
  fullCycle.set(moduleId('reasoner'), {
    type: 'reasoner', source: moduleId('reasoner'), timestamp: Date.now(),
    confidence: 0.75, conflictDetected: false, effortLevel: 'medium',
  } as unknown as MonitoringSignal);
  fullCycle.set(moduleId('actor'), {
    type: 'actor', source: moduleId('actor'), timestamp: Date.now(),
    actionTaken: 'Bash', success: true, unexpectedResult: false,
  } as unknown as MonitoringSignal);
  fullCycle.set(moduleId('evaluator'), {
    type: 'evaluator', source: moduleId('evaluator'), timestamp: Date.now(),
    estimatedProgress: 0.4, diminishingReturns: false,
  } as unknown as MonitoringSignal);
  inputs.push({ name: 'full-cycle-5-modules', signals: fullCycle });

  // 5. Low confidence anomaly
  const lowConf: AggregatedSignals = new Map();
  lowConf.set(moduleId('reasoner'), {
    type: 'reasoner', source: moduleId('reasoner'), timestamp: Date.now(),
    confidence: 0.15, conflictDetected: false, effortLevel: 'high',
  } as unknown as MonitoringSignal);
  inputs.push({ name: 'low-confidence', signals: lowConf });

  // 6. Compound anomaly
  const compound: AggregatedSignals = new Map();
  compound.set(moduleId('reasoner'), {
    type: 'reasoner', source: moduleId('reasoner'), timestamp: Date.now(),
    confidence: 0.1, conflictDetected: true, effortLevel: 'high',
  } as unknown as MonitoringSignal);
  compound.set(moduleId('actor'), {
    type: 'actor', source: moduleId('actor'), timestamp: Date.now(),
    actionTaken: 'Read', success: false, unexpectedResult: true,
  } as unknown as MonitoringSignal);
  inputs.push({ name: 'compound-anomaly', signals: compound });

  // 7. Large signal set (8 modules)
  const large: AggregatedSignals = new Map();
  for (let i = 0; i < 8; i++) {
    large.set(moduleId(`module-${i}`), {
      type: 'reasoner', source: moduleId(`module-${i}`), timestamp: Date.now(),
      confidence: 0.5 + (i * 0.05), conflictDetected: false, effortLevel: 'medium',
    } as unknown as MonitoringSignal);
  }
  inputs.push({ name: 'large-8-modules', signals: large });

  return inputs;
}

// ── Measurement ─────────────────────────────────────────────────

interface MeasurementResult {
  name: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  promptCharacterCount: number;
  systemPromptTokens: number;
  userPromptTokens: number;
}

interface BaselineCostReport {
  timestamp: string;
  pricingModel: string;
  inputCostPerToken: number;
  outputCostPerToken: number;
  systemPromptTokens: number;
  measurements: MeasurementResult[];
  summary: {
    totalMeasurements: number;
    avgInputTokens: number;
    avgOutputTokens: number;
    avgTotalTokens: number;
    avgCostPerCallUsd: number;
    avgLatencyMs: number;
    minTotalTokens: number;
    maxTotalTokens: number;
    estimatedCostPer100Calls: number;
    estimatedCostPer1000Calls: number;
  };
}

async function main(): Promise<void> {
  console.log('=== LLM Monitor v2 — Baseline Cost Measurement ===\n');

  const adapter = createMeasuringAdapter();
  const monitor = createLlmMonitor(adapter);
  const noControl = { target: moduleId('llm-monitor'), timestamp: Date.now() } as NoControl;

  const inputs = buildRepresentativeInputs();
  console.log(`  Representative inputs: ${inputs.length}`);
  console.log(`  System prompt tokens: ${estimateTokens(MONITOR_SYSTEM_PROMPT)}`);
  console.log('');

  const measurements: MeasurementResult[] = [];

  for (const { name, signals } of inputs) {
    const state = monitor.initialState();
    const userPrompt = buildMonitorUserPrompt(signals);
    const userPromptTokens = estimateTokens(userPrompt);
    const systemPromptTokens = estimateTokens(MONITOR_SYSTEM_PROMPT);

    const startTime = performance.now();
    await monitor.step(signals, state, noControl);
    const latencyMs = performance.now() - startTime;

    const inputTokens = adapter.lastMeasurement.inputTokens;
    const outputTokens = adapter.lastMeasurement.outputTokens;
    const totalTokens = inputTokens + outputTokens;
    const estimatedCostUsd = inputTokens * INPUT_COST_PER_TOKEN + outputTokens * OUTPUT_COST_PER_TOKEN;

    measurements.push({
      name,
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCostUsd,
      latencyMs: Math.round(latencyMs * 100) / 100,
      promptCharacterCount: userPrompt.length + MONITOR_SYSTEM_PROMPT.length,
      systemPromptTokens,
      userPromptTokens,
    });

    console.log(`  ${name}: ${totalTokens} tokens, $${estimatedCostUsd.toFixed(6)}, ${latencyMs.toFixed(1)}ms`);
  }

  // Compute summary
  const totalMeasurements = measurements.length;
  const avgInputTokens = Math.round(measurements.reduce((s, m) => s + m.inputTokens, 0) / totalMeasurements);
  const avgOutputTokens = Math.round(measurements.reduce((s, m) => s + m.outputTokens, 0) / totalMeasurements);
  const avgTotalTokens = Math.round(measurements.reduce((s, m) => s + m.totalTokens, 0) / totalMeasurements);
  const avgCostPerCallUsd = measurements.reduce((s, m) => s + m.estimatedCostUsd, 0) / totalMeasurements;
  const avgLatencyMs = Math.round(measurements.reduce((s, m) => s + m.latencyMs, 0) / totalMeasurements * 100) / 100;
  const minTotalTokens = Math.min(...measurements.map(m => m.totalTokens));
  const maxTotalTokens = Math.max(...measurements.map(m => m.totalTokens));

  const report: BaselineCostReport = {
    timestamp: new Date().toISOString(),
    pricingModel: 'claude-3-haiku (simulated)',
    inputCostPerToken: INPUT_COST_PER_TOKEN,
    outputCostPerToken: OUTPUT_COST_PER_TOKEN,
    systemPromptTokens: estimateTokens(MONITOR_SYSTEM_PROMPT),
    measurements,
    summary: {
      totalMeasurements,
      avgInputTokens,
      avgOutputTokens,
      avgTotalTokens,
      avgCostPerCallUsd: Math.round(avgCostPerCallUsd * 1000000) / 1000000,
      avgLatencyMs,
      minTotalTokens,
      maxTotalTokens,
      estimatedCostPer100Calls: Math.round(avgCostPerCallUsd * 100 * 1000000) / 1000000,
      estimatedCostPer1000Calls: Math.round(avgCostPerCallUsd * 1000 * 1000000) / 1000000,
    },
  };

  // Write results
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf-8');

  console.log('\n--- Summary ---');
  console.log(`  Avg tokens per call: ${avgTotalTokens} (${avgInputTokens} in + ${avgOutputTokens} out)`);
  console.log(`  Token range: ${minTotalTokens} - ${maxTotalTokens}`);
  console.log(`  Avg cost per call: $${avgCostPerCallUsd.toFixed(6)}`);
  console.log(`  Est. cost per 100 calls: $${report.summary.estimatedCostPer100Calls.toFixed(4)}`);
  console.log(`  Est. cost per 1000 calls: $${report.summary.estimatedCostPer1000Calls.toFixed(4)}`);
  console.log(`\n  Results written to: ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
