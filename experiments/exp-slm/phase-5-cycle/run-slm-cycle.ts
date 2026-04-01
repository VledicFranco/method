/**
 * Phase 5 Runner — SLM Cognitive Cycle Experiment
 *
 * Wires 3 SLM-compiled modules (Monitor, Observer, Evaluator) into the cognitive
 * cycle and measures their impact on T01-T05 tasks.
 *
 * Five conditions:
 *   flat:                   anthropicProvider + VirtualToolProvider (no cycle)
 *   rule-cognitive:          rule-based Observer + Monitor + Evaluator + ReasonerActor
 *   partitioned-cognitive:   rule-based modules + partitioned workspace (PRD 044 C-4)
 *   monitor-only:            SLM Monitor + rule-based Observer (cycle 0 only) + rule-based Evaluator
 *   slm-cognitive:           SLM Monitor + SLM Observer + SLM Evaluator + frontier ReasonerActor
 *
 * Usage:
 *   npx tsx experiments/exp-slm/phase-5-cycle/run-slm-cycle.ts [options]
 *
 * Options:
 *   --condition  slm-cognitive | monitor-only | rule-cognitive | partitioned-cognitive | flat  (default: all)
 *   --task       1-5 or 'all'   (default: all)
 *   --runs       N               (default: 3)
 *   --config     baseline | v2-minimal  (default: baseline)
 *   --monitor-url   http://localhost:8100
 *   --observer-url  http://localhost:8101
 *   --evaluator-url http://localhost:8102
 */

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Load .env — try multiple paths
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
} from '../../../packages/pacta/src/cognitive/algebra/index.js';

import { createReasonerActor, type ReasonerActorControl } from '../../../packages/pacta/src/cognitive/modules/reasoner-actor.js';
import { createObserver } from '../../../packages/pacta/src/cognitive/modules/observer.js';
import { createMonitor } from '../../../packages/pacta/src/cognitive/modules/monitor.js';
import { createEvaluator, type EvaluatorInput } from '../../../packages/pacta/src/cognitive/modules/evaluator.js';
import { checkConstraintViolations } from '../../../packages/pacta/src/cognitive/modules/constraint-classifier.js';

import { createPartitionSystem } from '../../../packages/pacta/src/cognitive/partitions/index.js';
import type { ContextSelector, PartitionId, PartitionMonitorContext } from '../../../packages/pacta/src/cognitive/algebra/index.js';

// CJS/ESM interop: exp-cognitive-baseline has no package.json "type":"module",
// so its exports need default-import destructuring under Node16 resolution.
import strategiesModule from '../../exp-cognitive-baseline/strategies.js';
const CONFIGS = (strategiesModule as any).CONFIGS ?? strategiesModule;
type CognitiveConfig = import('../../exp-cognitive-baseline/strategies.js').CognitiveConfig;

import task01Module from '../../exp-cognitive-baseline/task-01-circular-dep.js';
import task02Module from '../../exp-cognitive-baseline/task-02-test-first-bug.js';
import task03Module from '../../exp-cognitive-baseline/task-03-config-migration.js';
import task04Module from '../../exp-cognitive-baseline/task-04-api-versioning.js';
import task05Module from '../../exp-cognitive-baseline/task-05-dead-code-removal.js';
const TASK_01 = (task01Module as any).TASK_01 ?? task01Module;
const TASK_02 = (task02Module as any).TASK_02 ?? task02Module;
const TASK_03 = (task03Module as any).TASK_03 ?? task03Module;
const TASK_04 = (task04Module as any).TASK_04 ?? task04Module;
const TASK_05 = (task05Module as any).TASK_05 ?? task05Module;

import task06Module from '../../exp-cognitive-baseline/task-06-multi-module-extract.js';
const TASK_06 = (task06Module as any).TASK_06 ?? task06Module;

// SLM infrastructure
import { createHttpSLMInference, type SLMInference } from '../phase-4-integration/src/slm-inference.js';

// Local SLM modules
import { createSLMMonitor } from './src/slm-monitor-module.js';
import { createSLMObserver } from './src/slm-observer-module.js';
import { createSLMEvaluator } from './src/slm-evaluator-module.js';
import { mergeMetacognitiveReports } from './src/control-merge.js';
import { createMetricsCollector, type SLMCycleMetric, type SLMRunMetrics } from './src/slm-cycle-metrics.js';
import { decomposeTaskToEntries, logDecomposition } from './src/task-decompose.js';

// ── Types ───────────────────────────────────────────────────────

interface TaskDefinition {
  name: string;
  baseDescription: string;
  description: string;
  initialFiles: Record<string, string>;
  validate(files: ReadonlyMap<string, string>): { success: boolean; reason: string };
}

const TASKS: TaskDefinition[] = [TASK_01, TASK_02, TASK_03, TASK_04, TASK_05, TASK_06];

type Condition = 'flat' | 'rule-cognitive' | 'monitor-only' | 'slm-cognitive' | 'partitioned-cognitive' | 'slm-partitioned' | 'partitioned-smart';

interface ContextProfile {
  cycle: number;
  totalEntries: number;
  estimatedTokens: number;
  pinnedEntries: number;
  observerEntries: number;
}

interface PartitionedContextProfile extends ContextProfile {
  perPartition: Record<string, { entries: number; tokens: number }>;
  perModule: Record<string, { entries: number; tokens: number }>;
}

interface RunResult {
  condition: Condition;
  task: string;
  run: number;
  success: boolean;
  reason: string;
  tokensUsed: number;
  providerCalls: number;
  durationMs: number;
  toolCalls: Array<{ tool: string; input: unknown; success: boolean }>;
  monitorInterventions?: number;
  slmMetrics?: SLMRunMetrics;
  contextProfiles?: ContextProfile[];
}

let MAX_CYCLES = 15; // overridable via --max-cycles=N
let extendedThinkingBudget = 0; // overridable via --extended-thinking=N

// ── Condition A: Flat Agent ─────────────────────────────────────

async function runFlat(task: TaskDefinition, runNumber: number): Promise<RunResult> {
  const startTime = Date.now();
  const vfs = new VirtualToolProvider(task.initialFiles);

  const provider = anthropicProvider({
    model: 'claude-opus-4-20250514',
    maxOutputTokens: 4096,
    toolProvider: vfs,
    maxTurns: 15,
    ...(extendedThinkingBudget > 0 ? { thinking: { budgetTokens: extendedThinkingBudget } } : {}),
  });

  let totalTokens = 0;

  try {
    const result = await provider.invoke(
      {
        mode: { type: 'oneshot' },
        budget: { maxTurns: 15, maxOutputTokens: 4096 },
      },
      {
        prompt: task.baseDescription,
        systemPrompt: 'You are a coding assistant. Use the available tools (Read, Write, Edit, Glob, Grep) to complete the task. Work step by step.',
      },
    );

    totalTokens = result.usage.totalTokens;
    const validation = task.validate(vfs.files);

    return {
      condition: 'flat',
      task: task.name,
      run: runNumber,
      success: validation.success,
      reason: validation.reason,
      tokensUsed: totalTokens,
      providerCalls: result.turns,
      durationMs: Date.now() - startTime,
      toolCalls: vfs.callLog.map(c => ({
        tool: c.name,
        input: c.input,
        success: !c.result.isError,
      })),
    };
  } catch (err) {
    return {
      condition: 'flat',
      task: task.name,
      run: runNumber,
      success: false,
      reason: `Error: ${err instanceof Error ? err.message : String(err)}`,
      tokensUsed: totalTokens,
      providerCalls: 0,
      durationMs: Date.now() - startTime,
      toolCalls: vfs.callLog.map(c => ({
        tool: c.name,
        input: c.input,
        success: !c.result.isError,
      })),
    };
  }
}

// ── Condition B: Rule-based Cognitive ───────────────────────────

