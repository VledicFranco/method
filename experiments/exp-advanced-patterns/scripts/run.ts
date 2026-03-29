/**
 * EXP-027 Runner — Advanced Cognitive Patterns Impact on Task Success
 *
 * Five conditions:
 *   A (control):   Base 8-module cognitive cycle, no advanced patterns
 *   B (reflector): Base + reflector-v2 (P6) + thought patterns (P5)
 *   C (affect):    Base + affect module (P3)
 *   D (conflict):  Base + meta-composer (P2) + conflict-resolver (P1)
 *   E (combined):  All Tier 1-2 patterns (P1-P6) active
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... npx tsx experiments/exp-advanced-patterns/scripts/run.ts [options]
 *
 * Options:
 *   --condition=A|B|C|D|E|all   Which condition(s) to run (default: all)
 *   --task=1..8|all             Which task(s) to run (default: all)
 *   --runs=N                    Runs per condition per task (default: 1)
 *   --pilot                     Pilot mode: N=2, T01 only, conditions A+E
 *   --dry-run                   Print execution plan without running
 *   --output-dir=path           Custom output directory (default: ../results)
 */

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// ── .env Loading ──────────────────────────────────────────────

try {
  const candidates = [
    resolve(import.meta.dirname ?? '.', '../../../.env'),
    resolve(process.cwd(), '.env'),
  ];
  let envContent = '';
  for (const p of candidates) {
    try { envContent = readFileSync(p, 'utf8'); break; } catch { continue; }
  }
  if (envContent) {
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
  }
} catch { /* .env not found */ }

// ── Imports ───────────────────────────────────────────────────

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
import { createMemoryModuleV2, type MemoryV2Control } from '../../../packages/pacta/src/cognitive/modules/memory-module-v2.js';
import { InMemoryMemory } from '../../../packages/pacta/src/ports/memory-impl.js';
import type { MemoryPortV2 } from '../../../packages/pacta/src/ports/memory-port.js';

// PRD 032 pattern imports
import { createReflectorV2 } from '../../../packages/pacta/src/cognitive/modules/reflector-v2.js';
import { seedPatterns, formatPatternForWorkspace } from '../../../packages/pacta/src/config/thought-patterns.js';
import { classifyTask, gatherTaskSignals } from '../../../packages/pacta/src/cognitive/modules/meta-composer.js';
import { selectPersona, formatPersonaPrompt } from '../../../packages/pacta/src/config/personas.js';
import { computeAffect, type AffectInput } from '../../../packages/pacta/src/cognitive/modules/affect-module.js';

// Strategy configs (reuse from exp-cognitive-baseline)
import { CONFIGS, describeConfig, type CognitiveConfig } from '../../exp-cognitive-baseline/strategies.js';

// Tasks — existing tasks from exp-cognitive-baseline
import { TASK_01 } from '../../exp-cognitive-baseline/task-01-circular-dep.js';
import { TASK_02 } from '../../exp-cognitive-baseline/task-02-test-first-bug.js';
import { TASK_03 } from '../../exp-cognitive-baseline/task-03-config-migration.js';
import { TASK_04 } from '../../exp-cognitive-baseline/task-04-api-versioning.js';
import { TASK_05 } from '../../exp-cognitive-baseline/task-05-dead-code-removal.js';

// New pattern-specific tasks
import { TASK_06, TASK_07, TASK_08_PHASE1, TASK_08_PHASE2 } from './task-suite.js';

// ── Types ─────────────────────────────────────────────────────

interface TaskDefinition {
  name: string;
  baseDescription: string;
  description: string;
  initialFiles: Record<string, string>;
  validate(files: ReadonlyMap<string, string>): { success: boolean; reason: string };
}

type ConditionName = 'A' | 'B' | 'C' | 'D' | 'E';

interface PatternFlags {
  reflect: boolean;   // P6
  patterns: boolean;  // P5
  adaptive: boolean;  // P2
  personas: boolean;  // P4
  affect: boolean;    // P3
}

