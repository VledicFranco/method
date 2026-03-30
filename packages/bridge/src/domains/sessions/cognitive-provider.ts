/**
 * Cognitive Agent Provider v3 — manual module composition (PRD 042 Phase 4).
 *
 * Architecture: BridgeMonitorModule + BridgeReasonerActorModule composed in a
 * manual for-loop with monitor-first execution order. Module factories from
 * cognitive-modules.ts encapsulate all behavioral logic (11 fixes from PRDs
 * 033/040/041). This file owns the outer cycle engine and session lifecycle.
 *
 * Execution order per cycle:
 *   1. Monitor reads last cycle's RA monitoring -> produces BridgeMonitorControl
 *   2. RA runs inner while-loop with monitor's control applied immediately
 *
 * External interface unchanged: createCognitiveSession returning PtySession.
 */

import PQueue from 'p-queue';
import type {
  SalienceContext,
  ProviderAdapter,
  WorkspaceManager,
  ToolProvider,
} from '@method/pacta';
import { moduleId, createWorkspace } from '@method/pacta';
import type { PtySession, SessionStatus, StreamChunkCallback } from './print-session.js';
import type { StreamEvent } from './pool.js';
import type { CognitiveSink } from './cognitive-sink.js';
import {
  createBridgeReasonerActorModule,
  createBridgeMonitorModule,
} from './cognitive-modules.js';
import type {
  BridgeReasonerActorMonitoring,
  BridgeMonitorControl,
} from './cognitive-modules.js';

// ── Configuration ───────────────────────────────────────────────

export interface CognitiveSessionConfig {
  name?: string;
  patterns?: string[];
  maxCycles?: number;              // default 15
  maxToolsPerCycle?: number;       // default 5
  workspaceCapacity?: number;      // default 8
  confidenceThreshold?: number;    // default 0.3
  stagnationThreshold?: number;    // default 2
  interventionBudget?: number;     // default 5
  maxOutputTokens?: number;        // default 8192 — max tokens per LLM call (2048 caused no-action loops on large Write ops)
}

export interface CognitiveSessionOptions {
  id: string;
  workdir: string;
  onEvent: (event: StreamEvent) => void;
  adapter: ProviderAdapter;
  tools: ToolProvider;
  config?: CognitiveSessionConfig;
  initialPrompt?: string;
  /** Optional CognitiveSink for emitting typed CognitiveEvents to the bridge event bus (PRD 026). */
  cognitiveSink?: CognitiveSink;
}

// ── Cost estimation constants ───────────────────────────────────
// Sonnet ~$3/$15 per M tokens (input/output). Order of magnitude is fine.
const INPUT_COST_PER_TOKEN = 3.0 / 1_000_000;
const OUTPUT_COST_PER_TOKEN = 15.0 / 1_000_000;

// ── Factory ─────────────────────────────────────────────────────

