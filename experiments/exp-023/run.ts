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
import type { AggregatedSignals, ActorMonitoring } from '../../packages/pacta/src/cognitive/algebra/index.js';

import { createReasoner, type ReasonerControl } from '../../packages/pacta/src/cognitive/modules/reasoner.js';
import { createActor, type ActorControl } from '../../packages/pacta/src/cognitive/modules/actor.js';
import { createObserver } from '../../packages/pacta/src/cognitive/modules/observer.js';
import { createMemoryModule } from '../../packages/pacta/src/cognitive/modules/memory-module.js';
import { createMonitor } from '../../packages/pacta/src/cognitive/modules/monitor.js';

import type { MemoryPort, MemoryEntry } from '../../packages/pacta/src/ports/memory-port.js';
import type { ReadonlyWorkspaceSnapshot, SalienceContext } from '../../packages/pacta/src/cognitive/algebra/index.js';

import { TASK_01 } from './task-01-circular-dep.js';

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

// ── Simple In-Memory MemoryPort ─────────────────────────────────

function createSimpleMemory(): MemoryPort {
  const store = new Map<string, string>();
  return {
    async store(key: string, value: string) { store.set(key, value); },
    async retrieve(key: string) { return store.get(key) ?? null; },
    async search(_query: string, _limit?: number) { return [] as MemoryEntry[]; },
  };
}

// ── Condition A: Flat Agent ─────────────────────────────────────

