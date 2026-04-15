/**
 * `MethodAgent<T>` handle — PRD-058 §4.3 (S1 §4.3).
 *
 * Concrete implementation of the `MethodAgent` interface returned by
 * `createMethodAgent`. Internal class — consumers depend on the `MethodAgent`
 * interface, never on this type.
 *
 * Responsibilities:
 *   - `invoke(request)` — delegate to the composed pacta `Agent.invoke`, wrap
 *     the result with Cortex annotations (`appId`, `auditEventCount`,
 *     optional `resumption`).
 *   - `resume(resumption, partial)` — recover payload, re-enter invoke with
 *     `resumeSessionId` set. Throws UnknownSessionError on miss (S1 §4.3).
 *   - `abort(sessionId, reason)` — cooperative abort via pacta's
 *     AbortController wiring (per-invocation signal is attached at invoke
 *     time, S1 Q8).
 *   - `events()` — delegate to the EventsMultiplexer (mutex enforced there).
 *   - `dispose()` — close the multiplexer, release per-invocation controllers,
 *     and call provider.dispose if available.
 */

import type {
  Agent,
  AgentEvent,
  AgentRequest,
  AgentResult,
  AgentState,
  Pact,
} from '@method/pacta';
import type { CortexCtx } from './cortex/ctx-types.js';
import { EventsMultiplexer } from './events-multiplexer.js';
import { UnknownSessionError } from './errors.js';
import {
  createResumption,
  isResumptionLive,
  parseResumption,
  type Resumption,
  type ResumptionPayload,
} from './resumption.js';
import type { SessionStoreAdapter } from './session-store-adapter.js';

/** Result shape extending pacta with Cortex annotations (S1 §4.4). */
export interface MethodAgentResult<TOutput = unknown> extends AgentResult<TOutput> {
  /** Resumption token when the agent suspended (undefined on completion). */
  readonly resumption?: Resumption;
  /** AppId under which budget + audit were attributed. */
  readonly appId: string;
  /** Number of `ctx.audit.event()` invocations during this invocation. */
  readonly auditEventCount: number;
}

/** Minimal interface the handle exposes (S1 §4.3). */
export interface MethodAgent<TOutput = unknown> {
  readonly pact: Pact<TOutput>;
  readonly state: AgentState;
  invoke(request: AgentRequest): Promise<MethodAgentResult<TOutput>>;
  resume(
    resumption: Resumption,
    request?: Partial<AgentRequest>,
  ): Promise<MethodAgentResult<TOutput>>;
  abort(sessionId: string, reason?: string): Promise<void>;
  events(): AsyncIterable<AgentEvent>;
  dispose(): Promise<void>;
}

export interface MethodAgentHandleOptions<TOutput = unknown> {
  readonly inner: Agent<TOutput>;
  readonly ctx: CortexCtx;
  readonly multiplexer: EventsMultiplexer;
  readonly sessionStore: SessionStoreAdapter;
  readonly storeNamespace: string;
  readonly auditEventCounter: { count: number };
  /**
   * The default Cortex-derived request metadata merged into every invoke.
   * The multiplexer's `fanIn` is installed here as `metadata.onEvent` so
   * middleware inside pacta can participate in the fan-out contract.
   */
  readonly requestDefaults: Record<string, unknown>;
}

/**
 * The S1-conformant handle. Not exported from the barrel — consumers hold
 * a `MethodAgent<T>` interface reference only.
 */
export class MethodAgentHandle<TOutput = unknown> implements MethodAgent<TOutput> {
  private readonly options: MethodAgentHandleOptions<TOutput>;
  private readonly inFlight = new Map<string, AbortController>();
  private disposed = false;

  constructor(options: MethodAgentHandleOptions<TOutput>) {
    this.options = options;
  }

  get pact(): Pact<TOutput> {
    return this.options.inner.pact;
  }

  get state(): AgentState {
    return this.options.inner.state;
  }

