/**
 * MockCortexCtx for PRD-068 Wave 1 cognitive sample apps.
 *
 * Extends the incident-triage sample mock with `ctx.schedule` + per-topic
 * event assertions for workspace coordination.
 */

import type {
  CortexAuditFacade,
  CortexCtx,
  CortexEventsFacade,
  CortexLlmFacade,
  CortexLogger,
  CortexScheduleFacade,
  CortexStorageFacade,
} from '@method/agent-runtime';

export interface Spy<Args extends unknown[]> {
  calls: Args[];
  callCount(): number;
  reset(): void;
}

function makeSpy<Args extends unknown[]>(): Spy<Args> {
  const calls: Args[] = [];
  return {
    calls,
    callCount: () => calls.length,
    reset: () => {
      calls.length = 0;
    },
  };
}

export interface MockCtxOptions {
  readonly appId?: string;
  readonly tier?: 'service' | 'tool' | 'web';
  readonly llmContent?: string;
  readonly includeEvents?: boolean;
  readonly includeStorage?: boolean;
  readonly includeSchedule?: boolean;
}

export interface MockCtxBundle {
  readonly ctx: CortexCtx;
  readonly spies: {
    readonly llmComplete: Spy<[unknown]>;
    readonly auditEvent: Spy<[unknown]>;
    readonly eventsPublish: Spy<[string, unknown]>;
    readonly storagePut: Spy<[string, unknown]>;
    readonly scheduleRegister: Spy<[string, unknown]>;
  };
  /** Retrieve every event published to a given topic. */
  eventsFor(topic: string): ReadonlyArray<Record<string, unknown>>;
}

const DEFAULT_MONITOR_REPORT = JSON.stringify({
  severity: 'anomaly',
  confidence: 0.78,
  detail: 'planner emitted a plan step that violates constraint C-3',
});

export function createMockCtx(options: MockCtxOptions = {}): MockCtxBundle {
  const llmComplete = makeSpy<[unknown]>();
  const auditEvent = makeSpy<[unknown]>();
  const eventsPublish = makeSpy<[string, unknown]>();
  const storagePut = makeSpy<[string, unknown]>();
  const scheduleRegister = makeSpy<[string, unknown]>();

  const content = options.llmContent ?? DEFAULT_MONITOR_REPORT;

  const llm: CortexLlmFacade = {
    async complete(req) {
      llmComplete.calls.push([req]);
      return {
        content,
        text: content,
        tokensIn: 90,
        tokensOut: 40,
        costUsd: 0.0012,
        providerModel: 'mock-fast',
        budget: {
          totalCostUsd: 0.0012,
          limitUsd: 0.05,
          percentUsed: 2.4,
        },
      };
    },
    async structured(req) {
      llmComplete.calls.push([req]);
      return {
        value: JSON.parse(content),
        tokensIn: 90,
        tokensOut: 40,
        costUsd: 0.0012,
        providerModel: 'mock-fast',
      } as never;
    },
  };

  const audit: CortexAuditFacade = {
    async event(e) {
      auditEvent.calls.push([e]);
    },
  };

  const events: CortexEventsFacade | undefined =
    options.includeEvents === false
      ? undefined
      : {
          async publish(topic, payload) {
            eventsPublish.calls.push([topic, payload]);
          },
        };

  const storageMap = new Map<string, Record<string, unknown>>();
  const storage: CortexStorageFacade | undefined = options.includeStorage
    ? {
        async put(key, value) {
          storagePut.calls.push([key, value]);
          storageMap.set(key, value as Record<string, unknown>);
        },
        async get(key) {
          return storageMap.get(key) ?? null;
        },
        async delete(key) {
          storageMap.delete(key);
        },
      }
    : undefined;

  const schedule: CortexScheduleFacade | undefined = options.includeSchedule
    ? {
        async register(cron, handler) {
          scheduleRegister.calls.push([cron, handler]);
          return { scheduleId: `sched-${scheduleRegister.callCount()}` };
        },
      }
    : undefined;

  const log: CortexLogger = {
    info: () => {
      /* no-op */
    },
    warn: () => {
      /* no-op */
    },
    error: () => {
      /* no-op */
    },
  };

  const ctx: CortexCtx = {
    app: { id: options.appId ?? 'cortex-cognitive-monitor', tier: options.tier ?? 'tool' },
    llm,
    audit,
    events,
    storage,
    schedule,
    log,
  };

  return {
    ctx,
    spies: { llmComplete, auditEvent, eventsPublish, storagePut, scheduleRegister },
    eventsFor(topic: string): ReadonlyArray<Record<string, unknown>> {
      return eventsPublish.calls
        .filter(([t]) => t === topic)
        .map(([, p]) => p as Record<string, unknown>);
    },
  };
}
