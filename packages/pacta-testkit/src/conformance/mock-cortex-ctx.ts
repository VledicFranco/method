// SPDX-License-Identifier: Apache-2.0
/**
 * `MockCortexCtx` — the structural `CortexCtx` impl the conformance suite
 * installs as the `ctx` passed to a tenant app handler. Every facade call is
 * appended to an in-memory recorder; plugins read the log to assert invariants.
 *
 * S8 §5.2 freezes the shape. PRD-065 §7 pins the exhaustive behaviour table.
 */

import type {
  CortexCtx,
  CortexAppFacade,
  CortexLlmFacade,
  CortexAuditFacade,
  CortexEventsFacade,
  CortexStorageFacade,
  CortexJobsFacade,
  CortexScheduleFacade,
  CortexAuthFacade,
  CortexLogger,
} from './cortex-types.js';

import { ConformanceRunError } from './errors.js';

// ── Scripted LLM response (S8 §5.2) ─────────────────────────────

export interface TokenUsageShape {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens?: number;
}

export type ScriptedBudgetSignal =
  | { readonly kind: 'none' }
  | { readonly kind: 'warning'; readonly percentUsed: number }
  | { readonly kind: 'critical'; readonly percentUsed: number }
  | { readonly kind: 'exceeded'; readonly percentUsed: 101 };

export interface ScriptedLlmResponse {
  readonly text: string;
  readonly usage: TokenUsageShape;
  readonly costUsd: number;
  readonly model?: string;
  readonly simulateBudget?: ScriptedBudgetSignal;
  /** Optional list of tools the scripted turn "requested" — recorded for scope checks. */
  readonly toolsRequested?: ReadonlyArray<string>;
}

// ── Recorder (S8 §5.2) ──────────────────────────────────────────

export interface RecordedCtxCall {
  readonly at: number;
  readonly wallTimeMs: number;
  readonly facade: keyof CortexCtx;
  readonly method: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly result?: Readonly<Record<string, unknown>>;
  readonly error?: { readonly name: string; readonly message: string };
  readonly delegationDepth: number;
}

export interface CallRecorder {
  readonly calls: ReadonlyArray<RecordedCtxCall>;
  where(facade: keyof CortexCtx): ReadonlyArray<RecordedCtxCall>;
  count(pred: (c: RecordedCtxCall) => boolean): number;
  firstIndexOf(pred: (c: RecordedCtxCall) => boolean): number;
}

// ── Mock ctx interface (S8 §5.2) ────────────────────────────────

export interface MockCortexCtx extends CortexCtx {
  readonly recorder: CallRecorder;
  reset(): void;
  scriptLlmResponse(response: ScriptedLlmResponse): void;
}

export interface CreateMockCortexCtxOptions {
  readonly appId: string;
  readonly tier?: 'service' | 'tool' | 'web';
  readonly parentToken?: string;
}

// ── Internal state container ────────────────────────────────────

interface MockCtxState {
  readonly appId: string;
  readonly tier: 'service' | 'tool' | 'web';
  readonly parentToken: string;
  storage: Map<string, Readonly<Record<string, unknown>>>;
  llmScript: ScriptedLlmResponse[];
  callIndex: number;
  currentDelegationDepth: number;
  tokenToDepth: Map<string, number>;
  calls: RecordedCtxCall[];
}

