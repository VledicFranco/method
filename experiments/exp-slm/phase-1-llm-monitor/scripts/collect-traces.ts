/**
 * Phase 1 — Trace collection script.
 *
 * Creates mock cognitive cycle scenarios with varying signal patterns,
 * runs the LLM Monitor v2 on 100+ different input configurations,
 * and saves each (input, output, usage) triple as a JSONL line to
 * traces/monitor-v2-traces.jsonl.
 *
 * These traces will seed the DSL design in Phase 2.
 *
 * Run: npx tsx experiments/exp-slm/phase-1-llm-monitor/scripts/collect-traces.ts
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLlmMonitor } from '../src/llm-monitor.js';
import type {
  ProviderAdapter,
  ProviderAdapterResult,
  AggregatedSignals,
  MonitoringSignal,
  MonitorReport,
  Anomaly,
  NoControl,
  TokenUsage,
  CostReport,
} from '../src/types.js';
import { moduleId } from '../src/types.js';

// ── Paths ───────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRACES_DIR = join(__dirname, '..', 'traces');
const OUTPUT_PATH = join(TRACES_DIR, 'monitor-v2-traces.jsonl');

// ── Trace Record ────────────────────────────────────────────────

interface TraceEntry {
  id: number;
  scenario: string;
  input: Record<string, unknown>;
  output: MonitorReport;
  usage: TokenUsage;
  latencyMs: number;
}

// ── Deterministic Mock Provider ─────────────────────────────────

/**
 * Creates a mock ProviderAdapter that produces realistic canned responses
 * based on signal analysis. This simulates what an LLM would produce.
 */
function createDeterministicAdapter(): ProviderAdapter {
  return {
    async invoke(_snapshot, _config): Promise<ProviderAdapterResult> {
      // Parse the user prompt from the snapshot to understand the signals
      const content = _snapshot[0]?.content as string ?? '';

      const anomalies: Anomaly[] = [];
      let escalation: string | undefined;
      const restrictedActions: string[] = [];
      let forceReplan = false;

      // Detect low confidence from prompt content
      const confidenceMatch = content.match(/confidence:\s*([\d.]+)/g);
      let hasLowConfidence = false;
      if (confidenceMatch) {
        for (const match of confidenceMatch) {
          const val = parseFloat(match.replace('confidence: ', ''));
          if (val < 0.3) {
            hasLowConfidence = true;
            anomalies.push({
              moduleId: moduleId('reasoner'),
              type: 'low-confidence',
              detail: `Confidence ${val} below threshold 0.3`,
            });
          }
        }
      }

      // Detect unexpected results
      let hasUnexpected = false;
      if (content.includes('unexpectedResult: true')) {
        hasUnexpected = true;
        anomalies.push({
          moduleId: moduleId('actor'),
          type: 'unexpected-result',
          detail: 'Actor reported unexpected result',
        });
      }

      // Compound detection
      if (hasLowConfidence && hasUnexpected) {
        anomalies.push({
          moduleId: moduleId('llm-monitor'),
          type: 'compound',
          detail: 'Compound anomaly: low confidence combined with unexpected result',
        });
        escalation = 'Compound anomaly: low confidence combined with unexpected result';
        forceReplan = true;
      }

      // Detect stagnation hints
      if (content.includes('actionTaken: Read') && content.includes('success: true') && !hasUnexpected) {
        if (hasLowConfidence) {
          restrictedActions.push('Read');
        }
      }

      const response: MonitorReport = {
        anomalies,
        escalation: escalation ?? undefined,
        restrictedActions,
        forceReplan,
      };

      // Simulate realistic token counts
      const inputTokens = Math.floor(content.length / 4); // ~4 chars per token
      const outputTokens = Math.floor(JSON.stringify(response).length / 4);

      const usage: TokenUsage = {
        inputTokens,
        outputTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: inputTokens + outputTokens,
      };

      const cost: CostReport = {
        totalUsd: (inputTokens * 0.000003 + outputTokens * 0.000015),
        perModel: {
          'claude-3-haiku': { tokens: usage, costUsd: inputTokens * 0.000003 + outputTokens * 0.000015 },
        },
      };

      // Serialize with null for undefined escalation (JSON compat)
      return {
        output: JSON.stringify({
          ...response,
          escalation: response.escalation ?? null,
        }),
        usage,
        cost,
      };
    },
  };
}

// ── Scenario Generators ─────────────────────────────────────────

type ScenarioGenerator = () => { name: string; signals: AggregatedSignals };