async function runFlat(task: typeof TASK_01, runNumber: number): Promise<RunResult> {
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

async function runCliAgent(task: typeof TASK_01, runNumber: number): Promise<RunResult> {
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

// ── Condition C: Cognitive Agent ─────────────────────────────────

async function runCognitive(task: typeof TASK_01, runNumber: number): Promise<RunResult> {
  const startTime = Date.now();
  const vfs = new VirtualToolProvider(task.initialFiles);

  // Provider for Reasoner/Planner (single-turn, no tools)
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
    goals: ['break circular dependency', 'preserve functionality'],
    sourcePriorities: new Map([
      [moduleId('reasoner'), 0.9],
      [moduleId('actor'), 0.7],
      [moduleId('observer'), 0.6],
    ]),
  };
  const workspace = createWorkspace({ capacity: 8 }, salienceContext);
  const memory = createSimpleMemory();
  // Create modules with workspace ports
  const observer = createObserver(workspace.getWritePort(moduleId('observer')));
  const memoryModule = createMemoryModule(memory, workspace.getWritePort(moduleId('memory')));
  const reasoner = createReasoner(adapter, workspace.getWritePort(moduleId('reasoner')));
  const actor = createActor(vfs, workspace.getWritePort(moduleId('actor')));
  const monitor = createMonitor({ confidenceThreshold: 0.3 });

  // Cycle state
  let totalTokens = 0;
  let providerCalls = 0;
  let monitorInterventions = 0;
  const allToolCalls: Array<{ tool: string; input: unknown; success: boolean }> = [];

  const MAX_CYCLES = 12;
  const reasonerControl: ReasonerControl = { target: moduleId('reasoner'), timestamp: Date.now(), strategy: 'plan', effort: 'medium' };
  const actorControl: ActorControl = { target: moduleId('actor'), timestamp: Date.now() };

  // Module states (persisted across cycles)
  let observerState = observer.initialState();
  memoryModule.initialState(); // initialise but module runs passively
  let reasonerState = reasoner.initialState();
  let actorState = actor.initialState();
  let monitorState = monitor.initialState();
  let prevActorMonitoring: ActorMonitoring | null = null;

  try {
    for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
      // 1. OBSERVE — feed task description (first cycle) or cycle continuation
      const observerInput = cycle === 0
        ? { content: task.description }
        : { content: `Cycle ${cycle + 1}: continue working on the task.` };
      const obsResult = await observer.step(observerInput, observerState, { target: moduleId('observer'), timestamp: Date.now() } as any);
      observerState = obsResult.state;

      // 2. REASON — get workspace snapshot, ask LLM what to do
      const snapshot: ReadonlyWorkspaceSnapshot = workspace.getReadPort(moduleId('reasoner')).read();
      const reasonResult = await reasoner.step({ snapshot }, reasonerState, reasonerControl);
      reasonerState = reasonResult.state;
      providerCalls++;
      totalTokens += reasonResult.monitoring.tokensThisStep ?? 0;

      // 3. MONITOR — always run with reasoner signal + previous cycle's actor signal
      const monitorSignals: AggregatedSignals = new Map();
      monitorSignals.set(moduleId('reasoner'), reasonResult.monitoring);
      if (prevActorMonitoring) {
        monitorSignals.set(moduleId('actor'), prevActorMonitoring);
      }
      const monResult = await monitor.step(monitorSignals, monitorState, { target: moduleId('monitor'), timestamp: Date.now() } as any);
      monitorState = monResult.state;
      if (monResult.monitoring.anomalyDetected) {
        monitorInterventions++;
        // Strategy shift: switch to 'think' for deeper deliberation
        reasonerControl.strategy = 'think';
      }

      // 4. ACT — execute the action instruction from Reasoner
      const actorSnapshot: ReadonlyWorkspaceSnapshot = workspace.getReadPort(moduleId('actor')).read();
      const actResult = await actor.step({ snapshot: actorSnapshot }, actorState, actorControl);
      actorState = actResult.state;
      prevActorMonitoring = actResult.monitoring;

      if (actResult.output.result) {
        allToolCalls.push({
          tool: actResult.output.actionName,
          input: actResult.output.result,
          success: actResult.monitoring.success,
        });
      }

      // Per-cycle trace logging
      const monitorTag = monResult.monitoring.anomalyDetected ? ' ⚠ monitor' : '';
      console.log(`    [cycle ${cycle + 1}] ${actResult.output.actionName}  conf=${reasonResult.monitoring.confidence.toFixed(2)}  tok=${reasonResult.monitoring.tokensThisStep ?? 0}${monitorTag}`);

      // Check for completion
      if (actResult.output.actionName === 'done') {
        break;
      }
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

  const runsArg = args.find(a => a.startsWith('--runs=') || a === '--runs');
  let numRuns = 1;
  if (runsArg) {
    const next = runsArg.includes('=') ? runsArg.split('=')[1] : args[args.indexOf('--runs') + 1];
    numRuns = parseInt(next ?? '1', 10) || 1;
  }

  console.log('\n=== EXP-023: A/A/B — Flat vs CLI Sub-agent vs Cognitive ===');
  console.log(`    Conditions: ${[runAll || runFlat_ ? 'A(flat)' : '', runAll || runCli ? 'B(cli-agent)' : '', runAll || runCog ? 'C(cognitive)' : ''].filter(Boolean).join(', ')}`);
  console.log(`    Runs per condition: ${numRuns}\n`);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ERROR: ANTHROPIC_API_KEY not set. Configure .env');
    process.exit(1);
  }

  const results: RunResult[] = [];

  if (runAll || runFlat_) {
    console.log('Condition A: Flat (anthropicProvider + VirtualToolProvider)');
    for (let i = 1; i <= numRuns; i++) {
      const r = await runFlat(TASK_01, i);
      printResult(r);
      results.push(r);
    }
  }

  if (runAll || runCli) {
    console.log('\nCondition B: CLI Sub-agent (claude --print in real tmp/ dir)');
    for (let i = 1; i <= numRuns; i++) {
      const r = await runCliAgent(TASK_01, i);
      printResult(r);
      results.push(r);
    }
  }

  if (runAll || runCog) {
    console.log('\nCondition C: Cognitive (8-module cycle + VirtualToolProvider)');
    for (let i = 1; i <= numRuns; i++) {
      const r = await runCognitive(TASK_01, i);
      printResult(r);
      results.push(r);
    }
  }

  if (results.length > 1) {
    printComparison(results);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
