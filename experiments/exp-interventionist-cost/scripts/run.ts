/**
 * EXP-026 Runner — Cost Overhead of Default-Interventionist Monitoring
 *
 * Three conditions:
 *   A (no-monitor):       MONITOR/CONTROL never fire. Baseline cost reference.
 *   B (always-on):        MONITOR/CONTROL fire every cycle. Maximum detection ceiling.
 *   C (interventionist):  MONITOR/CONTROL fire on threshold crossing. Designed mode.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... npx tsx experiments/exp-interventionist-cost/scripts/run.ts [options]
 *
 * Options:
 *   --condition A|B|C|all     Which condition(s) to run (default: all)
 *   --tier 1|2|3|all          Which task tier(s) to run (default: all)
 *   --task <id>               Run a specific task by ID
 *   --runs <N>                Runs per task per condition (default: 10)
 *   --pilot                   Pilot mode: 3 runs on circular-dep only (Gate G1)
 *   --dry-run                 Print run plan without executing
 */

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Load .env
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

// ── Imports ─────────────────────────────────────────────────────

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
  TraceSink,
} from '../../../packages/pacta/src/cognitive/algebra/index.js';

import { createReasonerActorV2, type ReasonerActorV2Control } from '../../../packages/pacta/src/cognitive/modules/reasoner-actor-v2.js';
import { createObserver } from '../../../packages/pacta/src/cognitive/modules/observer.js';
import { createMonitorV2 } from '../../../packages/pacta/src/cognitive/modules/monitor-v2.js';

import type { ThresholdPolicy } from '../../../packages/pacta/src/cognitive/engine/cycle.js';

import { NO_MONITOR_THRESHOLD } from '../configs/no-monitor.js';
import { ALWAYS_ON_THRESHOLD } from '../configs/always-on.js';
import { INTERVENTIONIST_THRESHOLD } from '../configs/interventionist.js';

import { ALL_TASKS, TASKS_BY_TIER, getTaskById, type TaskDefinition } from './tasks.js';
import { CostTracker, BudgetGuardian, BudgetExceededError, type RunMetrics } from './cost-tracker.js';

// ── Types ───────────────────────────────────────────────────────

type ConditionLabel = 'no-monitor' | 'always-on' | 'interventionist';

interface ConditionConfig {
  label: ConditionLabel;
  threshold: ThresholdPolicy;
  maxConsecutiveInterventions: number;
}

const CONDITIONS: Record<string, ConditionConfig> = {
  A: {
    label: 'no-monitor',
    threshold: NO_MONITOR_THRESHOLD,
    maxConsecutiveInterventions: 0,
  },
  B: {
    label: 'always-on',
    threshold: ALWAYS_ON_THRESHOLD,
    maxConsecutiveInterventions: 15,
  },
  C: {
    label: 'interventionist',
    threshold: INTERVENTIONIST_THRESHOLD,
    maxConsecutiveInterventions: 3,
  },
};

// ── CLI Argument Parsing ────────────────────────────────────────

interface RunOptions {
  conditions: string[];          // 'A', 'B', 'C'
  tiers: number[];               // 1, 2, 3
  specificTask: string | null;
  runsPerTask: number;
  pilot: boolean;
  dryRun: boolean;
}

function parseArgs(): RunOptions {
  const args = process.argv.slice(2);
  const opts: RunOptions = {
    conditions: ['A', 'B', 'C'],
    tiers: [1, 2, 3],
    specificTask: null,
    runsPerTask: 10,
    pilot: false,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--condition':
        opts.conditions = args[++i] === 'all' ? ['A', 'B', 'C'] : [args[i]];
        break;
      case '--tier':
        opts.tiers = args[++i] === 'all' ? [1, 2, 3] : [parseInt(args[i])];
        break;
      case '--task':
        opts.specificTask = args[++i];
        break;
      case '--runs':
        opts.runsPerTask = parseInt(args[++i]);
        break;
      case '--pilot':
        opts.pilot = true;
        opts.runsPerTask = 3;
        opts.specificTask = 'circular-dep';
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
    }
  }

  return opts;
}