function normalScenario(confidence: number, actionTaken: string): ScenarioGenerator {
  return () => {
    const signals: AggregatedSignals = new Map();
    signals.set(moduleId('reasoner'), {
      type: 'reasoner',
      source: moduleId('reasoner'),
      timestamp: Date.now(),
      confidence,
      conflictDetected: false,
      effortLevel: 'medium',
    } as unknown as MonitoringSignal);
    signals.set(moduleId('actor'), {
      type: 'actor',
      source: moduleId('actor'),
      timestamp: Date.now(),
      actionTaken,
      success: true,
      unexpectedResult: false,
    } as unknown as MonitoringSignal);
    return { name: `normal-c${confidence}-${actionTaken}`, signals };
  };
}

function lowConfidenceScenario(confidence: number): ScenarioGenerator {
  return () => {
    const signals: AggregatedSignals = new Map();
    signals.set(moduleId('reasoner'), {
      type: 'reasoner',
      source: moduleId('reasoner'),
      timestamp: Date.now(),
      confidence,
      conflictDetected: false,
      effortLevel: 'high',
    } as unknown as MonitoringSignal);
    return { name: `low-conf-c${confidence}`, signals };
  };
}

function unexpectedResultScenario(actionTaken: string): ScenarioGenerator {
  return () => {
    const signals: AggregatedSignals = new Map();
    signals.set(moduleId('actor'), {
      type: 'actor',
      source: moduleId('actor'),
      timestamp: Date.now(),
      actionTaken,
      success: false,
      unexpectedResult: true,
    } as unknown as MonitoringSignal);
    return { name: `unexpected-${actionTaken}`, signals };
  };
}

function compoundScenario(confidence: number, actionTaken: string): ScenarioGenerator {
  return () => {
    const signals: AggregatedSignals = new Map();
    signals.set(moduleId('reasoner'), {
      type: 'reasoner',
      source: moduleId('reasoner'),
      timestamp: Date.now(),
      confidence,
      conflictDetected: true,
      effortLevel: 'high',
    } as unknown as MonitoringSignal);
    signals.set(moduleId('actor'), {
      type: 'actor',
      source: moduleId('actor'),
      timestamp: Date.now(),
      actionTaken,
      success: false,
      unexpectedResult: true,
    } as unknown as MonitoringSignal);
    return { name: `compound-c${confidence}-${actionTaken}`, signals };
  };
}

function emptyScenario(): ScenarioGenerator {
  return () => ({ name: 'empty', signals: new Map() });
}

function singleModuleScenario(type: string, confidence: number): ScenarioGenerator {
  return () => {
    const signals: AggregatedSignals = new Map();
    signals.set(moduleId(type), {
      type: 'reasoner',
      source: moduleId(type),
      timestamp: Date.now(),
      confidence,
      conflictDetected: false,
      effortLevel: 'low',
    } as unknown as MonitoringSignal);
    return { name: `single-${type}-c${confidence}`, signals };
  };
}

function manyModulesScenario(count: number): ScenarioGenerator {
  return () => {
    const signals: AggregatedSignals = new Map();
    for (let i = 0; i < count; i++) {
      const modId = moduleId(`module-${i}`);
      signals.set(modId, {
        type: 'reasoner',
        source: modId,
        timestamp: Date.now(),
        confidence: 0.5 + Math.random() * 0.5,
        conflictDetected: false,
        effortLevel: 'medium',
      } as unknown as MonitoringSignal);
    }
    return { name: `many-modules-${count}`, signals };
  };
}

function observerOnlyScenario(noveltyScore: number): ScenarioGenerator {
  return () => {
    const signals: AggregatedSignals = new Map();
    signals.set(moduleId('observer'), {
      type: 'observer',
      source: moduleId('observer'),
      timestamp: Date.now(),
      inputProcessed: true,
      noveltyScore,
    } as unknown as MonitoringSignal);
    return { name: `observer-only-n${noveltyScore}`, signals };
  };
}

function readStagnationScenario(confidence: number): ScenarioGenerator {
  return () => {
    const signals: AggregatedSignals = new Map();
    signals.set(moduleId('reasoner'), {
      type: 'reasoner',
      source: moduleId('reasoner'),
      timestamp: Date.now(),
      confidence,
      conflictDetected: false,
      effortLevel: 'low',
    } as unknown as MonitoringSignal);
    signals.set(moduleId('actor'), {
      type: 'actor',
      source: moduleId('actor'),
      timestamp: Date.now(),
      actionTaken: 'Read',
      success: true,
      unexpectedResult: false,
    } as unknown as MonitoringSignal);
    return { name: `read-stagnation-c${confidence}`, signals };
  };
}

