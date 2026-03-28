/**
 * Cognitive Agent Provider — runs the cognitive cycle as a bridge session (PRD 033).
 *
 * Instead of spawning `claude --print`, this provider runs the 5-module cognitive cycle
 * (observer -> monitor -> reasoner-actor) internally, emitting cycle-by-cycle events
 * via the onEvent callback for real-time frontend visualization.
 *
 * Pattern: experiments/exp-023/run.ts lines 362-660 (manual cycle loop).
 * Does NOT use createCognitiveAgent (which requires all 8 modules).
 */

import PQueue from 'p-queue';
import type {
  ReadonlyWorkspaceSnapshot,
  SalienceContext,
  ProviderAdapter,
  WorkspaceManager,
  ToolProvider,
} from '@method/pacta';
import { moduleId, createWorkspace } from '@method/pacta';
import type { PtySession, SessionStatus, StreamChunkCallback } from './print-session.js';
import type { StreamEvent } from './pool.js';

// ── Configuration ───────────────────────────────────────────────

export interface CognitiveSessionConfig {
  name?: string;
  patterns?: string[];
  maxCycles?: number;              // default 15
  workspaceCapacity?: number;      // default 8
  confidenceThreshold?: number;    // default 0.3
  stagnationThreshold?: number;    // default 2
  interventionBudget?: number;     // default 5
}

export interface CognitiveSessionOptions {
  id: string;
  workdir: string;
  onEvent: (event: StreamEvent) => void;
  adapter: ProviderAdapter;
  tools: ToolProvider;
  config?: CognitiveSessionConfig;
  initialPrompt?: string;
}

// ── Reasoner-Actor prompt format ────────────────────────────────

const FORMAT_INSTRUCTION =
`Respond in exactly three XML sections:
<plan>Brief 2-3 step plan.</plan>
<reasoning>Analysis and rationale.</reasoning>
<action>{"tool":"ToolName","input":{...}}</action>
Use tool "done" with {"result":"summary"} when the task is complete.`;

const READ_ONLY_ACTIONS = new Set(['Read', 'Glob', 'Grep', 'Search', 'List']);

// ── Factory ─────────────────────────────────────────────────────