  async invoke(request: AgentRequest): Promise<MethodAgentResult<TOutput>> {
    this.assertAlive();
    return this.runInvocation(request, /*resumedPayload=*/ undefined);
  }

  async resume(
    resumption: Resumption,
    request?: Partial<AgentRequest>,
  ): Promise<MethodAgentResult<TOutput>> {
    this.assertAlive();

    if (!isResumptionLive(resumption)) {
      throw new UnknownSessionError(resumption.sessionId);
    }

    // Recover internal payload (validates versioning + sessionId match).
    const payload = parseResumption(resumption);

    // Confirm session is known to the store — PRD-058 §4 criterion 9.
    const stored = await this.options.sessionStore.get(resumption.sessionId);
    if (!stored) {
      throw new UnknownSessionError(resumption.sessionId);
    }

    const mergedRequest: AgentRequest = {
      prompt: request?.prompt ?? '',
      ...request,
      resumeSessionId: resumption.sessionId,
    };

    return this.runInvocation(mergedRequest, payload);
  }

  async abort(sessionId: string, reason?: string): Promise<void> {
    const controller = this.inFlight.get(sessionId);
    if (!controller) return;
    controller.abort(reason);
  }

  events(): AsyncIterable<AgentEvent> {
    return this.options.multiplexer.events();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.options.multiplexer.close();
    for (const [, controller] of this.inFlight) {
      controller.abort('handle_disposed');
    }
    this.inFlight.clear();
    const innerDispose = this.options.inner.dispose;
    if (typeof innerDispose === 'function') {
      try {
        innerDispose();
      } catch (err) {
        this.options.ctx.log?.warn?.('agent-runtime: inner agent dispose threw', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // ── Internals ────────────────────────────────────────────────────

  private assertAlive(): void {
    if (this.disposed) {
      throw new Error('MethodAgent has been disposed');
    }
  }

  private async runInvocation(
    request: AgentRequest,
    resumedPayload: ResumptionPayload | undefined,
  ): Promise<MethodAgentResult<TOutput>> {
    const sessionId =
      request.resumeSessionId ??
      (request.metadata?.sessionId as string | undefined) ??
      `agent-${Date.now().toString(36)}`;

    // Abort controller per invocation (S1 Q8 — cooperative).
    const controller = new AbortController();
    this.inFlight.set(sessionId, controller);

    // Chain any externally-supplied abortSignal.
    const externalSignal = request.abortSignal;
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort(externalSignal.reason);
      } else {
        externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason), {
          once: true,
        });
      }
    }

    const mergedMetadata = {
      ...this.options.requestDefaults,
      ...(request.metadata ?? {}),
      sessionId,
      onEvent: this.options.multiplexer.fanIn,
    };

    const mergedRequest: AgentRequest = {
      ...request,
      metadata: mergedMetadata,
      abortSignal: controller.signal,
    };

    // Reset audit counter for this invocation.
    this.options.auditEventCounter.count = 0;

    let pactaResult: AgentResult<TOutput>;
    try {
      pactaResult = await this.options.inner.invoke(mergedRequest);
    } finally {
      this.inFlight.delete(sessionId);
    }

    // Build the Cortex-annotated result.
    const suspended =
      pactaResult.completed === false &&
      (pactaResult.stopReason === 'killed' ||
        pactaResult.stopReason === 'timeout' ||
        pactaResult.stopReason === 'budget_exhausted');

    let resumption: Resumption | undefined;
    if (suspended && this.pact.mode.type === 'resumable') {
      const payload: ResumptionPayload = {
        v: 1,
        sessionId,
        checkpointRef: resumedPayload?.checkpointRef ?? sessionId,
        budgetRef: resumedPayload?.budgetRef ?? sessionId,
        storeNamespace: this.options.storeNamespace,
      };
      await this.options.sessionStore.put(sessionId, payload);
      resumption = createResumption(payload);
    }

    return {
      ...pactaResult,
      appId: this.options.ctx.app.id,
      auditEventCount: this.options.auditEventCounter.count,
      resumption,
    };
  }
}
