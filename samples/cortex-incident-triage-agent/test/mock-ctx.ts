/**
 * In-process mock Cortex `ctx` for the sample app E2E tests (PRD-058 §7.2).
 *
 * Intentionally duplicates the test-support mock in `@method/agent-runtime`
 * — the sample should be usable by tenant teams without depending on
 * internals of the runtime. The mock's surface matches `CortexCtx`.
 */

import type {
  CortexAuditFacade,
  CortexCtx,
  CortexEventsFacade,
  CortexLlmFacade,
  CortexLogger,
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
  readonly inputText?: string;
  readonly llmContent?: string;
  readonly includeEvents?: boolean;
  readonly includeStorage?: boolean;
}

export interface MockCtxBundle {
  readonly ctx: CortexCtx;
  readonly spies: {
    readonly llmComplete: Spy<[unknown]>;
    readonly auditEvent: Spy<[unknown]>;
    readonly eventsPublish: Spy<[string, unknown]>;
    readonly storagePut: Spy<[string, unknown]>;
  };
}

const DEFAULT_TRIAGE_JSON = JSON.stringify({
  severity: 'warning',
  summary: 'Database connection pool saturated on db-west-2',
  nextAction: 'page on-call DBA, scale read replicas',
});

export function createMockCtx(options: MockCtxOptions = {}): MockCtxBundle {
  const llmComplete = makeSpy<[unknown]>();
  const auditEvent = makeSpy<[unknown]>();
  const eventsPublish = makeSpy<[string, unknown]>();
  const storagePut = makeSpy<[string, unknown]>();

  const content = options.llmContent ?? DEFAULT_TRIAGE_JSON;

  const llm: CortexLlmFacade = {
    async complete(req) {
      llmComplete.calls.push([req]);
      return {
        content,
        text: content,
        tokensIn: 140,
        tokensOut: 96,
        costUsd: 0.0023,
        providerModel: 'mock-balanced',
        budget: {
          totalCostUsd: 0.0023,
          limitUsd: 0.1,
          percentUsed: 2,
        },
      };
    },
    async structured(req) {
      llmComplete.calls.push([req]);
      return {
        value: JSON.parse(content),
        tokensIn: 140,
        tokensOut: 96,
        costUsd: 0.0023,
        providerModel: 'mock-balanced',
      } as never;
    },
  };

  const audit: CortexAuditFacade = {
    async event(e) {
      auditEvent.calls.push([e]);
    },
  };

  const events: CortexEventsFacade | undefined = options.includeEvents
    ? {
        async publish(topic, payload) {
          eventsPublish.calls.push([topic, payload]);
        },
      }
    : undefined;

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
    app: { id: options.appId ?? 'incident-triage', tier: options.tier ?? 'tool' },
    llm,
    audit,
    events,
    storage,
    log,
    input: { text: options.inputText ?? 'DB pool 100% saturated; latency p99 12s' },
  };

  return {
    ctx,
    spies: { llmComplete, auditEvent, eventsPublish, storagePut },
  };
}