export function createCognitiveSession(options: CognitiveSessionOptions): PtySession {
  const { id, workdir, onEvent, adapter, tools, config: cfg, initialPrompt } = options;
  const maxCycles = cfg?.maxCycles ?? 15;
  const wsCapacity = cfg?.workspaceCapacity ?? 8;
  const confThreshold = cfg?.confidenceThreshold ?? 0.3;
  const stagThreshold = cfg?.stagnationThreshold ?? 2;
  const intBudget = cfg?.interventionBudget ?? 5;

  const queue = new PQueue({ concurrency: 1 });
  let status: SessionStatus = 'ready';
  let promptCount = 0;
  let lastActivityAt = new Date();
  let transcript = '';
  const outputSubs = new Set<(data: string) => void>();
  const exitCbs: Array<(code: number) => void> = [];
  const getStatus = (): SessionStatus => status;

  function notify(data: string): void {
    for (const sub of outputSubs) { try { sub(data); } catch { /* */ } }
  }

  // ── Cognitive cycle ─────────────────────────────────────────

  async function runCycle(prompt: string, onChunk?: StreamChunkCallback): Promise<string> {
    const ctx: SalienceContext = {
      now: Date.now(),
      goals: ['complete the task', 'produce correct output'],
      sourcePriorities: new Map([
        [moduleId('reasoner-actor'), 0.9],
        [moduleId('observer'), 0.6],
      ]),
    };
    const ws: WorkspaceManager = createWorkspace({ capacity: wsCapacity }, ctx);
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

    const foldedCtx: string[] = [];
    let totalTokens = 0, interventions = 0, lastOutput = '';
    let readOnlyRun = 0, prevConf = 1.0, prevAction: string | null = null;

    for (let c = 0; c < maxCycles; c++) {
      onEvent({ type: 'cycle-start', cycle: c + 1, maxCycles });

      // ── Monitor (inline) ──
      let forceReplan = false;
      const restricted: string[] = [];

      if (c > 0) {
        if (prevAction && READ_ONLY_ACTIONS.has(prevAction)) readOnlyRun++;
        else readOnlyRun = 0;

        const anomaly = prevConf < confThreshold || readOnlyRun >= stagThreshold;
        if (anomaly && interventions < intBudget) {
          interventions++;
          forceReplan = true;
          if (interventions < 3 && prevAction) restricted.push(prevAction);
          onEvent({
            type: 'monitor', cycle: c + 1,
            intervention: interventions >= 3 ? 'reframe' : 'constrain',
            restricted: restricted.length > 0 ? restricted : undefined,
          });
        }
      }

      // ── Context injection ──
      if (foldedCtx.length > 0 || forceReplan) {
        const parts = [`[Cycle ${c + 1}/${maxCycles}]`];
        if (foldedCtx.length > 0) parts.push(`## Completed Actions\n${foldedCtx.join('\n')}`);
        if (forceReplan) parts.push('MUST try a different strategy. Previous approach is stagnating.');
        if (restricted.length > 0) parts.push(`RESTRICTED actions: ${restricted.join(', ')}`);
        obsPort.write({ source: moduleId('observer'), content: parts.join('\n\n'), salience: 0.9, timestamp: Date.now() });
      }

      // ── Reasoner-Actor (LLM call + tool exec) ──
      const wsEntries = raReadPort.read();

      const strat = forceReplan
        ? 'Consider the problem deeply. Weigh alternatives and identify the strongest path.'
        : 'Produce a structured plan with numbered steps. Identify dependencies and risks.';
      const toolList = tools.list().map((t) => `- ${t.name}: ${t.description ?? ''}`).join('\n');

      // Build a synthetic snapshot: strategy + tools + format + workspace entries
      const now = Date.now();
      const syntheticSnapshot: ReadonlyWorkspaceSnapshot = [
        { source: moduleId('observer'), content: strat, salience: 1.0, timestamp: now },
        { source: moduleId('observer'), content: `Available tools:\n${toolList}`, salience: 0.95, timestamp: now },
        { source: moduleId('observer'), content: FORMAT_INSTRUCTION, salience: 0.95, timestamp: now },
        ...wsEntries,
      ];

      try {
        const res = await adapter.invoke(syntheticSnapshot, {
          pactTemplate: { mode: { type: 'oneshot' }, budget: { maxOutputTokens: 2048 } },
        });

        const text = String(res.output);
        const tok = res.usage.totalTokens;
        totalTokens += tok;

        const plan = text.match(/<plan>([\s\S]*?)<\/plan>/)?.[1]?.trim() ?? '';
        const reasoning = text.match(/<reasoning>([\s\S]*?)<\/reasoning>/)?.[1]?.trim() ?? '';
        const actionRaw = text.match(/<action>([\s\S]*?)<\/action>/)?.[1]?.trim() ?? '';

        // Stream reasoning
        if (reasoning) {
          const chunk = `**[Cycle ${c + 1}]** ${reasoning}\n`;
          onEvent({ type: 'text', content: chunk });
          onChunk?.(chunk);
        }

        // Parse + execute action
        let actionName = 'unknown', confidence = 0.5;
        try {
          const parsed = JSON.parse(actionRaw);
          actionName = parsed.tool ?? 'unknown';

          if (actionName === 'done') {
            lastOutput = parsed.input?.result ?? reasoning ?? plan;
            onEvent({ type: 'cycle-action', cycle: c + 1, action: 'done', confidence: 1.0, tokens: tok });
            break;
          }

          const toolRes = await tools.execute(actionName, parsed.input ?? {});
          confidence = toolRes.isError ? 0.3 : 0.7;
          const resStr = typeof toolRes.output === 'string' ? toolRes.output : JSON.stringify(toolRes.output);
          raWritePort.write({
            source: moduleId('reasoner-actor'),
            content: `[${actionName}] Result:\n${resStr}`,
            salience: 0.8, timestamp: Date.now(),
          });
        } catch {
          actionName = actionRaw ? 'parse-error' : 'no-action';
          confidence = 0.2;
        }

        prevConf = confidence;
        prevAction = actionName;
        onEvent({ type: 'cycle-action', cycle: c + 1, action: actionName, confidence, tokens: tok });

        foldedCtx.push(`[c${c + 1}] ${actionName}: ${(plan || reasoning).slice(0, 80)}`);
        if (foldedCtx.length > 15) foldedCtx.shift();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        onEvent({ type: 'cycle-action', cycle: c + 1, action: 'error', confidence: 0, tokens: 0 });
        onEvent({ type: 'text', content: `\n[cycle ${c + 1}] Error: ${msg}\n` });
        onChunk?.(`\n[cycle ${c + 1}] Error: ${msg}\n`);
      }
    }

    const output = lastOutput || '(no output — cycle limit reached)';
    onEvent({
      type: 'done', output,
      metadata: { totalTokens, totalCycles: maxCycles, monitorInterventions: interventions, workdir },
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
