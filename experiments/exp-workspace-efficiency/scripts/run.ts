/**
 * EXP-025 Runner — Token Savings from Salience-Based Workspace Eviction
 *
 * Five conditions testing workspace capacity and salience strategies:
 *   A (unlimited):          Capacity 100, no meaningful eviction
 *   B (standard-8):         Capacity 8, default salience, silent discard
 *   C (evict-summary-8):    Capacity 8, default salience, summary re-injection
 *   D (tight-4):            Capacity 4, default salience, summary re-injection
 *   E (priority-attend-8):  Capacity 8, PriorityAttend 3-factor salience
 *
 * All conditions use the cognitive agent (8-module cycle) with identical
 * monitor, prompt, and provider configuration. Only the workspace varies.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... npx tsx experiments/exp-workspace-efficiency/scripts/run.ts \
 *     [--conditions A,B,C,D,E] [--tasks 1,2,3,4,5] [--runs 10] [--phase pilot|core|extended]
 *
 * Phases (convenience presets):
 *   --phase pilot:     Conditions A,B,D / Tasks 1,2 / N=2
 *   --phase core:      Conditions A,B,D / Tasks 1-5 / N=10
 *   --phase extended:  Conditions C,E   / Tasks 1-5 / N=10
 *
 * Results are written to experiments/exp-workspace-efficiency/results/ as JSON.
 */

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// ── Load .env ─────────────────────────────────────────────────────

try {
  const candidates = [
    resolve(import.meta.dirname ?? '.', '../../../.env'),
    resolve(process.cwd(), '.env'),
  ];
  let envContent = '';
  for (const p of candidates) {
    try { envContent = readFileSync(p, 'utf8'); break; } catch { continue; }
  }
  if (!envContent) throw new Error('no .env found');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx);
      const value = trimmed.slice(eqIdx + 1);
      if (!process.env[key]) process.env[key] = value;
    }
  }
} catch { /* .env not found */ }

// ── Imports ───────────────────────────────────────────────────────

import { anthropicProvider } from '../../../packages/pacta-provider-anthropic/src/anthropic-provider.js';
import { VirtualToolProvider } from '../../../packages/pacta-playground/src/virtual-tool-provider.js';

import {
  moduleId,
  createWorkspace,
  createProviderAdapter,
} from '../../../packages/pacta/src/cognitive/algebra/index.js';
import type {
  AggregatedSignals,
  MonitoringSignal,
  ReadonlyWorkspaceSnapshot,
  SalienceContext,
} from '../../../packages/pacta/src/cognitive/algebra/index.js';
import type { WorkspaceConfig } from '../../../packages/pacta/src/cognitive/algebra/workspace-types.js';
import type { WorkspaceManager, EvictionInfo } from '../../../packages/pacta/src/cognitive/algebra/workspace.js';

import { createReasonerActor, type ReasonerActorControl } from '../../../packages/pacta/src/cognitive/modules/reasoner-actor.js';
import { createObserver } from '../../../packages/pacta/src/cognitive/modules/observer.js';
import { createMonitor } from '../../../packages/pacta/src/cognitive/modules/monitor.js';

// Tasks — reused from exp-cognitive-baseline
import { TASK_01 } from '../../exp-cognitive-baseline/task-01-circular-dep.js';
import { TASK_02 } from '../../exp-cognitive-baseline/task-02-test-first-bug.js';
import { TASK_03 } from '../../exp-cognitive-baseline/task-03-config-migration.js';
import { TASK_04 } from '../../exp-cognitive-baseline/task-04-api-versioning.js';
import { TASK_05 } from '../../exp-cognitive-baseline/task-05-dead-code-removal.js';

// PriorityAttend salience function (Condition E)
import { createPriorityAttendSalience } from './priority-attend.js';

// ── Types ─────────────────────────────────────────────────────────

interface TaskDefinition {
  name: string;
  baseDescription: string;
  description: string;
  initialFiles: Record<string, string>;
  validate(files: ReadonlyMap<string, string>): { success: boolean; reason: string };
}