// ── Single Run ──────────────────────────────────────────────────

async function executeRun(
  task: TaskDefinition,
  condition: ConditionConfig,
  runNumber: number,
  costTracker: CostTracker,
): Promise<RunMetrics> {
  const startedAt = new Date();
  costTracker.reset();

  const vfs = new VirtualToolProvider(task.initialFiles);

  // Provider for ReasonerActor (single-turn, no tool provider)
  const llmProvider = anthropicProvider({
    model: 'claude-sonnet-4-20250514',
    maxOutputTokens: 2048,
  });

  const adapter = createProviderAdapter(llmProvider, {
    pactTemplate: { mode: { type: 'oneshot' }, budget: { maxOutputTokens: 2048 } },
  });

  // Workspace
  const salienceContext: SalienceContext = {
    now: Date.now(),
    goals: ['complete task', 'detect errors'],
    sourcePriorities: new Map([
      [moduleId('reasoner-actor'), 0.9],
      [moduleId('observer'), 0.6],
    ]),
  };
  const workspace = createWorkspace({ capacity: 8 }, salienceContext);

  // Modules (v2)
  const observer = createObserver(workspace.getWritePort(moduleId('observer')));
  const reasonerActor = createReasonerActorV2(
    adapter,
    vfs,
    workspace.getWritePort(moduleId('reasoner-actor')),
  );
  const monitor = createMonitorV2({ baseConfidenceThreshold: 0.3, stagnationThreshold: 2 });

  // Cycle state
  let observerState = observer.initialState();
  let raState = reasonerActor.initialState();
  let monitorState = monitor.initialState();
  let prevRAMonitoring: MonitoringSignal | null = null;

  const MAX_CYCLES = 15;
  const raControl: ReasonerActorV2Control = {
    target: moduleId('reasoner-actor'),
    timestamp: Date.now(),
    strategy: 'plan',
    effort: 'medium',
  };

  const traceSinks: TraceSink[] = [costTracker];

  try {
    for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
      costTracker.nextCycle();

      // Phase 1: OBSERVE (task description on first cycle only)
      if (cycle === 0) {
        const obsResult = await observer.step(
          { content: task.description },
          observerState,
          { target: moduleId('observer'), timestamp: Date.now() } as any,
        );
        observerState = obsResult.state;
      }

      // Phase 5: MONITOR (conditional based on threshold policy)
      const monitorSignals: AggregatedSignals = new Map();
      if (prevRAMonitoring) {
        monitorSignals.set(moduleId('reasoner-actor'), prevRAMonitoring);
      }

      const shouldFire = condition.threshold.type === 'predicate'
        ? condition.threshold.shouldIntervene(monitorSignals)
        : false; // field-based thresholds evaluated separately

      if (shouldFire) {
        const monResult = await monitor.step(
          monitorSignals, monitorState,
          { target: moduleId('monitor'), timestamp: Date.now() } as any,
        );
        monitorState = monResult.state;

        // Forward monitor trace to cost tracker
        costTracker.onTrace({
          moduleId: monitor.id,
          phase: 'MONITOR',
          timestamp: Date.now(),
          inputHash: String(monitorSignals.size),
          outputSummary: JSON.stringify(monResult.output).slice(0, 100),
          monitoring: monResult.monitoring,
          stateHash: String(monResult.state.cycleCount),
          durationMs: 0, // Monitor is rule-based, near-zero latency
        });

        // Apply monitor enforcement
        if (monResult.monitoring.anomalyDetected) {
          raControl.restrictedActions = monResult.output.restrictedActions;
          raControl.forceReplan = monResult.output.forceReplan;
          if (monResult.output.forceReplan) raControl.strategy = 'think';
        }
      }

      // Phase 4+7: REASON + ACT (single merged LLM call)
      const snapshot: ReadonlyWorkspaceSnapshot = workspace.getReadPort(moduleId('reasoner-actor')).read();
      const raResult = await reasonerActor.step({ snapshot }, raState, raControl);
      raState = raResult.state;
      prevRAMonitoring = raResult.monitoring;

      // Forward reasoner-actor trace to cost tracker
      costTracker.onTrace({
        moduleId: reasonerActor.id,
        phase: 'REASON',
        timestamp: Date.now(),
        inputHash: String(snapshot.length),
        outputSummary: JSON.stringify(raResult.output).slice(0, 100),
        monitoring: raResult.monitoring,
        stateHash: String(raState),
        durationMs: 0, // Will be populated from provider timing
        tokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: (raResult.monitoring as any).tokensThisStep ?? 0,
        },
      });

      // Check for task completion
      const output = raResult.output as { actionName?: string };
      if (output.actionName === 'error') {
        const errInfo = (raResult as any).error;
        console.error(`  [cycle ${cycle}] ERROR: ${errInfo?.message ?? JSON.stringify(raResult.output).slice(0, 200)}`);
        break;
      }
      if (output.actionName === 'done') {
        break;
      }
    }

    // Validate task
    const validation = task.validate(vfs.files);

    return costTracker.buildRunMetrics({
      runId: `${condition.label}-${task.id}-run${runNumber}`,
      condition: condition.label,
      taskId: task.id,
      tier: task.tier,
      hasInjectedError: task.hasInjectedError,
      success: validation.success,
      reason: validation.reason,
      startedAt,
    });
  } catch (err) {
    return costTracker.buildRunMetrics({
      runId: `${condition.label}-${task.id}-run${runNumber}`,
      condition: condition.label,
      taskId: task.id,
      tier: task.tier,
      hasInjectedError: task.hasInjectedError,
      success: false,
      reason: `Error: ${err instanceof Error ? err.message : String(err)}`,
      startedAt,
    });
  }
}