interface RunResult {
  condition: ConditionName;
  task: string;
  run: number;
  success: boolean;
  reason: string;
  tokensUsed: number;
  providerCalls: number;
  durationMs: number;
  cycles: number;
  toolCalls: Array<{ tool: string; input: unknown; success: boolean }>;
  monitorInterventions: number;
  affectSignals: Array<{ cycle: number; label: string; valence: number; arousal: number }>;
  conflictResolutions: Array<{ resolution: string; cycle: number }>;
  reflectionLessons: number;
  memoryRetrievals: number;
  configUsed: string;
}

// ── All Tasks ─────────────────────────────────────────────────

const ALL_TASKS: TaskDefinition[] = [
  TASK_01, TASK_02, TASK_03, TASK_04, TASK_05,
  TASK_06, TASK_07,
  // T08 is special (two-phase) — handled separately
];

// ── Condition → Pattern Flag Mapping ──────────────────────────

const CONDITION_FLAGS: Record<ConditionName, PatternFlags> = {
  A: { reflect: false, patterns: false, adaptive: false, personas: false, affect: false },
  B: { reflect: true,  patterns: true,  adaptive: false, personas: false, affect: false },
  C: { reflect: false, patterns: false, adaptive: false, personas: false, affect: true  },
  D: { reflect: false, patterns: false, adaptive: true,  personas: false, affect: false },
  E: { reflect: true,  patterns: true,  adaptive: true,  personas: true,  affect: true  },
};

const CONDITION_CONFIGS: Record<ConditionName, string> = {
  A: 'baseline',
  B: 'baseline',
  C: 'baseline',
  D: 'v2-full',
  E: 'v2-full',
};

const CONDITION_MEMORY: Record<ConditionName, boolean> = {
  A: false,
  B: true,
  C: false,
  D: true,
  E: true,
};

// ── Run Single Task ───────────────────────────────────────────

