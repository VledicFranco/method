/**
 * EXP-023 Runner — Cognitive vs Flat Agent: Strategy Shift Recovery
 *
 * Three conditions:
 *   A (flat):      anthropicProvider + VirtualToolProvider — in-memory simulated tool loop
 *   B (cli-agent): Claude Code CLI sub-agent in a real tmp/ directory — real agentic baseline
 *   C (cognitive): 8-module cognitive cycle + VirtualToolProvider
 *
 * Usage: ANTHROPIC_API_KEY=... npx tsx experiments/exp-023/run.ts [--flat] [--cli] [--cognitive] [--runs 1]
 */

import { readFileSync } from 'node:fs';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

// Load .env — try multiple paths
try {
  const candidates = [
    resolve(import.meta.dirname ?? '.', '../../.env'),
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

import { anthropicProvider } from '../../packages/pacta-provider-anthropic/src/anthropic-provider.js';
import { claudeCliProvider } from '../../packages/pacta-provider-claude-cli/src/claude-cli-provider.js';
import { VirtualToolProvider } from '../../packages/pacta-playground/src/virtual-tool-provider.js';

import {
  moduleId,
  createWorkspace,
  createProviderAdapter,
} from '../../packages/pacta/src/cognitive/algebra/index.js';
import type { AggregatedSignals, MonitoringSignal } from '../../packages/pacta/src/cognitive/algebra/index.js';

import { createReasonerActor, type ReasonerActorControl } from '../../packages/pacta/src/cognitive/modules/reasoner-actor.js';
import { createObserver } from '../../packages/pacta/src/cognitive/modules/observer.js';
import { createMonitor } from '../../packages/pacta/src/cognitive/modules/monitor.js';
import { createMemoryModuleV2, handleEviction, type MemoryV2Control } from '../../packages/pacta/src/cognitive/modules/memory-module-v2.js';
import { InMemoryMemory } from '../../packages/pacta/src/ports/memory-impl.js';
import type { MemoryPortV2 } from '../../packages/pacta/src/ports/memory-port.js';

import type { ReadonlyWorkspaceSnapshot, SalienceContext } from '../../packages/pacta/src/cognitive/algebra/index.js';

import { CONFIGS, describeConfig, type CognitiveConfig } from './strategies.js';

import { TASK_01 } from './task-01-circular-dep.js';
import { TASK_02 } from './task-02-test-first-bug.js';
import { TASK_03 } from './task-03-config-migration.js';
import { TASK_04 } from './task-04-api-versioning.js';
import { TASK_05 } from './task-05-dead-code-removal.js';

interface TaskDefinition {
  name: string;
  baseDescription: string;
  description: string;
  initialFiles: Record<string, string>;
  validate(files: ReadonlyMap<string, string>): { success: boolean; reason: string };
}

const TASKS: TaskDefinition[] = [TASK_01, TASK_02, TASK_03, TASK_04, TASK_05];

// ── Types ───────────────────────────────────────────────────────

interface RunResult {
  condition: 'flat' | 'cli-agent' | 'cognitive';
  task: string;
  run: number;
  success: boolean;
  reason: string;
  tokensUsed: number;
  providerCalls: number;
  durationMs: number;
  toolCalls: Array<{ tool: string; input: unknown; success: boolean }>;
  monitorInterventions?: number;
  strategyShifts?: number;
}

// ── Condition A: Flat Agent ─────────────────────────────────────

async function runFlat(task: TaskDefinition, runNumber: number): Promise<RunResult> {
  const startTime = Date.now();
  const vfs = new VirtualToolProvider(task.initialFiles);

  const provider = anthropicProvider({
    model: 'claude-sonnet-4-20250514',
    maxOutputTokens: 4096,
    toolProvider: vfs,
    maxTurns: 15,
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

// ── Session JSONL Tool Call Extractor ────────────────────────────

interface SessionEntry {
  type: string;
  message?: {
    role?: string;
    content?: Array<{ type: string; name?: string; input?: unknown; id?: string }> | string;
  };
}

/**
 * Read tool calls from a Claude session JSONL file.
 * Claude Code writes sessions to ~/.claude/projects/{cwd-hash}/{session-id}.jsonl.
 * The cwd-hash is the cwd path with path separators replaced by '--'.
 */
async function readSessionToolCalls(
  sessionId: string,
  cwd: string,
): Promise<Array<{ tool: string; input: unknown; success: boolean }>> {
  try {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
    // Claude Code project hash: replace ':', '/', '\' each with a single '-'
    // e.g. C:\Users\atfm0\tmp\foo → C--Users-atfm0-tmp-foo
    const pathHash = cwd.replace(/[:\\/]/g, '-');
    const sessionFile = resolve(home, '.claude', 'projects', pathHash, `${sessionId}.jsonl`);

    let content: string;
    try {
      content = await readFile(sessionFile, 'utf8');
    } catch {
      // File may not exist or path hash computation may differ
      return [];
    }

    const calls: Array<{ tool: string; input: unknown; success: boolean }> = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as SessionEntry;
        if (entry.type === 'assistant' && entry.message?.content && Array.isArray(entry.message.content)) {
          for (const block of entry.message.content) {
            if (block.type === 'tool_use' && block.name) {
              calls.push({ tool: block.name, input: block.input, success: true });
            }
          }
        }
        // Mark tool calls as failed if the subsequent tool_result has an error
        if (entry.type === 'user' && entry.message?.content && Array.isArray(entry.message.content)) {
          for (const block of entry.message.content) {
            if (block.type === 'tool_result' && block.id) {
              // Find the matching call by position — mark last N calls as checked
              // (simple heuristic: the last unresolved call gets the result)
            }
          }
        }
      } catch { /* skip malformed lines */ }
    }
    return calls;
  } catch {
    return [];
  }
}

// ── Condition B: CLI Sub-agent ────────────────────────────────────
//
// Spawns a real `claude --print` process in a tmp/ directory with real files.
// This is the natural Claude Code agentic baseline — no custom wiring, no VFS.
// No tool restrictions: we want to see Claude's natural tool-use behavior.
// Token counts and session ID come from the stdout JSON; tool calls from the JSONL.

async function runCliAgent(task: TaskDefinition, runNumber: number): Promise<RunResult> {
  const startTime = Date.now();

  // Use baseDescription — no cognitive-specific "done" signal
  const prompt = task.baseDescription;

  // Create a real tmp directory and write initial files.
  // Use process.cwd() (the repo root) rather than import.meta.dirname which may fall back
  // to '.' in some tsx/ESM contexts, causing the path to resolve incorrectly.
  const tmpDir = resolve(process.cwd(), 'tmp', `exp-023-cli-${runNumber}-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  for (const [relativePath, content] of Object.entries(task.initialFiles)) {
    const absPath = resolve(tmpDir, relativePath);
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, content, 'utf8');
  }

  try {
    // Disallow AskUserQuestion and Agent to keep the CLI condition comparable.
    const childProcess = await import('node:child_process');
    const provider = claudeCliProvider({
      timeoutMs: 300_000,
      executorOptions: {
        spawnFn: (binary: string, args: string[], options: Parameters<typeof childProcess.spawn>[2]) =>
          childProcess.spawn(binary, ['--disallowedTools', 'AskUserQuestion,Agent', ...args], options),
      },
    });

    const result = await provider.invoke(
      { mode: { type: 'oneshot' } },
      {
        prompt,
        systemPrompt: 'You are a coding assistant. Complete the task using any tools available to you.',
        workdir: tmpDir,
      },
    );

    // Read files back from disk to validate
    const filesMap = new Map<string, string>();
    for (const relativePath of Object.keys(task.initialFiles)) {
      try {
        filesMap.set(relativePath, await readFile(resolve(tmpDir, relativePath), 'utf8'));
      } catch { /* file deleted or not present */ }
    }

    // Also pick up any new .ts files created during refactoring
    try {
      const { readdirSync, statSync } = await import('node:fs');
      const scanDir = (dir: string, base: string) => {
        for (const entry of readdirSync(dir)) {
          const full = resolve(dir, entry);
          const rel = `${base}${entry}`;
          if (statSync(full).isDirectory()) {
            scanDir(full, `${rel}/`);
          } else if (entry.endsWith('.ts') && !filesMap.has(rel)) {
            try { filesMap.set(rel, readFileSync(full, 'utf8')); } catch { /* skip */ }
          }
        }
      };
      scanDir(tmpDir, '');
    } catch { /* skip */ }

    const validation = task.validate(filesMap);

    // Read tool calls from the session JSONL
    const toolCalls = await readSessionToolCalls(result.sessionId, tmpDir);

    return {
      condition: 'cli-agent',
      task: task.name,
      run: runNumber,
      success: validation.success,
      reason: validation.reason,
      tokensUsed: result.usage.totalTokens,
      providerCalls: result.turns,
      durationMs: Date.now() - startTime,
      toolCalls,
    };
  } catch (err) {
    return {
      condition: 'cli-agent',
      task: task.name,
      run: runNumber,
      success: false,
      reason: `Error: ${err instanceof Error ? err.message : String(err)}`,
      tokensUsed: 0,
      providerCalls: 0,
      durationMs: Date.now() - startTime,
      toolCalls: [],
    };
  } finally {
    try { await rm(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

// ── Condition C: Cognitive Agent (5-module merged architecture) ──
//
// Council-recommended redesign:
//   1. Observer (rule-based) — writes task/tool context to workspace
//   2. Monitor (rule-based, hard enforcement) — behavioral observables, action restrictions
//   3. Reasoner-Actor (single LLM call) — <plan>/<reasoning>/<action> + tool execution
//   4. Workspace (salience eviction, capacity=8) — managed context buffer
//   5. Reflector (conditional) — fires on forceReplan only (not yet wired)

async function runCognitive(
  task: TaskDefinition,
  runNumber: number,
  config: CognitiveConfig,
  useMemory: boolean = false,
  sharedMemoryPort?: MemoryPortV2
): Promise<RunResult> {
  const startTime = Date.now();
  const vfs = new VirtualToolProvider(task.initialFiles);

  // Provider for merged Reasoner-Actor (single-turn, no tool provider — tools handled internally)
  const llmProvider = anthropicProvider({
    model: 'claude-sonnet-4-20250514',
    maxOutputTokens: 2048,
  });

  const adapter = createProviderAdapter(llmProvider, {
    pactTemplate: { mode: { type: 'oneshot' }, budget: { maxOutputTokens: 2048 } },
  });

  // Workspace (capacity=8, tuned from council recommendation)
  const salienceContext: SalienceContext = {
    now: Date.now(),
    goals: ['break circular dependency', 'preserve functionality'],
    sourcePriorities: new Map([
      [moduleId('reasoner-actor'), 0.9],
      [moduleId('observer'), 0.6],
    ]),
  };
  const workspace = createWorkspace({ capacity: config.workspace.capacity }, salienceContext);

  const foldedContext: string[] = [];  // Accumulated summaries of past actions

  // 5-module setup
  const observer = createObserver(workspace.getWritePort(moduleId('observer')));
  const reasonerActor = createReasonerActor(
    adapter,
    vfs,
    workspace.getWritePort(moduleId('reasoner-actor')),
  );
  const monitor = createMonitor({ confidenceThreshold: 0.3, stagnationThreshold: 2 });

  // Memory module (PRD 031)
  const memoryPort = sharedMemoryPort ?? new InMemoryMemory();
  const memoryModule = useMemory
    ? createMemoryModuleV2(memoryPort, workspace.getWritePort(moduleId('memory')))
    : null;
  let memoryState = memoryModule?.initialState() ?? null;
  const memoryControl: MemoryV2Control = {
    target: moduleId('memory'),
    timestamp: Date.now(),
    retrievalEnabled: true,
    extractionEnabled: true,
    maxRetrievals: 3,
  };

  // Cycle state
  let totalTokens = 0;
  let providerCalls = 0;
  let monitorInterventions = 0;
  const allToolCalls: Array<{ tool: string; input: unknown; success: boolean }> = [];
  let prevAction: { name: string; success: boolean; target?: string } | undefined;

  const MAX_CYCLES = 15;
  const raControl: ReasonerActorControl = {
    target: moduleId('reasoner-actor'),
    timestamp: Date.now(),
    strategy: 'plan',
    effort: 'medium',
  };

  // Module states (persisted across cycles)
  let observerState = observer.initialState();
  let raState = reasonerActor.initialState();
  let monitorState = monitor.initialState();
  let prevRAMonitoring: MonitoringSignal | null = null;

  try {
    for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
      // 1. OBSERVE — feed task description (first cycle only)
      if (cycle === 0) {
        const obsResult = await observer.step(
          { content: task.description },
          observerState,
          { target: moduleId('observer'), timestamp: Date.now() } as any,
        );
        observerState = obsResult.state;
      }

      // 2. MONITOR — always run with previous cycle's reasoner-actor signal
      const monitorSignals: AggregatedSignals = new Map();
      if (prevRAMonitoring) {
        monitorSignals.set(moduleId('reasoner-actor'), prevRAMonitoring);
      }
      const monResult = await monitor.step(
        monitorSignals, monitorState,
        { target: moduleId('monitor'), timestamp: Date.now() } as any,
      );
      monitorState = monResult.state;

      // Apply monitor enforcement based on strategy
      const interventionsUsed = monitorInterventions;
      const budgetRemaining = config.monitor.interventionBudget - interventionsUsed;

      if (monResult.monitoring.anomalyDetected && budgetRemaining > 0) {
        monitorInterventions++;

        switch (config.monitor.onStagnation) {
          case 'constrain':
            if (config.monitor.name === 'hybrid' && interventionsUsed >= 3) {
              // Hybrid escalation: after 3 constrain attempts, switch to reframe
              raControl.restrictedActions = [];
              raControl.forceReplan = true;
              raControl.strategy = 'think';
            } else {
              // Standard constrain: restrict actions + force replan
              raControl.restrictedActions = monResult.output.restrictedActions;
              raControl.forceReplan = monResult.output.forceReplan;
              if (monResult.output.forceReplan) raControl.strategy = 'think';
            }
            break;

          case 'reframe':
            // Inject reframe prompt instead of restricting actions
            raControl.restrictedActions = [];  // Don't restrict
            raControl.forceReplan = true;      // But do force replan
            raControl.strategy = 'think';
            // The forceReplan flag already adds "MUST try different strategy" to prompt
            break;

          case 'expand':
            // Suggest expansion: search for things not yet examined
            raControl.restrictedActions = [];
            raControl.forceReplan = true;
            raControl.strategy = 'plan';  // Plan strategy encourages broader thinking
            break;

          case 'nudge-reframe-reset':
            // 3-tier: nudge first, then reframe, then reset
            if (interventionsUsed <= 1) {
              // Nudge: don't restrict, just note it
              raControl.restrictedActions = [];
              raControl.forceReplan = false;
            } else if (interventionsUsed <= 2) {
              // Reframe
              raControl.restrictedActions = [];
              raControl.forceReplan = true;
              raControl.strategy = 'think';
            } else {
              // Reset: clear workspace context, re-inject task
              raControl.restrictedActions = [];
              raControl.forceReplan = true;
              raControl.strategy = 'plan';
              // Clear non-essential workspace entries would go here in a full impl
            }
            break;
        }
      } else if (monResult.monitoring.anomalyDetected && budgetRemaining <= 0) {
        // Budget exhausted — monitor goes silent
        raControl.restrictedActions = [];
        raControl.forceReplan = false;
      }

      // Build strategy-specific prompt additions
      const promptAdditions: string[] = [];

      if (config.prompt.taskAnchor) {
        promptAdditions.push(`## CURRENT TASK\n${task.description}\nDo not work on anything else.\n`);
      }

      if (config.prompt.showCycleBudget) {
        promptAdditions.push(`[Cycle ${cycle + 1}/${MAX_CYCLES}]`);
      }

      if (foldedContext.length > 0) {
        promptAdditions.push(`## Completed Actions\n${foldedContext.join('\n')}\n`);
      }

      if (config.prompt.completionChecklist) {
        promptAdditions.push(`When the task is complete, call the "done" action. Do not continue working after the task is solved.`);
      }

      if (config.prompt.preDeleteChecklist) {
        promptAdditions.push(`BEFORE removing or deleting any code: (1) search for the identifier as a literal string in ALL files, (2) search for dynamic references (require(), import(), string interpolation, bracket notation), (3) check config files. Only delete if no references found.`);
      }

      if (config.prompt.problemStateRequired) {
        promptAdditions.push(`Start your <plan> with: PROBLEM_STATE: [one sentence — what am I solving right now?]`);
      }

      // Inject prompt strategy context into workspace
      if (promptAdditions.length > 0) {
        const strategyContext = promptAdditions.join('\n\n');
        workspace.getWritePort(moduleId('observer')).write({
          source: moduleId('observer'),
          content: strategyContext,
          salience: 0.95,  // High salience — always visible
          timestamp: Date.now(),
        });
      }

      // MEMORY RETRIEVAL GATE (if enabled)
      if (memoryModule && memoryState) {
        const memSnapshot = workspace.getReadPort(moduleId('memory')).read();
        const memResult = await memoryModule.step(
          { snapshot: memSnapshot, lastAction: prevAction },
          memoryState,
          memoryControl,
        );
        memoryState = memResult.state;
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

      // Track last action for memory extraction — target should be the file/resource acted on
      const actionTarget = raResult.output.actionName === 'Write' || raResult.output.actionName === 'Edit'
        ? (raResult.output.reasoning?.match(/(?:src\/|tests\/|config\/)[\w\-/.]+\.(?:ts|js|yaml|json)/)?.[0] ?? raResult.output.actionName)
        : raResult.output.actionName;
      prevAction = {
        name: raResult.output.actionName,
        success: (raResult.monitoring as any).success ?? true,
        target: actionTarget,
      };

      // Log errors if the step failed
      if (raResult.error) {
        console.log(`    ❌ Error: ${raResult.error.message}`);
      }

      // Accumulate folded context summary
      const actionSummary = `[c${cycle+1}] ${raResult.output.actionName}: ${raResult.output.plan?.slice(0, 80) || raResult.output.reasoning?.slice(0, 80) || ''}`;
      foldedContext.push(actionSummary);
      // Keep last 15 summaries max
      if (foldedContext.length > 15) foldedContext.shift();

      // Per-cycle trace logging
      const conf = (raResult.monitoring as any).confidence ?? 0;
      const tok = (raResult.monitoring as any).tokensThisStep ?? 0;
      const stagnationTag = monResult.monitoring.anomalyDetected
        ? budgetRemaining > 0
          ? ` ⚠ ${config.monitor.onStagnation}`
          : ' ⚠ (budget exhausted)'
        : '';
      console.log(`    [cycle ${cycle + 1}] ${raResult.output.actionName}  conf=${conf.toFixed(2)}  tok=${tok}${stagnationTag}`);

      // Check for completion
      if (raResult.output.actionName === 'done') {
        break;
      }
    }

    if (memoryModule && memoryState) {
      const cardCount = (await memoryPort.allCards()).length;
      console.log(`    memory: ${cardCount} fact cards stored, ${memoryState.retrievalCount} retrievals`);
    }

    const validation = task.validate(vfs.files);

    return {
      condition: 'cognitive',
      task: task.name,
      run: runNumber,
      success: validation.success,
      reason: validation.reason,
      tokensUsed: totalTokens,
      providerCalls,
      durationMs: Date.now() - startTime,
      toolCalls: allToolCalls,
      monitorInterventions,
      strategyShifts: monitorInterventions,
    };
  } catch (err) {
    return {
      condition: 'cognitive',
      task: task.name,
      run: runNumber,
      success: false,
      reason: `Error: ${err instanceof Error ? err.message : String(err)}`,
      tokensUsed: totalTokens,
      providerCalls,
      durationMs: Date.now() - startTime,
      toolCalls: allToolCalls,
      monitorInterventions,
    };
  }
}

// ── Report ──────────────────────────────────────────────────────

function printResult(r: RunResult) {
  const status = r.success ? 'PASS' : 'FAIL';
  console.log(`  [${status}] ${r.condition} run ${r.run}: ${r.reason}`);
  console.log(`    tokens: ${r.tokensUsed}, provider calls: ${r.providerCalls}, duration: ${(r.durationMs / 1000).toFixed(1)}s`);
  if (r.toolCalls.length > 0) {
    console.log(`    tool calls: ${r.toolCalls.length} (${r.toolCalls.map(t => t.tool).join(' → ')})`);
  } else {
    console.log(`    tool calls: (not tracked for this condition)`);
  }
  if (r.monitorInterventions !== undefined) {
    console.log(`    monitor interventions: ${r.monitorInterventions}, strategy shifts: ${r.strategyShifts ?? 0}`);
  }
}

function printComparison(results: RunResult[]) {
  const byCondition = (c: RunResult['condition']) => results.filter(r => r.condition === c);
  const flat = byCondition('flat');
  const cli = byCondition('cli-agent');
  const cog = byCondition('cognitive');

  console.log('\n--- Comparison ---');

  function summary(label: string, rs: RunResult[]) {
    if (rs.length === 0) return;
    const passes = rs.filter(r => r.success).length;
    const avgTokens = rs.reduce((s, r) => s + r.tokensUsed, 0) / rs.length;
    const avgDuration = rs.reduce((s, r) => s + r.durationMs, 0) / rs.length;
    console.log(`  ${label}: ${passes}/${rs.length} PASS, avg tokens: ${Math.round(avgTokens)}, avg duration: ${(avgDuration / 1000).toFixed(1)}s`);
  }

  summary('A (flat)', flat);
  summary('B (cli-agent)', cli);
  summary('C (cognitive)', cog);

  // Cost ratio relative to flat
  if (flat.length > 0) {
    const flatAvg = flat.reduce((s, r) => s + r.tokensUsed, 0) / flat.length;
    if (cli.length > 0) {
      const cliAvg = cli.reduce((s, r) => s + r.tokensUsed, 0) / cli.length;
      console.log(`  B/A token ratio: ${(cliAvg / Math.max(flatAvg, 1)).toFixed(2)}x`);
    }
    if (cog.length > 0) {
      const cogAvg = cog.reduce((s, r) => s + r.tokensUsed, 0) / cog.length;
      console.log(`  C/A token ratio: ${(cogAvg / Math.max(flatAvg, 1)).toFixed(2)}x`);
    }
  }
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const runFlat_ = args.includes('--flat');
  const runCli = args.includes('--cli');
  const runCog = args.includes('--cognitive');
  const runAll = !runFlat_ && !runCli && !runCog;
  const useMemory = args.includes('--memory');

  const runsArg = args.find(a => a.startsWith('--runs=') || a === '--runs');
  let numRuns = 1;
  if (runsArg) {
    const next = runsArg.includes('=') ? runsArg.split('=')[1] : args[args.indexOf('--runs') + 1];
    numRuns = parseInt(next ?? '1', 10) || 1;
  }

  // Config selection: --config=baseline (default), --config=v2-minimal, etc.
  const configArg = args.find(a => a.startsWith('--config='))?.split('=')[1] ?? 'baseline';
  const cognitiveConfig = CONFIGS[configArg];
  if (!cognitiveConfig) {
    console.error(`Unknown config: ${configArg}. Available: ${Object.keys(CONFIGS).join(', ')}`);
    process.exit(1);
  }

  // Task selection: --task 1 (default), --task 2, --task all
  const taskArg = args.find(a => a.startsWith('--task=') || a === '--task');
  let taskSelection: string = '1';
  if (taskArg) {
    const next = taskArg.includes('=') ? taskArg.split('=')[1] : args[args.indexOf('--task') + 1];
    taskSelection = next ?? '1';
  }

  const selectedTasks = taskSelection === 'all'
    ? TASKS
    : [TASKS[parseInt(taskSelection, 10) - 1]].filter(Boolean);

  if (selectedTasks.length === 0) {
    console.error(`ERROR: Unknown task "${taskSelection}". Use --task 1..5 or --task all`);
    process.exit(1);
  }

  // Cross-task memory persistence
  const { FactCardStore } = await import('../../packages/pacta/src/persistence/fact-card-store.js');
  const memoryStorePath = resolve(process.cwd(), '.method/memory/exp-023-facts.jsonl');
  const sharedMemoryStore = useMemory ? new FactCardStore(memoryStorePath) : null;

  // Load any existing facts from prior runs
  if (sharedMemoryStore) {
    const loaded = await sharedMemoryStore.load();
    if (loaded > 0) console.log(`    Loaded ${loaded} fact cards from prior runs`);
  }

  console.log('\n=== EXP-023: Cognitive vs Flat — Strategy Shift Recovery ===');
  console.log(`    Conditions: ${[runAll || runFlat_ ? 'A(flat)' : '', runAll || runCli ? 'B(cli-agent)' : '', runAll || runCog ? 'C(cognitive)' : ''].filter(Boolean).join(', ')}`);
  console.log(`    Config: ${describeConfig(cognitiveConfig)}`);
  console.log('    Memory: ' + (useMemory ? 'enabled' : 'disabled'));
  console.log(`    Tasks: ${selectedTasks.map(t => t.name).join(', ')}`);
  console.log(`    Runs per condition per task: ${numRuns}\n`);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ERROR: ANTHROPIC_API_KEY not set. Configure .env');
    process.exit(1);
  }

  const results: RunResult[] = [];

  for (const task of selectedTasks) {
    console.log(`\n━━━ Task: ${task.name} ━━━\n`);

    if (runAll || runFlat_) {
      console.log('Condition A: Flat (anthropicProvider + VirtualToolProvider)');
      for (let i = 1; i <= numRuns; i++) {
        const r = await runFlat(task, i);
        printResult(r);
        results.push(r);
      }
    }

    if (runAll || runCli) {
      console.log('\nCondition B: CLI Sub-agent (claude --print in real tmp/ dir)');
      for (let i = 1; i <= numRuns; i++) {
        const r = await runCliAgent(task, i);
        printResult(r);
        results.push(r);
      }
    }

    if (runAll || runCog) {
      console.log('\nCondition C: Cognitive (5-module merged cycle)');
      for (let i = 1; i <= numRuns; i++) {
        const r = await runCognitive(task, i, cognitiveConfig, useMemory, sharedMemoryStore?.port);
        printResult(r);
        results.push(r);
      }
      if (sharedMemoryStore) {
        const saved = await sharedMemoryStore.save();
        console.log(`    Saved ${saved} fact cards to ${memoryStorePath}`);
      }
    }
  }

  if (results.length > 1) {
    printComparison(results);
  }

  if (sharedMemoryStore) {
    const mdPath = resolve(process.cwd(), '.method/memory/exp-023-memory.md');
    await sharedMemoryStore.exportMarkdown(mdPath);
    console.log(`\nMemory exported to ${mdPath}`);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
