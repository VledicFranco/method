// SPDX-License-Identifier: Apache-2.0
/**
 * Bridge Cognitive Modules — CognitiveModule implementations extracted from
 * the monolithic cognitive-provider.ts inline loop.
 *
 * BridgeReasonerActorModule: extracts the inner while-loop (multi-tool cycle)
 * BridgeMonitorModule: extracts the inline monitor block (anomaly, write gate, etc.)
 *
 * All 11 behavioral fixes from PRDs 033/040/041 remain intact inside these modules.
 * The refactor is structural, not behavioral.
 *
 * PRD 042 Phase 1-3: Module Type Definitions + Factories
 */

import type {
  CognitiveModule,
  MonitoringSignal,
  ControlDirective,
  StepResult,
  ReadonlyWorkspaceSnapshot,
  ProviderAdapter,
  WorkspaceManager,
  WorkspaceReadPort,
  WorkspaceWritePort,
  ToolProvider,
} from '@methodts/pacta';
import { moduleId } from '@methodts/pacta';
import type { StreamEvent } from './pool.js';
import type { StreamChunkCallback } from './print-session.js';
import type { CognitiveEventBusSink as CognitiveSink } from './cognitive-sink.js';

// ── Constants (duplicated from cognitive-provider.ts — forbidden to import) ──

const FORMAT_INSTRUCTION =
`You MUST respond with exactly three XML sections. No other text outside these tags.

<plan>Brief 2-3 step plan.</plan>
<reasoning>Your analysis and rationale.</reasoning>
<action>{"tool":"ToolName","input":{"key":"value"}}</action>

The <action> tag MUST contain valid JSON with a "tool" field matching one of the available tools.
When the task is complete, use: <action>{"tool":"done","input":{"result":"your final answer here"}}</action>

CRITICAL RULE — If you see "[\\u2713 DELIVERABLE WRITTEN" anywhere in your context, the task output is already saved. Your ONLY valid next action is done. Do not read, write, or research further.

IMPORTANT — For Write operations with large or multi-line content, use a <content> block INSTEAD of putting content in the JSON. This avoids JSON escaping issues:
<action>{"tool":"Write","input":{"path":"output.md"}}</action>
<content>
...your multi-line content here, no escaping needed...
</content>

Example response:
<plan>1. Read the file. 2. Report the contents.</plan>
<reasoning>I need to read the file to answer the question.</reasoning>
<action>{"tool":"Read","input":{"path":"package.json"}}</action>`;

export const READ_ONLY_ACTIONS = new Set(['Read', 'Glob', 'Grep', 'Search', 'List']);

const MAX_CONSECUTIVE_FAILED_PARSES = 3;

// ── Type Definitions ───────────────────────────────────────────────

/** Control issued by BridgeMonitorModule, consumed by RA on the same cycle. */
export interface BridgeMonitorControl extends ControlDirective {
  forceReplan: boolean;
  restricted: string[];
  interventionMessage: string | null;
  writeGateFired: boolean;
  prevCycleAction: string | null;
}

/** Persistent state for one prompt's worth of ReasonerActor execution. */
export interface BridgeReasonerActorState {
  foldedCtx: string[];                // last 15 completed actions
  promptSuccessfulReads: number;      // reads since last write (write gate counter)
  promptSuccessfulWrites: number;
  writeGateFired: boolean;
  // NOTE: prevSemanticKey is NOT in state — it is a within-step local.
  // Impasse detection compares actions within a single step() call's inner loop,
  // not across cycles. Reset to null at the start of each step().
}

/** Monitoring signal emitted per cycle for the Monitor to read next cycle. */
export interface BridgeReasonerActorMonitoring extends MonitoringSignal {
  type: 'bridge-reasoner-actor';
  prevConf: number;
  prevAction: string | null;
  consecutiveFailedParses: number;
  wsUtilization: number;              // entries / capacity
  promptInputTokens: number;          // per-cycle delta
  promptOutputTokens: number;         // per-cycle delta
  writeGateFired: boolean;
  promptSuccessfulReads: number;
  promptSuccessfulWrites: number;
  cycleDone: boolean;                 // true if 'done' or circuit-breaker fired
  lastOutput: string;                 // result if cycleDone; diagnostic string on circuit-breaker
}

