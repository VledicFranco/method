/**
 * Reusable spy-backed mock Cortex `ctx` for @method/agent-runtime tests.
 *
 * Not exported from the package barrel — internal test support only. Lives
 * under `src/test-support/` so the TS project can still compile it without
 * pulling in vitest/sinon as dependencies.
 */

import type {
  CortexAuditFacade,
  CortexAuthFacade,
  CortexCtx,
  CortexEventsFacade,
  CortexLlmFacade,
  CortexLogger,
  CortexStorageFacade,
} from '../cortex/ctx-types.js';

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
  readonly llmResponse?: {
    readonly content?: string;
    readonly tokensIn?: number;
    readonly tokensOut?: number;
    readonly costUsd?: number;
    readonly providerModel?: string;
  };
  readonly includeEvents?: boolean;
  readonly includeAuth?: boolean;
  readonly includeStorage?: boolean;
}

export interface MockCtxBundle {
  readonly ctx: CortexCtx;
  readonly spies: {
    readonly llmComplete: Spy<[unknown]>;
    readonly auditEvent: Spy<[unknown]>;
    readonly eventsPublish: Spy<[string, unknown]>;
    readonly authExchange: Spy<[unknown]>;
    readonly storagePut: Spy<[string, unknown]>;
    readonly storageGet: Spy<[string]>;
  };
}

export function makeMockCtx(opts: MockCtxOptions = {}): MockCtxBundle {
  const llmComplete = makeSpy<[unknown]>();
  const auditEvent = makeSpy<[unknown]>();
  const eventsPublish = makeSpy<[string, unknown]>();
  const authExchange = makeSpy<[unknown]>();
  const storagePut = makeSpy<[string, unknown]>();
  const storageGet = makeSpy<[string]>();

  const llmResponse = {
    content: opts.llmResponse?.content ?? '{"ok":true}',
    tokensIn: opts.llmResponse?.tokensIn ?? 120,
    tokensOut: opts.llmResponse?.tokensOut ?? 80,
    costUsd: opts.llmResponse?.costUsd ?? 0.0012,
    providerModel: opts.llmResponse?.providerModel ?? 'mock-model',
  };

  const llm: CortexLlmFacade = {
    async complete(req) {
      llmComplete.calls.push([req]);
      return {
        content: llmResponse.content,
        text: llmResponse.content,
        tokensIn: llmResponse.tokensIn,
        tokensOut: llmResponse.tokensOut,
        costUsd: llmResponse.costUsd,
        providerModel: llmResponse.providerModel,
        budget: {
          totalCostUsd: llmResponse.costUsd,
          limitUsd: 1,
          percentUsed: 1,
        },
      };
    },
    async structured(req) {
      llmComplete.calls.push([req]);
      return {
        value: { ok: true },
        tokensIn: llmResponse.tokensIn,
        tokensOut: llmResponse.tokensOut,
        costUsd: llmResponse.costUsd,
        providerModel: llmResponse.providerModel,
      } as never;
    },
  };

  const audit: CortexAuditFacade = {
    async event(e) {
      auditEvent.calls.push([e]);
    },
  };

  const events: CortexEventsFacade | undefined = opts.includeEvents
    ? {
        async publish(topic, payload) {
          eventsPublish.calls.push([topic, payload]);
        },
      }
    : undefined;

  const auth: CortexAuthFacade | undefined = opts.includeAuth
    ? {
        async exchange(req) {
          authExchange.calls.push([req]);
          return {
            token: 'exchanged-token',
            expiresAt: Date.now() + 60_000,
            audience: (req as { audience?: string }).audience ?? 'agent',
            actAs: [],
            scope: [],
          };
        },
        serviceAccountToken: 'service-account-token',
      }
    : undefined;

  const storageMap = new Map<string, Record<string, unknown>>();
  const storage: CortexStorageFacade | undefined = opts.includeStorage
    ? {
        async put(key, value) {
          storagePut.calls.push([key, value]);
          storageMap.set(key, value as Record<string, unknown>);
        },
        async get(key) {
          storageGet.calls.push([key]);
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
    app: { id: opts.appId ?? 'test-app', tier: opts.tier ?? 'tool' },
    llm,
    audit,
    events,
    auth,
    storage,
    log,
  };

  return {
    ctx,
    spies: {
      llmComplete,
      auditEvent,
      eventsPublish,
      authExchange,
      storagePut,
      storageGet,
    },
  };
}