async function runTask(
  task: TaskDefinition,
  condition: ConditionName,
  runNumber: number,
  config: CognitiveConfig,
  flags: PatternFlags,
  sharedMemoryPort?: MemoryPortV2,
  maxCycles: number = 15,
): Promise<RunResult> {
  const startTime = Date.now();
  const vfs = new VirtualToolProvider(task.initialFiles);

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
    goals: ['complete task', 'fix issues'],
    sourcePriorities: new Map([
      [moduleId('reasoner-actor'), 0.9],
      [moduleId('observer'), 0.6],
    ]),
  };
  const workspace = createWorkspace({ capacity: config.workspace.capacity }, salienceContext);

  const foldedContext: string[] = [];

  // Modules
  const observer = createObserver(workspace.getWritePort(moduleId('observer')));
  const reasonerActor = createReasonerActor(
    adapter, vfs, workspace.getWritePort(moduleId('reasoner-actor')),
  );
  const monitor = createMonitor({ confidenceThreshold: 0.3, stagnationThreshold: 2 });

  // Memory
  const memoryPort = sharedMemoryPort ?? new InMemoryMemory();
  const useMemory = CONDITION_MEMORY[condition];
  const memoryModule = useMemory
    ? createMemoryModuleV2(memoryPort, workspace.getWritePort(moduleId('memory')))
    : null;
  let memoryState = memoryModule?.initialState() ?? null;
  const memoryControl: MemoryV2Control = {
    target: moduleId('memory'),
    timestamp: Date.now(),
    retrievalEnabled: true,
    extractionEnabled: true,
    maxRetrievals: 1,
  };

  // Tracking
  let totalTokens = 0;
  let providerCalls = 0;
  let monitorInterventions = 0;
  let memoryRetrievals = 0;
  const allToolCalls: Array<{ tool: string; input: unknown; success: boolean }> = [];
  const affectSignals: RunResult['affectSignals'] = [];
  const conflictResolutions: RunResult['conflictResolutions'] = [];
  let prevAction: { name: string; success: boolean; target?: string } | undefined;
  let cycles = 0;

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
    for (let cycle = 0; cycle < maxCycles; cycle++) {
      cycles = cycle + 1;

      // 1. OBSERVE (first cycle only)
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

      // Apply monitor enforcement
      const budgetRemaining = config.monitor.interventionBudget - monitorInterventions;
      if (monResult.monitoring.anomalyDetected && budgetRemaining > 0) {
        monitorInterventions++;
        switch (config.monitor.onStagnation) {
          case 'constrain':
            raControl.restrictedActions = monResult.output.restrictedActions;
            raControl.forceReplan = monResult.output.forceReplan;
            if (monResult.output.forceReplan) raControl.strategy = 'think';
            break;
          case 'reframe':
            raControl.restrictedActions = [];
            raControl.forceReplan = true;
            raControl.strategy = 'think';
            break;
          case 'expand':
            raControl.restrictedActions = [];
            raControl.forceReplan = true;
            raControl.strategy = 'plan';
            break;
          case 'nudge-reframe-reset':
            if (monitorInterventions <= 1) {
              raControl.restrictedActions = [];
              raControl.forceReplan = false;
            } else if (monitorInterventions <= 2) {
              raControl.restrictedActions = [];
              raControl.forceReplan = true;
              raControl.strategy = 'think';
            } else {
              raControl.restrictedActions = [];
              raControl.forceReplan = true;
              raControl.strategy = 'plan';
            }
            break;
        }
      } else if (monResult.monitoring.anomalyDetected && budgetRemaining <= 0) {
        raControl.restrictedActions = [];
        raControl.forceReplan = false;
      }

      // Build prompt additions
      const promptAdditions: string[] = [];

      if (config.prompt.taskAnchor) {
        promptAdditions.push(`## CURRENT TASK\n${task.description}\nDo not work on anything else.\n`);
      }
      if (config.prompt.showCycleBudget) {
        promptAdditions.push(`[Cycle ${cycle + 1}/${maxCycles}]`);
      }
      if (foldedContext.length > 0) {
        promptAdditions.push(`## Completed Actions\n${foldedContext.join('\n')}\n`);
      }
      if (config.prompt.completionChecklist) {
        promptAdditions.push(`When the task is complete, call the "done" action.`);
      }
      if (config.prompt.preDeleteChecklist) {
        promptAdditions.push(`BEFORE removing code: search for all references first.`);
      }

      // P4: Dynamic persona injection (cycle 0 only)
      if (flags.personas && cycle === 0) {
        const persona = selectPersona(task.description);
        if (persona) {
          promptAdditions.push(formatPersonaPrompt(persona));
          console.log(`    [P4] Persona: ${persona.name}`);
        }
      }

      // P3: Affect computation
      if (flags.affect) {
        const writeActions = ['Write', 'Edit', 'done'];
        const toolNames = allToolCalls.map(tc => tc.tool);
        let lastWriteIdx = -1;
        for (let wi = toolNames.length - 1; wi >= 0; wi--) {
          if (writeActions.includes(toolNames[wi])) { lastWriteIdx = wi; break; }
        }
        const cyclesSinceLastWrite = lastWriteIdx >= 0 ? allToolCalls.length - 1 - lastWriteIdx : cycle + 1;

        const affectInput: AffectInput = {
          recentActions: raState.recentActions
            ?.slice(-5)
            ?.map((name: string) => ({ name, success: true })) ?? [],
          confidenceTrend: [],
          uniqueActionsInWindow: new Set(raState.recentActions?.slice(-5) ?? []).size,
          cyclesSinceLastWrite,
          novelInfoDiscovered: false,
        };
        const affect = computeAffect(affectInput);
        affectSignals.push({
          cycle: cycle + 1,
          label: affect.label,
          valence: affect.valence,
          arousal: affect.arousal,
        });
        if (affect.label !== 'neutral') {
          // Inject guidance into workspace
          const guidance = affect.label === 'frustrated'
            ? 'You appear stuck. Step back and reconsider your approach.'
            : affect.label === 'anxious'
              ? 'Confidence is declining. Verify your assumptions.'
              : affect.label === 'curious'
                ? 'New information discovered. Understand implications before acting.'
                : 'Making good progress. Continue current approach.';
          promptAdditions.push(`[Affect: ${affect.label}] ${guidance}`);
        }
      }

      // Inject prompt additions into workspace
      if (promptAdditions.length > 0) {
        workspace.getWritePort(moduleId('observer')).write({
          source: moduleId('observer'),
          content: promptAdditions.join('\n\n'),
          salience: 0.95,
          timestamp: Date.now(),
        });
      }

      // Memory retrieval
      if (memoryModule && memoryState) {
        const memSnapshot = workspace.getReadPort(moduleId('memory')).read();
        const memResult = await memoryModule.step(
          { snapshot: memSnapshot, lastAction: prevAction },
          memoryState,
          memoryControl,
        );
        memoryState = memResult.state;
        memoryRetrievals = memResult.state.retrievalCount ?? 0;
      }

      // 3. REASON + ACT
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

      // Track last action
      prevAction = {
        name: raResult.output.actionName,
        success: (raResult.monitoring as any).success ?? true,
      };

      // Fold context
      const actionSummary = `[c${cycle + 1}] ${raResult.output.actionName}: ${raResult.output.plan?.slice(0, 80) || ''}`;
      foldedContext.push(actionSummary);
      if (foldedContext.length > 15) foldedContext.shift();

      // Per-cycle logging
      const conf = (raResult.monitoring as any).confidence ?? 0;
      const tok = (raResult.monitoring as any).tokensThisStep ?? 0;
      const stag = monResult.monitoring.anomalyDetected ? ' [stagnation]' : '';
      console.log(`    [c${cycle + 1}] ${raResult.output.actionName}  conf=${conf.toFixed(2)}  tok=${tok}${stag}`);

      // Check completion
      if (raResult.output.actionName === 'done') break;
    }

    // Validate
    const validation = task.validate(vfs.files);

    // P6: Post-task reflection
    let reflectionLessons = 0;
    if (flags.reflect && (sharedMemoryPort || useMemory)) {
      try {
        const reflectionMemory = sharedMemoryPort ?? memoryPort;
        const reflector = createReflectorV2(reflectionMemory, adapter);
        const reflectResult = await reflector.step(
          {
            taskDescription: task.description,
            actionHistory: allToolCalls.map(tc => tc.tool),
            outcome: { success: validation.success, reason: validation.reason },
          },
          reflector.initialState(),
          { target: moduleId('reflector-v2'), timestamp: Date.now() },
        );
        reflectionLessons = reflectResult.output.lessons.length;
        if (reflectionLessons > 0) {
          console.log(`    [P6] Reflection: ${reflectionLessons} lessons`);
          for (const lesson of reflectResult.output.lessons) {
            console.log(`      - ${lesson.content.slice(0, 100)}`);
          }
        }
      } catch (err) {
        console.log(`    [P6] Reflection skipped: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return {
      condition,
      task: task.name,
      run: runNumber,
      success: validation.success,
      reason: validation.reason,
      tokensUsed: totalTokens,
      providerCalls,
      durationMs: Date.now() - startTime,
      cycles,
      toolCalls: allToolCalls,
      monitorInterventions,
      affectSignals,
      conflictResolutions,
      reflectionLessons,
      memoryRetrievals,
      configUsed: config.name,
    };
  } catch (err) {
    return {
      condition,
      task: task.name,
      run: runNumber,
      success: false,
      reason: `Error: ${err instanceof Error ? err.message : String(err)}`,
      tokensUsed: totalTokens,
      providerCalls,
      durationMs: Date.now() - startTime,
      cycles,
      toolCalls: allToolCalls,
      monitorInterventions,
      affectSignals,
      conflictResolutions,
      reflectionLessons: 0,
      memoryRetrievals,
      configUsed: config.name,
    };
  }
}

// ── T08 Two-Phase Runner ──────────────────────────────────────

async function runT08(
  condition: ConditionName,
  runNumber: number,
  config: CognitiveConfig,
  flags: PatternFlags,
  sharedMemoryPort?: MemoryPortV2,
): Promise<[RunResult, RunResult]> {
  // Phase 1: Tight budget (5 cycles) — expected to fail, produces reflections
  console.log(`    [T08] Phase 1: Tight-budget circular dep (5 cycles)`);
  const phase1 = await runTask(
    TASK_08_PHASE1, condition, runNumber, config, flags,
    sharedMemoryPort, 5, // only 5 cycles
  );
  console.log(`    [T08] Phase 1: ${phase1.success ? 'PASS' : 'FAIL'} — ${phase1.reason.slice(0, 80)}`);

  // Phase 2: Full budget, same memory — should benefit from Phase 1 lessons
  console.log(`    [T08] Phase 2: Full-budget variant (15 cycles, same memory)`);
  const phase2 = await runTask(
    TASK_08_PHASE2, condition, runNumber, config, flags,
    sharedMemoryPort, 15,
  );
  console.log(`    [T08] Phase 2: ${phase2.success ? 'PASS' : 'FAIL'} — ${phase2.reason.slice(0, 80)}`);

  return [phase1, phase2];
}

// ── Results Persistence ───────────────────────────────────────

async function saveResult(result: RunResult, outputDir: string): Promise<void> {
  const taskDir = resolve(outputDir, result.task);
  await mkdir(taskDir, { recursive: true });
  const filename = `${result.condition}-run${String(result.run).padStart(2, '0')}.json`;
  await writeFile(
    resolve(taskDir, filename),
    JSON.stringify(result, null, 2),
    'utf8',
  );
}

// ── Reporting ─────────────────────────────────────────────────

function printResult(r: RunResult): void {
  const status = r.success ? 'PASS' : 'FAIL';
  console.log(`  [${status}] ${r.condition} run ${r.run}: ${r.reason.slice(0, 100)}`);
  console.log(`    tokens: ${r.tokensUsed}, calls: ${r.providerCalls}, cycles: ${r.cycles}, duration: ${(r.durationMs / 1000).toFixed(1)}s`);
  if (r.monitorInterventions > 0) console.log(`    monitor: ${r.monitorInterventions} interventions`);
  if (r.reflectionLessons > 0) console.log(`    reflection: ${r.reflectionLessons} lessons`);
  if (r.memoryRetrievals > 0) console.log(`    memory: ${r.memoryRetrievals} retrievals`);
  if (r.affectSignals.length > 0) {
    const labels = r.affectSignals.map(s => s.label).filter(l => l !== 'neutral');
    if (labels.length > 0) console.log(`    affect: ${labels.join(', ')}`);
  }
}

function printSummary(results: RunResult[]): void {
  console.log('\n=== Summary ===\n');

  const conditions: ConditionName[] = ['A', 'B', 'C', 'D', 'E'];
  for (const cond of conditions) {
    const condResults = results.filter(r => r.condition === cond);
    if (condResults.length === 0) continue;

    const passes = condResults.filter(r => r.success).length;
    const avgTokens = condResults.reduce((s, r) => s + r.tokensUsed, 0) / condResults.length;
    const avgCycles = condResults.reduce((s, r) => s + r.cycles, 0) / condResults.length;
    const avgDuration = condResults.reduce((s, r) => s + r.durationMs, 0) / condResults.length;
    const totalInterventions = condResults.reduce((s, r) => s + r.monitorInterventions, 0);
    const totalLessons = condResults.reduce((s, r) => s + r.reflectionLessons, 0);

    console.log(`  Condition ${cond}: ${passes}/${condResults.length} PASS`);
    console.log(`    avg tokens: ${Math.round(avgTokens)}, avg cycles: ${avgCycles.toFixed(1)}, avg duration: ${(avgDuration / 1000).toFixed(1)}s`);
    console.log(`    total interventions: ${totalInterventions}, total lessons: ${totalLessons}`);
  }

  // Cost ratio vs control
  const controlResults = results.filter(r => r.condition === 'A');
  if (controlResults.length > 0) {
    const controlAvg = controlResults.reduce((s, r) => s + r.tokensUsed, 0) / controlResults.length;
    for (const cond of (['B', 'C', 'D', 'E'] as ConditionName[])) {
      const condResults = results.filter(r => r.condition === cond);
      if (condResults.length === 0) continue;
      const condAvg = condResults.reduce((s, r) => s + r.tokensUsed, 0) / condResults.length;
      console.log(`  ${cond}/A token ratio: ${(condAvg / Math.max(controlAvg, 1)).toFixed(2)}x`);
    }
  }
}

// ── Budget Tracker ────────────────────────────────────────────

class BudgetTracker {
  private totalTokens = 0;
  private totalRuns = 0;
  private readonly maxBudgetUsd: number;

  // Claude Sonnet pricing: $3/1M input, $15/1M output
  // Approximate: 80% input, 20% output → blended rate ~$5.4/1M
  private readonly blendedRatePerMillion = 5.4;

  constructor(maxBudgetUsd: number) {
    this.maxBudgetUsd = maxBudgetUsd;
  }

  addRun(tokens: number): void {
    this.totalTokens += tokens;
    this.totalRuns++;
  }

  estimatedCostUsd(): number {
    return (this.totalTokens / 1_000_000) * this.blendedRatePerMillion;
  }

  isOverBudget(): boolean {
    return this.estimatedCostUsd() > this.maxBudgetUsd;
  }

  report(): string {
    return `${this.totalRuns} runs, ${Math.round(this.totalTokens / 1000)}K tokens, ~$${this.estimatedCostUsd().toFixed(2)} / $${this.maxBudgetUsd}`;
  }
}

// ── Randomize Array ───────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Main ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse arguments
  const conditionArg = args.find(a => a.startsWith('--condition='))?.split('=')[1] ?? 'all';
  const taskArg = args.find(a => a.startsWith('--task='))?.split('=')[1] ?? 'all';
  const runsArg = args.find(a => a.startsWith('--runs='))?.split('=')[1] ?? '1';
  const isPilot = args.includes('--pilot');
  const isDryRun = args.includes('--dry-run');
  const outputDir = args.find(a => a.startsWith('--output-dir='))?.split('=')[1]
    ?? resolve(import.meta.dirname ?? '.', '../results');

  // Determine conditions
  let conditions: ConditionName[];
  if (isPilot) {
    conditions = ['A', 'E'];
  } else if (conditionArg === 'all') {
    conditions = ['A', 'B', 'C', 'D', 'E'];
  } else {
    conditions = conditionArg.split(',') as ConditionName[];
  }

  // Determine tasks
  let taskIndices: number[];
  if (isPilot) {
    taskIndices = [0]; // T01 only
  } else if (taskArg === 'all') {
    taskIndices = [0, 1, 2, 3, 4, 5, 6, 7]; // T01-T08
  } else {
    taskIndices = taskArg.split(',').map(t => parseInt(t, 10) - 1);
  }

  const numRuns = isPilot ? 2 : parseInt(runsArg, 10);

  // Validate
  if (!process.env.ANTHROPIC_API_KEY && !isDryRun) {
    console.error('ERROR: ANTHROPIC_API_KEY not set. Configure .env');
    process.exit(1);
  }

  // Print execution plan
  const totalRuns = conditions.length * taskIndices.length * numRuns;
  console.log('\n=== EXP-027: Advanced Cognitive Patterns ===');
  console.log(`  Conditions: ${conditions.join(', ')}`);
  console.log(`  Tasks: ${taskIndices.map(i => `T${String(i + 1).padStart(2, '0')}`).join(', ')}`);
  console.log(`  Runs per condition per task: ${numRuns}`);
  console.log(`  Total runs: ${totalRuns}`);
  console.log(`  Output: ${outputDir}`);
  if (isPilot) console.log('  MODE: PILOT (N=2, T01, conditions A+E)');
  console.log('');

  if (isDryRun) {
    console.log('DRY RUN — exiting without execution.');
    return;
  }

  // Create output directory
  await mkdir(outputDir, { recursive: true });

  // Budget tracker
  const budget = new BudgetTracker(17);

  // Per-condition shared memory
  const conditionMemory: Record<string, MemoryPortV2> = {};

  const allResults: RunResult[] = [];

  // Execute: sequential across tasks, randomized within task
  for (const taskIdx of taskIndices) {
    const isT08 = taskIdx === 7;

    if (isT08) {
      console.log(`\n--- T08: Cross-Task Transfer ---\n`);
    } else {
      const task = ALL_TASKS[taskIdx];
      if (!task) {
        console.error(`Unknown task index: ${taskIdx}`);
        continue;
      }
      console.log(`\n--- ${task.name} ---\n`);
    }

    // Build run schedule: condition x run, randomized
    const schedule: Array<{ condition: ConditionName; run: number }> = [];
    for (const cond of conditions) {
      for (let r = 1; r <= numRuns; r++) {
        schedule.push({ condition: cond, run: r });
      }
    }
    const randomized = shuffle(schedule);

    for (const { condition, run } of randomized) {
      const flags = CONDITION_FLAGS[condition];
      const configName = CONDITION_CONFIGS[condition];
      const config = CONFIGS[configName];

      // Get or create shared memory for this condition
      if (CONDITION_MEMORY[condition] && !conditionMemory[condition]) {
        conditionMemory[condition] = new InMemoryMemory();
        // Seed thought patterns if enabled
        if (flags.patterns) {
          await seedPatterns(conditionMemory[condition]);
          console.log(`  [${condition}] Seeded thought patterns`);
        }
      }
      const memoryPort = conditionMemory[condition];

      // P2: Adaptive config selection
      let taskConfig = config;
      if (flags.adaptive && memoryPort && !isT08) {
        const task = ALL_TASKS[taskIdx];
        const signals = await gatherTaskSignals(memoryPort, task.description);
        const classification = classifyTask(signals);
        console.log(`  [${condition}][P2] ${classification.profile} -> ${classification.configName}`);
        const adaptiveConfig = CONFIGS[classification.configName];
        if (adaptiveConfig) taskConfig = adaptiveConfig;
      }

      console.log(`  Running: condition=${condition}, run=${run}, config=${taskConfig.name}`);

      if (isT08) {
        // Two-phase task
        const [phase1, phase2] = await runT08(condition, run, taskConfig, flags, memoryPort);
        printResult(phase1);
        printResult(phase2);
        allResults.push(phase1, phase2);
        await saveResult(phase1, outputDir);
        await saveResult(phase2, outputDir);
        budget.addRun(phase1.tokensUsed + phase2.tokensUsed);
      } else {
        const task = ALL_TASKS[taskIdx];
        const result = await runTask(task, condition, run, taskConfig, flags, memoryPort);
        printResult(result);
        allResults.push(result);
        await saveResult(result, outputDir);
        budget.addRun(result.tokensUsed);
      }

      // Budget check
      console.log(`  Budget: ${budget.report()}`);
      if (budget.isOverBudget()) {
        console.error('\n*** BUDGET EXCEEDED — stopping execution ***\n');
        printSummary(allResults);
        return;
      }
    }
  }

  printSummary(allResults);
  console.log(`\nBudget: ${budget.report()}`);
  console.log('Done.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
