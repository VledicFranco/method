/**
 * In-process mock Cortex `ctx` for the SDK-flavor sample's E2E tests.
 *
 * Adapted from `samples/cortex-incident-triage-agent/test/mock-ctx.ts`.
 * Differences from the sibling:
 *   - `llm.complete` / `llm.structured` are spies but never called by the
 *     SDK provider (the SDK routes through the cortex transport, not
 *     ctx.llm). They remain so the structural CortexCtx type is satisfied
 *     and so the audit middleware composition works the same as in the
 *     manual-loop sibling.
 *   - The flat-vs-nested ctx-shape conversion happens inside `agent.ts`
 *     (`adaptCtx` helper). This mock continues to expose the **nested**
 *     CortexCtx shape — that is the public boundary tenant apps see.
 */

import type {
  CortexAuditFacade,
  CortexCtx,
  CortexEventsFacade,
  CortexLlmFacade,
  CortexLogger,
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
    readonly logWarn: Spy<[string, unknown?]>;
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
  const logWarn = makeSpy<[string, unknown?]>();

  const content = options.llmContent ?? DEFAULT_TRIAGE_JSON;

  // The SDK provider does NOT route through ctx.llm — it goes through
  // the cortex transport (HTTP proxy). complete / structured remain wired
  // so the structural CortexLlmFacade is satisfied; if anything ever calls
  // them, the spy records it (useful for diagnosing accidental dual-paths).
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

  // Logger captures warns — useful when the cortex transport's
  // degraded-mode path logs about missing reserve/settle.
  const log: CortexLogger = {
    info: () => {
      /* no-op */
    },
    warn: (msg, fields) => {
      logWarn.calls.push([msg, fields]);
    },
    error: () => {
      /* no-op */
    },
  };

  // Default tier is 'tool' so strict-mode does not refuse a custom
  // provider override (createMethodAgent strict-mode rule for service-tier
  // apps). The SDK-flavor sample's e2e test passes a stub provider, which
  // requires non-service tier.
  const ctx: CortexCtx = {
    app: { id: options.appId ?? 'incident-triage-sdk', tier: options.tier ?? 'tool' },
    llm,
    audit,
    events,
    storage,
    log,
    input: { text: options.inputText ?? 'DB pool 100% saturated; latency p99 12s' },
  };

  return {
    ctx,
    spies: { llmComplete, auditEvent, eventsPublish, storagePut, logWarn },
  };
}
