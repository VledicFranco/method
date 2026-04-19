// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for cortexAnthropicTransport (S-CORTEX-ANTHROPIC-TRANSPORT).
 *
 * AC coverage from realize-plan §C-2:
 *   - AC-2.1: ctx.llm.reserve()/settle() called once per /v1/messages POST
 *             (full mode). Degraded mode (Cortex O1 not yet present) is
 *             also exercised.
 *   - AC-2.2: ctx.audit.event() emitted per turn with usage payload.
 *   - AC-2.3: HEAD / probe handled (200) per spike-1 finding.
 *   - AC-2.4: budget-exceeded → 429 with the right error shape.
 *   - Multiple concurrent setup() calls produce independent servers.
 *   - teardown() releases the port.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  cortexAnthropicTransport,
  cortexAnthropicTransportV2,
  defaultEstimateCost,
  type AnthropicMessagesRequestShape,
  type CortexAnthropicTransportConfig,
  type CortexAnthropicTransportCtx,
} from './anthropic-transport.js';
import type {
  AuditEvent,
  CortexAuditCtx,
  CortexLlmCtx,
  CompletionRequest,
  CompletionResult,
  StructuredResult,
  EmbeddingResult,
} from './ctx-types.js';

// ── Test fixtures ────────────────────────────────────────────────

interface ReserveCall {
  readonly maxCostUsd: number;
}
interface SettleCall {
  readonly handle: unknown;
  readonly actualCostUsd: number;
}

/**
 * Wave 0 stub froze the transport's ctx parameter as a flat
 * intersection `CortexLlmCtx & CortexAuditCtx` rather than the nested
 * `CortexCtx` shape used elsewhere. Tests therefore build a flat ctx
 * with `complete/structured/embed/event` (and optional `reserve/settle`
 * for full mode) co-located on a single object. See README §Wave 0
 * surface note.
 */
interface FlatCortexCtx extends CortexLlmCtx, CortexAuditCtx {
  reserve?: (args: { maxCostUsd: number }) => Promise<unknown>;
  settle?: (handle: unknown, actualCostUsd: number) => Promise<void>;
}

interface MockCtxBundle {
  ctx: FlatCortexCtx;
  readonly reserveCalls: ReserveCall[];
  readonly settleCalls: SettleCall[];
  readonly auditEvents: AuditEvent[];
  reserveBehavior: 'allow' | 'budget_exceeded' | 'throw_other';
}

interface MockCtxOptions {
  readonly withReserveSettle?: boolean;
  readonly reserveBehavior?: 'allow' | 'budget_exceeded' | 'throw_other';
}

function makeMockCtx(options: MockCtxOptions = {}): MockCtxBundle {
  const reserveCalls: ReserveCall[] = [];
  const settleCalls: SettleCall[] = [];
  const auditEvents: AuditEvent[] = [];
  const bundle: MockCtxBundle = {
    ctx: undefined as never,
    reserveCalls,
    settleCalls,
    auditEvents,
    reserveBehavior: options.reserveBehavior ?? 'allow',
  };

  const flatCtx: FlatCortexCtx = {
    async complete(_req: CompletionRequest): Promise<CompletionResult> {
      throw new Error('not used in transport tests');
    },
    async structured<T>(_req: CompletionRequest): Promise<StructuredResult<T>> {
      throw new Error('not used in transport tests');
    },
    async embed(_text: string): Promise<EmbeddingResult> {
      throw new Error('not used in transport tests');
    },
    async event(ev: AuditEvent): Promise<void> {
      auditEvents.push(ev);
    },
  };

  if (options.withReserveSettle) {
    flatCtx.reserve = async (args: { maxCostUsd: number }): Promise<unknown> => {
      reserveCalls.push({ maxCostUsd: args.maxCostUsd });
      if (bundle.reserveBehavior === 'budget_exceeded') {
        const err = new Error('Budget exceeded for app');
        err.name = 'BudgetExceededError';
        throw err;
      }
      if (bundle.reserveBehavior === 'throw_other') {
        throw new Error('upstream catastrophe');
      }
      return { handleId: `r-${reserveCalls.length}` };
    };
    flatCtx.settle = async (handle: unknown, actualCostUsd: number): Promise<void> => {
      settleCalls.push({ handle, actualCostUsd });
    };
  }

  bundle.ctx = flatCtx;
  return bundle;
}