async function runRuleCognitive(
  task: TaskDefinition,
  runNumber: number,
  config: CognitiveConfig,
): Promise<RunResult> {
  const startTime = Date.now();
  const vfs = new VirtualToolProvider(task.initialFiles);

  const llmProvider = anthropicProvider({
    model: 'claude-opus-4-20250514',
    maxOutputTokens: 2048,
    ...(extendedThinkingBudget > 0 ? { thinking: { budgetTokens: extendedThinkingBudget } } : {}),
  });
  const adapter = createProviderAdapter(llmProvider, {
    pactTemplate: { mode: { type: 'oneshot' }, budget: { maxOutputTokens: 2048 } },
  });

  const salienceContext: SalienceContext = {
    now: Date.now(),
    goals: ['complete the coding task', 'preserve functionality'],
    sourcePriorities: new Map([
      [moduleId('reasoner-actor'), 0.9],
      [moduleId('observer'), 0.6],
    ]),
  };
  const workspace = createWorkspace({ capacity: config.workspace.capacity }, salienceContext);

  const observer = createObserver(workspace.getWritePort(moduleId('observer')));
  const monitor = createMonitor({ confidenceThreshold: 0.3, stagnationThreshold: config.monitor.stagnationThreshold });
  const evaluator = createEvaluator();
  const reasonerActor = createReasonerActor(
    adapter, vfs, workspace.getWritePort(moduleId('reasoner-actor')),
  );

  let totalTokens = 0;
  let providerCalls = 0;
  let monitorInterventions = 0;
  const allToolCalls: Array<{ tool: string; input: unknown; success: boolean }> = [];
  const contextProfiles: ContextProfile[] = [];

  let observerState = observer.initialState();
  let monitorState = monitor.initialState();
  let evaluatorState = evaluator.initialState();
  let raState = reasonerActor.initialState();
  let prevRAMonitoring: MonitoringSignal | null = null;

  const raControl: ReasonerActorControl = {
    target: moduleId('reasoner-actor'),
    timestamp: Date.now(),
    strategy: 'plan',
    effort: 'medium',
  };

  try {
    for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
      // 1. OBSERVE (cycle 0 only)
      if (cycle === 0) {
        const obsResult = await observer.step(
          { content: task.description },
          observerState,
          { target: moduleId('observer'), timestamp: Date.now() } as any,
        );
        observerState = obsResult.state;
      }

      // 2. MONITOR
      const monitorSignals: AggregatedSignals = new Map();
      if (prevRAMonitoring) {
        monitorSignals.set(moduleId('reasoner-actor'), prevRAMonitoring);
      }
      const monResult = await monitor.step(
        monitorSignals, monitorState,
        { target: moduleId('monitor'), timestamp: Date.now() } as any,
      );
      monitorState = monResult.state;

      // 3. EVALUATE
      const evalInput: EvaluatorInput = {
        workspace: workspace.getReadPort(moduleId('evaluator')).read(),
        signals: monitorSignals,
      };
      const evalResult = await evaluator.step(
        evalInput, evaluatorState,
        { target: moduleId('evaluator'), timestamp: Date.now(), evaluationHorizon: 'trajectory' },
      );
      evaluatorState = evalResult.state;

      // Apply monitor enforcement
      if (monResult.monitoring.anomalyDetected) {
        monitorInterventions++;
        raControl.restrictedActions = monResult.output.restrictedActions;
        raControl.forceReplan = monResult.output.forceReplan;
        if (monResult.output.forceReplan) raControl.strategy = 'think';
      }

      // 4. REASON+ACT
      const snapshot: ReadonlyWorkspaceSnapshot = workspace.getReadPort(moduleId('reasoner-actor')).read();

      // Context profiling
      const contextProfile: ContextProfile = {
        cycle,
        totalEntries: snapshot.length,
        estimatedTokens: snapshot.reduce((sum, e) => sum + Math.ceil(String(e.content).length / 4), 0),
        pinnedEntries: snapshot.filter((e: any) => e.pinned).length,
        observerEntries: snapshot.filter((e: any) => String(e.source) === 'observer').length,
      };
      contextProfiles.push(contextProfile);

      const raResult = await reasonerActor.step({ snapshot }, raState, raControl);
      raState = raResult.state;
      prevRAMonitoring = raResult.monitoring;
      providerCalls++;
      totalTokens += (raResult.monitoring as any).tokensThisStep ?? 0;

      if (raResult.output.toolResult) {
        allToolCalls.push({
          tool: raResult.output.actionName,
          input: raResult.output.toolResult,
          success: (raResult.monitoring as any).success ?? true,
        });
      }

      // Per-cycle trace
      const conf = (raResult.monitoring as any).confidence ?? 0;
      const tok = (raResult.monitoring as any).tokensThisStep ?? 0;
      const stag = monResult.monitoring.anomalyDetected ? ' stag' : '';
      console.log(`    [c${cycle + 1}] ${raResult.output.actionName}  conf=${conf.toFixed(2)}  tok=${tok}  ctx=${contextProfile.totalEntries}e/${contextProfile.estimatedTokens}tok${stag}`);

      // Post-ACT constraint verification (PRD 043)
      const pinnedEntries = workspace.getReadPort(moduleId('observer')).read().filter((e: any) => e.pinned);
      if (pinnedEntries.length > 0 && raResult?.output) {
        const actContent = typeof (raResult.output as any).lastOutput === 'string'
          ? (raResult.output as any).lastOutput : '';
        if (actContent) {
          const violations = checkConstraintViolations(pinnedEntries, actContent);
          if (violations.length > 0) {
            for (const v of violations) {
              console.log(`    constraint violation: ${v.constraint.slice(0, 80)} | matched: ${v.violation}`);
            }
            raControl.restrictedActions = ['Write'];
            raControl.forceReplan = true;
            raControl.strategy = 'think';
          }
        }
      }

      if (raResult.output.actionName === 'done') break;
    }

    const validation = task.validate(vfs.files);
    return {
      condition: 'rule-cognitive',
      task: task.name,
      run: runNumber,
      success: validation.success,
      reason: validation.reason,
      tokensUsed: totalTokens,
      providerCalls,
      durationMs: Date.now() - startTime,
      toolCalls: allToolCalls,
      monitorInterventions,
      contextProfiles,
    };
  } catch (err) {
    return {
      condition: 'rule-cognitive',
      task: task.name,
      run: runNumber,
      success: false,
      reason: `Error: ${err instanceof Error ? err.message : String(err)}`,
      tokensUsed: totalTokens,
      providerCalls,
      durationMs: Date.now() - startTime,
      toolCalls: allToolCalls,
      monitorInterventions,
      contextProfiles,
    };
  }
}

// ── Condition E: Partitioned Cognitive ─────────────────────────

async function runPartitionedCognitive(
  task: TaskDefinition,
  runNumber: number,
  config: CognitiveConfig,
): Promise<RunResult> {
  const startTime = Date.now();
  const vfs = new VirtualToolProvider(task.initialFiles);

  const llmProvider = anthropicProvider({
    model: 'claude-opus-4-20250514',
    maxOutputTokens: 2048,
    ...(extendedThinkingBudget > 0 ? { thinking: { budgetTokens: extendedThinkingBudget } } : {}),
  });
  const adapter = createProviderAdapter(llmProvider, {
    pactTemplate: { mode: { type: 'oneshot' }, budget: { maxOutputTokens: 2048 } },
  });

  const salienceContext: SalienceContext = {
    now: Date.now(),
    goals: ['complete the coding task', 'preserve functionality'],
    sourcePriorities: new Map([
      [moduleId('reasoner-actor'), 0.9],
      [moduleId('observer'), 0.6],
    ]),
  };

  // Monolithic workspace — modules still write here via their write ports
  const workspace = createWorkspace({ capacity: config.workspace.capacity }, salienceContext);

  // Partition system — entries are dual-written here for partitioned context reads
  const partitions = createPartitionSystem({
    constraintCapacity: 10,
    operationalCapacity: 12,
    taskCapacity: 6,
  });

  const observer = createObserver(workspace.getWritePort(moduleId('observer')));
  const monitor = createMonitor({ confidenceThreshold: 0.3, stagnationThreshold: config.monitor.stagnationThreshold });
  const evaluator = createEvaluator();
  const reasonerActor = createReasonerActor(
    adapter, vfs, workspace.getWritePort(moduleId('reasoner-actor')),
  );

  let totalTokens = 0;
  let providerCalls = 0;
  let monitorInterventions = 0;
  const allToolCalls: Array<{ tool: string; input: unknown; success: boolean }> = [];
  const contextProfiles: PartitionedContextProfile[] = [];

  // Track last write cycle per partition for monitor context
  const lastWriteCycle = new Map<PartitionId, number>([
    ['constraint', 0],
    ['operational', 0],
    ['task', 0],
  ]);

  let observerState = observer.initialState();
  let monitorState = monitor.initialState();
  let evaluatorState = evaluator.initialState();
  let raState = reasonerActor.initialState();
  let prevRAMonitoring: MonitoringSignal | null = null;

  const raControl: ReasonerActorControl = {
    target: moduleId('reasoner-actor'),
    timestamp: Date.now(),
    strategy: 'plan',
    effort: 'medium',
  };

  // Selector for the reasoner-actor: reads task + constraint + operational partitions
  const reasonerSelector: ContextSelector = {
    sources: ['task', 'constraint', 'operational'] as PartitionId[],
    budget: 8192,
    strategy: 'salience',
  };

  try {
    for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
      partitions.resetCycleQuotas();

      // 1. OBSERVE (cycle 0 only)
      if (cycle === 0) {
        const obsResult = await observer.step(
          { content: task.description },
          observerState,
          { target: moduleId('observer'), timestamp: Date.now() } as any,
        );
        observerState = obsResult.state;

        // Dual-write: replicate observer entries into partition system
        // Read what the observer just wrote to workspace and route it through partitions
        const observerEntries = workspace.getReadPort(moduleId('observer')).read();
        for (const entry of observerEntries) {
          const writtenTo = partitions.write(entry, moduleId('observer'));
          lastWriteCycle.set(writtenTo, cycle);
        }
      }

      // 2. MONITOR
      const monitorSignals: AggregatedSignals = new Map();
      if (prevRAMonitoring) {
        monitorSignals.set(moduleId('reasoner-actor'), prevRAMonitoring);
      }
      const monResult = await monitor.step(
        monitorSignals, monitorState,
        { target: moduleId('monitor'), timestamp: Date.now() } as any,
      );
      monitorState = monResult.state;

      // 3. EVALUATE
      const evalInput: EvaluatorInput = {
        workspace: workspace.getReadPort(moduleId('evaluator')).read(),
        signals: monitorSignals,
      };
      const evalResult = await evaluator.step(
        evalInput, evaluatorState,
        { target: moduleId('evaluator'), timestamp: Date.now(), evaluationHorizon: 'trajectory' },
      );
      evaluatorState = evalResult.state;

      // Apply monitor enforcement
      if (monResult.monitoring.anomalyDetected) {
        monitorInterventions++;
        raControl.restrictedActions = monResult.output.restrictedActions;
        raControl.forceReplan = monResult.output.forceReplan;
        if (monResult.output.forceReplan) raControl.strategy = 'think';
      }

      // 4. REASON+ACT — context comes from partitioned system, not monolithic workspace
      // Monolithic context (for comparison profiling)
      const monoSnapshot = workspace.getReadPort(moduleId('reasoner-actor')).read();
      const monoTokens = monoSnapshot.reduce((sum, e) => sum + Math.ceil(String(e.content).length / 4), 0);

      // Partitioned context (what the agent actually sees)
      const partSnapshot = partitions.buildContext(reasonerSelector);
      const partTokens = partSnapshot.reduce((sum, e) => sum + Math.ceil(String(e.content).length / 4), 0);

      const reduction = monoTokens > 0 ? Math.round((1 - partTokens / monoTokens) * 100) : 0;
      console.log(`    [c${cycle + 1}] context: mono=${monoSnapshot.length}e/${monoTokens}tok → part=${partSnapshot.length}e/${partTokens}tok (${reduction}% reduction)`);

      // Per-partition breakdown
      const perPartition: Record<string, { entries: number; tokens: number }> = {};
      for (const pid of ['constraint', 'operational', 'task'] as PartitionId[]) {
        const pEntries = partitions.getPartition(pid).snapshot();
        perPartition[pid] = {
          entries: pEntries.length,
          tokens: pEntries.reduce((sum, e) => sum + Math.ceil(String(e.content).length / 4), 0),
        };
      }

      // Per-module breakdown from monolithic workspace (for profiling)
      const perModule: Record<string, { entries: number; tokens: number }> = {};
      for (const entry of monoSnapshot) {
        const src = String((entry as any).source ?? 'unknown');
        if (!perModule[src]) perModule[src] = { entries: 0, tokens: 0 };
        perModule[src].entries++;
        perModule[src].tokens += Math.ceil(String(entry.content).length / 4);
      }

      const contextProfile: PartitionedContextProfile = {
        cycle,
        totalEntries: partSnapshot.length,
        estimatedTokens: partTokens,
        pinnedEntries: partSnapshot.filter((e: any) => e.pinned).length,
        observerEntries: partSnapshot.filter((e: any) => String(e.source) === 'observer').length,
        perPartition,
        perModule,
      };
      contextProfiles.push(contextProfile);

      // Feed partitioned context to reasoner-actor
      const snapshot: ReadonlyWorkspaceSnapshot = partSnapshot;
      const raResult = await reasonerActor.step({ snapshot }, raState, raControl);
      raState = raResult.state;
      prevRAMonitoring = raResult.monitoring;
      providerCalls++;
      totalTokens += (raResult.monitoring as any).tokensThisStep ?? 0;

      if (raResult.output.toolResult) {
        allToolCalls.push({
          tool: raResult.output.actionName,
          input: raResult.output.toolResult,
          success: (raResult.monitoring as any).success ?? true,
        });

        // Dual-write: replicate RA tool result into partition system as operational entry
        const toolContent = typeof raResult.output.toolResult === 'object'
          ? JSON.stringify(raResult.output.toolResult)
          : String(raResult.output.toolResult);
        partitions.write(
          {
            content: `[${raResult.output.actionName}] ${toolContent.slice(0, 500)}`,
            timestamp: Date.now(),
            source: moduleId('reasoner-actor'),
            contentType: 'tool-result',
          } as any,
          moduleId('reasoner-actor'),
        );
        lastWriteCycle.set('operational', cycle);
      }

      // Per-cycle trace
      const conf = (raResult.monitoring as any).confidence ?? 0;
      const tok = (raResult.monitoring as any).tokensThisStep ?? 0;
      const stag = monResult.monitoring.anomalyDetected ? ' stag' : '';
      console.log(`    [c${cycle + 1}] ${raResult.output.actionName}  conf=${conf.toFixed(2)}  tok=${tok}  ctx=${contextProfile.totalEntries}e/${contextProfile.estimatedTokens}tok${stag}`);

      // Post-ACT constraint verification via partition monitors (PRD 044)
      const actContent = typeof (raResult.output as any).lastOutput === 'string'
        ? (raResult.output as any).lastOutput : '';
      const partMonitorCtx: PartitionMonitorContext = {
        cycleNumber: cycle,
        lastWriteCycle,
        actorOutput: actContent || undefined,
      };
      const partSignals = partitions.checkPartitions(partMonitorCtx);
      const criticalSignals = partSignals.filter(s => s.severity === 'critical' || s.severity === 'high');
      if (criticalSignals.length > 0) {
        for (const sig of criticalSignals) {
          console.log(`    partition signal [${sig.severity}] ${sig.partition}: ${sig.type} — ${sig.detail}`);
        }
        raControl.restrictedActions = ['Write'];
        raControl.forceReplan = true;
        raControl.strategy = 'think';
      }

      // Constraint check — reads from constraint partition (authoritative source)
      const pinnedEntries = partitions.getPartition('constraint').snapshot().filter((e: any) => e.pinned);
      if (pinnedEntries.length > 0 && raResult?.output && actContent) {
        const violations = checkConstraintViolations(pinnedEntries, actContent);
        if (violations.length > 0) {
          for (const v of violations) {
            console.log(`    constraint violation: ${v.constraint.slice(0, 80)} | matched: ${v.violation}`);
          }
          raControl.restrictedActions = ['Write'];
          raControl.forceReplan = true;
          raControl.strategy = 'think';
        }
      }

      if (raResult.output.actionName === 'done') break;
    }

    const validation = task.validate(vfs.files);
    return {
      condition: 'partitioned-cognitive',
      task: task.name,
      run: runNumber,
      success: validation.success,
      reason: validation.reason,
      tokensUsed: totalTokens,
      providerCalls,
      durationMs: Date.now() - startTime,
      toolCalls: allToolCalls,
      monitorInterventions,
      contextProfiles,
    };
  } catch (err) {
    return {
      condition: 'partitioned-cognitive',
      task: task.name,
      run: runNumber,
      success: false,
      reason: `Error: ${err instanceof Error ? err.message : String(err)}`,
      tokensUsed: totalTokens,
      providerCalls,
      durationMs: Date.now() - startTime,
      toolCalls: allToolCalls,
      monitorInterventions,
      contextProfiles,
    };
  }
}