const TASKS: TaskDefinition[] = [TASK_01, TASK_02, TASK_03, TASK_04, TASK_05];

type ConditionLabel = 'A' | 'B' | 'C' | 'D' | 'E';

interface ConditionConfig {
  label: ConditionLabel;
  name: string;
  workspaceCapacity: number;
  evictionHandler: 'discard' | 'summary';
  summaryMaxChars: number;
  salienceFunction: 'default' | 'priority-attend';
}

const CONDITIONS: Record<ConditionLabel, ConditionConfig> = {
  A: {
    label: 'A',
    name: 'unlimited',
    workspaceCapacity: 100,
    evictionHandler: 'discard',
    summaryMaxChars: 0,
    salienceFunction: 'default',
  },
  B: {
    label: 'B',
    name: 'standard-8',
    workspaceCapacity: 8,
    evictionHandler: 'discard',
    summaryMaxChars: 0,
    salienceFunction: 'default',
  },
  C: {
    label: 'C',
    name: 'evict-summary-8',
    workspaceCapacity: 8,
    evictionHandler: 'summary',
    summaryMaxChars: 120,
    salienceFunction: 'default',
  },
  D: {
    label: 'D',
    name: 'tight-4',
    workspaceCapacity: 4,
    evictionHandler: 'summary',
    summaryMaxChars: 80,
    salienceFunction: 'default',
  },
  E: {
    label: 'E',
    name: 'priority-attend-8',
    workspaceCapacity: 8,
    evictionHandler: 'discard',
    summaryMaxChars: 0,
    salienceFunction: 'priority-attend',
  },
};

interface RunResult {
  experiment: 'exp-workspace-efficiency';
  condition: ConditionLabel;
  conditionName: string;
  task: string;
  taskIndex: number;
  run: number;
  success: boolean;
  reason: string;
  tokensUsed: number;
  providerCalls: number;
  durationMs: number;
  cyclesCompleted: number;
  evictionCount: number;
  evictionSalienceMean: number;
  evictionSalienceMax: number;
  monitorInterventions: number;
  workspaceEntriesAtEnd: number;
  toolCalls: Array<{ tool: string; input: unknown; success: boolean }>;
  timestamp: string;
}

// ── Summary Builder ───────────────────────────────────────────────

function buildEvictionSummary(entry: { content: unknown; source: string }, maxChars: number): string {
  const text = typeof entry.content === 'string'
    ? entry.content
    : JSON.stringify(entry.content);
  const trimmed = text.slice(0, maxChars).replace(/\s+/g, ' ').trim();
  const sentenceEnd = trimmed.lastIndexOf('.');
  const summary = sentenceEnd > Math.floor(maxChars * 0.3) ? trimmed.slice(0, sentenceEnd + 1) : trimmed;
  return `[evicted:${entry.source}] ${summary}`;
}

// ── Single Run ────────────────────────────────────────────────────