function noopHandlers(): CortexAnthropicTransportConfig['handlers'] {
  return {
    onBudgetWarning: () => undefined,
    onBudgetCritical: () => undefined,
    onBudgetExceeded: () => undefined,
  };
}

interface FetchCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

interface MockFetchOptions {
  readonly status?: number;
  readonly responseBody?: unknown;
  readonly throwError?: Error;
}

function makeMockFetch(options: MockFetchOptions = {}): {
  fetch: typeof globalThis.fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchFn: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    if (options.throwError) {
      throw options.throwError;
    }
    const status = options.status ?? 200;
    const body =
      options.responseBody ??
      ({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 25 },
      } as Record<string, unknown>);
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(text, {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch: fetchFn, calls };
}

const MESSAGES_BODY: AnthropicMessagesRequestShape = {
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'hi' }],
};

async function postMessages(
  baseUrl: string,
  body: AnthropicMessagesRequestShape = MESSAGES_BODY,
  query = '?beta=true',
): Promise<Response> {
  return globalThis.fetch(`${baseUrl}/v1/messages${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── defaultEstimateCost smoke ────────────────────────────────────

describe('defaultEstimateCost', () => {
  it('returns positive cost for known model', () => {
    const cost = defaultEstimateCost({ ...MESSAGES_BODY, model: 'claude-sonnet-4-6' });
    assert.ok(cost > 0, `expected positive cost, got ${cost}`);
  });
  it('falls back to Opus rates for unknown model', () => {
    const sonnet = defaultEstimateCost({ ...MESSAGES_BODY, model: 'claude-sonnet-4-6' });
    const unknown = defaultEstimateCost({ ...MESSAGES_BODY, model: 'unknown-model' });
    assert.ok(unknown > sonnet, `expected unknown to be more expensive than sonnet (${unknown} > ${sonnet})`);
  });
});

// ── setup() / teardown() lifecycle ───────────────────────────────

describe('cortexAnthropicTransport — setup() / teardown()', () => {
  it('returns env with ANTHROPIC_BASE_URL pointing at a listening 127.0.0.1 port', async () => {
    const { ctx } = makeMockCtx();
    const { fetch } = makeMockFetch();
    const transport = cortexAnthropicTransport(ctx, {
      handlers: noopHandlers(),
      apiKey: { source: 'literal', value: 'sk-test' },
      fetchFn: fetch,
    });
    const { env, teardown } = await transport.setup();

    try {
      assert.ok(
        /^http:\/\/127\.0\.0\.1:\d+$/.test(env.ANTHROPIC_BASE_URL),
        `unexpected base URL: ${env.ANTHROPIC_BASE_URL}`,
      );
      assert.equal(env.ANTHROPIC_API_KEY, 'sk-test');
      // Confirm the port is actually listening.
      const probe = await globalThis.fetch(env.ANTHROPIC_BASE_URL, { method: 'HEAD' });
      assert.equal(probe.status, 200);
    } finally {
      await teardown();
    }
  });

  it('teardown() closes the server (port becomes available — connect refuses)', async () => {
    const { ctx } = makeMockCtx();
    const { fetch } = makeMockFetch();
    const transport = cortexAnthropicTransport(ctx, {
      handlers: noopHandlers(),
      apiKey: { source: 'literal', value: 'sk' },
      fetchFn: fetch,
    });
    const { env, teardown } = await transport.setup();
    await teardown();

    // Subsequent connect should fail.
    let didFail = false;
    try {
      await globalThis.fetch(env.ANTHROPIC_BASE_URL, { method: 'HEAD' });
    } catch {
      didFail = true;
    }
    assert.equal(didFail, true, 'expected connect to fail after teardown');
  });

  it('multiple concurrent setup() calls produce independent servers on different ports', async () => {
    const { ctx } = makeMockCtx();
    const { fetch } = makeMockFetch();
    const transport = cortexAnthropicTransport(ctx, {
      handlers: noopHandlers(),
      apiKey: { source: 'literal', value: 'sk' },
      fetchFn: fetch,
    });
    const [a, b, c] = await Promise.all([
      transport.setup(),
      transport.setup(),
      transport.setup(),
    ]);
    try {
      const ports = [a.env.ANTHROPIC_BASE_URL, b.env.ANTHROPIC_BASE_URL, c.env.ANTHROPIC_BASE_URL];
      assert.equal(new Set(ports).size, 3, `expected 3 unique URLs, got ${JSON.stringify(ports)}`);
      // Each must be independently reachable.
      for (const url of ports) {
        const probe = await globalThis.fetch(url, { method: 'HEAD' });
        assert.equal(probe.status, 200);
      }
    } finally {
      await Promise.all([a.teardown(), b.teardown(), c.teardown()]);
    }
  });
});

// ── HEAD / connectivity probe (AC-2.3) ───────────────────────────

describe('cortexAnthropicTransport — HEAD / probe (AC-2.3)', () => {
  it('responds 200 to HEAD /', async () => {
    const { ctx } = makeMockCtx();
    const { fetch } = makeMockFetch();
    const transport = cortexAnthropicTransport(ctx, {
      handlers: noopHandlers(),
      apiKey: { source: 'literal', value: 'sk' },
      fetchFn: fetch,
    });
    const { env, teardown } = await transport.setup();
    try {
      const resp = await globalThis.fetch(env.ANTHROPIC_BASE_URL + '/', {
        method: 'HEAD',
      });
      assert.equal(resp.status, 200);
    } finally {
      await teardown();
    }
  });

  it('responds 404 to unhandled GET /random', async () => {
    const { ctx } = makeMockCtx();
    const { fetch } = makeMockFetch();
    const transport = cortexAnthropicTransport(ctx, {
      handlers: noopHandlers(),
      apiKey: { source: 'literal', value: 'sk' },
      fetchFn: fetch,
    });
    const { env, teardown } = await transport.setup();
    try {
      const resp = await globalThis.fetch(env.ANTHROPIC_BASE_URL + '/random');
      assert.equal(resp.status, 404);
      const body = await resp.json();
      assert.equal((body as { type: string }).type, 'error');
    } finally {
      await teardown();
    }
  });
});

// ── /v1/messages POST — full mode (with reserve/settle) (AC-2.1, AC-2.2) ──

describe('cortexAnthropicTransport — full mode /v1/messages?beta=true', () => {
  it('reserve() and settle() called once each, audit emitted, response forwarded', async () => {
    const bundle = makeMockCtx({ withReserveSettle: true });
    const { fetch, calls } = makeMockFetch();
    const transport = cortexAnthropicTransport(bundle.ctx, {
      handlers: noopHandlers(),
      apiKey: { source: 'literal', value: 'sk-real' },
      fetchFn: fetch,
      upstreamBaseUrl: 'https://api.anthropic.com',
    });
    const { env, teardown } = await transport.setup();
    try {
      const resp = await postMessages(env.ANTHROPIC_BASE_URL);
      assert.equal(resp.status, 200);

      // Wait for fire-and-forget audit + settle.
      await new Promise((r) => setImmediate(r));

      // AC-2.1 — reserve + settle called exactly once.
      assert.equal(bundle.reserveCalls.length, 1, 'reserve called once');
      assert.equal(bundle.settleCalls.length, 1, 'settle called once');
      assert.ok(
        bundle.reserveCalls[0].maxCostUsd > 0,
        'reserve received positive maxCostUsd',
      );
      // settle's actual cost is computed from the mock response usage
      // (10 input tokens + 25 output tokens at sonnet rates).
      assert.ok(bundle.settleCalls[0].actualCostUsd > 0, 'settle received actualCost');

      // AC-2.2 — exactly one audit event per turn with usage payload.
      assert.equal(bundle.auditEvents.length, 1, 'one audit event per POST');
      const ev = bundle.auditEvents[0];
      assert.equal(ev.eventType, 'method.transport.turn_completed');
      const payload = ev.payload as Record<string, unknown>;
      assert.equal(payload.transport, 'cortex-anthropic-sdk');
      assert.equal(payload.status, 200);
      assert.equal(payload.degradedMode, false, 'full mode reported');
      const usage = payload.usage as Record<string, number>;
      assert.equal(usage.inputTokens, 10);
      assert.equal(usage.outputTokens, 25);

      // Upstream fetch was called with the correct URL/headers/body.
      assert.equal(calls.length, 1);
      assert.ok(
        calls[0].url.includes('/v1/messages?beta=true'),
        `unexpected upstream URL: ${calls[0].url}`,
      );
      const headers = (calls[0].init?.headers ?? {}) as Record<string, string>;
      assert.equal(headers['x-api-key'], 'sk-real');
      assert.equal(headers['anthropic-version'], '2023-06-01');
    } finally {
      await teardown();
    }
  });

  it('non-beta /v1/messages POST is also handled', async () => {
    const bundle = makeMockCtx({ withReserveSettle: true });
    const { fetch } = makeMockFetch();
    const transport = cortexAnthropicTransport(bundle.ctx, {
      handlers: noopHandlers(),
      apiKey: { source: 'literal', value: 'sk' },
      fetchFn: fetch,
    });
    const { env, teardown } = await transport.setup();
    try {
      const resp = await postMessages(env.ANTHROPIC_BASE_URL, MESSAGES_BODY, '');
      assert.equal(resp.status, 200);
      await new Promise((r) => setImmediate(r));
      assert.equal(bundle.reserveCalls.length, 1);
    } finally {
      await teardown();
    }
  });
});

// ── /v1/messages POST — degraded mode (no reserve/settle) ───────

describe('cortexAnthropicTransport — degraded mode (Cortex O1 missing)', () => {
  it('forwards request and emits audit even without reserve/settle on ctx.llm', async () => {
    const bundle = makeMockCtx({ withReserveSettle: false });
    const { fetch, calls } = makeMockFetch();
    const transport = cortexAnthropicTransport(bundle.ctx, {
      handlers: noopHandlers(),
      apiKey: { source: 'literal', value: 'sk' },
      fetchFn: fetch,
    });
    const { env, teardown } = await transport.setup();
    try {
      const resp = await postMessages(env.ANTHROPIC_BASE_URL);
      assert.equal(resp.status, 200);
      await new Promise((r) => setImmediate(r));

      assert.equal(bundle.reserveCalls.length, 0, 'no reserve in degraded mode');
      assert.equal(bundle.settleCalls.length, 0, 'no settle in degraded mode');
      assert.equal(calls.length, 1, 'still forwarded upstream');
      assert.equal(bundle.auditEvents.length, 1);
      const payload = bundle.auditEvents[0].payload as Record<string, unknown>;
      assert.equal(payload.degradedMode, true, 'degradedMode reported');
    } finally {
      await teardown();
    }
  });
});

// ── Budget exceeded (AC-2.4) ─────────────────────────────────────

describe('cortexAnthropicTransport — budget exceeded (AC-2.4)', () => {
  it('returns 429 with rate_limit_error shape; audit emitted; no upstream fetch', async () => {
    const bundle = makeMockCtx({
      withReserveSettle: true,
      reserveBehavior: 'budget_exceeded',
    });
    let onBudgetExceededCalls = 0;
    const handlers: CortexAnthropicTransportConfig['handlers'] = {
      onBudgetWarning: () => undefined,
      onBudgetCritical: () => undefined,
      onBudgetExceeded: () => {
        onBudgetExceededCalls += 1;
      },
    };
    const { fetch, calls } = makeMockFetch();
    const transport = cortexAnthropicTransport(bundle.ctx, {
      handlers,
      apiKey: { source: 'literal', value: 'sk' },
      fetchFn: fetch,
    });
    const { env, teardown } = await transport.setup();
    try {
      const resp = await postMessages(env.ANTHROPIC_BASE_URL);
      assert.equal(resp.status, 429);
      const body = await resp.json();
      const e = (body as { error?: { type?: string; message?: string } }).error;
      assert.equal(e?.type, 'rate_limit_error');
      assert.match(e?.message ?? '', /Budget exceeded/);

      await new Promise((r) => setImmediate(r));

      assert.equal(calls.length, 0, 'no upstream forward on budget exceeded');
      assert.equal(bundle.settleCalls.length, 0, 'no settle when reserve fails');
      assert.equal(onBudgetExceededCalls, 1, 'onBudgetExceeded handler fired');
      assert.equal(bundle.auditEvents.length, 1, 'audit still emitted (status 429)');
      const payload = bundle.auditEvents[0].payload as Record<string, unknown>;
      assert.equal(payload.status, 429);
    } finally {
      await teardown();
    }
  });
});

// ── Upstream failure / non-200 forwarding ────────────────────────

describe('cortexAnthropicTransport — upstream failure', () => {
  it('upstream network error → 502 with Anthropic-shaped error body, settles at 0', async () => {
    const bundle = makeMockCtx({ withReserveSettle: true });
    const { fetch } = makeMockFetch({
      throwError: new Error('ECONNREFUSED upstream'),
    });
    const transport = cortexAnthropicTransport(bundle.ctx, {
      handlers: noopHandlers(),
      apiKey: { source: 'literal', value: 'sk' },
      fetchFn: fetch,
    });
    const { env, teardown } = await transport.setup();
    try {
      const resp = await postMessages(env.ANTHROPIC_BASE_URL);
      assert.equal(resp.status, 502);
      const body = await resp.json();
      assert.equal((body as { type: string }).type, 'error');
      await new Promise((r) => setImmediate(r));
      // Settled at 0 so caller doesn't get double-billed.
      assert.equal(bundle.settleCalls.length, 1);
      assert.equal(bundle.settleCalls[0].actualCostUsd, 0);
    } finally {
      await teardown();
    }
  });

  it('upstream 401 is forwarded with status preserved', async () => {
    const bundle = makeMockCtx({ withReserveSettle: true });
    const { fetch } = makeMockFetch({
      status: 401,
      responseBody: { type: 'error', error: { type: 'authentication_error', message: 'bad key' } },
    });
    const transport = cortexAnthropicTransport(bundle.ctx, {
      handlers: noopHandlers(),
      apiKey: { source: 'literal', value: 'sk' },
      fetchFn: fetch,
    });
    const { env, teardown } = await transport.setup();
    try {
      const resp = await postMessages(env.ANTHROPIC_BASE_URL);
      assert.equal(resp.status, 401);
      await new Promise((r) => setImmediate(r));
      // Reserve happened; settle happened at 0 cost (non-2xx skips usage parse).
      assert.equal(bundle.reserveCalls.length, 1);
      assert.equal(bundle.settleCalls.length, 1);
      assert.equal(bundle.settleCalls[0].actualCostUsd, 0);
    } finally {
      await teardown();
    }
  });
});

// ── Bad input handling ───────────────────────────────────────────

describe('cortexAnthropicTransport — input validation', () => {
  it('returns 400 for non-JSON request body', async () => {
    const bundle = makeMockCtx({ withReserveSettle: true });
    const { fetch } = makeMockFetch();
    const transport = cortexAnthropicTransport(bundle.ctx, {
      handlers: noopHandlers(),
      apiKey: { source: 'literal', value: 'sk' },
      fetchFn: fetch,
    });
    const { env, teardown } = await transport.setup();
    try {
      const resp = await globalThis.fetch(env.ANTHROPIC_BASE_URL + '/v1/messages?beta=true', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not-json',
      });
      assert.equal(resp.status, 400);
      // No reserve, no upstream call.
      assert.equal(bundle.reserveCalls.length, 0);
    } finally {
      await teardown();
    }
  });
});

// ── cortexAnthropicTransportV2 — nested ctx shape (Wave 3 harmonise) ──

describe('cortexAnthropicTransportV2 — nested { llm, audit } ctx', () => {
  it('degraded mode happy path: forwards request, emits audit with degradedMode=true, no reserve/settle', async () => {
    const auditEvents: AuditEvent[] = [];
    // Narrow V2 ctx: no `complete/structured/embed` needed — the
    // transport forwards to upstream Anthropic directly.
    const nestedCtx: CortexAnthropicTransportCtx = {
      llm: {},
      audit: {
        async event(ev: AuditEvent): Promise<void> {
          auditEvents.push(ev);
        },
      },
    };

    const { fetch, calls } = makeMockFetch();
    const transport = cortexAnthropicTransportV2(nestedCtx, {
      handlers: noopHandlers(),
      apiKey: { source: 'literal', value: 'sk-v2' },
      fetchFn: fetch,
    });
    const { env, teardown } = await transport.setup();
    try {
      const resp = await postMessages(env.ANTHROPIC_BASE_URL);
      assert.equal(resp.status, 200);
      await new Promise((r) => setImmediate(r));

      // Upstream was hit once.
      assert.equal(calls.length, 1);
      // Exactly one audit event, reporting degraded mode.
      assert.equal(auditEvents.length, 1);
      const payload = auditEvents[0].payload as Record<string, unknown>;
      assert.equal(payload.transport, 'cortex-anthropic-sdk');
      assert.equal(payload.status, 200);
      assert.equal(payload.degradedMode, true);
      const usage = payload.usage as Record<string, number>;
      assert.equal(usage.inputTokens, 10);
      assert.equal(usage.outputTokens, 25);
    } finally {
      await teardown();
    }
  });

  it('preserves duck-typed reserve/settle on ctx.llm (full mode)', async () => {
    const reserveCalls: ReserveCall[] = [];
    const settleCalls: SettleCall[] = [];
    const auditEvents: AuditEvent[] = [];

    const nestedCtx: CortexAnthropicTransportCtx = {
      llm: {
        async reserve(args: { maxCostUsd: number }): Promise<unknown> {
          reserveCalls.push({ maxCostUsd: args.maxCostUsd });
          return { handleId: `r-${reserveCalls.length}` };
        },
        async settle(handle: unknown, actualCostUsd: number): Promise<void> {
          settleCalls.push({ handle, actualCostUsd });
        },
      },
      audit: {
        async event(ev: AuditEvent): Promise<void> {
          auditEvents.push(ev);
        },
      },
    };

    const { fetch } = makeMockFetch();
    const transport = cortexAnthropicTransportV2(nestedCtx, {
      handlers: noopHandlers(),
      apiKey: { source: 'literal', value: 'sk-v2-full' },
      fetchFn: fetch,
    });
    const { env, teardown } = await transport.setup();
    try {
      const resp = await postMessages(env.ANTHROPIC_BASE_URL);
      assert.equal(resp.status, 200);
      await new Promise((r) => setImmediate(r));

      assert.equal(reserveCalls.length, 1, 'reserve called once via V2');
      assert.equal(settleCalls.length, 1, 'settle called once via V2');
      assert.ok(reserveCalls[0].maxCostUsd > 0);
      assert.ok(settleCalls[0].actualCostUsd > 0);
      assert.equal(auditEvents.length, 1);
      const payload = auditEvents[0].payload as Record<string, unknown>;
      assert.equal(payload.degradedMode, false, 'full mode reported via V2');
    } finally {
      await teardown();
    }
  });

  it('budget exceeded returns 429 via V2 with audit emitted', async () => {
    const auditEvents: AuditEvent[] = [];
    const nestedCtx: CortexAnthropicTransportCtx = {
      llm: {
        async reserve(_args: { maxCostUsd: number }): Promise<unknown> {
          const err = new Error('Budget exceeded for app');
          err.name = 'BudgetExceededError';
          throw err;
        },
        async settle(_handle: unknown, _actualCostUsd: number): Promise<void> {
          // unreachable when reserve throws
        },
      },
      audit: {
        async event(ev: AuditEvent): Promise<void> {
          auditEvents.push(ev);
        },
      },
    };

    let onBudgetExceededCalls = 0;
    const handlers: CortexAnthropicTransportConfig['handlers'] = {
      onBudgetWarning: () => undefined,
      onBudgetCritical: () => undefined,
      onBudgetExceeded: () => {
        onBudgetExceededCalls += 1;
      },
    };
    const { fetch, calls } = makeMockFetch();
    const transport = cortexAnthropicTransportV2(nestedCtx, {
      handlers,
      apiKey: { source: 'literal', value: 'sk' },
      fetchFn: fetch,
    });
    const { env, teardown } = await transport.setup();
    try {
      const resp = await postMessages(env.ANTHROPIC_BASE_URL);
      assert.equal(resp.status, 429);
      await new Promise((r) => setImmediate(r));
      assert.equal(calls.length, 0, 'no upstream forward on budget exceeded');
      assert.equal(onBudgetExceededCalls, 1);
      assert.equal(auditEvents.length, 1);
      const payload = auditEvents[0].payload as Record<string, unknown>;
      assert.equal(payload.status, 429);
    } finally {
      await teardown();
    }
  });
});