// ── Condition E+: Partitioned Smart ────────────────────────────
//
// Extends partitioned-cognitive with two architectural improvements:
//
// 1. SMART TASK DECOMPOSITION (cycle 0):
//    Instead of writing the full task description as a single entry (which routes
//    to one partition based on first keyword match), we decompose it into typed entries:
//      - Constraint sentences → "CONSTRAINT: <text>" → constraint partition
//      - Goal sentences       → "GOAL: <text>"       → task partition
//      - Context sentences    → plain text            → operational partition
//    This ensures goals and constraints live in the RIGHT partitions from the start.
//
// 2. WRITE-PHASE ENFORCER:
//    Tracks consecutive read-only cycles (Read/Grep/Glob). After WRITE_BIAS_THRESHOLD
//    cycles with no Write/Edit, injects a CRITICAL DIRECTIVE into the task partition
//    and restricts actions to force the agent to write something. Specifically targets
//    T06's Read-loop failure mode.

const WRITE_BIAS_THRESHOLD = 5;
const READ_ONLY_ACTION_NAMES = new Set(['Read', 'Grep', 'Glob', 'List', 'Bash', 'SearchFiles']);

async function runPartitionedSmart(
  task: TaskDefinition,
  runNumber: number,
  config: CognitiveConfig,
): Promise<RunResult> {
  const startTime = Date.now();
  const vfs = new VirtualToolProvider(task.initialFiles);

  const llmProvider = anthropicProvider({
    model: 'claude-opus-4-20250514',
    maxOutputTokens: 2048,
    ...(extendedThinkingBudget > 0 ? { thinking: { budgetTokens: extendedThinkingBudget } } : {}),
  });
  const adapter = createProviderAdapter(llmProvider, {
    pactTemplate: { mode: { type: 'oneshot' }, budget: { maxOutputTokens: 2048 } },
  });

  const salienceContext: SalienceContext = {
    now: Date.now(),
    goals: ['complete the coding task', 'preserve functionality'],
    sourcePriorities: new Map([
      [moduleId('reasoner-actor'), 0.9],
      [moduleId('observer'), 0.6],
    ]),
  };

  const workspace = createWorkspace({ capacity: config.workspace.capacity }, salienceContext);

  // Larger task capacity than base partitioned-cognitive (6→12) to ensure all goal
  // entries from smart decomposition fit without eviction. T06 has 6 goals + progress
  // notes; 12 gives headroom without hurting short tasks (T01-T05 have ≤4 goals).
  const partitions = createPartitionSystem({
    constraintCapacity: 12,
    operationalCapacity: 14,
    taskCapacity: 12,
  });

  const monitor = createMonitor({
    confidenceThreshold: 0.3,
    stagnationThreshold: config.monitor.stagnationThreshold,
  });
  const evaluator = createEvaluator();
  const reasonerActor = createReasonerActor(
    adapter, vfs, workspace.getWritePort(moduleId('reasoner-actor')),
  );

  let totalTokens = 0;
  let providerCalls = 0;
  let monitorInterventions = 0;
  const allToolCalls: Array<{ tool: string; input: unknown; success: boolean }> = [];
  const contextProfiles: PartitionedContextProfile[] = [];

  const lastWriteCycle = new Map<PartitionId, number>([
    ['constraint', 0],
    ['operational', 0],
    ['task', 0],
  ]);

  let monitorState = monitor.initialState();
  let evaluatorState = evaluator.initialState();
  let raState = reasonerActor.initialState();
  let prevRAMonitoring: MonitoringSignal | null = null;

  const raControl: ReasonerActorControl = {
    target: moduleId('reasoner-actor'),
    timestamp: Date.now(),
    strategy: 'plan',
    effort: 'medium',
  };

  const reasonerSelector: ContextSelector = {
    sources: ['task', 'constraint', 'operational'] as PartitionId[],
    budget: 8192,
    strategy: 'salience',
  };

  // Write-phase enforcer state
  // Only activate for complex multi-file tasks (≥4 goals). Short tasks (T01-T05) solve
  // naturally in 3-5 reads; early enforcement hurts them by pushing writes before the
  // agent has understood the structure. T06-style tasks (many goals) need the push.
  let consecutiveReadOnlyCycles = 0;
  let totalWriteActionsThisRun = 0;
  let writeEnforcerFired = false;
  // Deferred until after task decomposition runs (will be set in cycle 0)
  let effectiveWriteBiasThreshold = MAX_CYCLES + 1; // disabled by default

  try {
    for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
      partitions.resetCycleQuotas();

      // 1. SMART OBSERVE (cycle 0 only) — decompose into typed entries
      if (cycle === 0) {
        const decomposed = decomposeTaskToEntries(task.description);
        logDecomposition(decomposed);

        // Write each type to partitions; prefixes route them to the right partition
        for (const entry of [...decomposed.constraints, ...decomposed.goals, ...decomposed.context]) {
          const pid = partitions.write(entry, moduleId('observer'));
          lastWriteCycle.set(pid, cycle);
        }

        // Activate write-phase enforcer only for complex multi-file tasks (≥4 goals).
        // Short tasks solve naturally; enforcer would push writes before full understanding.
        if (decomposed.goals.length >= 4) {
          effectiveWriteBiasThreshold = WRITE_BIAS_THRESHOLD;
          console.log(`    [write-enforcer] activated (${decomposed.goals.length} goals detected, threshold=${WRITE_BIAS_THRESHOLD})`);
        } else {
          console.log(`    [write-enforcer] disabled (${decomposed.goals.length} goals — too few for enforcement)`);
        }

        // Also write full description to monolithic workspace (for backward compat)
        workspace.getWritePort(moduleId('observer')).write({
          source: moduleId('observer'),
          content: task.description,
          salience: 0.9,
          timestamp: Date.now(),
        } as any);
      }

      // 2. MONITOR
      const monitorSignals: AggregatedSignals = new Map();
      if (prevRAMonitoring) {
        monitorSignals.set(moduleId('reasoner-actor'), prevRAMonitoring);
      }
      const monResult = await monitor.step(
        monitorSignals, monitorState,
        { target: moduleId('monitor'), timestamp: Date.now() } as any,
      );
      monitorState = monResult.state;

      // 3. EVALUATE
      const evalInput: EvaluatorInput = {
        workspace: workspace.getReadPort(moduleId('evaluator')).read(),
        signals: monitorSignals,
      };
      const evalResult = await evaluator.step(
        evalInput, evaluatorState,
        { target: moduleId('evaluator'), timestamp: Date.now(), evaluationHorizon: 'trajectory' },
      );
      evaluatorState = evalResult.state;

      // Apply monitor enforcement
      if (monResult.monitoring.anomalyDetected) {
        monitorInterventions++;
        raControl.restrictedActions = monResult.output.restrictedActions;
        raControl.forceReplan = monResult.output.forceReplan;
        if (monResult.output.forceReplan) raControl.strategy = 'plan'; // NOT 'think' — extended thinking not wired
      }

      // Write-phase enforcer: injects a write directive after too many consecutive read-only cycles.
      // First firing: WRITE_BIAS_THRESHOLD cycles with NO writes ever.
      // Subsequent firings: WRITE_BIAS_THRESHOLD + 3 cycles since last write (allows read-verify loop).
      const enforcerThreshold = totalWriteActionsThisRun === 0
        ? effectiveWriteBiasThreshold
        : effectiveWriteBiasThreshold + 3;
      if (consecutiveReadOnlyCycles >= enforcerThreshold) {
        const directive =
          `[METACOGNITIVE ALERT] You have been reading for ${consecutiveReadOnlyCycles} consecutive cycles. ` +
          (totalWriteActionsThisRun === 0
            ? `You have NOT created or modified any files yet. The task requires creating files. `
            : `You have written ${totalWriteActionsThisRun} file(s) so far, but there are more files to create or update. `) +
          `Your NEXT action MUST be Write or Edit on a required file. Do not use Read, Grep, or Glob.`;
        if (!writeEnforcerFired || consecutiveReadOnlyCycles === enforcerThreshold) {
          // Write to operational partition (no GOAL/CONSTRAINT prefix) so it appears
          // as most-recent entry without evicting goal entries from task partition
          partitions.write({
            source: moduleId('monitor'),  // monitor source → operational via D3-like rule
            content: directive,
            salience: 1.0,
            timestamp: Date.now(),
          } as any, moduleId('monitor'));
          writeEnforcerFired = true;
          console.log(`    [write-enforcer c${cycle + 1}] ${consecutiveReadOnlyCycles} read-only cycles (writes so far: ${totalWriteActionsThisRun}) — forcing write`);
        }
        // Restrict to write-only actions
        raControl.restrictedActions = ['Read', 'Grep', 'Glob', 'List', 'Bash', 'SearchFiles'];
        raControl.forceReplan = false;
        raControl.strategy = 'plan';
      }

      // 4. REASON+ACT — partitioned context
      const monoSnapshot = workspace.getReadPort(moduleId('reasoner-actor')).read();
      const monoTokens = monoSnapshot.reduce((sum, e) => sum + Math.ceil(String(e.content).length / 4), 0);

      const partSnapshot = partitions.buildContext(reasonerSelector);
      const partTokens = partSnapshot.reduce((sum, e) => sum + Math.ceil(String(e.content).length / 4), 0);

      const reduction = monoTokens > 0 ? Math.round((1 - partTokens / monoTokens) * 100) : 0;
      console.log(`    [c${cycle + 1}] context: mono=${monoSnapshot.length}e/${monoTokens}tok → part=${partSnapshot.length}e/${partTokens}tok (${reduction}% reduction)`);

      const perPartition: Record<string, { entries: number; tokens: number }> = {};
      for (const pid of ['constraint', 'operational', 'task'] as PartitionId[]) {
        const pEntries = partitions.getPartition(pid).snapshot();
        perPartition[pid] = {
          entries: pEntries.length,
          tokens: pEntries.reduce((sum, e) => sum + Math.ceil(String(e.content).length / 4), 0),
        };
      }

      const perModule: Record<string, { entries: number; tokens: number }> = {};
      for (const entry of monoSnapshot) {
        const src = String((entry as any).source ?? 'unknown');
        if (!perModule[src]) perModule[src] = { entries: 0, tokens: 0 };
        perModule[src].entries++;
        perModule[src].tokens += Math.ceil(String(entry.content).length / 4);
      }

      contextProfiles.push({
        cycle,
        totalEntries: partSnapshot.length,
        estimatedTokens: partTokens,
        pinnedEntries: partSnapshot.filter((e: any) => e.pinned).length,
        observerEntries: partSnapshot.filter((e: any) => String(e.source) === 'observer').length,
        perPartition,
        perModule,
      });

      const snapshot: ReadonlyWorkspaceSnapshot = partSnapshot;
      const raResult = await reasonerActor.step({ snapshot }, raState, raControl);
      raState = raResult.state;
      prevRAMonitoring = raResult.monitoring;
      providerCalls++;
      totalTokens += (raResult.monitoring as any).tokensThisStep ?? 0;

      // Surface API errors immediately for debugging
      if ((raResult as any).error) {
        console.log(`    [c${cycle + 1}] ERROR: ${(raResult as any).error?.message}`);
      }

      const actionName = raResult.output.actionName;
      const isWriteAction = actionName === 'Write' || actionName === 'Edit';

      // Update write-phase enforcer counters
      if (isWriteAction) {
        consecutiveReadOnlyCycles = 0;
        totalWriteActionsThisRun++;
        writeEnforcerFired = false; // Reset so next enforcement event can inject fresh directive
        // Clear write restriction after agent writes
        if (raControl.restrictedActions?.includes('Read')) {
          raControl.restrictedActions = [];
          raControl.strategy = 'plan';
        }

        // Progress injection: show what files have been created or modified
        // This gives the agent a running checklist view of what's done vs. pending
        const newFiles: string[] = [];
        const modifiedFiles: string[] = [];
        for (const [path] of vfs.files) {
          if (!(path in task.initialFiles)) {
            newFiles.push(path.split('/').pop() ?? path);
          } else if (vfs.files.get(path) !== task.initialFiles[path]) {
            modifiedFiles.push(path.split('/').pop() ?? path);
          }
        }
        if (newFiles.length > 0 || modifiedFiles.length > 0) {
          const progressNote =
            `[PROGRESS c${cycle + 1}] ` +
            (newFiles.length > 0 ? `Created: ${newFiles.join(', ')}. ` : '') +
            (modifiedFiles.length > 0 ? `Updated: ${modifiedFiles.join(', ')}. ` : '') +
            `Continue working through remaining items in your goal list.`;
          partitions.write({
            source: moduleId('monitor'),
            content: progressNote,
            salience: 0.85,
            timestamp: Date.now(),
          } as any, moduleId('monitor'));
          console.log(`    [progress] ${progressNote.slice(0, 100)}`);
        }
      } else if (READ_ONLY_ACTION_NAMES.has(actionName)) {
        consecutiveReadOnlyCycles++;
      }

      if (raResult.output.toolResult) {
        allToolCalls.push({
          tool: actionName,
          input: raResult.output.toolResult,
          success: (raResult.monitoring as any).success ?? true,
        });

        const toolContent = typeof raResult.output.toolResult === 'object'
          ? JSON.stringify(raResult.output.toolResult)
          : String(raResult.output.toolResult);
        partitions.write(
          {
            content: `[${actionName}] ${toolContent.slice(0, 500)}`,
            timestamp: Date.now(),
            source: moduleId('reasoner-actor'),
            contentType: 'tool-result',
          } as any,
          moduleId('reasoner-actor'),
        );
        lastWriteCycle.set('operational', cycle);
      }

      const conf = (raResult.monitoring as any).confidence ?? 0;
      const tok = (raResult.monitoring as any).tokensThisStep ?? 0;
      const stag = monResult.monitoring.anomalyDetected ? ' stag' : '';
      const writeTag = isWriteAction ? ' ✎WRITE' : '';
      console.log(`    [c${cycle + 1}] ${actionName}  conf=${conf.toFixed(2)}  tok=${tok}  readOnly=${consecutiveReadOnlyCycles}${stag}${writeTag}`);

      // Post-ACT partition monitors — handle per signal type
      // IMPORTANT: Do NOT set strategy='think' (extended thinking not wired); use 'plan'.
      // Do NOT restrict Write for stagnation (stagnation means agent isn't writing — restricting
      // Write would make it worse and conflicts with write-phase enforcer).
      const actContent = typeof (raResult.output as any).lastOutput === 'string'
        ? (raResult.output as any).lastOutput : '';
      const partMonitorCtx: PartitionMonitorContext = {
        cycleNumber: cycle,
        lastWriteCycle,
        actorOutput: actContent || undefined,
      };
      const partSignals = partitions.checkPartitions(partMonitorCtx);
      for (const sig of partSignals.filter(s => s.severity === 'critical' || s.severity === 'high')) {
        console.log(`    partition signal [${sig.severity}] ${sig.partition}: ${sig.type} — ${sig.detail}`);
        if (sig.type === 'constraint-violation') {
          // Genuine constraint violation: restrict write until resolved
          raControl.restrictedActions = ['Write'];
          raControl.forceReplan = true;
          raControl.strategy = 'plan';
        } else if (sig.type === 'stagnation') {
          // Stagnation: do NOT restrict Write — we want the agent to write!
          // The write-phase enforcer handles this more precisely.
          raControl.forceReplan = false; // let agent act freely
        }
        // goal-stale and capacity-warning: log but don't restrict actions
      }

      // Constraint check — reads from constraint partition (authoritative source)
      const pinnedEntries = partitions.getPartition('constraint').snapshot().filter((e: any) => e.pinned);
      if (pinnedEntries.length > 0 && actContent) {
        const violations = checkConstraintViolations(pinnedEntries, actContent);
        if (violations.length > 0) {
          for (const v of violations) {
            console.log(`    constraint violation: ${v.constraint.slice(0, 80)} | matched: ${v.violation}`);
          }
          raControl.restrictedActions = ['Write'];
          raControl.forceReplan = true;
          raControl.strategy = 'plan';
        }
      }

      // Clear stagnation-induced forceReplan after write to avoid blocking enforcer
      if (isWriteAction && raControl.forceReplan) {
        raControl.forceReplan = false;
        raControl.strategy = 'plan';
      }

      if (actionName === 'done') break;
    }

    const validation = task.validate(vfs.files);
    return {
      condition: 'partitioned-smart' as Condition,
      task: task.name,
      run: runNumber,
      success: validation.success,
      reason: validation.reason,
      tokensUsed: totalTokens,
      providerCalls,
      durationMs: Date.now() - startTime,
      toolCalls: allToolCalls,
      monitorInterventions,
      contextProfiles,
    };
  } catch (err) {
    return {
      condition: 'partitioned-smart' as Condition,
      task: task.name,
      run: runNumber,
      success: false,
      reason: `Error: ${err instanceof Error ? err.message : String(err)}`,
      tokensUsed: totalTokens,
      providerCalls,
      durationMs: Date.now() - startTime,
      toolCalls: allToolCalls,
      monitorInterventions,
      contextProfiles,
    };
  }
}

