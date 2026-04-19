/**
 * MockCortexCtx for the Planner sample E2E tests. Mirrors the Monitor
 * sample's mock with a planner-flavored default LLM response.
 */

import type {
  CortexAuditFacade,
  CortexCtx,
  CortexEventsFacade,
  CortexLlmFacade,
  CortexLogger,
  CortexScheduleFacade,
  CortexStorageFacade,
} from '@methodts/agent-runtime';

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
  eventsFor(topic: string): ReadonlyArray<Record<string, unknown>>;
}

const DEFAULT_PLAN_UPDATE = JSON.stringify({
  goalId: 'goal-42',
  statement: 'restore workspace coherence after constraint violation',
  planSummary: 'pin the violated constraint and re-plan from step 3',
  changedSteps: ['step-3', 'step-4', 'step-5'],
  requiresMemoryRecall: true,
  rationale: 'prior episodes recovered from similar conflicts via pin-flag',
});

export function createMockCtx(options: MockCtxOptions = {}): MockCtxBundle {
  const llmComplete = makeSpy<[unknown]>();
  const auditEvent = makeSpy<[unknown]>();
  const eventsPublish = makeSpy<[string, unknown]>();
  const storagePut = makeSpy<[string, unknown]>();
  const scheduleRegister = makeSpy<[string, unknown]>();

  const content = options.llmContent ?? DEFAULT_PLAN_UPDATE;

  const llm: CortexLlmFacade = {
    async complete(req) {
      llmComplete.calls.push([req]);
      return {
        content,
        text: content,
        tokensIn: 220,
        tokensOut: 180,
        costUsd: 0.018,
        providerModel: 'mock-balanced',
        budget: {
          totalCostUsd: 0.018,
          limitUsd: 0.35,
          percentUsed: 5.1,
        },
      };
    },
    async structured(req) {
      llmComplete.calls.push([req]);
      return {
        value: JSON.parse(content),
        tokensIn: 220,
        tokensOut: 180,
        costUsd: 0.018,
        providerModel: 'mock-balanced',
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
    app: {
      id: options.appId ?? 'cortex-cognitive-planner',
      tier: options.tier ?? 'tool',
    },
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