async function runCondition(
  condition: ConditionConfig,
  task: TaskDefinition,
  taskIndex: number,
  runNumber: number,
): Promise<RunResult> {
  const startTime = Date.now();
  const vfs = new VirtualToolProvider(task.initialFiles);

  // Provider for merged Reasoner-Actor
  const llmProvider = anthropicProvider({
    model: 'claude-sonnet-4-20250514',
    maxOutputTokens: 2048,
  });

  const adapter = createProviderAdapter(llmProvider, {
    pactTemplate: { mode: { type: 'oneshot' }, budget: { maxOutputTokens: 2048 } },
  });

  // Workspace configuration — the independent variable
  const salienceContext: SalienceContext = {
    now: Date.now(),
    goals: extractGoals(task.description),
    sourcePriorities: new Map([
      [moduleId('reasoner-actor'), 0.9],
      [moduleId('observer'), 0.6],
    ]),
    selectionOutcomes: [], // populated during run for Condition E
    activeSubgoals: [],    // populated during run for Condition E
  };

  const workspaceConfig: WorkspaceConfig = {
    capacity: condition.workspaceCapacity,
    salience: condition.salienceFunction === 'priority-attend'
      ? createPriorityAttendSalience()
      : undefined, // use default
  };

  const workspace = createWorkspace(workspaceConfig, salienceContext);

  // Modules — identical across all conditions
  const observer = createObserver(workspace.getWritePort(moduleId('observer')));
  const reasonerActor = createReasonerActor(
    adapter,
    vfs,
    workspace.getWritePort(moduleId('reasoner-actor')),
  );
  const monitor = createMonitor({ confidenceThreshold: 0.3, stagnationThreshold: 2 });

  // Cycle state
  let totalTokens = 0;
  let providerCalls = 0;
  let monitorInterventions = 0;
  let cyclesCompleted = 0;
  const allToolCalls: Array<{ tool: string; input: unknown; success: boolean }> = [];

  const MAX_CYCLES = 15;
  const raControl: ReasonerActorControl = {
    target: moduleId('reasoner-actor'),
    timestamp: Date.now(),
    strategy: 'plan',
    effort: 'medium',
  };

  // Module states
  let observerState = observer.initialState();
  let raState = reasonerActor.initialState();
  let monitorState = monitor.initialState();
  let prevRAMonitoring: MonitoringSignal | null = null;

  try {
    for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
      cyclesCompleted = cycle + 1;

      // Update salience context timestamp
      salienceContext.now = Date.now();

      // 1. OBSERVE — feed task description (first cycle only)
      if (cycle === 0) {
        const obsResult = await observer.step(
          { content: task.description },
          observerState,
          { target: moduleId('observer'), timestamp: Date.now() } as any,
        );
        observerState = obsResult.state;
      }

      // 2. MONITOR — check previous cycle's signals
      const monitorSignals: AggregatedSignals = new Map();
      if (prevRAMonitoring) {
        monitorSignals.set(moduleId('reasoner-actor'), prevRAMonitoring);
      }
      const monResult = await monitor.step(
        monitorSignals, monitorState,
        { target: moduleId('monitor'), timestamp: Date.now() } as any,
      );
      monitorState = monResult.state;

      if (monResult.monitoring.anomalyDetected) {
        monitorInterventions++;
        raControl.restrictedActions = monResult.output.restrictedActions;
        raControl.forceReplan = monResult.output.forceReplan;
        if (monResult.output.forceReplan) raControl.strategy = 'think';
      }

      // 3. REASON+ACT — single LLM call, then tool execution
      const snapshot: ReadonlyWorkspaceSnapshot = workspace.getReadPort(moduleId('reasoner-actor')).read();
      const raResult = await reasonerActor.step({ snapshot }, raState, raControl);
      raState = raResult.state;
      prevRAMonitoring = raResult.monitoring;
      providerCalls++;
      totalTokens += (raResult.monitoring as any).tokensThisStep ?? 0;

      // Track tool calls
      if (raResult.output.toolResult) {
        allToolCalls.push({
          tool: raResult.output.actionName,
          input: raResult.output.toolResult,
          success: (raResult.monitoring as any).success ?? true,
        });
      }

      // Handle eviction summaries for conditions C and D
      if (condition.evictionHandler === 'summary') {
        const evictions = workspace.getEvictions();
        // Only process new evictions (since last check)
        const newEvictions = evictions.slice(-1); // last eviction from this write
        for (const eviction of newEvictions) {
          if (eviction.reason === 'capacity') {
            const summary = buildEvictionSummary(
              { content: eviction.entry.content, source: String(eviction.entry.source) },
              condition.summaryMaxChars,
            );
            // Re-inject summary as a low-salience entry
            workspace.getWritePort(moduleId('observer')).write({
              source: moduleId('observer'),
              content: summary,
              salience: 0.2, // low salience — will be evicted first if space is needed
              timestamp: Date.now(),
            });
          }
        }
      }

      // Update selection history for Condition E
      if (condition.salienceFunction === 'priority-attend' && raResult.output.toolResult) {
        const actionSuccess = (raResult.monitoring as any).success ?? true;
        // Record outcome for entries that were in the workspace when this action was taken
        const currentEntries = workspace.snapshot();
        for (const entry of currentEntries) {
          const { simpleEntryHash } = await import('./priority-attend.js');
          salienceContext.selectionOutcomes = salienceContext.selectionOutcomes ?? [];
          salienceContext.selectionOutcomes.push({
            entryHash: simpleEntryHash(entry),
            outcome: actionSuccess ? 'positive' : 'negative',
            timestamp: Date.now(),
          });
        }
        // Trim history to prevent unbounded growth
        if (salienceContext.selectionOutcomes && salienceContext.selectionOutcomes.length > 100) {
          salienceContext.selectionOutcomes = salienceContext.selectionOutcomes.slice(-100);
        }
      }

      // Check for completion (done action)
      if (raResult.output.actionName === 'done') break;
    }

    // Validate task completion
    const validation = task.validate(vfs.files);

    // Collect eviction metrics
    const evictions = workspace.getEvictions();
    const evictionSaliences = evictions
      .filter((e: EvictionInfo) => e.reason === 'capacity')
      .map((e: EvictionInfo) => e.salience);
    const evictionSalienceMean = evictionSaliences.length > 0
      ? evictionSaliences.reduce((a: number, b: number) => a + b, 0) / evictionSaliences.length
      : 0;
    const evictionSalienceMax = evictionSaliences.length > 0
      ? Math.max(...evictionSaliences)
      : 0;

    const endSnapshot = workspace.snapshot();

    return {
      experiment: 'exp-workspace-efficiency',
      condition: condition.label,
      conditionName: condition.name,
      task: task.name,
      taskIndex,
      run: runNumber,
      success: validation.success,
      reason: validation.reason,
      tokensUsed: totalTokens,
      providerCalls,
      durationMs: Date.now() - startTime,
      cyclesCompleted,
      evictionCount: evictions.filter((e: EvictionInfo) => e.reason === 'capacity').length,
      evictionSalienceMean,
      evictionSalienceMax,
      monitorInterventions,
      workspaceEntriesAtEnd: endSnapshot.length,
      toolCalls: allToolCalls,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return {
      experiment: 'exp-workspace-efficiency',
      condition: condition.label,
      conditionName: condition.name,
      task: task.name,
      taskIndex,
      run: runNumber,
      success: false,
      reason: `Error: ${err instanceof Error ? err.message : String(err)}`,
      tokensUsed: totalTokens,
      providerCalls,
      durationMs: Date.now() - startTime,
      cyclesCompleted,
      evictionCount: 0,
      evictionSalienceMean: 0,
      evictionSalienceMax: 0,
      monitorInterventions,
      workspaceEntriesAtEnd: 0,
      toolCalls: allToolCalls,
      timestamp: new Date().toISOString(),
    };
  }
}