// ── Condition C: Monitor-Only SLM ──────────────────────────────

async function runMonitorOnly(
  task: TaskDefinition,
  runNumber: number,
  config: CognitiveConfig,
  monitorSlm: SLMInference,
): Promise<RunResult> {
  const startTime = Date.now();
  const vfs = new VirtualToolProvider(task.initialFiles);
  const metrics = createMetricsCollector();

  const llmProvider = anthropicProvider({
    model: 'claude-opus-4-20250514',
    maxOutputTokens: 2048,
    ...(extendedThinkingBudget > 0 ? { thinking: { budgetTokens: extendedThinkingBudget } } : {}),
  });
  const adapter = createProviderAdapter(llmProvider, {
    pactTemplate: { mode: { type: 'oneshot' }, budget: { maxOutputTokens: 2048 } },
  });

  const salienceContext: SalienceContext = {
    now: Date.now(),
    goals: ['complete the coding task', 'preserve functionality'],
    sourcePriorities: new Map([
      [moduleId('reasoner-actor'), 0.9],
      [moduleId('observer'), 0.6],
    ]),
  };
  const workspace = createWorkspace({ capacity: config.workspace.capacity }, salienceContext);

  // SLM Monitor + rule-based Observer + rule-based Evaluator
  const observer = createObserver(workspace.getWritePort(moduleId('observer')));
  const slmMonitor = createSLMMonitor({
    slm: monitorSlm,
    confidenceThreshold: 0.4,
    fallbackConfig: { confidenceThreshold: 0.3, stagnationThreshold: config.monitor.stagnationThreshold },
  });
  const evaluator = createEvaluator();
  const reasonerActor = createReasonerActor(
    adapter, vfs, workspace.getWritePort(moduleId('reasoner-actor')),
  );

  let totalTokens = 0;
  let providerCalls = 0;
  let monitorInterventions = 0;
  const allToolCalls: Array<{ tool: string; input: unknown; success: boolean }> = [];

  let observerState = observer.initialState();
  let monitorState = slmMonitor.initialState();
  let evaluatorState = evaluator.initialState();
  let raState = reasonerActor.initialState();
  let prevRAMonitoring: MonitoringSignal | null = null;

  const raControl: ReasonerActorControl = {
    target: moduleId('reasoner-actor'),
    timestamp: Date.now(),
    strategy: 'plan',
    effort: 'medium',
  };

  try {
    for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
      // 1. OBSERVE (cycle 0 only, rule-based)
      if (cycle === 0) {
        const obsResult = await observer.step(
          { content: task.description },
          observerState,
          { target: moduleId('observer'), timestamp: Date.now() } as any,
        );
        observerState = obsResult.state;
      }

      // 2. SLM MONITOR
      const monitorSignals: AggregatedSignals = new Map();
      if (prevRAMonitoring) {
        monitorSignals.set(moduleId('reasoner-actor'), prevRAMonitoring);
      }
      const monResult = await slmMonitor.step(
        monitorSignals, monitorState,
        { target: moduleId('monitor'), timestamp: Date.now() } as any,
      );
      monitorState = monResult.state;

      // Record SLM metrics
      if (slmMonitor.lastMetrics) {
        metrics.record({
          cycle,
          module: 'monitor',
          latencyMs: slmMonitor.lastMetrics.slmLatencyMs,
          confidence: slmMonitor.lastMetrics.slmConfidence,
          parseSuccess: slmMonitor.lastMetrics.slmParseSuccess,
          usedFallback: slmMonitor.lastMetrics.usedFallback,
          inputTokens: slmMonitor.lastMetrics.slmInputTokens,
          outputTokens: slmMonitor.lastMetrics.slmOutputTokens,
        });
      }

      // 3. EVALUATE (rule-based)
      const evalInput: EvaluatorInput = {
        workspace: workspace.getReadPort(moduleId('evaluator')).read(),
        signals: monitorSignals,
      };
      const evalResult = await evaluator.step(
        evalInput, evaluatorState,
        { target: moduleId('evaluator'), timestamp: Date.now(), evaluationHorizon: 'trajectory' },
      );
      evaluatorState = evalResult.state;

      // Apply monitor enforcement
      if (monResult.monitoring.anomalyDetected) {
        monitorInterventions++;
        raControl.restrictedActions = monResult.output.restrictedActions;
        raControl.forceReplan = monResult.output.forceReplan;
        if (monResult.output.forceReplan) raControl.strategy = 'think';
      }

      // 4. REASON+ACT
      const snapshot: ReadonlyWorkspaceSnapshot = workspace.getReadPort(moduleId('reasoner-actor')).read();
      const raResult = await reasonerActor.step({ snapshot }, raState, raControl);
      raState = raResult.state;
      prevRAMonitoring = raResult.monitoring;
      providerCalls++;
      totalTokens += (raResult.monitoring as any).tokensThisStep ?? 0;

      if (raResult.output.toolResult) {
        allToolCalls.push({
          tool: raResult.output.actionName,
          input: raResult.output.toolResult,
          success: (raResult.monitoring as any).success ?? true,
        });
      }

      const conf = (raResult.monitoring as any).confidence ?? 0;
      const tok = (raResult.monitoring as any).tokensThisStep ?? 0;
      const fb = slmMonitor.lastMetrics?.usedFallback ? ' fb' : ' slm';
      const stag = monResult.monitoring.anomalyDetected ? ' stag' : '';
      console.log(`    [c${cycle + 1}] ${raResult.output.actionName}  conf=${conf.toFixed(2)}  tok=${tok}  mon=${fb}${stag}`);

      // Post-ACT constraint verification (PRD 043)
      const pinnedEntries = workspace.getReadPort(moduleId('observer')).read().filter((e: any) => e.pinned);
      if (pinnedEntries.length > 0 && raResult?.output) {
        const actContent = typeof (raResult.output as any).lastOutput === 'string'
          ? (raResult.output as any).lastOutput : '';
        if (actContent) {
          const violations = checkConstraintViolations(pinnedEntries, actContent);
          if (violations.length > 0) {
            for (const v of violations) {
              console.log(`    constraint violation: ${v.constraint.slice(0, 80)} | matched: ${v.violation}`);
            }
            raControl.restrictedActions = ['Write'];
            raControl.forceReplan = true;
            raControl.strategy = 'think';
          }
        }
      }

      if (raResult.output.actionName === 'done') break;
    }

    const validation = task.validate(vfs.files);
    return {
      condition: 'monitor-only',
      task: task.name,
      run: runNumber,
      success: validation.success,
      reason: validation.reason,
      tokensUsed: totalTokens,
      providerCalls,
      durationMs: Date.now() - startTime,
      toolCalls: allToolCalls,
      monitorInterventions,
      slmMetrics: metrics.summarize(),
    };
  } catch (err) {
    return {
      condition: 'monitor-only',
      task: task.name,
      run: runNumber,
      success: false,
      reason: `Error: ${err instanceof Error ? err.message : String(err)}`,
      tokensUsed: totalTokens,
      providerCalls,
      durationMs: Date.now() - startTime,
      toolCalls: allToolCalls,
      monitorInterventions,
      slmMetrics: metrics.summarize(),
    };
  }
}