/** Persistent monitor state across cycles within a single prompt. */
export interface BridgeMonitorState {
  readOnlyRun: number;                // consecutive read-only cycles
  interventions: number;              // total interventions fired this prompt
  accumulatedInputTokens: number;     // running total for 100k threshold check
}

/** Type alias for the BridgeReasonerActorModule. */
export type BridgeReasonerActorModuleType = CognitiveModule<
  string,                             // input: the current prompt
  BridgeReasonerActorMonitoring,      // output: same as monitoring for caller convenience
  BridgeReasonerActorState,
  BridgeReasonerActorMonitoring,
  BridgeMonitorControl
>;

/** Type alias for the BridgeMonitorModule. */
export type BridgeMonitorModuleType = CognitiveModule<
  BridgeReasonerActorMonitoring | null, // input: last cycle's RA monitoring (null on first cycle)
  BridgeMonitorControl,                 // output: control directives for this cycle's RA
  BridgeMonitorState,
  MonitoringSignal,                     // monitor's own monitoring
  ControlDirective                      // base type — monitor accepts no meaningful control
>;

// ── Config Interfaces ──────────────────────────────────────────────

export interface ReasonerActorModuleConfig {
  maxToolsPerCycle: number;
  maxOutputTokens: number;
  wsCapacity: number;
  cycleNumber: number;       // mutable — updated by the outer loop each cycle
  maxCycles: number;
}

export interface MonitorModuleConfig {
  confThreshold: number;
  stagThreshold: number;
  intBudget: number;
}

// ── Helper ─────────────────────────────────────────────────────────

/** Returns the default monitor control (no interventions). */
export function defaultBridgeMonitorControl(): BridgeMonitorControl {
  return {
    target: moduleId('reasoner-actor'),
    timestamp: Date.now(),
    forceReplan: false,
    restricted: [],
    interventionMessage: null,
    writeGateFired: false,
    prevCycleAction: null,
  };
}

// ── BridgeReasonerActorModule Factory ──────────────────────────────

/**
 * Creates a BridgeReasonerActorModule that extracts the inner while-loop
 * from cognitive-provider.ts into a CognitiveModule implementation.
 *
 * All 11 behavioral fixes remain inside:
 * - Write-completion hint (salience 1.0 after successful Write)
 * - Write gate counters (promptSuccessfulReads/Writes, writeGateFired)
 * - Impasse detection (exact-match semantic key, within-step local)
 * - Parse failure circuit-breaker (consecutiveFailedParses >= 3)
 * - Content block handling (<content> tag for Write)
 * - Truncation hint (Read result truncation message)
 */