// ── Goal Extraction ───────────────────────────────────────────────

/**
 * Extract goal keywords from a task description.
 * Simple heuristic: extract key noun phrases and action verbs.
 */
function extractGoals(description: string): string[] {
  // Extract sentences, take first 3 as goal context
  const sentences = description.split(/[.!]\s+/).slice(0, 3);
  // Extract significant words (>4 chars, not common stop words)
  const stopWords = new Set([
    'that', 'this', 'with', 'from', 'your', 'have', 'been', 'will',
    'they', 'each', 'should', 'which', 'their', 'there', 'about',
    'would', 'could', 'still', 'other',
  ]);
  const words = sentences.join(' ').toLowerCase().split(/\s+/)
    .filter(w => w.length > 4 && !stopWords.has(w))
    .slice(0, 15);
  return [...new Set(words)];
}

// ── CLI Argument Parsing ──────────────────────────────────────────

interface RunOptions {
  conditions: ConditionLabel[];
  taskIndices: number[];
  runsPerConditionTask: number;
  maxSpendUsd: number;
}

function parseArgs(): RunOptions {
  const args = process.argv.slice(2);
  let conditions: ConditionLabel[] = ['A', 'B', 'C', 'D', 'E'];
  let taskIndices = [0, 1, 2, 3, 4];
  let runsPerConditionTask = 10;
  let maxSpendUsd = 12;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--conditions' && args[i + 1]) {
      conditions = args[++i].split(',').map(s => s.trim().toUpperCase() as ConditionLabel);
    } else if (args[i] === '--tasks' && args[i + 1]) {
      taskIndices = args[++i].split(',').map(s => parseInt(s.trim(), 10) - 1);
    } else if (args[i] === '--runs' && args[i + 1]) {
      runsPerConditionTask = parseInt(args[++i], 10);
    } else if (args[i] === '--max-spend' && args[i + 1]) {
      maxSpendUsd = parseFloat(args[++i]);
    } else if (args[i] === '--phase') {
      const phase = args[++i];
      switch (phase) {
        case 'pilot':
          conditions = ['A', 'B', 'D'];
          taskIndices = [0, 1];
          runsPerConditionTask = 2;
          break;
        case 'core':
          conditions = ['A', 'B', 'D'];
          taskIndices = [0, 1, 2, 3, 4];
          runsPerConditionTask = 10;
          break;
        case 'extended':
          conditions = ['C', 'E'];
          taskIndices = [0, 1, 2, 3, 4];
          runsPerConditionTask = 10;
          break;
        default:
          console.error(`Unknown phase: ${phase}. Use pilot, core, or extended.`);
          process.exit(1);
      }
    }
  }

  return { conditions, taskIndices, runsPerConditionTask, maxSpendUsd };
}