// ── Condition D: Full SLM Cognitive ─────────────────────────────

type ObserverMode = 'every-cycle' | 'cycle0';

async function runSlmCognitive(
  task: TaskDefinition,
  runNumber: number,
  config: CognitiveConfig,
  monitorSlm: SLMInference,
  observerSlm: SLMInference,
  evaluatorSlm: SLMInference,
  observerMode: ObserverMode = 'every-cycle',
): Promise<RunResult> {
  const startTime = Date.now();
  const vfs = new VirtualToolProvider(task.initialFiles);
  const metrics = createMetricsCollector();

  const llmProvider = anthropicProvider({
    model: 'claude-opus-4-20250514',
    maxOutputTokens: 2048,
    ...(extendedThinkingBudget > 0 ? { thinking: { budgetTokens: extendedThinkingBudget } } : {}),
  });
  const adapter = createProviderAdapter(llmProvider, {
    pactTemplate: { mode: { type: 'oneshot' }, budget: { maxOutputTokens: 2048 } },
  });

  const salienceContext: SalienceContext = {
    now: Date.now(),
    goals: ['complete the coding task', 'preserve functionality'],
    sourcePriorities: new Map([
      [moduleId('reasoner-actor'), 0.9],
      [moduleId('observer'), 0.6],
    ]),
  };
  const workspace = createWorkspace({ capacity: config.workspace.capacity }, salienceContext);

  // All three SLM modules
  const slmObserver = createSLMObserver({
    slm: observerSlm,
    confidenceThreshold: 0.4,
    writePort: workspace.getWritePort(moduleId('observer')),
  });
  const slmMonitor = createSLMMonitor({
    slm: monitorSlm,
    confidenceThreshold: 0.4,
    fallbackConfig: { confidenceThreshold: 0.3, stagnationThreshold: config.monitor.stagnationThreshold },
  });
  const slmEvaluator = createSLMEvaluator({
    slm: evaluatorSlm,
    confidenceThreshold: 0.4,
  });
  const reasonerActor = createReasonerActor(
    adapter, vfs, workspace.getWritePort(moduleId('reasoner-actor')),
  );

  let totalTokens = 0;
  let providerCalls = 0;
  let monitorInterventions = 0;
  const allToolCalls: Array<{ tool: string; input: unknown; success: boolean }> = [];
  const contextProfiles: ContextProfile[] = [];

  let observerState = slmObserver.initialState();
  let monitorState = slmMonitor.initialState();
  let evaluatorState = slmEvaluator.initialState();
  let raState = reasonerActor.initialState();
  let prevRAMonitoring: MonitoringSignal | null = null;
  let lastToolResultContent: string | null = null;

  const raControl: ReasonerActorControl = {
    target: moduleId('reasoner-actor'),
    timestamp: Date.now(),
    strategy: 'plan',
    effort: 'medium',
  };

  try {
    for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
      // 1. SLM OBSERVE — mode controls frequency
      //    every-cycle: fires every cycle (design doc section 2.3)
      //    cycle0: fires only at cycle 0 (matches baseline behavior)
      const shouldObserve = observerMode === 'every-cycle' || cycle === 0;

      if (shouldObserve) {
        const observerContent = cycle === 0
          ? task.description
          : (lastToolResultContent ?? 'No tool result from previous cycle.');

        const obsResult = await slmObserver.step(
          { content: observerContent },
          observerState,
          { target: moduleId('observer'), timestamp: Date.now() } as any,
        );
        observerState = obsResult.state;

        // Record observer SLM metrics
        if (slmObserver.lastMetrics) {
          metrics.record({
            cycle,
            module: 'observer',
            latencyMs: slmObserver.lastMetrics.slmLatencyMs,
            confidence: slmObserver.lastMetrics.slmConfidence,
            parseSuccess: slmObserver.lastMetrics.slmParseSuccess,
            usedFallback: slmObserver.lastMetrics.usedFallback,
            inputTokens: slmObserver.lastMetrics.slmInputTokens,
          outputTokens: slmObserver.lastMetrics.slmOutputTokens,
        });
      }
      } // end if (shouldObserve)

      // 2. SLM MONITOR
      const monitorSignals: AggregatedSignals = new Map();
      if (prevRAMonitoring) {
        monitorSignals.set(moduleId('reasoner-actor'), prevRAMonitoring);
      }
      const monResult = await slmMonitor.step(
        monitorSignals, monitorState,
        { target: moduleId('monitor'), timestamp: Date.now() } as any,
      );
      monitorState = monResult.state;

      // Record monitor SLM metrics
      if (slmMonitor.lastMetrics) {
        metrics.record({
          cycle,
          module: 'monitor',
          latencyMs: slmMonitor.lastMetrics.slmLatencyMs,
          confidence: slmMonitor.lastMetrics.slmConfidence,
          parseSuccess: slmMonitor.lastMetrics.slmParseSuccess,
          usedFallback: slmMonitor.lastMetrics.usedFallback,
          inputTokens: slmMonitor.lastMetrics.slmInputTokens,
          outputTokens: slmMonitor.lastMetrics.slmOutputTokens,
        });
      }

      // 3. SLM EVALUATE
      const evalInput: EvaluatorInput = {
        workspace: workspace.getReadPort(moduleId('evaluator')).read(),
        signals: monitorSignals,
      };
      const evalResult = await slmEvaluator.step(
        evalInput, evaluatorState,
        { target: moduleId('evaluator'), timestamp: Date.now(), evaluationHorizon: 'trajectory' },
      );
      evaluatorState = evalResult.state;

      // Record evaluator SLM metrics
      if (slmEvaluator.lastMetrics) {
        metrics.record({
          cycle,
          module: 'evaluator',
          latencyMs: slmEvaluator.lastMetrics.slmLatencyMs,
          confidence: slmEvaluator.lastMetrics.slmConfidence,
          parseSuccess: slmEvaluator.lastMetrics.slmParseSuccess,
          usedFallback: slmEvaluator.lastMetrics.usedFallback,
          inputTokens: slmEvaluator.lastMetrics.slmInputTokens,
          outputTokens: slmEvaluator.lastMetrics.slmOutputTokens,
        });
      }

      // 4. MERGE metacognitive reports into RA control
      const controlPatch = mergeMetacognitiveReports(
        monResult.output,
        slmEvaluator.lastReport ?? null,
      );
      raControl.restrictedActions = controlPatch.restrictedActions;
      raControl.forceReplan = controlPatch.forceReplan;
      raControl.strategy = controlPatch.strategy;

      if (monResult.monitoring.anomalyDetected || controlPatch.forceReplan) {
        monitorInterventions++;
      }

      // 5. REASON+ACT (frontier LLM)
      const snapshot: ReadonlyWorkspaceSnapshot = workspace.getReadPort(moduleId('reasoner-actor')).read();

      // Context profiling
      const contextProfile: ContextProfile = {
        cycle,
        totalEntries: snapshot.length,
        estimatedTokens: snapshot.reduce((sum, e) => sum + Math.ceil(String(e.content).length / 4), 0),
        pinnedEntries: snapshot.filter((e: any) => e.pinned).length,
        observerEntries: snapshot.filter((e: any) => String(e.source) === 'observer').length,
      };
      contextProfiles.push(contextProfile);

      const raResult = await reasonerActor.step({ snapshot }, raState, raControl);
      raState = raResult.state;
      prevRAMonitoring = raResult.monitoring;
      providerCalls++;
      totalTokens += (raResult.monitoring as any).tokensThisStep ?? 0;

      if (raResult.output.toolResult) {
        allToolCalls.push({
          tool: raResult.output.actionName,
          input: raResult.output.toolResult,
          success: (raResult.monitoring as any).success ?? true,
        });
        // Capture last tool result for next cycle's Observer input
        lastToolResultContent = typeof raResult.output.toolResult === 'object'
          ? JSON.stringify(raResult.output.toolResult)
          : String(raResult.output.toolResult);
      } else {
        lastToolResultContent = raResult.output.reasoning?.slice(0, 500) ?? null;
      }

      // Per-cycle trace
      const conf = (raResult.monitoring as any).confidence ?? 0;
      const tok = (raResult.monitoring as any).tokensThisStep ?? 0;
      const obsFb = slmObserver.lastMetrics?.usedFallback ? 'fb' : 'slm';
      const monFb = slmMonitor.lastMetrics?.usedFallback ? 'fb' : 'slm';
      const evalFb = slmEvaluator.lastMetrics?.usedFallback ? 'fb' : 'slm';
      const stag = monResult.monitoring.anomalyDetected ? ' stag' : '';
      console.log(`    [c${cycle + 1}] ${raResult.output.actionName}  conf=${conf.toFixed(2)}  tok=${tok}  ctx=${contextProfile.totalEntries}e/${contextProfile.estimatedTokens}tok  obs=${obsFb} mon=${monFb} eval=${evalFb}${stag}`);

      // Post-ACT constraint verification (PRD 043)
      const pinnedEntries = workspace.getReadPort(moduleId('observer')).read().filter((e: any) => e.pinned);
      if (pinnedEntries.length > 0 && raResult?.output) {
        const actContent = typeof (raResult.output as any).lastOutput === 'string'
          ? (raResult.output as any).lastOutput : '';
        if (actContent) {
          const violations = checkConstraintViolations(pinnedEntries, actContent);
          if (violations.length > 0) {
            for (const v of violations) {
              console.log(`    constraint violation: ${v.constraint.slice(0, 80)} | matched: ${v.violation}`);
            }
            raControl.restrictedActions = ['Write'];
            raControl.forceReplan = true;
            raControl.strategy = 'think';
          }
        }
      }

      if (raResult.output.actionName === 'done') break;
    }

    const validation = task.validate(vfs.files);
    return {
      condition: 'slm-cognitive',
      task: task.name,
      run: runNumber,
      success: validation.success,
      reason: validation.reason,
      tokensUsed: totalTokens,
      providerCalls,
      durationMs: Date.now() - startTime,
      toolCalls: allToolCalls,
      monitorInterventions,
      slmMetrics: metrics.summarize(),
      contextProfiles,
    };
  } catch (err) {
    return {
      condition: 'slm-cognitive',
      task: task.name,
      run: runNumber,
      success: false,
      reason: `Error: ${err instanceof Error ? err.message : String(err)}`,
      tokensUsed: totalTokens,
      providerCalls,
      durationMs: Date.now() - startTime,
      toolCalls: allToolCalls,
      monitorInterventions,
      slmMetrics: metrics.summarize(),
      contextProfiles,
    };
  }
}