export function createBridgeReasonerActorModule(
  adapter: ProviderAdapter,
  tools: ToolProvider,
  ws: WorkspaceManager,
  raWritePort: WorkspaceWritePort,
  raReadPort: WorkspaceReadPort,
  obsPort: WorkspaceWritePort,
  config: ReasonerActorModuleConfig,
  onEvent: (e: StreamEvent) => void,
  cognitiveSink?: CognitiveSink,
  onChunk?: StreamChunkCallback,
): BridgeReasonerActorModuleType {
  const raModuleId = moduleId('reasoner-actor');

  return {
    id: raModuleId,

    initialState(): BridgeReasonerActorState {
      return {
        foldedCtx: [],
        promptSuccessfulReads: 0,
        promptSuccessfulWrites: 0,
        writeGateFired: false,
      };
    },

    async step(
      prompt: string,
      state: BridgeReasonerActorState,
      control: BridgeMonitorControl,
    ): Promise<StepResult<BridgeReasonerActorMonitoring, BridgeReasonerActorState, BridgeReasonerActorMonitoring>> {
      // Clone state for immutability
      const foldedCtx = [...state.foldedCtx];
      let promptSuccessfulReads = state.promptSuccessfulReads;
      let promptSuccessfulWrites = state.promptSuccessfulWrites;
      let writeGateFired = state.writeGateFired;

      // Per-cycle locals
      let prevSemanticKey: string | null = null;
      let consecutiveFailedParses = 0;
      let cycleDone = false;
      let lastOutput = '';
      let prevConf = 1.0;
      let prevAction: string | null = null;
      let cycleInputTokens = 0;
      let cycleOutputTokens = 0;

      const { maxToolsPerCycle, maxOutputTokens, wsCapacity, cycleNumber, maxCycles } = config;
      // Bug 1 fix: propagate writeGateFired from monitor control into RA state
      if (control.writeGateFired) writeGateFired = true;

      const forceReplan = control.forceReplan;
      const restricted = control.restricted;

      // ── Context injection ──
      if (foldedCtx.length > 0 || forceReplan) {
        const parts = [`[Cycle ${cycleNumber}/${maxCycles}]`];
        if (foldedCtx.length > 0) parts.push(`## Completed Actions\n${foldedCtx.join('\n')}`);
        if (forceReplan) {
          const noActionStall = control.prevCycleAction === 'no-action' || control.prevCycleAction === 'parse-error';
          parts.push(noActionStall
            ? 'Your last response had NO <action> block. You MUST end with <action>{"tool":"ToolName","input":{...}}</action>. Do not describe what you would do — call the tool directly NOW.'
            : 'MUST try a different strategy. Previous approach is stagnating.');
        }
        if (restricted.length > 0) parts.push(`RESTRICTED actions: ${restricted.join(', ')}`);
        if (control.interventionMessage) parts.push(control.interventionMessage);
        obsPort.write({ source: moduleId('observer'), content: parts.join('\n\n'), salience: 0.9, timestamp: Date.now() });
      }

      // ── Multi-tool inner loop ──
      let toolsThisCycle = 0;

      while (toolsThisCycle < maxToolsPerCycle) {
        const wsEntries = raReadPort.read();

        const strat = forceReplan && toolsThisCycle === 0
          ? 'Consider the problem deeply. Weigh alternatives and identify the strongest path.'
          : 'Produce a structured plan with numbered steps. Identify dependencies and risks.';
        const toolList = tools.list().map((t) => `- ${t.name}: ${t.description ?? ''}`).join('\n');

        const now = Date.now();
        const syntheticSnapshot: ReadonlyWorkspaceSnapshot = [
          { source: moduleId('observer'), content: strat, salience: 1.0, timestamp: now },
          { source: moduleId('observer'), content: `Available tools:\n${toolList}`, salience: 0.95, timestamp: now },
          { source: moduleId('observer'), content: FORMAT_INSTRUCTION, salience: 0.95, timestamp: now },
          ...wsEntries,
        ];

        try {
          const res = await adapter.invoke(syntheticSnapshot, {
            pactTemplate: { mode: { type: 'oneshot' }, budget: { maxOutputTokens } },
          });

          const text = String(res.output);
          const inTok = res.usage.inputTokens;
          const outTok = res.usage.outputTokens;
          cycleInputTokens += inTok;
          cycleOutputTokens += outTok;

          if (!text.trim()) {
            onEvent({ type: 'cycle-action', cycle: cycleNumber, action: 'empty-response', confidence: 0.1, tokens: res.usage.totalTokens });
            cognitiveSink?.handle({ type: 'cognitive:module_step', moduleId: raModuleId, phase: 'empty-response', durationMs: 0, hasError: true, timestamp: Date.now() });
            prevConf = 0.1;
            prevAction = 'empty-response';
            foldedCtx.push(`[c${cycleNumber}] empty-response`);
            if (foldedCtx.length > 15) foldedCtx.shift();
            break;
          }

          const plan = text.match(/<plan>([\s\S]*?)<\/plan>/)?.[1]?.trim() ?? '';
          const reasoning = text.match(/<reasoning>([\s\S]*?)<\/reasoning>/)?.[1]?.trim() ?? '';
          const actionRaw = text.match(/<action>([\s\S]*?)<\/action>/)?.[1]?.trim() ?? '';
          const contentBlock = text.match(/<content>([\s\S]*?)<\/content>/)?.[1] ?? null;

          if (reasoning) {
            const chunk = `**[Cycle ${cycleNumber}/${maxCycles} | Tool ${toolsThisCycle + 1}]** ${reasoning}\n`;
            onEvent({ type: 'text', content: chunk });
            onChunk?.(chunk);
          }

          let actionName = 'unknown';
          let confidence = 0.5;

          let parsed: { tool: string; input?: Record<string, unknown> };
          try {
            parsed = JSON.parse(actionRaw);
            consecutiveFailedParses = 0;
            if (contentBlock !== null && parsed.tool === 'Write') {
              parsed.input = parsed.input ?? {};
              parsed.input.content = contentBlock;
            }
          } catch {
            actionName = actionRaw ? 'parse-error' : 'no-action';
            confidence = 0.2;
            prevConf = confidence;
            prevAction = actionName;
            consecutiveFailedParses++;
            onEvent({ type: 'cycle-action', cycle: cycleNumber, action: actionName, confidence, tokens: res.usage.totalTokens });
            cognitiveSink?.handle({ type: 'cognitive:module_step', moduleId: raModuleId, phase: actionName, durationMs: 0, hasError: true, timestamp: Date.now() });
            foldedCtx.push(`[c${cycleNumber}] ${actionName}: ${(plan || reasoning).slice(0, 80)}`);
            if (foldedCtx.length > 15) foldedCtx.shift();

            // Early bail-out: circuit-breaker
            if (consecutiveFailedParses >= MAX_CONSECUTIVE_FAILED_PARSES) {
              lastOutput = reasoning || plan || `Model could not produce a valid action after ${MAX_CONSECUTIVE_FAILED_PARSES} attempts. Last response:\n${text.slice(0, 500)}`;
              const cbMsg = `\n[cognitive] Stopping: ${MAX_CONSECUTIVE_FAILED_PARSES} consecutive parse failures. The model may not support the required output format.\n`;
              onEvent({ type: 'text', content: cbMsg });
              onChunk?.(cbMsg);
              cognitiveSink?.handle({ type: 'cognitive:cycle_aborted', reason: `${MAX_CONSECUTIVE_FAILED_PARSES} consecutive parse failures`, phase: 'action', cycleNumber, timestamp: Date.now() });
              cycleDone = true;
              break;
            }
            // Continue the while-loop to allow consecutive failures to accumulate
            // toward the circuit-breaker threshold. Each failed parse still counts
            // as a tool slot consumed.
            toolsThisCycle++;
            continue;
          }
          actionName = parsed.tool ?? 'unknown';

          if (actionName === 'done') {
            lastOutput = parsed.input?.result as string ?? reasoning ?? plan;
            onEvent({ type: 'cycle-action', cycle: cycleNumber, action: 'done', confidence: 1.0, tokens: res.usage.totalTokens });
            cognitiveSink?.handle({ type: 'cognitive:cycle_phase', phase: 'done', cycleNumber, timestamp: Date.now() });
            cycleDone = true;
            break;
          }

          // ── Impasse detection (exact match) ──
          const semanticKey = `${actionName}:${JSON.stringify(parsed.input ?? {})}`;
          if (prevSemanticKey === semanticKey) {
            raWritePort.write({
              source: raModuleId,
              content: '[IMPASSE] You are repeating the same action with identical input. Try a fundamentally different approach.',
              salience: 0.95, timestamp: Date.now(),
            });
            onEvent({
              type: 'monitor', cycle: cycleNumber,
              intervention: 'impasse-detected',
              action: actionName,
            });
            cognitiveSink?.handle({
              type: 'cognitive:control_policy_violation',
              directive: { target: raModuleId, timestamp: Date.now() },
              reason: `impasse: repeated action ${actionName} with identical input`,
              timestamp: Date.now(),
            });
          }
          prevSemanticKey = semanticKey;

          try {
            const toolRes = await tools.execute(actionName, parsed.input ?? {});
            confidence = toolRes.isError ? 0.3 : 0.7;
            const resStr = typeof toolRes.output === 'string' ? toolRes.output : JSON.stringify(toolRes.output);
            raWritePort.write({
              source: raModuleId,
              content: `[${actionName}] Result:\n${resStr}`,
              salience: 0.8, timestamp: Date.now(),
            });
            // Truncation hint
            if (actionName === 'Read' && resStr.endsWith('... (truncated)')) {
              const readPath = (parsed.input as Record<string, unknown>)?.path;
              raWritePort.write({
                source: moduleId('observer'),
                content: `[READ TRUNCATED] Output was cut at 8000 chars. To read the rest, use: Read({"path":"${readPath}","offset":<next_line_number>,"limit":100}). First, estimate the line number from the truncated content.`,
                salience: 0.88, timestamp: Date.now(),
              });
            }
            // Write-completion hint
            if (actionName === 'Write' && !toolRes.isError) {
              const writePath = (parsed.input as Record<string, unknown>)?.path as string ?? 'file';
              obsPort.write({
                source: moduleId('observer'),
                content: `[\u2713 DELIVERABLE WRITTEN \u2192 ${writePath}]\nTask output is saved. Execute this action immediately:\n<action>{"tool":"done","input":{"result":"Output written to ${writePath}"}}</action>`,
                salience: 1.0, timestamp: Date.now(),
              });
            }
            // Write gate counters
            if (!toolRes.isError) {
              if (READ_ONLY_ACTIONS.has(actionName)) promptSuccessfulReads++;
              if (actionName === 'Write') {
                promptSuccessfulWrites++;
                promptSuccessfulReads = 0;
                writeGateFired = false;
              }
            }
          } catch (toolErr) {
            const msg = toolErr instanceof Error ? toolErr.message : String(toolErr);
            confidence = 0.1;
            raWritePort.write({
              source: raModuleId,
              content: `[${actionName}] Tool error: ${msg}`,
              salience: 0.8, timestamp: Date.now(),
            });
          }

          prevConf = confidence;
          prevAction = actionName;
          onEvent({ type: 'cycle-action', cycle: cycleNumber, action: actionName, confidence, tokens: res.usage.totalTokens });
          cognitiveSink?.handle({ type: 'cognitive:module_step', moduleId: raModuleId, phase: actionName, durationMs: 0, hasError: confidence < 0.5, timestamp: Date.now() });

          foldedCtx.push(`[c${cycleNumber}] ${actionName}: ${(plan || reasoning).slice(0, 80)}`);
          if (foldedCtx.length > 15) foldedCtx.shift();

          toolsThisCycle++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          onEvent({ type: 'cycle-action', cycle: cycleNumber, action: 'error', confidence: 0, tokens: 0 });
          const errMsg = `\n[cycle ${cycleNumber}] Error: ${msg}\n`;
          onEvent({ type: 'text', content: errMsg });
          onChunk?.(errMsg);
          cognitiveSink?.handle({ type: 'cognitive:cycle_aborted', reason: msg, phase: 'action', cycleNumber, timestamp: Date.now() });
          break;
        }
      }

      // Compute workspace utilization
      const wsSnapshot = ws.snapshot();
      const wsUtilization = wsSnapshot.length / wsCapacity;

      const newState: BridgeReasonerActorState = {
        foldedCtx,
        promptSuccessfulReads,
        promptSuccessfulWrites,
        writeGateFired,
      };

      const monitoring: BridgeReasonerActorMonitoring = {
        source: raModuleId,
        timestamp: Date.now(),
        type: 'bridge-reasoner-actor',
        prevConf,
        prevAction,
        consecutiveFailedParses,
        wsUtilization,
        promptInputTokens: cycleInputTokens,
        promptOutputTokens: cycleOutputTokens,
        writeGateFired,
        promptSuccessfulReads,
        promptSuccessfulWrites,
        cycleDone,
        lastOutput,
      };

      return {
        output: monitoring,
        state: newState,
        monitoring,
      };
    },
  };
}