function structuralClone<T>(value: T): T {
  if (value === undefined || value === null) return value;
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

// ── Factory ─────────────────────────────────────────────────────

export function createMockCortexCtx(
  options: CreateMockCortexCtxOptions,
): MockCortexCtx {
  const state: MockCtxState = {
    appId: options.appId,
    tier: options.tier ?? 'service',
    parentToken: options.parentToken ?? 'parent-token-0',
    storage: new Map(),
    llmScript: [],
    callIndex: 0,
    currentDelegationDepth: 0,
    tokenToDepth: new Map([[options.parentToken ?? 'parent-token-0', 0]]),
    calls: [],
  };

  const record = (
    facade: keyof CortexCtx,
    method: string,
    args: Record<string, unknown>,
    result?: Record<string, unknown>,
    error?: { name: string; message: string },
  ): RecordedCtxCall => {
    const entry: RecordedCtxCall = {
      at: state.callIndex++,
      wallTimeMs: Date.now(),
      facade,
      method,
      args: Object.freeze(structuralClone(args)) as Readonly<Record<string, unknown>>,
      result:
        result === undefined
          ? undefined
          : (Object.freeze(structuralClone(result)) as Readonly<Record<string, unknown>>),
      error,
      delegationDepth: state.currentDelegationDepth,
    };
    state.calls.push(entry);
    return entry;
  };

  // ── Recorder view ────────────────────────────────────────────
  const recorder: CallRecorder = {
    get calls(): ReadonlyArray<RecordedCtxCall> {
      return state.calls;
    },
    where(facade: keyof CortexCtx): ReadonlyArray<RecordedCtxCall> {
      return state.calls.filter((c) => c.facade === facade);
    },
    count(pred: (c: RecordedCtxCall) => boolean): number {
      let n = 0;
      for (const c of state.calls) if (pred(c)) n++;
      return n;
    },
    firstIndexOf(pred: (c: RecordedCtxCall) => boolean): number {
      return state.calls.findIndex(pred);
    },
  };

  // ── app facade ───────────────────────────────────────────────
  const app: CortexAppFacade = { id: state.appId, tier: state.tier };

  // ── llm facade ───────────────────────────────────────────────
  const llm: CortexLlmFacade = {
    async complete(req) {
      const script = state.llmScript.shift();
      if (!script) {
        const err = new ConformanceRunError('INVALID_FIXTURE', {
          detail: `ctx.llm.complete called with empty LLM script (call #${state.callIndex})`,
        });
        record(
          'llm',
          'complete',
          { tier: req.tier, prompt: req.prompt },
          undefined,
          { name: err.name, message: err.message },
        );
        throw err;
      }

      // Detect whether handlers were registered on the request metadata. The
      // real CortexLLMProvider stamps `_handlers` or similar; for the mock we
      // accept any of: explicit `_handlers` key, `budgetHandlers`, or a prior
      // `registerBudgetHandlers` call on this facade (tracked on state).
      const handlersRegistered =
        '_handlers' in req ||
        'budgetHandlers' in req ||
        state.calls.some(
          (c) =>
            c.facade === 'llm' &&
            c.method === 'registerBudgetHandlers',
        );

      record('llm', 'complete', {
        tier: req.tier,
        prompt: req.prompt,
        handlersRegistered,
        toolsRequested: script.toolsRequested ?? [],
      });

      // Fire simulated budget signals after recording the primary call, so
      // plugins see the triggering completion before the handler call.
      if (script.simulateBudget && script.simulateBudget.kind !== 'none') {
        const signal = script.simulateBudget;
        const lastHandlers = [...state.calls]
          .reverse()
          .find(
            (c) => c.facade === 'llm' && c.method === 'registerBudgetHandlers',
          );
        if (lastHandlers) {
          record('llm', `budget.${signal.kind}`, {
            percentUsed: signal.percentUsed,
          });
        }
      }

      const result = {
        content: script.text,
        text: script.text,
        tokensIn: script.usage.inputTokens,
        tokensOut: script.usage.outputTokens,
        costUsd: script.costUsd,
        providerModel: script.model ?? 'mock-claude-sonnet',
      };
      return result;
    },
    registerBudgetHandlers(handlers) {
      // Record that handlers were registered; stash count so subsequent
      // complete() calls can stamp `handlersRegistered: true`.
      record('llm', 'registerBudgetHandlers', {
        hasWarning: typeof handlers.onBudgetWarning === 'function',
        hasCritical: typeof handlers.onBudgetCritical === 'function',
        hasExceeded: typeof handlers.onBudgetExceeded === 'function',
      });
    },
  };

  // ── audit facade ─────────────────────────────────────────────
  const audit: CortexAuditFacade = {
    event(e) {
      const payloadArgs: Record<string, unknown> = {};
      if (e.kind !== undefined) payloadArgs.kind = e.kind;
      if (e.eventType !== undefined) payloadArgs.eventType = e.eventType;
      if (e.actor !== undefined) payloadArgs.actor = e.actor;
      if (e.subject !== undefined) payloadArgs.subject = e.subject;
      if (e.payload !== undefined) payloadArgs.payload = e.payload;
      if (e.correlationId !== undefined) payloadArgs.correlationId = e.correlationId;
      record('audit', 'event', payloadArgs);
      return undefined;
    },
  };

  // ── events facade ────────────────────────────────────────────
  const events: CortexEventsFacade = {
    publish(topic, payload) {
      record('events', 'publish', { topic, payload });
      return undefined;
    },
  };

  // ── storage facade ───────────────────────────────────────────
  const storage: CortexStorageFacade = {
    async get(key) {
      const value = state.storage.get(key);
      record('storage', 'get', { key }, value ? { value } : { value: null });
      return value ?? null;
    },
    async put(key, value) {
      state.storage.set(key, structuralClone(value));
      record('storage', 'put', { key, value });
    },
    async delete(key) {
      state.storage.delete(key);
      record('storage', 'delete', { key });
    },
  };

  // ── jobs facade ──────────────────────────────────────────────
  const jobs: CortexJobsFacade = {
    async enqueue(job) {
      const jobId = `mock-job-${state.callIndex}`;
      const args: Record<string, unknown> = {
        kind: job.kind,
        payload: job.payload,
      };
      if (job.runAfterMs !== undefined) args.runAfterMs = job.runAfterMs;
      record('jobs', 'enqueue', args, { jobId });
      return { jobId };
    },
  };

  // ── schedule facade ──────────────────────────────────────────
  const schedule: CortexScheduleFacade = {
    async register(cron, handler) {
      const scheduleId = `mock-sched-${state.callIndex}`;
      record('schedule', 'register', { cron, handler }, { scheduleId });
      return { scheduleId };
    },
  };

  // ── auth facade (delegation depth tracking) ──────────────────
  const auth: CortexAuthFacade = {
    async exchangeForAgent(parentToken, scope) {
      const parentDepth = state.tokenToDepth.get(parentToken) ?? 0;
      const newDepth = parentDepth + 1;
      const newToken = `ext-token-d${newDepth}`;
      state.tokenToDepth.set(newToken, newDepth);
      state.currentDelegationDepth = Math.max(
        state.currentDelegationDepth,
        newDepth,
      );
      const expiresAt = Date.now() + 3_600_000;
      record(
        'auth',
        'exchangeForAgent',
        { parentToken, scope: [...scope] },
        { token: newToken, expiresAt },
      );
      // Stamp the resulting call's delegationDepth to the new depth (the
      // record() call above already captured currentDelegationDepth which
      // we just updated — OK).
      return { token: newToken, expiresAt };
    },
    serviceAccountToken: 'mock-service-account-token',
  };

  // ── log facade ───────────────────────────────────────────────
  const log: CortexLogger = {
    info(msg, fields) {
      record('log', 'info', fields ? { msg, fields } : { msg });
    },
    warn(msg, fields) {
      record('log', 'warn', fields ? { msg, fields } : { msg });
    },
    error(msg, fields) {
      record('log', 'error', fields ? { msg, fields } : { msg });
    },
    debug(msg, fields) {
      record('log', 'debug', fields ? { msg, fields } : { msg });
    },
  };

  const ctx: MockCortexCtx = {
    app,
    llm,
    audit,
    events,
    storage,
    jobs,
    schedule,
    auth,
    log,
    recorder,
    reset(): void {
      state.storage.clear();
      state.llmScript.length = 0;
      state.calls.length = 0;
      state.callIndex = 0;
      state.currentDelegationDepth = 0;
      state.tokenToDepth.clear();
      state.tokenToDepth.set(state.parentToken, 0);
    },
    scriptLlmResponse(response: ScriptedLlmResponse): void {
      state.llmScript.push(response);
    },
  };

  return ctx;
}