// ── Condition F: SLM Partitioned ────────────────────────────────

async function runSlmPartitioned(
  task: TaskDefinition,
  runNumber: number,
  config: CognitiveConfig,
  monitorSlm: SLMInference,
  observerSlm: SLMInference,
  evaluatorSlm: SLMInference,
  observerMode: ObserverMode = 'cycle0',
): Promise<RunResult> {
  const startTime = Date.now();
  const vfs = new VirtualToolProvider(task.initialFiles);
  const metrics = createMetricsCollector();

  const llmProvider = anthropicProvider({
    model: 'claude-opus-4-20250514',
    maxOutputTokens: 2048,
    ...(extendedThinkingBudget > 0 ? { thinking: { budgetTokens: extendedThinkingBudget } } : {}),
  });
  const adapter = createProviderAdapter(llmProvider, {
    pactTemplate: { mode: { type: 'oneshot' }, budget: { maxOutputTokens: 2048 } },
  });

  const salienceContext: SalienceContext = {
    now: Date.now(),
    goals: ['complete the coding task', 'preserve functionality'],
    sourcePriorities: new Map([
      [moduleId('reasoner-actor'), 0.9],
      [moduleId('observer'), 0.6],
    ]),
  };

  // Monolithic workspace — SLM modules write here via their write ports
  const workspace = createWorkspace({ capacity: config.workspace.capacity }, salienceContext);

  // Partition system — entries are dual-written here for partitioned context reads
  const partitions = createPartitionSystem({
    constraintCapacity: 10,
    operationalCapacity: 12,
    taskCapacity: 6,
  });

  // SLM modules
  const slmObserver = createSLMObserver({
    slm: observerSlm,
    confidenceThreshold: 0.4,
    writePort: workspace.getWritePort(moduleId('observer')),
  });
  const slmMonitor = createSLMMonitor({
    slm: monitorSlm,
    confidenceThreshold: 0.4,
    fallbackConfig: { confidenceThreshold: 0.3, stagnationThreshold: config.monitor.stagnationThreshold },
  });
  const slmEvaluator = createSLMEvaluator({
    slm: evaluatorSlm,
    confidenceThreshold: 0.4,
  });
  const reasonerActor = createReasonerActor(
    adapter, vfs, workspace.getWritePort(moduleId('reasoner-actor')),
  );

  let totalTokens = 0;
  let providerCalls = 0;
  let monitorInterventions = 0;
  const allToolCalls: Array<{ tool: string; input: unknown; success: boolean }> = [];
  const contextProfiles: PartitionedContextProfile[] = [];
  let lastToolResultContent: string | null = null;

  // Track last write cycle per partition for monitor context
  const lastWriteCycle = new Map<PartitionId, number>([
    ['constraint', 0],
    ['operational', 0],
    ['task', 0],
  ]);

  let observerState = slmObserver.initialState();
  let monitorState = slmMonitor.initialState();
  let evaluatorState = slmEvaluator.initialState();
  let raState = reasonerActor.initialState();
  let prevRAMonitoring: MonitoringSignal | null = null;

  const raControl: ReasonerActorControl = {
    target: moduleId('reasoner-actor'),
    timestamp: Date.now(),
    strategy: 'plan',
    effort: 'medium',
  };

  // Selector for the reasoner-actor: reads task + constraint + operational partitions
  const reasonerSelector: ContextSelector = {
    sources: ['task', 'constraint', 'operational'] as PartitionId[],
    budget: 8192,
    strategy: 'salience',
  };

  try {
    for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
      partitions.resetCycleQuotas();

      // 1. SLM OBSERVE — mode controls frequency
      const shouldObserve = observerMode === 'every-cycle' || cycle === 0;
      if (shouldObserve) {
        const observerContent = cycle === 0
          ? task.description
          : (lastToolResultContent ?? 'No tool result from previous cycle.');
        const obsResult = await slmObserver.step(
          { content: observerContent },
          observerState,
          { target: moduleId('observer'), timestamp: Date.now() } as any,
        );
        observerState = obsResult.state;

        if (slmObserver.lastMetrics) {
          metrics.record({
            cycle,
            module: 'observer',
            latencyMs: slmObserver.lastMetrics.slmLatencyMs,
            confidence: slmObserver.lastMetrics.slmConfidence,
            parseSuccess: slmObserver.lastMetrics.slmParseSuccess,
            usedFallback: slmObserver.lastMetrics.usedFallback,
            inputTokens: slmObserver.lastMetrics.slmInputTokens,
            outputTokens: slmObserver.lastMetrics.slmOutputTokens,
          });
        }

        // Dual-write: replicate observer entries into partition system
        const observerEntries = workspace.getReadPort(moduleId('observer')).read();
        for (const entry of observerEntries) {
          const writtenTo = partitions.write(entry, moduleId('observer'));
          lastWriteCycle.set(writtenTo, cycle);
        }
      }

      // 2. SLM MONITOR
      const monitorSignals: AggregatedSignals = new Map();
      if (prevRAMonitoring) {
        monitorSignals.set(moduleId('reasoner-actor'), prevRAMonitoring);
      }
      const monResult = await slmMonitor.step(
        monitorSignals, monitorState,
        { target: moduleId('monitor'), timestamp: Date.now() } as any,
      );
      monitorState = monResult.state;

      if (slmMonitor.lastMetrics) {
        metrics.record({
          cycle,
          module: 'monitor',
          latencyMs: slmMonitor.lastMetrics.slmLatencyMs,
          confidence: slmMonitor.lastMetrics.slmConfidence,
          parseSuccess: slmMonitor.lastMetrics.slmParseSuccess,
          usedFallback: slmMonitor.lastMetrics.usedFallback,
          inputTokens: slmMonitor.lastMetrics.slmInputTokens,
          outputTokens: slmMonitor.lastMetrics.slmOutputTokens,
        });
      }

      // 3. SLM EVALUATE
      const evalInput: EvaluatorInput = {
        workspace: workspace.getReadPort(moduleId('evaluator')).read(),
        signals: monitorSignals,
      };
      const evalResult = await slmEvaluator.step(
        evalInput, evaluatorState,
        { target: moduleId('evaluator'), timestamp: Date.now(), evaluationHorizon: 'trajectory' },
      );
      evaluatorState = evalResult.state;

      if (slmEvaluator.lastMetrics) {
        metrics.record({
          cycle,
          module: 'evaluator',
          latencyMs: slmEvaluator.lastMetrics.slmLatencyMs,
          confidence: slmEvaluator.lastMetrics.slmConfidence,
          parseSuccess: slmEvaluator.lastMetrics.slmParseSuccess,
          usedFallback: slmEvaluator.lastMetrics.usedFallback,
          inputTokens: slmEvaluator.lastMetrics.slmInputTokens,
          outputTokens: slmEvaluator.lastMetrics.slmOutputTokens,
        });
      }

      // 4. MERGE metacognitive reports into RA control
      const controlPatch = mergeMetacognitiveReports(
        monResult.output,
        slmEvaluator.lastReport ?? null,
      );
      raControl.restrictedActions = controlPatch.restrictedActions;
      raControl.forceReplan = controlPatch.forceReplan;
      raControl.strategy = controlPatch.strategy;

      if (monResult.monitoring.anomalyDetected || controlPatch.forceReplan) {
        monitorInterventions++;
      }

      // 5. REASON+ACT — context comes from partitioned system
      // Monolithic context (for comparison profiling)
      const monoSnapshot = workspace.getReadPort(moduleId('reasoner-actor')).read();
      const monoTokens = monoSnapshot.reduce((sum, e) => sum + Math.ceil(String(e.content).length / 4), 0);

      // Partitioned context (what the agent actually sees)
      const partSnapshot = partitions.buildContext(reasonerSelector);
      const partTokens = partSnapshot.reduce((sum, e) => sum + Math.ceil(String(e.content).length / 4), 0);

      const reduction = monoTokens > 0 ? Math.round((1 - partTokens / monoTokens) * 100) : 0;
      console.log(`    [c${cycle + 1}] context: mono=${monoSnapshot.length}e/${monoTokens}tok → part=${partSnapshot.length}e/${partTokens}tok (${reduction}% reduction)`);

      // Per-partition breakdown
      const perPartition: Record<string, { entries: number; tokens: number }> = {};
      for (const pid of ['constraint', 'operational', 'task'] as PartitionId[]) {
        const pEntries = partitions.getPartition(pid).snapshot();
        perPartition[pid] = {
          entries: pEntries.length,
          tokens: pEntries.reduce((sum, e) => sum + Math.ceil(String(e.content).length / 4), 0),
        };
      }

      // Per-module breakdown from monolithic workspace (for profiling)
      const perModule: Record<string, { entries: number; tokens: number }> = {};
      for (const entry of monoSnapshot) {
        const src = String((entry as any).source ?? 'unknown');
        if (!perModule[src]) perModule[src] = { entries: 0, tokens: 0 };
        perModule[src].entries++;
        perModule[src].tokens += Math.ceil(String(entry.content).length / 4);
      }

      const contextProfile: PartitionedContextProfile = {
        cycle,
        totalEntries: partSnapshot.length,
        estimatedTokens: partTokens,
        pinnedEntries: partSnapshot.filter((e: any) => e.pinned).length,
        observerEntries: partSnapshot.filter((e: any) => String(e.source) === 'observer').length,
        perPartition,
        perModule,
      };
      contextProfiles.push(contextProfile);

      // Feed partitioned context to reasoner-actor
      const snapshot: ReadonlyWorkspaceSnapshot = partSnapshot;
      const raResult = await reasonerActor.step({ snapshot }, raState, raControl);
      raState = raResult.state;
      prevRAMonitoring = raResult.monitoring;
      providerCalls++;
      totalTokens += (raResult.monitoring as any).tokensThisStep ?? 0;

      if (raResult.output.toolResult) {
        allToolCalls.push({
          tool: raResult.output.actionName,
          input: raResult.output.toolResult,
          success: (raResult.monitoring as any).success ?? true,
        });

        // Dual-write: replicate RA tool result into partition system as operational entry
        const toolContent = typeof raResult.output.toolResult === 'object'
          ? JSON.stringify(raResult.output.toolResult)
          : String(raResult.output.toolResult);
        partitions.write(
          {
            content: `[${raResult.output.actionName}] ${toolContent.slice(0, 500)}`,
            timestamp: Date.now(),
            source: moduleId('reasoner-actor'),
            contentType: 'tool-result',
          } as any,
          moduleId('reasoner-actor'),
        );
        lastWriteCycle.set('operational', cycle);

        // Capture last tool result for next cycle's Observer input
        lastToolResultContent = toolContent;
      } else {
        lastToolResultContent = (raResult.output as any).reasoning?.slice(0, 500) ?? null;
      }

      // Per-cycle trace
      const conf = (raResult.monitoring as any).confidence ?? 0;
      const tok = (raResult.monitoring as any).tokensThisStep ?? 0;
      const obsFb = slmObserver.lastMetrics?.usedFallback ? 'fb' : 'slm';
      const monFb = slmMonitor.lastMetrics?.usedFallback ? 'fb' : 'slm';
      const evalFb = slmEvaluator.lastMetrics?.usedFallback ? 'fb' : 'slm';
      const stag = monResult.monitoring.anomalyDetected ? ' stag' : '';
      console.log(`    [c${cycle + 1}] ${raResult.output.actionName}  conf=${conf.toFixed(2)}  tok=${tok}  ctx=${contextProfile.totalEntries}e/${contextProfile.estimatedTokens}tok  obs=${obsFb} mon=${monFb} eval=${evalFb}${stag}`);

      // Post-ACT constraint verification (PRD 044) — via partition monitors
      const actContent = typeof (raResult.output as any).lastOutput === 'string'
        ? (raResult.output as any).lastOutput : '';
      const partMonitorCtx: PartitionMonitorContext = {
        cycleNumber: cycle,
        lastWriteCycle,
        actorOutput: actContent || undefined,
      };
      const partSignals = partitions.checkPartitions(partMonitorCtx);
      const criticalSignals = partSignals.filter(s => s.severity === 'critical' || s.severity === 'high');
      if (criticalSignals.length > 0) {
        for (const sig of criticalSignals) {
          console.log(`    partition signal [${sig.severity}] ${sig.partition}: ${sig.type} — ${sig.detail}`);
        }
        raControl.restrictedActions = ['Write'];
        raControl.forceReplan = true;
        raControl.strategy = 'think';
      }

      // Constraint check — reads from constraint partition (authoritative source)
      const pinnedEntries = partitions.getPartition('constraint').snapshot().filter((e: any) => e.pinned);
      if (pinnedEntries.length > 0 && raResult?.output && actContent) {
        const violations = checkConstraintViolations(pinnedEntries, actContent);
        if (violations.length > 0) {
          for (const v of violations) {
            console.log(`    constraint violation: ${v.constraint.slice(0, 80)} | matched: ${v.violation}`);
          }
          raControl.restrictedActions = ['Write'];
          raControl.forceReplan = true;
          raControl.strategy = 'think';
        }
      }

      if (raResult.output.actionName === 'done') break;
    }

    const validation = task.validate(vfs.files);
    return {
      condition: 'slm-partitioned',
      task: task.name,
      run: runNumber,
      success: validation.success,
      reason: validation.reason,
      tokensUsed: totalTokens,
      providerCalls,
      durationMs: Date.now() - startTime,
      toolCalls: allToolCalls,
      monitorInterventions,
      slmMetrics: metrics.summarize(),
      contextProfiles,
    };
  } catch (err) {
    return {
      condition: 'slm-partitioned',
      task: task.name,
      run: runNumber,
      success: false,
      reason: `Error: ${err instanceof Error ? err.message : String(err)}`,
      tokensUsed: totalTokens,
      providerCalls,
      durationMs: Date.now() - startTime,
      toolCalls: allToolCalls,
      monitorInterventions,
      slmMetrics: metrics.summarize(),
      contextProfiles,
    };
  }
}