// ── Cost Estimation ───────────────────────────────────────────────

// Rough Sonnet 4 pricing (as of 2026-03-29)
const INPUT_COST_PER_MTOK = 3.0;   // $/MTok
const OUTPUT_COST_PER_MTOK = 15.0;  // $/MTok
const INPUT_OUTPUT_RATIO = 0.6;     // 60% input, 40% output (estimated)

function estimateCostUsd(totalTokens: number): number {
  const inputTokens = totalTokens * INPUT_OUTPUT_RATIO;
  const outputTokens = totalTokens * (1 - INPUT_OUTPUT_RATIO);
  return (inputTokens / 1_000_000) * INPUT_COST_PER_MTOK +
         (outputTokens / 1_000_000) * OUTPUT_COST_PER_MTOK;
}

// ── Main ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs();

  // Validate
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set. Set it in .env or environment.');
    process.exit(1);
  }

  const totalRuns = opts.conditions.length * opts.taskIndices.length * opts.runsPerConditionTask;
  console.log(`\n=== EXP-025: Workspace Efficiency ===`);
  console.log(`Conditions: ${opts.conditions.join(', ')}`);
  console.log(`Tasks:      ${opts.taskIndices.map(i => i + 1).join(', ')}`);
  console.log(`Runs/cond:  ${opts.runsPerConditionTask}`);
  console.log(`Total runs: ${totalRuns}`);
  console.log(`Max spend:  $${opts.maxSpendUsd}\n`);

  // Results directory
  const resultsDir = resolve(import.meta.dirname ?? '.', '../results');
  await mkdir(resultsDir, { recursive: true });

  // Timestamp for this batch
  const batchTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const batchFile = resolve(resultsDir, `batch-${batchTimestamp}.json`);

  const allResults: RunResult[] = [];
  let cumulativeTokens = 0;
  let runCount = 0;

  // Run all conditions x tasks x repeats
  for (const condLabel of opts.conditions) {
    const condition = CONDITIONS[condLabel];
    if (!condition) {
      console.error(`Unknown condition: ${condLabel}`);
      continue;
    }

    for (const taskIdx of opts.taskIndices) {
      const task = TASKS[taskIdx];
      if (!task) {
        console.error(`Unknown task index: ${taskIdx}`);
        continue;
      }

      for (let run = 1; run <= opts.runsPerConditionTask; run++) {
        runCount++;

        // Budget check
        const estimatedCost = estimateCostUsd(cumulativeTokens);
        if (estimatedCost > opts.maxSpendUsd) {
          console.error(`\n!!! Budget exceeded: $${estimatedCost.toFixed(2)} > $${opts.maxSpendUsd}. Stopping.`);
          await writeFile(batchFile, JSON.stringify(allResults, null, 2), 'utf8');
          printSummary(allResults);
          process.exit(1);
        }

        console.log(
          `[${runCount}/${totalRuns}] Condition ${condLabel} (${condition.name}) | ` +
          `Task ${taskIdx + 1} (${task.name}) | Run ${run}/${opts.runsPerConditionTask} ` +
          `| Cost so far: $${estimatedCost.toFixed(2)}`
        );

        const result = await runCondition(condition, task, taskIdx, run);
        allResults.push(result);
        cumulativeTokens += result.tokensUsed;

        console.log(
          `  -> ${result.success ? 'PASS' : 'FAIL'} | ` +
          `${result.tokensUsed} tokens | ${result.providerCalls} calls | ` +
          `${result.cyclesCompleted} cycles | ${result.evictionCount} evictions | ` +
          `${result.durationMs}ms`
        );

        // Write incremental results after each run
        await writeFile(batchFile, JSON.stringify(allResults, null, 2), 'utf8');
      }
    }
  }

  console.log(`\nResults written to: ${batchFile}`);
  printSummary(allResults);
}

