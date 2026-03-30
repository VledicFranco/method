/**
 * Cognitive Agent Provider v2 — multi-tool cycles, workspace persistence,
 * cost tracking, and impasse detection (PRD 040 C-2).
 *
 * Upgrade from v1 inline cycle loop to v2 architecture:
 * - Multi-tool cycles: up to maxToolsPerCycle (default 5) tool calls per cycle
 *   before the monitor evaluates
 * - Workspace persistence: workspace persists across prompts within a session
 *   (TTL-based eviction between prompts)
 * - Cost & token tracking: cumulative inputTokens, outputTokens, costUsd across
 *   all LLM calls, included in done event metadata
 * - Impasse detection: consecutive identical toolName+toolInput triggers
 *   "try a different approach" workspace injection
 *
 * Keeps the same external interface: createCognitiveSession returning PtySession.
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
import type { CognitiveSink } from './cognitive-sink.js';

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

// ── Reasoner-Actor prompt format ────────────────────────────────

const FORMAT_INSTRUCTION =
`You MUST respond with exactly three XML sections. No other text outside these tags.

<plan>Brief 2-3 step plan.</plan>
<reasoning>Your analysis and rationale.</reasoning>
<action>{"tool":"ToolName","input":{"key":"value"}}</action>

The <action> tag MUST contain valid JSON with a "tool" field matching one of the available tools.
When the task is complete, use: <action>{"tool":"done","input":{"result":"your final answer here"}}</action>

Example response:
<plan>1. Read the file. 2. Report the contents.</plan>
<reasoning>I need to read the file to answer the question.</reasoning>
<action>{"tool":"Read","input":{"path":"package.json"}}</action>`;

const READ_ONLY_ACTIONS = new Set(['Read', 'Glob', 'Grep', 'Search', 'List']);

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

    const foldedCtx: string[] = [];
    let promptInputTokens = 0, promptOutputTokens = 0;
    let interventions = 0, lastOutput = '';
    let readOnlyRun = 0, prevConf = 1.0, prevAction: string | null = null;
    let actualCycles = 0;

    // Impasse detection: track previous tool call for no-change detection
    let prevToolName: string | null = null;
    let prevToolInput: string | null = null;
    // Early bail-out: consecutive failed parses (no-action/parse-error)
    let consecutiveFailedParses = 0;
    const MAX_CONSECUTIVE_FAILED_PARSES = 3;

    for (let c = 0; c < maxCycles; c++) {
      actualCycles = c + 1;
      // Reset per-cycle: consecutive parse failures count resets at each new cycle boundary.
      // This prevents no-action in cycle N from "using up" one strike for cycle N+1.
      consecutiveFailedParses = 0;
      onEvent({ type: 'cycle-start', cycle: c + 1, maxCycles });
      // Emit CognitiveCyclePhase via sink for event bus consumers
      cognitiveSink?.handle({ type: 'cognitive:cycle_phase', phase: 'start', cycleNumber: c + 1, timestamp: Date.now() });
      ws.resetCycleQuotas();

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
          const interventionKind = interventions >= 3 ? 'reframe' : 'constrain';
          onEvent({
            type: 'monitor', cycle: c + 1,
            intervention: interventionKind,
            restricted: restricted.length > 0 ? restricted : undefined,
          });
          // Emit CognitiveControlDirective via sink for event bus consumers
          cognitiveSink?.handle({
            type: 'cognitive:control_directive',
            directive: {
              target: moduleId('reasoner-actor'),
              timestamp: Date.now(),
            },
            timestamp: Date.now(),
          });
        }
      }

      // ── Context injection ──
      if (foldedCtx.length > 0 || forceReplan) {
        const parts = [`[Cycle ${c + 1}/${maxCycles}]`];
        if (foldedCtx.length > 0) parts.push(`## Completed Actions\n${foldedCtx.join('\n')}`);
        if (forceReplan) {
          // Tailor the intervention message to the specific failure mode:
          // - no-action: agent has a plan but isn't producing a tool call → remind format
          // - other stagnation: generic "try something else"
          const noActionStall = prevAction === 'no-action' || prevAction === 'parse-error';
          parts.push(noActionStall
            ? 'Your last response had NO <action> block. You MUST end with <action>{"tool":"ToolName","input":{...}}</action>. Do not describe what you would do — call the tool directly NOW.'
            : 'MUST try a different strategy. Previous approach is stagnating.');
        }
        if (restricted.length > 0) parts.push(`RESTRICTED actions: ${restricted.join(', ')}`);
        obsPort.write({ source: moduleId('observer'), content: parts.join('\n\n'), salience: 0.9, timestamp: Date.now() });
      }

      // ── Multi-tool inner loop ──
      let toolsThisCycle = 0;
      let cycleDone = false;
      let lastActionInCycle: string | null = null;

      while (toolsThisCycle < maxToolsPerCycle) {
        // ── Reasoner-Actor (LLM call + tool exec) ──
        const wsEntries = raReadPort.read();

        const strat = forceReplan && toolsThisCycle === 0
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
            pactTemplate: { mode: { type: 'oneshot' }, budget: { maxOutputTokens: maxOutputTokens } },
          });

          const text = String(res.output);
          const inTok = res.usage.inputTokens;
          const outTok = res.usage.outputTokens;
          promptInputTokens += inTok;
          promptOutputTokens += outTok;

          if (!text.trim()) {
            onEvent({ type: 'cycle-action', cycle: c + 1, action: 'empty-response', confidence: 0.1, tokens: res.usage.totalTokens });
            cognitiveSink?.handle({ type: 'cognitive:module_step', moduleId: moduleId('reasoner-actor'), phase: 'empty-response', durationMs: 0, hasError: true, timestamp: Date.now() });
            prevConf = 0.1;
            prevAction = 'empty-response';
            lastActionInCycle = 'empty-response';
            foldedCtx.push(`[c${c + 1}] empty-response`);
            if (foldedCtx.length > 15) foldedCtx.shift();
            break; // exit inner loop on empty response
          }

          const plan = text.match(/<plan>([\s\S]*?)<\/plan>/)?.[1]?.trim() ?? '';
          const reasoning = text.match(/<reasoning>([\s\S]*?)<\/reasoning>/)?.[1]?.trim() ?? '';
          const actionRaw = text.match(/<action>([\s\S]*?)<\/action>/)?.[1]?.trim() ?? '';

          // Stream reasoning immediately (with cycle number)
          if (reasoning) {
            const chunk = `**[Cycle ${c + 1}/${maxCycles} | Tool ${toolsThisCycle + 1}]** ${reasoning}\n`;
            onEvent({ type: 'text', content: chunk });
            onChunk?.(chunk);
          }

          // Parse + execute action
          let actionName = 'unknown', confidence = 0.5;

          let parsed: { tool: string; input?: Record<string, unknown> };
          try {
            parsed = JSON.parse(actionRaw);
            consecutiveFailedParses = 0; // reset on successful parse
          } catch {
            actionName = actionRaw ? 'parse-error' : 'no-action';
            confidence = 0.2;
            prevConf = confidence;
            prevAction = actionName;
            lastActionInCycle = actionName;
            consecutiveFailedParses++;
            onEvent({ type: 'cycle-action', cycle: c + 1, action: actionName, confidence, tokens: res.usage.totalTokens });
            cognitiveSink?.handle({ type: 'cognitive:module_step', moduleId: moduleId('reasoner-actor'), phase: actionName, durationMs: 0, hasError: true, timestamp: Date.now() });
            foldedCtx.push(`[c${c + 1}] ${actionName}: ${(plan || reasoning).slice(0, 80)}`);
            if (foldedCtx.length > 15) foldedCtx.shift();

            // Early bail-out: if the model can't produce valid actions repeatedly, stop
            if (consecutiveFailedParses >= MAX_CONSECUTIVE_FAILED_PARSES) {
              lastOutput = reasoning || plan || `Model could not produce a valid action after ${MAX_CONSECUTIVE_FAILED_PARSES} attempts. Last response:\n${text.slice(0, 500)}`;
              onEvent({ type: 'text', content: `\n[cognitive] Stopping: ${MAX_CONSECUTIVE_FAILED_PARSES} consecutive parse failures. The model may not support the required output format.\n` });
              onChunk?.(`\n[cognitive] Stopping: ${MAX_CONSECUTIVE_FAILED_PARSES} consecutive parse failures.\n`);
              cognitiveSink?.handle({ type: 'cognitive:cycle_aborted', reason: `${MAX_CONSECUTIVE_FAILED_PARSES} consecutive parse failures`, phase: 'action', cycleNumber: c + 1, timestamp: Date.now() });
              cycleDone = true;
            }
            break; // exit inner loop on parse error
          }
          actionName = parsed.tool ?? 'unknown';

          if (actionName === 'done') {
            lastOutput = parsed.input?.result as string ?? reasoning ?? plan;
            onEvent({ type: 'cycle-action', cycle: c + 1, action: 'done', confidence: 1.0, tokens: res.usage.totalTokens });
            cognitiveSink?.handle({ type: 'cognitive:cycle_phase', phase: 'done', cycleNumber: c + 1, timestamp: Date.now() });
            cycleDone = true;
            break; // exit inner loop
          }

          // ── Impasse detection: consecutive identical toolName+toolInput ──
          const currentToolInput = JSON.stringify(parsed.input ?? {});
          if (prevToolName === actionName && prevToolInput === currentToolInput) {
            // Impasse detected: inject "try a different approach" into workspace
            raWritePort.write({
              source: moduleId('reasoner-actor'),
              content: '[IMPASSE] You are repeating the same action with identical input. Try a fundamentally different approach.',
              salience: 0.95, timestamp: Date.now(),
            });
            onEvent({
              type: 'monitor', cycle: c + 1,
              intervention: 'impasse-detected',
              action: actionName,
            });
            cognitiveSink?.handle({
              type: 'cognitive:control_policy_violation',
              directive: { target: moduleId('reasoner-actor'), timestamp: Date.now() },
              reason: `impasse: repeated action ${actionName} with identical input`,
              timestamp: Date.now(),
            });
          }
          prevToolName = actionName;
          prevToolInput = currentToolInput;

          try {
            const toolRes = await tools.execute(actionName, parsed.input ?? {});
            confidence = toolRes.isError ? 0.3 : 0.7;
            const resStr = typeof toolRes.output === 'string' ? toolRes.output : JSON.stringify(toolRes.output);
            raWritePort.write({
              source: moduleId('reasoner-actor'),
              content: `[${actionName}] Result:\n${resStr}`,
              salience: 0.8, timestamp: Date.now(),
            });
          } catch (toolErr) {
            const msg = toolErr instanceof Error ? toolErr.message : String(toolErr);
            confidence = 0.1;
            raWritePort.write({
              source: moduleId('reasoner-actor'),
              content: `[${actionName}] Tool error: ${msg}`,
              salience: 0.8, timestamp: Date.now(),
            });
          }

          prevConf = confidence;
          prevAction = actionName;
          lastActionInCycle = actionName;
          onEvent({ type: 'cycle-action', cycle: c + 1, action: actionName, confidence, tokens: res.usage.totalTokens });
          cognitiveSink?.handle({ type: 'cognitive:module_step', moduleId: moduleId('reasoner-actor'), phase: actionName, durationMs: 0, hasError: confidence < 0.5, timestamp: Date.now() });

          foldedCtx.push(`[c${c + 1}] ${actionName}: ${(plan || reasoning).slice(0, 80)}`);
          if (foldedCtx.length > 15) foldedCtx.shift();

          toolsThisCycle++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          onEvent({ type: 'cycle-action', cycle: c + 1, action: 'error', confidence: 0, tokens: 0 });
          onEvent({ type: 'text', content: `\n[cycle ${c + 1}] Error: ${msg}\n` });
          onChunk?.(`\n[cycle ${c + 1}] Error: ${msg}\n`);
          cognitiveSink?.handle({ type: 'cognitive:cycle_aborted', reason: msg, phase: 'action', cycleNumber: c + 1, timestamp: Date.now() });
          break; // exit inner loop on error
        }
      }

      // Update lastActionInCycle for monitor tracking
      if (lastActionInCycle) {
        prevAction = lastActionInCycle;
      }

      if (cycleDone) break; // exit outer loop
    }

    // ── Accumulate into session-level totals ──
    sessionInputTokens += promptInputTokens;
    sessionOutputTokens += promptOutputTokens;
    const promptCostUsd = promptInputTokens * INPUT_COST_PER_TOKEN + promptOutputTokens * OUTPUT_COST_PER_TOKEN;
    sessionCostUsd += promptCostUsd;

    const totalTokens = promptInputTokens + promptOutputTokens;

    const output = lastOutput ||
      (foldedCtx.length > 0
        ? `Cycle limit reached. Summary of actions:\n${foldedCtx.slice(-5).join('\n')}`
        : '(no output — cycle limit reached)');
    onEvent({
      type: 'done', output,
      metadata: {
        totalTokens,
        totalCycles: actualCycles,
        monitorInterventions: interventions,
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