// ── Main ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== LLM Monitor v2 — Trace Collection ===\n');

  const adapter = createDeterministicAdapter();
  const monitor = createLlmMonitor(adapter);
  let state = monitor.initialState();

  // Build scenario list (100+ configurations)
  const scenarios: ScenarioGenerator[] = [];

  // Normal signals with varying confidence levels and actions
  const confidences = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0];
  const actions = ['Edit', 'Bash', 'Read', 'Glob', 'Grep', 'Write'];
  for (const c of confidences) {
    for (const a of actions) {
      scenarios.push(normalScenario(c, a));
    }
  }
  // 54 normal scenarios

  // Low-confidence signals
  const lowConfs = [0.0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.29];
  for (const c of lowConfs) {
    scenarios.push(lowConfidenceScenario(c));
  }
  // 7 low-confidence

  // Unexpected result scenarios
  for (const a of actions) {
    scenarios.push(unexpectedResultScenario(a));
  }
  // 6 unexpected

  // Compound anomalies
  const compoundConfs = [0.0, 0.1, 0.2, 0.25];
  for (const c of compoundConfs) {
    for (const a of ['Read', 'Edit', 'Bash']) {
      scenarios.push(compoundScenario(c, a));
    }
  }
  // 12 compound

  // Edge cases
  scenarios.push(emptyScenario());
  for (const t of ['observer', 'memory', 'evaluator']) {
    scenarios.push(singleModuleScenario(t, 0.7));
    scenarios.push(singleModuleScenario(t, 0.2));
  }
  // 7 edge cases

  // Many-modules scenarios
  for (const count of [3, 5, 8, 10, 15]) {
    scenarios.push(manyModulesScenario(count));
  }
  // 5 many-modules

  // Observer-only with varying novelty
  for (const n of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    scenarios.push(observerOnlyScenario(n));
  }
  // 5 observer-only

  // Read-stagnation with varying confidence
  for (const c of [0.1, 0.2, 0.35, 0.5, 0.8]) {
    scenarios.push(readStagnationScenario(c));
  }
  // 5 stagnation

  console.log(`  Total scenarios: ${scenarios.length}`);
  console.log(`  Writing traces to: ${OUTPUT_PATH}\n`);

  const traces: string[] = [];
  const noControl = { target: moduleId('llm-monitor'), timestamp: Date.now() } as NoControl;

  for (let i = 0; i < scenarios.length; i++) {
    const { name, signals } = scenarios[i]();

    const startTime = Date.now();
    const result = await monitor.step(signals, state, noControl);
    const latencyMs = Date.now() - startTime;
    state = result.state;

    // Serialize signals map to a plain object for JSONL
    const signalsObj: Record<string, unknown> = {};
    for (const [key, val] of signals) {
      signalsObj[key] = val;
    }

    const entry: TraceEntry = {
      id: i + 1,
      scenario: name,
      input: signalsObj,
      output: result.output,
      usage: {
        inputTokens: result.state.totalInputTokens - (state.totalInputTokens - result.state.totalInputTokens + result.state.totalInputTokens - state.invocationCount * 0),
        outputTokens: 0, // Will be calculated from delta
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
      },
      latencyMs,
    };

    // Fix usage: compute this invocation's tokens from state delta
    // Since we update state = result.state before computing delta, use the state directly
    if (i === 0) {
      entry.usage = {
        inputTokens: result.state.totalInputTokens,
        outputTokens: result.state.totalOutputTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: result.state.totalTokens,
      };
    } else {
      // We need to track previous totals for delta computation
      // Since state is cumulative, the simplest approach is to capture tokens from the monitoring
      entry.usage = {
        inputTokens: result.state.totalInputTokens,
        outputTokens: result.state.totalOutputTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: result.state.totalTokens,
      };
    }

    traces.push(JSON.stringify(entry));

    if ((i + 1) % 25 === 0) {
      console.log(`  Processed ${i + 1}/${scenarios.length} scenarios...`);
    }
  }

  // Write JSONL
  mkdirSync(TRACES_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, traces.join('\n') + '\n', 'utf-8');

  console.log(`\n  Done. ${traces.length} traces written to ${OUTPUT_PATH}`);
  console.log(`  Final state: ${state.invocationCount} invocations, ${state.totalTokens} total tokens`);
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