// ── BridgeMonitorModule Factory ────────────────────────────────────

/**
 * Creates a BridgeMonitorModule that extracts the inline monitor block
 * from cognitive-provider.ts into a CognitiveModule implementation.
 *
 * Reads the previous cycle's RA monitoring signal and produces control
 * directives for the current cycle's RA.
 *
 * Workspace writes use source: moduleId('monitor') (identity fix per PRD 042).
 */
export function createBridgeMonitorModule(
  ws: WorkspaceManager,
  monitorPort: WorkspaceWritePort,
  wsCapacity: number,
  config: MonitorModuleConfig,
  onEvent: (e: StreamEvent) => void,
  cognitiveSink?: CognitiveSink,
): BridgeMonitorModuleType {
  const monModuleId = moduleId('monitor');

  return {
    id: monModuleId,

    initialState(): BridgeMonitorState {
      return {
        readOnlyRun: 0,
        interventions: 0,
        accumulatedInputTokens: 0,
      };
    },

    async step(
      monitoring: BridgeReasonerActorMonitoring | null,
      state: BridgeMonitorState,
      _noControl: ControlDirective,
    ): Promise<StepResult<BridgeMonitorControl, BridgeMonitorState, MonitoringSignal>> {
      // First cycle: no monitoring available yet — return default control
      if (monitoring === null) {
        return {
          output: defaultBridgeMonitorControl(),
          state: { ...state },
          monitoring: {
            source: monModuleId,
            timestamp: Date.now(),
          },
        };
      }

      const { confThreshold, stagThreshold, intBudget } = config;

      // Clone state for immutability
      let readOnlyRun = state.readOnlyRun;
      let interventions = state.interventions;
      let accumulatedInputTokens = state.accumulatedInputTokens + monitoring.promptInputTokens;

      // Track read-only runs
      if (monitoring.prevAction && READ_ONLY_ACTIONS.has(monitoring.prevAction)) {
        readOnlyRun++;
      } else {
        readOnlyRun = 0;
      }

      let forceReplan = false;
      const restricted: string[] = [];
      let interventionMessage: string | null = null;

      // ── Anomaly detection ──
      const anomaly = monitoring.prevConf < confThreshold || readOnlyRun >= stagThreshold;
      if (anomaly && interventions < intBudget) {
        interventions++;
        forceReplan = true;
        if (interventions < 3 && monitoring.prevAction) restricted.push(monitoring.prevAction);
        const interventionKind = interventions >= 3 ? 'reframe' : 'constrain';
        onEvent({
          type: 'monitor', cycle: 0, // cycle number not available in monitor — caller sets context
          intervention: interventionKind,
          restricted: restricted.length > 0 ? restricted : undefined,
        });
        cognitiveSink?.handle({
          type: 'cognitive:control_directive',
          directive: {
            target: moduleId('reasoner-actor'),
            timestamp: Date.now(),
          },
          timestamp: Date.now(),
        });
      }

      // ── Workspace saturation intervention ──
      const wsEntries = ws.snapshot();
      const wsUtilization = wsEntries.length / wsCapacity;
      if (wsUtilization >= 0.8) {
        monitorPort.write({
          source: monModuleId,
          content: `[WORKSPACE ${wsEntries.length}/${wsCapacity} entries \u2014 near capacity] Context entries are being evicted. Stop accumulating information. Summarize what you know and produce your final output NOW.`,
          salience: 0.92,
          timestamp: Date.now(),
        });
        onEvent({ type: 'monitor', cycle: 0, intervention: 'workspace-saturation' });
      }

      // ── Token budget intervention ──
      if (accumulatedInputTokens > 100_000) {
        monitorPort.write({
          source: monModuleId,
          content: `[TOKEN BUDGET ALERT: ~${Math.round(accumulatedInputTokens / 1000)}k input tokens used] Context window pressure is high. Do NOT read more files. Use what you already know to produce your final Write + done action immediately.`,
          salience: 0.95,
          timestamp: Date.now(),
        });
        onEvent({ type: 'monitor', cycle: 0, intervention: 'token-budget-pressure' });
      }

      // ── Write gate intervention ──
      let writeGateJustFired = false;
      if (monitoring.promptSuccessfulReads >= 3 && monitoring.promptSuccessfulWrites === 0 && !monitoring.writeGateFired) {
        forceReplan = true;
        writeGateJustFired = true;
        for (const tool of READ_ONLY_ACTIONS) {
          if (!restricted.includes(tool)) restricted.push(tool);
        }
        monitorPort.write({
          source: monModuleId,
          content: `[WRITE GATE] You have gathered enough information (${monitoring.promptSuccessfulReads} reads). Read, Glob, Grep, Search, and List are strongly DISCOURAGED. You should produce a Write action to save your output or call done if the task is complete.`,
          salience: 0.85,
          timestamp: Date.now(),
        });
        onEvent({ type: 'monitor', cycle: 0, intervention: 'write-gate' });
      }

      const newState: BridgeMonitorState = {
        readOnlyRun,
        interventions,
        accumulatedInputTokens,
      };

      const output: BridgeMonitorControl = {
        target: moduleId('reasoner-actor'),
        timestamp: Date.now(),
        forceReplan,
        restricted,
        interventionMessage,
        writeGateFired: writeGateJustFired,
        prevCycleAction: monitoring.prevAction,
      };

      return {
        output,
        state: newState,
        monitoring: {
          source: monModuleId,
          timestamp: Date.now(),
        },
      };
    },
  };
}
