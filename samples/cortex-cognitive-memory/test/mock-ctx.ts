/**
 * MockCortexCtx for the Memory sample E2E tests (PRD-068 Wave 1).
 *
 * Mirrors the Monitor / Planner mocks with the following differences:
 *
 *   - Memory's pact is `persistent`, so storage-backed scenarios matter
 *     more — the mock ALWAYS wires a `ctx.storage` facade backed by an
 *     in-memory Map so `hydrateShadowFromStorage` can be exercised.
 *   - Default LLM content is a valid `MemoryRecallOutput` JSON payload
 *     (zero entries) so schema validation passes on a cold invoke.
 *   - `eventsFor(topic)` still returns every publish for assertion.
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
  /**
   * Seed entries that `ctx.storage.get` should return on a given key
   * (used by tests that want to verify the lazy shadow rebuild).
   */
  readonly storageSeed?: Record<string, unknown>;
}

export interface MockCtxBundle {
  readonly ctx: CortexCtx;
  readonly spies: {
    readonly llmComplete: Spy<[unknown]>;
    readonly auditEvent: Spy<[unknown]>;
    readonly eventsPublish: Spy<[string, unknown]>;
    readonly storagePut: Spy<[string, unknown]>;
    readonly storageGet: Spy<[string]>;
    readonly scheduleRegister: Spy<[string, unknown]>;
  };
  eventsFor(topic: string): ReadonlyArray<Record<string, unknown>>;
}

/**
 * Default mock LLM content — a valid `MemoryRecallOutput`. Entries
 * deliberately empty so the scaffold's in-memory store (not the mock)
 * drives retrieval assertions.
 */
const DEFAULT_MEMORY_RECALL_OUTPUT = JSON.stringify({
  queryKind: 'episodic',
  entries: [],
});

export function createMockCtx(options: MockCtxOptions = {}): MockCtxBundle {
  const llmComplete = makeSpy<[unknown]>();
  const auditEvent = makeSpy<[unknown]>();
  const eventsPublish = makeSpy<[string, unknown]>();
  const storagePut = makeSpy<[string, unknown]>();
  const storageGet = makeSpy<[string]>();
  const scheduleRegister = makeSpy<[string, unknown]>();

  const content = options.llmContent ?? DEFAULT_MEMORY_RECALL_OUTPUT;

  const llm: CortexLlmFacade = {
    async complete(req) {
      llmComplete.calls.push([req]);
      return {
        content,
        text: content,
        tokensIn: 120,
        tokensOut: 60,
        costUsd: 0.0031,
        providerModel: 'mock-fast',
        budget: {
          totalCostUsd: 0.0031,
          limitUsd: 0.25,
          percentUsed: 1.2,
        },
      };
    },
    async structured(req) {
      llmComplete.calls.push([req]);
      return {
        value: JSON.parse(content),
        tokensIn: 120,
        tokensOut: 60,
        costUsd: 0.0031,
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

  // Memory is a persistent pact — the mock ALWAYS provides a storage
  // facade by default, unless the test explicitly opts out.
  const storageMap = new Map<string, unknown>();
  if (options.storageSeed) {
    for (const [k, v] of Object.entries(options.storageSeed)) {
      storageMap.set(k, v);
    }
  }

  const includeStorage = options.includeStorage !== false;
  const storage: CortexStorageFacade | undefined = includeStorage
    ? {
        async put(key, value) {
          storagePut.calls.push([key, value]);
          storageMap.set(key, value);
        },
        async get(key) {
          storageGet.calls.push([key]);
          return (storageMap.get(key) ?? null) as Record<string, unknown> | null;
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
      id: options.appId ?? 'cortex-cognitive-memory',
      tier: options.tier ?? 'service',
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
    spies: {
      llmComplete,
      auditEvent,
      eventsPublish,
      storagePut,
      storageGet,
      scheduleRegister,
    },
    eventsFor(topic: string): ReadonlyArray<Record<string, unknown>> {
      return eventsPublish.calls
        .filter(([t]) => t === topic)
        .map(([, p]) => p as Record<string, unknown>);
    },
  };
}