// ── Report ──────────────────────────────────────────────────────

function printResult(r: RunResult) {
  const status = r.success ? 'PASS' : 'FAIL';
  console.log(`  [${status}] ${r.condition} run ${r.run}: ${r.reason}`);
  console.log(`    tokens: ${r.tokensUsed}, provider calls: ${r.providerCalls}, duration: ${(r.durationMs / 1000).toFixed(1)}s`);
  if (r.toolCalls.length > 0) {
    console.log(`    tool calls: ${r.toolCalls.length} (${r.toolCalls.map(t => t.tool).join(' -> ')})`);
  }
  if (r.monitorInterventions !== undefined) {
    console.log(`    monitor interventions: ${r.monitorInterventions}`);
  }
  if (r.slmMetrics) {
    const m = r.slmMetrics;
    console.log(`    slm: ${m.totalSlmCalls} calls, ${m.totalFallbacks} fallbacks (${(m.fallbackRate * 100).toFixed(0)}%), avg latency: ${m.avgLatencyMs.toFixed(0)}ms`);
  }
  if (r.contextProfiles && r.contextProfiles.length > 0) {
    const cp = r.contextProfiles;
    const avgEntries = Math.round(cp.reduce((s, p) => s + p.totalEntries, 0) / cp.length);
    const avgTokens = Math.round(cp.reduce((s, p) => s + p.estimatedTokens, 0) / cp.length);
    const peakEntries = Math.max(...cp.map(p => p.totalEntries));
    const peakTokens = Math.max(...cp.map(p => p.estimatedTokens));
    const totalObserver = cp.reduce((s, p) => s + p.observerEntries, 0);
    const totalAll = cp.reduce((s, p) => s + p.totalEntries, 0);
    const observerPct = totalAll > 0 ? Math.round(totalObserver / totalAll * 100) : 0;
    console.log(`    context: avg=${avgEntries} entries (${avgTokens}tok), peak=${peakEntries} entries (${peakTokens}tok), observer_pct=${observerPct}%`);
  }
}