// ── Summary ───────────────────────────────────────────────────────

function printSummary(results: RunResult[]): void {
  console.log('\n=== Summary ===\n');

  // Group by condition
  const byCondition = new Map<ConditionLabel, RunResult[]>();
  for (const r of results) {
    const list = byCondition.get(r.condition) || [];
    list.push(r);
    byCondition.set(r.condition, list);
  }

  // Header
  console.log(
    'Condition'.padEnd(22) +
    'Runs'.padStart(6) +
    'Success'.padStart(9) +
    'Tokens(mean)'.padStart(14) +
    'Tokens(med)'.padStart(13) +
    'Evictions(mean)'.padStart(17) +
    'Calls(mean)'.padStart(13)
  );
  console.log('-'.repeat(94));

  const conditionA = byCondition.get('A');
  const baselineMedian = conditionA
    ? median(conditionA.map(r => r.tokensUsed))
    : 0;

  for (const [cond, runs] of byCondition) {
    const successes = runs.filter(r => r.success).length;
    const tokens = runs.map(r => r.tokensUsed);
    const evictions = runs.map(r => r.evictionCount);
    const calls = runs.map(r => r.providerCalls);

    const tokenMean = mean(tokens);
    const tokenMed = median(tokens);
    const savings = baselineMedian > 0
      ? ((1 - tokenMed / baselineMedian) * 100).toFixed(1) + '%'
      : 'n/a';

    const config = CONDITIONS[cond];
    const label = `${cond} (${config?.name ?? '?'})`;

    console.log(
      label.padEnd(22) +
      String(runs.length).padStart(6) +
      `${successes}/${runs.length}`.padStart(9) +
      tokenMean.toFixed(0).padStart(14) +
      `${tokenMed.toFixed(0)} (${savings})`.padStart(13) +
      mean(evictions).toFixed(1).padStart(17) +
      mean(calls).toFixed(1).padStart(13)
    );
  }

  // Per-task breakdown
  console.log('\n=== Per-Task Token Usage (median) ===\n');
  const taskNames = [...new Set(results.map(r => r.task))];
  const condLabels = [...byCondition.keys()];

  const header = 'Task'.padEnd(30) + condLabels.map(c => c.padStart(12)).join('');
  console.log(header);
  console.log('-'.repeat(30 + condLabels.length * 12));

  for (const taskName of taskNames) {
    let row = taskName.padEnd(30);
    for (const cond of condLabels) {
      const condRuns = byCondition.get(cond)?.filter(r => r.task === taskName) ?? [];
      const med = condRuns.length > 0 ? median(condRuns.map(r => r.tokensUsed)) : 0;
      row += String(med.toFixed(0)).padStart(12);
    }
    console.log(row);
  }

  const totalCost = estimateCostUsd(results.reduce((sum, r) => sum + r.tokensUsed, 0));
  console.log(`\nTotal estimated cost: $${totalCost.toFixed(2)}`);
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