export function createCognitiveSession(options: CognitiveSessionOptions): PtySession {
  const { id, workdir, onEvent, adapter, tools, config: cfg, initialPrompt, cognitiveSink } = options;
  const maxCycles = cfg?.maxCycles ?? 15;
  const maxToolsPerCycle = cfg?.maxToolsPerCycle ?? 5;
  const wsCapacity = cfg?.workspaceCapacity ?? 8;
  const confThreshold = cfg?.confidenceThreshold ?? 0.3;
  const stagThreshold = cfg?.stagnationThreshold ?? 2;
  const intBudget = cfg?.interventionBudget ?? 5;
  // 8192 gives enough room for Write tool calls on large outputs (reports, code files).
  // 2048 caused no-action loops: plan used most tokens, leaving no room for the action JSON.
  const maxOutputTokens = cfg?.maxOutputTokens ?? 8192;

  const queue = new PQueue({ concurrency: 1 });
  let status: SessionStatus = 'ready';
  let promptCount = 0;
  let lastActivityAt = new Date();
  let transcript = '';
  const outputSubs = new Set<(data: string) => void>();
  const exitCbs: Array<(code: number) => void> = [];
  const getStatus = (): SessionStatus => status;

  // ── Session-level workspace (persists across prompts) ─────────
  const salienceCtx: SalienceContext = {
    now: Date.now(),
    goals: ['complete the task', 'produce correct output'],
    sourcePriorities: new Map([
      [moduleId('reasoner-actor'), 0.9],
      [moduleId('observer'), 0.6],
    ]),
  };
  const ws: WorkspaceManager = createWorkspace({ capacity: wsCapacity }, salienceCtx);

  // ── Session-level cumulative token/cost tracking ──────────────
  let sessionInputTokens = 0;
  let sessionOutputTokens = 0;
  let sessionCostUsd = 0;

  function notify(data: string): void {
    for (const sub of outputSubs) { try { sub(data); } catch { /* */ } }
  }

  // ── Cognitive cycle ─────────────────────────────────────────

  async function runCycle(prompt: string, onChunk?: StreamChunkCallback): Promise<string> {
    const obsPort = ws.getWritePort(moduleId('observer'));
    const raWritePort = ws.getWritePort(moduleId('reasoner-actor'));
    const raReadPort = ws.getReadPort(moduleId('reasoner-actor'));

    // Observer: seed workspace with task
    obsPort.write({ source: moduleId('observer'), content: prompt, salience: 0.95, timestamp: Date.now() });
    obsPort.write({
      source: moduleId('observer'),
      content: `## TASK\n${prompt}\nComplete the task, then call "done". Do not continue after solving it.`,
      salience: 0.95, timestamp: Date.now(),
    });

    let promptInputTokens = 0, promptOutputTokens = 0;
    let lastOutput = '';
    let actualCycles = 0;

    // ── Instantiate modules — per-prompt, session-scoped dependencies injected ──
    const monitorPort = ws.getWritePort(moduleId('monitor'));
    const raConfig = {
      maxToolsPerCycle, maxOutputTokens, wsCapacity, cycleNumber: 1, maxCycles,
    };
    const raModule = createBridgeReasonerActorModule(
      adapter, tools, ws, raWritePort, raReadPort, obsPort, raConfig, onEvent, cognitiveSink,
    );
    const monModule = createBridgeMonitorModule(
      ws, monitorPort, wsCapacity,
      { confThreshold, stagThreshold, intBudget },
      onEvent, cognitiveSink,
    );

    // State initialized per-prompt (not per-session).
    let raState = raModule.initialState();
    let monState = monModule.initialState();
    let lastRAMonitoring: BridgeReasonerActorMonitoring | null = null;

    for (let c = 0; c < maxCycles; c++) {
      actualCycles = c + 1;
      onEvent({ type: 'cycle-start', cycle: c + 1, maxCycles });
      cognitiveSink?.handle({ type: 'cognitive:cycle_phase', phase: 'start', cycleNumber: c + 1, timestamp: Date.now() });
      ws.resetCycleQuotas();

      // Update cycle number in RA config (mutable field).
      raConfig.cycleNumber = c + 1;

      // Monitor runs FIRST — reads last cycle's RA monitoring, produces control.
      // On cycle 0, lastRAMonitoring is null → monitor returns defaultControl (no interventions).
      const monResult = await monModule.step(
        lastRAMonitoring,
        monState,
        { target: moduleId('monitor'), timestamp: Date.now() },
      );
      monState = monResult.state;
      const control: BridgeMonitorControl = monResult.output;

      // RA runs SECOND — with this cycle's monitor control applied immediately.
      const raResult = await raModule.step(prompt, raState, control);
      raState = raResult.state;
      lastRAMonitoring = raResult.monitoring;

      // Accumulate token totals from per-cycle deltas.
      promptInputTokens += raResult.monitoring.promptInputTokens;
      promptOutputTokens += raResult.monitoring.promptOutputTokens;

      if (raResult.monitoring.cycleDone) {
        lastOutput = raResult.monitoring.lastOutput;
        break;
      }
    }

    // ── Accumulate into session-level totals ──
    sessionInputTokens += promptInputTokens;
    sessionOutputTokens += promptOutputTokens;
    const promptCostUsd = promptInputTokens * INPUT_COST_PER_TOKEN + promptOutputTokens * OUTPUT_COST_PER_TOKEN;
    sessionCostUsd += promptCostUsd;

    const totalTokens = promptInputTokens + promptOutputTokens;

    const output = lastOutput ||
      (raState.foldedCtx.length > 0
        ? `Cycle limit reached. Summary of actions:\n${raState.foldedCtx.slice(-5).join('\n')}`
        : '(no output — cycle limit reached)');
    onEvent({
      type: 'done', output,
      metadata: {
        totalTokens,
        totalCycles: actualCycles,
        monitorInterventions: monState.interventions,
        costUsd: promptCostUsd,
        inputTokens: promptInputTokens,
        outputTokens: promptOutputTokens,
        sessionCostUsd,
        sessionInputTokens,
        sessionOutputTokens,
        workdir,
      },
    });
    return output;
  }

  // ── Shared prompt execution ─────────────────────────────────

  function execPrompt(prompt: string, onChunk?: StreamChunkCallback): Promise<{ output: string; timedOut: boolean }> {
    if (status === 'dead') return Promise.reject(new Error(`Session ${id} is dead`));
    return queue.add(async () => {
      if (status === 'dead') throw new Error(`Session ${id} is dead`);
      status = 'working';
      promptCount++;
      lastActivityAt = new Date();
      notify(`\n[cognitive] Prompt #${promptCount}...\n`);
      try {
        const output = await runCycle(prompt, onChunk);
        transcript += `\n--- Prompt #${promptCount} ---\n${prompt}\n--- Response ---\n${output}\n`;
        notify(output);
        lastActivityAt = new Date();
        if (getStatus() !== 'dead') status = 'ready';
        return { output, timedOut: false };
      } catch (err) {
        lastActivityAt = new Date();
        if (getStatus() !== 'dead') status = 'ready';
        const msg = (err as Error).message;
        notify(`\n[cognitive] Error: ${msg}\n`);
        return { output: `Error: ${msg}`, timedOut: false };
      }
    }) as Promise<{ output: string; timedOut: boolean }>;
  }

  // ── PtySession ────────────────────────────────────────────────

  const session: PtySession = {
    id,
    get pid() { return null; },
    get status() { return status; },
    set status(s: SessionStatus) { status = s; },
    get queueDepth() { return queue.size + queue.pending; },
    get promptCount() { return promptCount; },
    set promptCount(n: number) { promptCount = n; },
    get lastActivityAt() { return lastActivityAt; },
    set lastActivityAt(d: Date) { lastActivityAt = d; },
    get transcript() { return transcript; },
    onOutput(cb: (data: string) => void) { outputSubs.add(cb); return () => { outputSubs.delete(cb); }; },
    onExit(cb: (code: number) => void) { exitCbs.push(cb); },
    sendPrompt(p: string) { return execPrompt(p); },
    sendPromptStream(p: string, onChunk: StreamChunkCallback) { return execPrompt(p, onChunk); },
    resize() { /* no PTY */ },
    kill() {
      status = 'dead';
      outputSubs.clear();
      for (const cb of exitCbs) { try { cb(0); } catch { /* */ } }
    },
    interrupt() { return false; },
    get adaptiveSettle() { return null; },
  };

  if (initialPrompt) {
    session.sendPrompt(initialPrompt).catch(() => { /* non-fatal */ });
  }

  return session;
}