function printComparison(results: RunResult[]) {
  const conditions: Condition[] = ['flat', 'rule-cognitive', 'partitioned-cognitive', 'partitioned-smart', 'monitor-only', 'slm-cognitive'];

  console.log('\n--- Comparison ---');
  console.log(`${'Condition'.padEnd(20)} ${'Pass'.padEnd(8)} ${'Avg Tok'.padEnd(10)} ${'Avg Dur'.padEnd(10)} ${'Fallback%'.padEnd(10)}`);
  console.log('-'.repeat(58));

  for (const cond of conditions) {
    const rs = results.filter(r => r.condition === cond);
    if (rs.length === 0) continue;

    const passes = rs.filter(r => r.success).length;
    const avgTokens = Math.round(rs.reduce((s, r) => s + r.tokensUsed, 0) / rs.length);
    const avgDuration = (rs.reduce((s, r) => s + r.durationMs, 0) / rs.length / 1000).toFixed(1);

    // Aggregate fallback rate across SLM runs
    const slmRuns = rs.filter(r => r.slmMetrics);
    const fallbackRate = slmRuns.length > 0
      ? (slmRuns.reduce((s, r) => s + (r.slmMetrics?.fallbackRate ?? 0), 0) / slmRuns.length * 100).toFixed(0)
      : 'n/a';

    console.log(`${cond.padEnd(20)} ${`${passes}/${rs.length}`.padEnd(8)} ${String(avgTokens).padEnd(10)} ${`${avgDuration}s`.padEnd(10)} ${`${fallbackRate}%`.padEnd(10)}`);
  }

  // Per-task breakdown
  const taskNames = [...new Set(results.map(r => r.task))];
  if (taskNames.length > 1) {
    console.log('\n--- Per-Task Breakdown ---');
    for (const taskName of taskNames) {
      console.log(`\n  ${taskName}:`);
      for (const cond of conditions) {
        const rs = results.filter(r => r.condition === cond && r.task === taskName);
        if (rs.length === 0) continue;
        const passes = rs.filter(r => r.success).length;
        console.log(`    ${cond}: ${passes}/${rs.length} PASS`);
      }
    }
  }
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Parse condition
  const condArg = args.find(a => a.startsWith('--condition='))?.split('=')[1];
  const runConditions = new Set<Condition>(
    condArg
      ? [condArg as Condition]
      : ['flat', 'rule-cognitive', 'partitioned-cognitive', 'monitor-only', 'slm-cognitive'],
  );

  // Parse task
  const taskArg = args.find(a => a.startsWith('--task='))?.split('=')[1] ?? 'all';
  const selectedTasks = taskArg === 'all'
    ? TASKS
    : [TASKS[parseInt(taskArg, 10) - 1]].filter(Boolean);

  if (selectedTasks.length === 0) {
    console.error(`ERROR: Unknown task "${taskArg}". Use --task=1..5 or --task=all`);
    process.exit(1);
  }

  // Parse runs
  const numRuns = parseInt(args.find(a => a.startsWith('--runs='))?.split('=')[1] ?? '3', 10) || 3;

  // Parse max cycles
  MAX_CYCLES = parseInt(args.find(a => a.startsWith('--max-cycles='))?.split('=')[1] ?? '15', 10) || 15;

  // Parse config
  const configName = args.find(a => a.startsWith('--config='))?.split('=')[1] ?? 'baseline';
  const cognitiveConfig = CONFIGS[configName];
  if (!cognitiveConfig) {
    console.error(`Unknown config: ${configName}. Available: ${Object.keys(CONFIGS).join(', ')}`);
    process.exit(1);
  }

  // Parse observer mode — cycle0 is default (R-15 ablation showed every-cycle hurts search tasks)
  const observerMode: ObserverMode = (args.find(a => a.startsWith('--observer-mode='))?.split('=')[1] ?? 'cycle0') as ObserverMode;

  // Parse extended thinking budget
  extendedThinkingBudget = parseInt(
    args.find(a => a.startsWith('--extended-thinking='))?.split('=')[1] ?? '0', 10,
  ) || 0;

  // Parse SLM server URLs
  const monitorUrl = args.find(a => a.startsWith('--monitor-url='))?.split('=')[1] ?? 'http://localhost:8100';
  const observerUrl = args.find(a => a.startsWith('--observer-url='))?.split('=')[1] ?? 'http://localhost:8101';
  const evaluatorUrl = args.find(a => a.startsWith('--evaluator-url='))?.split('=')[1] ?? 'http://localhost:8102';

  // Check API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ERROR: ANTHROPIC_API_KEY not set. Configure .env');
    process.exit(1);
  }

  const needsSlm = runConditions.has('slm-cognitive') || runConditions.has('monitor-only') || runConditions.has('slm-partitioned');

  console.log('\n=== Phase 5: SLM Cognitive Cycle Experiment ===');
  console.log(`    Conditions: ${[...runConditions].join(', ')}`);
  console.log(`    Config: ${cognitiveConfig.name}`);
  console.log(`    Tasks: ${selectedTasks.map(t => t.name).join(', ')}`);
  console.log(`    Runs per condition per task: ${numRuns}`);
  if (observerMode !== 'every-cycle') console.log(`    Observer mode: ${observerMode}`);
  if (extendedThinkingBudget > 0) {
    console.log(`    Extended thinking: ${extendedThinkingBudget} budget tokens`);
  }
  if (needsSlm) {
    console.log(`    Monitor SLM: ${monitorUrl}`);
    if (runConditions.has('slm-cognitive') || runConditions.has('slm-partitioned')) {
      console.log(`    Observer SLM: ${observerUrl}`);
      console.log(`    Evaluator SLM: ${evaluatorUrl}`);
    }
  }
  console.log('');

  // Create SLM inference clients and verify health
  let monitorSlm: SLMInference | null = null;
  let observerSlm: SLMInference | null = null;
  let evaluatorSlm: SLMInference | null = null;

  // CPU-only ONNX inference takes ~3-6s per call for 0.5B models; generous timeout
  const slmTimeoutMs = 15000;

  if (needsSlm) {
    monitorSlm = createHttpSLMInference({ modelId: 'monitor-slm', serverUrl: monitorUrl, timeoutMs: slmTimeoutMs });
    try {
      await monitorSlm.init();
      console.log('    Monitor SLM: healthy');
    } catch (err) {
      console.error(`ERROR: Monitor SLM not reachable at ${monitorUrl}: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    if (runConditions.has('slm-cognitive') || runConditions.has('slm-partitioned')) {
      observerSlm = createHttpSLMInference({ modelId: 'observer-slm', serverUrl: observerUrl, timeoutMs: slmTimeoutMs });
      evaluatorSlm = createHttpSLMInference({ modelId: 'evaluator-slm', serverUrl: evaluatorUrl, timeoutMs: slmTimeoutMs });

      try {
        await observerSlm.init();
        console.log('    Observer SLM: healthy');
      } catch (err) {
        console.error(`ERROR: Observer SLM not reachable at ${observerUrl}: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }

      try {
        await evaluatorSlm.init();
        console.log('    Evaluator SLM: healthy');
      } catch (err) {
        console.error(`ERROR: Evaluator SLM not reachable at ${evaluatorUrl}: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    }
    console.log('');
  }

  // Run experiments
  const results: RunResult[] = [];

  for (const task of selectedTasks) {
    console.log(`\n--- Task: ${task.name} ---\n`);

    if (runConditions.has('flat')) {
      console.log('Condition: flat');
      for (let i = 1; i <= numRuns; i++) {
        const r = await runFlat(task, i);
        printResult(r);
        results.push(r);
      }
    }

    if (runConditions.has('rule-cognitive')) {
      console.log('\nCondition: rule-cognitive');
      for (let i = 1; i <= numRuns; i++) {
        const r = await runRuleCognitive(task, i, cognitiveConfig);
        printResult(r);
        results.push(r);
      }
    }

    if (runConditions.has('partitioned-cognitive')) {
      console.log('\nCondition: partitioned-cognitive');
      for (let i = 1; i <= numRuns; i++) {
        const r = await runPartitionedCognitive(task, i, cognitiveConfig);
        printResult(r);
        results.push(r);
      }
    }

    if (runConditions.has('monitor-only') && monitorSlm) {
      console.log('\nCondition: monitor-only');
      for (let i = 1; i <= numRuns; i++) {
        const r = await runMonitorOnly(task, i, cognitiveConfig, monitorSlm);
        printResult(r);
        results.push(r);
      }
    }

    if (runConditions.has('slm-cognitive') && monitorSlm && observerSlm && evaluatorSlm) {
      console.log('\nCondition: slm-cognitive');
      for (let i = 1; i <= numRuns; i++) {
        const r = await runSlmCognitive(task, i, cognitiveConfig, monitorSlm, observerSlm, evaluatorSlm, observerMode);
        printResult(r);
        results.push(r);
      }
    }

    if (runConditions.has('slm-partitioned') && monitorSlm && observerSlm && evaluatorSlm) {
      console.log('\nCondition: slm-partitioned');
      for (let i = 1; i <= numRuns; i++) {
        const r = await runSlmPartitioned(task, i, cognitiveConfig, monitorSlm, observerSlm, evaluatorSlm, observerMode);
        printResult(r);
        results.push(r);
      }
    }

    if (runConditions.has('partitioned-smart')) {
      console.log('\nCondition: partitioned-smart');
      for (let i = 1; i <= numRuns; i++) {
        const r = await runPartitionedSmart(task, i, cognitiveConfig);
        printResult(r);
        results.push(r);
      }
    }
  }

  // Print comparison
  if (results.length > 1) {
    printComparison(results);
  }

  // Write results to JSON
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const resultsDir = resolve(import.meta.dirname ?? '.', 'results');
  await mkdir(resultsDir, { recursive: true });
  const resultsPath = resolve(resultsDir, `slm-cycle-${timestamp}.json`);

  const outputData = {
    timestamp: new Date().toISOString(),
    config: cognitiveConfig.name,
    conditions: [...runConditions],
    tasks: selectedTasks.map(t => t.name),
    runsPerCondition: numRuns,
    results,
    summary: {
      byCondition: Object.fromEntries(
        [...runConditions].map(cond => {
          const rs = results.filter(r => r.condition === cond);
          return [cond, {
            total: rs.length,
            passes: rs.filter(r => r.success).length,
            avgTokens: rs.length > 0 ? Math.round(rs.reduce((s, r) => s + r.tokensUsed, 0) / rs.length) : 0,
            avgDurationMs: rs.length > 0 ? Math.round(rs.reduce((s, r) => s + r.durationMs, 0) / rs.length) : 0,
            avgFallbackRate: rs.filter(r => r.slmMetrics).length > 0
              ? rs.filter(r => r.slmMetrics).reduce((s, r) => s + (r.slmMetrics?.fallbackRate ?? 0), 0) / rs.filter(r => r.slmMetrics).length
              : null,
          }];
        }),
      ),
    },
  };

  await writeFile(resultsPath, JSON.stringify(outputData, null, 2), 'utf8');
  console.log(`\nResults written to ${resultsPath}`);

  // Cleanup SLM clients
  if (monitorSlm) await monitorSlm.dispose();
  if (observerSlm) await observerSlm.dispose();
  if (evaluatorSlm) await evaluatorSlm.dispose();

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