// ── Main ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs();
  const resultsDir = resolve(import.meta.dirname ?? '.', '../results');
  await mkdir(resultsDir, { recursive: true });

  // Determine task list
  let tasks: TaskDefinition[];
  if (opts.specificTask) {
    const task = getTaskById(opts.specificTask);
    if (!task) {
      console.error(`Unknown task: ${opts.specificTask}`);
      console.error(`Available: ${ALL_TASKS.map(t => t.id).join(', ')}`);
      process.exit(1);
    }
    tasks = [task];
  } else {
    tasks = opts.tiers.flatMap(tier => TASKS_BY_TIER[tier] ?? []);
  }

  // Build run plan
  const plan: Array<{ condition: ConditionConfig; task: TaskDefinition; run: number }> = [];
  for (const condKey of opts.conditions) {
    const condition = CONDITIONS[condKey];
    if (!condition) {
      console.error(`Unknown condition: ${condKey}. Use A, B, or C.`);
      process.exit(1);
    }
    for (const task of tasks) {
      for (let run = 1; run <= opts.runsPerTask; run++) {
        plan.push({ condition, task, run });
      }
    }
  }

  console.log(`\n=== exp-interventionist-cost ===`);
  console.log(`Conditions: ${opts.conditions.join(', ')}`);
  console.log(`Tasks: ${tasks.map(t => `${t.id} (T${t.tier})`).join(', ')}`);
  console.log(`Runs per task: ${opts.runsPerTask}`);
  console.log(`Total planned runs: ${plan.length}`);
  console.log(`Pilot mode: ${opts.pilot}`);
  console.log();

  if (opts.dryRun) {
    console.log('DRY RUN — run plan:');
    for (const { condition, task, run } of plan) {
      console.log(`  ${condition.label} / ${task.id} (T${task.tier}) / run ${run}`);
    }
    return;
  }

  // Execute runs
  const budget = new BudgetGuardian(1.0, 0.50, 0.80);
  const costTracker = new CostTracker();
  const allResults: RunMetrics[] = [];

  for (let i = 0; i < plan.length; i++) {
    const { condition, task, run } = plan[i];
    const label = `[${i + 1}/${plan.length}] ${condition.label} / ${task.id} / run ${run}`;

    console.log(`${label} — starting...`);

    try {
      const metrics = await executeRun(task, condition, run, costTracker);

      // Record budget
      budget.recordRun(condition.label, metrics.totalTokens);

      allResults.push(metrics);

      const status = metrics.success ? 'PASS' : 'FAIL';
      console.log(`${label} — ${status} (${metrics.totalTokens} tokens, ${metrics.monitorInvocationCount} interventions, ${metrics.totalDurationMs}ms)`);

      // Write individual result
      const resultFile = resolve(resultsDir, `${metrics.runId}.json`);
      await writeFile(resultFile, JSON.stringify(metrics, null, 2), 'utf8');

    } catch (err) {
      if (err instanceof BudgetExceededError) {
        console.error(`\nBUDGET EXCEEDED: ${err.message}`);
        console.error('Aborting remaining runs.');
        break;
      }
      console.error(`${label} — ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Write summary
  const summaryFile = resolve(resultsDir, `summary-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`);
  const summary = {
    experiment: 'exp-interventionist-cost',
    timestamp: new Date().toISOString(),
    options: opts,
    budget: budget.summary(),
    totalRuns: allResults.length,
    byCondition: Object.fromEntries(
      (['no-monitor', 'always-on', 'interventionist'] as const).map(cond => {
        const condRuns = allResults.filter(r => r.condition === cond);
        return [cond, {
          runs: condRuns.length,
          successRate: condRuns.length > 0 ? condRuns.filter(r => r.success).length / condRuns.length : null,
          avgTokens: condRuns.length > 0 ? condRuns.reduce((s, r) => s + r.totalTokens, 0) / condRuns.length : null,
          avgMonitorTokens: condRuns.length > 0 ? condRuns.reduce((s, r) => s + r.monitorTokens, 0) / condRuns.length : null,
          avgInterventions: condRuns.length > 0 ? condRuns.reduce((s, r) => s + r.monitorInvocationCount, 0) / condRuns.length : null,
        }];
      }),
    ),
    byTier: Object.fromEntries(
      [1, 2, 3].map(tier => {
        const tierRuns = allResults.filter(r => r.tier === tier);
        return [tier, {
          runs: tierRuns.length,
          successRate: tierRuns.length > 0 ? tierRuns.filter(r => r.success).length / tierRuns.length : null,
          avgTokens: tierRuns.length > 0 ? tierRuns.reduce((s, r) => s + r.totalTokens, 0) / tierRuns.length : null,
        }];
      }),
    ),
  };

  await writeFile(summaryFile, JSON.stringify(summary, null, 2), 'utf8');
  console.log(`\n=== Summary written to ${summaryFile} ===`);
  console.log(`Total runs: ${allResults.length}`);
  console.log(`Budget: $${budget.summary().estimatedCostUsd.toFixed(2)} / $1.00`);

  // Print condition comparison table
  console.log('\nCondition Comparison:');
  console.log('| Condition       | Runs | Success | Avg Tokens | Avg Monitor Tokens | Avg Interventions |');
  console.log('|-----------------|------|---------|------------|--------------------|--------------------|');
  for (const cond of ['no-monitor', 'always-on', 'interventionist']) {
    const s = (summary.byCondition as Record<string, any>)[cond];
    if (!s || s.runs === 0) continue;
    console.log(
      `| ${cond.padEnd(15)} | ${String(s.runs).padEnd(4)} | ${((s.successRate ?? 0) * 100).toFixed(0).padStart(5)}%  | ${String(Math.round(s.avgTokens ?? 0)).padStart(10)} | ${String(Math.round(s.avgMonitorTokens ?? 0)).padStart(18)} | ${String((s.avgInterventions ?? 0).toFixed(1)).padStart(18)} |`,
    );
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
