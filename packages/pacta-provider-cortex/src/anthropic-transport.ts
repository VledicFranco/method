// SPDX-License-Identifier: Apache-2.0
/**
 * S-CORTEX-ANTHROPIC-TRANSPORT — Cortex-side production of
 * S-ANTHROPIC-SDK-TRANSPORT.
 *
 * Pairs with `@methodts/pacta-provider-claude-agent-sdk` to let a
 * Cortex tenant app use the Claude Agent SDK as its inner loop while
 * routing every API call through `ctx.llm` for budget enforcement.
 *
 * `setup()` per SDK invocation:
 *   1. Spins up a localhost HTTP proxy on a random port (127.0.0.1)
 *   2. Returns { env: { ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY }, teardown }
 *
 * The proxy intercepts each `/v1/messages?beta=true` POST:
 *   1. Parses the Anthropic request body
 *   2. Calls ctx.llm.reserve(estimateCost(req))   // requires Cortex O1
 *   3. Forwards to api.anthropic.com using the resolved API key
 *   4. Parses response, computes actual cost from usage
 *   5. Calls ctx.llm.settle(handle, actualCost)   // requires Cortex O1
 *   6. Emits ctx.audit.event for the turn (PRD-065 schema)
 *   7. Streams the unmodified Response back to the SDK
 *
 * Initial `HEAD /` connectivity probes from the SDK are answered with
 * 200 (see spike-findings.md surprise #1).
 *
 * # Degraded mode (current default)
 *
 * `ctx.llm.reserve()` / `.settle()` are Cortex ask **O1** — not yet
 * present on the structural `CortexLlmCtx` re-declared in
 * `ctx-types.ts`. Until O1 lands, this transport runs in **degraded
 * mode**: budget pre-flight is skipped, the request is forwarded
 * directly, the response usage is parsed, and a single audit event is
 * emitted per turn with the actual cost. Document and call sites are
 * marked `// TODO(O1):`.
 *
 * Once `CortexLlmCtx.reserve` / `.settle` exist (PRD-080 / Cortex O1),
 * the call sites flip to the full pre/post pattern with no transport
 * surface change.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';

import type { AnthropicSdkTransport } from '@methodts/pacta-provider-claude-agent-sdk';
import type {
  AuditEvent,
  CortexAuditCtx,
  CortexLlmCtx,
} from './ctx-types.js';

/**
 * Composed ctx slice this transport requires — flat intersection.
 *
 * Retained for the legacy `cortexAnthropicTransport` factory (see
 * `@deprecated` note there). New code should prefer the nested
 * {@link CortexAnthropicTransportCtx} shape consumed by
 * {@link cortexAnthropicTransportV2}, which mirrors the nested
 * `CortexCtx` shape used elsewhere on the Cortex surface.
 */
type CortexTransportCtx = CortexLlmCtx & CortexAuditCtx;

/**
 * Narrow runtime view of `ctx.audit` the transport touches. Structurally
 * identical to {@link CortexAuditCtx} but retained as a local alias so
 * the V2 ctx parameter can widen in step with the Cortex facade drift
 * without affecting legacy call sites.
 */
interface CortexAnthropicTransportAuditCtx {
  event(ev: AuditEvent): Promise<void> | void;
}

/**
 * Narrow runtime view of `ctx.llm` the V2 transport touches.
 *
 * Deliberately narrower than {@link CortexLlmCtx}: the transport's own
 * code path (proxy → upstream Anthropic) never invokes
 * `complete/structured/embed` in either degraded or full mode. The only
 * methods exercised are `reserve`/`settle` (Cortex O1, duck-typed) and
 * optionally `registerBudgetHandlers`. Keeping this view narrow lets
 * both narrow SDK redeclarations
 * (`@methodts/pacta-provider-cortex.CortexLlmCtx`,
 *  `@methodts/agent-runtime.CortexLlmFacade`) satisfy the V2 contract
 * without a structural-typing seam — i.e. without the `unknown as` cast
 * previously needed in the C-4 sample's `adaptCtx` helper. See the
 * Wave 3 cleanup note in PR #193.
 */
interface CortexAnthropicTransportLlmCtx {
  reserve?(args: { maxCostUsd: number }): Promise<unknown> | unknown;
  settle?(handle: unknown, actualCostUsd: number): Promise<void> | void;
  registerBudgetHandlers?: CortexLlmCtx['registerBudgetHandlers'];
}

/**
 * Nested ctx shape consumed by {@link cortexAnthropicTransportV2} — the
 * harmonised shape that matches `CortexCtx` elsewhere on the Cortex
 * surface (`ctx.llm.*`, `ctx.audit.*`). Prefer this over the legacy
 * flat-intersection factory.
 *
 * The member shapes are the narrow runtime views the transport actually
 * exercises; both `@methodts/pacta-provider-cortex`'s `CortexLlmCtx` and
 * `@methodts/agent-runtime`'s `CortexLlmFacade` structurally satisfy
 * {@link CortexAnthropicTransportLlmCtx} without drift.
 */
export interface CortexAnthropicTransportCtx {
  readonly llm: CortexAnthropicTransportLlmCtx;
  readonly audit: CortexAnthropicTransportAuditCtx;
}

/** Optional `log` facade — passed through for diagnostics. */
interface CortexLogShape {
  warn?(msg: string, fields?: Record<string, unknown>): void;
  error?(msg: string, fields?: Record<string, unknown>): void;
  info?(msg: string, fields?: Record<string, unknown>): void;
}

export interface BudgetEvent {
  readonly tenantAppId: string;
  readonly reservationId?: string;
  readonly costUsd: number;
  readonly maxCostUsd: number;
  readonly remainingUsd: number;
}

export interface AnthropicMessagesRequestShape {
  readonly model: string;
  readonly max_tokens: number;
  readonly messages: ReadonlyArray<{ role: string; content: unknown }>;
  readonly tools?: ReadonlyArray<unknown>;
  readonly system?: string | ReadonlyArray<unknown>;
}

/**
 * Reservation handle returned by the optional `ctx.llm.reserve()` call
 * (Cortex O1). Opaque from this transport's POV.
 */
type ReservationHandle = unknown;

/**
 * Forward-compatible shape of `ctx.llm.reserve` / `.settle` (Cortex
 * O1). Not part of the structural `CortexLlmCtx` yet — we duck-type at
 * runtime via {@link hasReserveSettle}.
 */
interface CortexLlmCtxWithReserve extends CortexLlmCtx {
  reserve(args: { maxCostUsd: number }): Promise<ReservationHandle> | ReservationHandle;
  settle(handle: ReservationHandle, actualCostUsd: number): Promise<void> | void;
}

export interface CortexAnthropicTransportConfig {
  /**
   * Where to fetch the Anthropic API key.
   * Defaults to `process.env.ANTHROPIC_API_KEY`.
   *
   * `source: 'secret'` is reserved for the future Cortex `ctx.secrets`
   * facade (not yet on `CortexLlmCtx & CortexAuditCtx`). Until that
   * surface lands, `source: 'secret'` falls back to env with a warning.
   * TODO(ctx.secrets): wire to ctx-types extension when available.
   */
  apiKey?:
    | { source: 'env'; name?: string }
    | { source: 'secret'; name: string }
    | { source: 'literal'; value: string };

  /**
   * Cost estimator: given an Anthropic request body, return the
   * predicted maxCostUsd to pass to ctx.llm.reserve().
   * Defaults to a conservative per-model upper bound based on
   * max_tokens (see {@link defaultEstimateCost}).
   */
  estimateCost?: (req: AnthropicMessagesRequestShape) => number;

  /**
   * Mandatory budget handlers (matches CortexLLMProviderConfig).
   * Wired into the same handler taxonomy so a tenant app sees a
   * single consistent budget surface across providers.
   */
  handlers: {
    onBudgetWarning: (e: BudgetEvent) => void;
    onBudgetCritical: (e: BudgetEvent) => void;
    onBudgetExceeded: (e: BudgetEvent) => void;
  };

  /**
   * App id, used for audit `actor` and for {@link BudgetEvent.tenantAppId}.
   * Defaults to `'cortex-anthropic-transport'`.
   */
  appId?: string;

  /**
   * Override the upstream Anthropic API base URL. Defaults to
   * `https://api.anthropic.com`. Tests can point this at a stub.
   */
  upstreamBaseUrl?: string;

  /**
   * Override the global fetch used to forward to upstream Anthropic.
   * Defaults to `globalThis.fetch`. Useful for tests.
   */
  fetchFn?: typeof globalThis.fetch;

  /** Optional logger for diagnostics. */
  log?: CortexLogShape;
}

// ── Default pricing (Anthropic, USD per million tokens) ───────────
//
// Hardcoded here rather than imported from `@methodts/pacta-provider-anthropic`
// because the cortex package must not depend on a sibling provider
// package. Keep in sync with `pacta-provider-anthropic/src/pricing.ts`.

interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheWritePerMillion: number;
  cacheReadPerMillion: number;
}

const PRICING_TABLE: Record<string, ModelPricing> = {
  'claude-sonnet-4-6': {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheWritePerMillion: 3.75,
    cacheReadPerMillion: 0.3,
  },
  'claude-sonnet-4-20250514': {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheWritePerMillion: 3.75,
    cacheReadPerMillion: 0.3,
  },
  'claude-opus-4-20250514': {
    inputPerMillion: 15,
    outputPerMillion: 75,
    cacheWritePerMillion: 18.75,
    cacheReadPerMillion: 1.5,
  },
  'claude-haiku-4-5-20250514': {
    inputPerMillion: 0.8,
    outputPerMillion: 4,
    cacheWritePerMillion: 1,
    cacheReadPerMillion: 0.08,
  },
};

// Conservative fallback for unknown models — Opus rates per the C-2
// spec ("If model unknown, charge as if Opus rates").
const OPUS_PRICING: ModelPricing = PRICING_TABLE['claude-opus-4-20250514'];

function pricingFor(model: string): ModelPricing {
  return PRICING_TABLE[model] ?? OPUS_PRICING;
}

/**
 * Default cost estimator: an upper bound assuming the entire
 * `max_tokens` budget is spent on output and the prompt is ~equal to
 * `max_tokens` (a deliberate over-estimate so we don't under-reserve).
 */
export function defaultEstimateCost(req: AnthropicMessagesRequestShape): number {
  const pricing = pricingFor(req.model);
  const maxTokens = Math.max(1, req.max_tokens ?? 4096);
  const inputCost = (maxTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (maxTokens / 1_000_000) * pricing.outputPerMillion;
  return inputCost + outputCost;
}

// ── Anthropic response usage shape (subset) ───────────────────────

interface AnthropicUsageShape {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface AnthropicMessagesResponseShape {
  model?: string;
  usage?: AnthropicUsageShape;
}

function actualCostFromResponse(
  reqModel: string,
  body: AnthropicMessagesResponseShape | null,
): { costUsd: number; usage: AnthropicUsageShape; model: string } {
  const usage: AnthropicUsageShape = body?.usage ?? {};
  const model = body?.model ?? reqModel;
  const pricing = pricingFor(model);
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cost =
    (input / 1_000_000) * pricing.inputPerMillion +
    (output / 1_000_000) * pricing.outputPerMillion +
    (cacheWrite / 1_000_000) * pricing.cacheWritePerMillion +
    (cacheRead / 1_000_000) * pricing.cacheReadPerMillion;
  return { costUsd: cost, usage, model };
}

// ── ctx.llm.reserve/settle duck typing (Cortex O1) ────────────────

function hasReserveSettle(
  llm: CortexLlmCtx,
): llm is CortexLlmCtxWithReserve {
  const candidate = llm as Partial<CortexLlmCtxWithReserve>;
  return (
    typeof candidate.reserve === 'function' &&
    typeof candidate.settle === 'function'
  );
}

// ── API key resolution ───────────────────────────────────────────

function resolveApiKey(
  config: CortexAnthropicTransportConfig,
  log: CortexLogShape | undefined,
): string {
  const spec = config.apiKey;
  if (!spec) {
    return process.env.ANTHROPIC_API_KEY ?? '';
  }
  if (spec.source === 'literal') {
    return spec.value;
  }
  if (spec.source === 'env') {
    const name = spec.name ?? 'ANTHROPIC_API_KEY';
    return process.env[name] ?? '';
  }
  // source === 'secret' — TODO(ctx.secrets): wire to ctx-types extension.
  log?.warn?.(
    '[cortexAnthropicTransport] apiKey.source="secret" not yet supported; falling back to ANTHROPIC_API_KEY env',
    { name: spec.name },
  );
  return process.env.ANTHROPIC_API_KEY ?? '';
}

// ── Anthropic-shaped error bodies ────────────────────────────────

function anthropicErrorBody(
  type:
    | 'rate_limit_error'
    | 'authentication_error'
    | 'api_error'
    | 'invalid_request_error'
    | 'overloaded_error',
  message: string,
): string {
  return JSON.stringify({ type: 'error', error: { type, message } });
}

// ── Body buffering ───────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

// ── Header helpers ───────────────────────────────────────────────

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  // Strip framing — node will set these correctly when we re-emit.
  'content-length',
  'content-encoding',
  // Strip the host header from upstream — would confuse SDK.
  'host',
]);

function copyResponseHeaders(
  source: Headers,
  res: ServerResponse,
): void {
  source.forEach((value, key) => {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) return;
    try {
      res.setHeader(key, value);
    } catch {
      // ignore invalid header names from upstream
    }
  });
}

// ── Audit emission ───────────────────────────────────────────────

interface TurnAuditPayload {
  readonly model: string;
  readonly maxTokens: number;
  readonly usage: AnthropicUsageShape;
  readonly costUsd: number;
  readonly maxCostUsd: number;
  readonly status: number;
  readonly degradedMode: boolean;
}

function emitTurnAudit(
  ctx: CortexAuditCtx,
  appId: string,
  payload: TurnAuditPayload,
): void {
  // PRD-065 audit event — `pact.turn_completed` doesn't yet exist in
  // AUDIT_EVENT_MAP (those entries map pacta AgentEvent → audit). The
  // transport emits below pacta, so we use a transport-specific
  // eventType. Documented in README §Audit events.
  const event: AuditEvent = {
    eventType: 'method.transport.turn_completed',
    payload: {
      transport: 'cortex-anthropic-sdk',
      model: payload.model,
      maxTokens: payload.maxTokens,
      usage: {
        inputTokens: payload.usage.input_tokens ?? 0,
        outputTokens: payload.usage.output_tokens ?? 0,
        cacheReadTokens: payload.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: payload.usage.cache_creation_input_tokens ?? 0,
      },
      costUsd: payload.costUsd,
      maxCostUsd: payload.maxCostUsd,
      status: payload.status,
      degradedMode: payload.degradedMode,
    },
    actor: { appId },
  };
  // Fire-and-forget per PRD-065 §6.4.
  try {
    const result = ctx.event(event);
    if (result && typeof (result as Promise<void>).then === 'function') {
      (result as Promise<void>).catch(() => {
        /* swallow per fire-and-forget contract */
      });
    }
  } catch {
    /* swallow per fire-and-forget contract */
  }
}

// ── Budget-exceeded error ────────────────────────────────────────

class BudgetExceededFromCtx extends Error {
  constructor(
    message: string,
    public readonly maxCostUsd: number,
  ) {
    super(message);
    this.name = 'BudgetExceededFromCtx';
  }
}

function isBudgetExceededError(err: unknown): boolean {
  if (err instanceof BudgetExceededFromCtx) return true;
  if (!(err instanceof Error)) return false;
  if (err.name === 'BudgetExceeded' || err.name === 'BudgetExceededError') {
    return true;
  }
  if (/budget.*(exceed|exhausted)/i.test(err.message)) return true;
  const code = (err as Error & { code?: unknown }).code;
  if (typeof code === 'string' && /budget/i.test(code)) return true;
  return false;
}

// ── The factory ──────────────────────────────────────────────────

/**
 * Produce a Cortex-aware AnthropicSdkTransport.
 *
 * Each `setup()` call boots an independent localhost HTTP proxy. Safe
 * to call concurrently from multiple agent invocations.
 *
 * @deprecated Use {@link cortexAnthropicTransportV2} with the nested
 *   `{ llm, audit }` ctx shape. Will be removed in 1.0. This overload
 *   retained for backward compatibility with consumers wired against
 *   the Wave 0 flat-intersection surface.
 */
export function cortexAnthropicTransport(
  ctx: CortexTransportCtx,
  config: CortexAnthropicTransportConfig,
): AnthropicSdkTransport {
  const log = config.log;
  const appId = config.appId ?? 'cortex-anthropic-transport';
  const upstreamBaseUrl = (
    config.upstreamBaseUrl ?? 'https://api.anthropic.com'
  ).replace(/\/+$/, '');
  const fetchFn: typeof globalThis.fetch =
    config.fetchFn ?? ((...args) => globalThis.fetch(...args));
  const estimateCost = config.estimateCost ?? defaultEstimateCost;

  return {
    async setup() {
      const apiKey = resolveApiKey(config, log);
      const server: Server = createServer((req, res) => {
        // Errors out of the handler must never crash the server.
        handleProxyRequest({
          req,
          res,
          ctx,
          appId,
          apiKey,
          upstreamBaseUrl,
          fetchFn,
          estimateCost,
          handlers: config.handlers,
          log,
        }).catch((err) => {
          log?.error?.('[cortexAnthropicTransport] handler crashed', {
            message: err instanceof Error ? err.message : String(err),
          });
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
            res.end(
              anthropicErrorBody('api_error', 'transport handler crashed'),
            );
          } else {
            try {
              res.end();
            } catch {
              /* ignore */
            }
          }
        });
      });

      // Bind to a random ephemeral port on loopback only.
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error): void => {
          server.removeListener('listening', onListening);
          reject(err);
        };
        const onListening = (): void => {
          server.removeListener('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(0, '127.0.0.1');
      });

      const address = server.address();
      if (!address || typeof address === 'string') {
        await new Promise<void>((r) => server.close(() => r()));
        throw new Error(
          '[cortexAnthropicTransport] failed to acquire ephemeral port',
        );
      }
      const port = address.port;

      return {
        env: {
          ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
          ANTHROPIC_API_KEY: apiKey,
        },
        teardown: () =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
            // Force-close any lingering connections so port becomes
            // free immediately (node's default close waits for keep-alive).
            try {
              (
                server as Server & { closeAllConnections?: () => void }
              ).closeAllConnections?.();
            } catch {
              /* node < 18.2 — keep-alive will eventually time out */
            }
          }),
      };
    },
  };
}

/**
 * Produce a Cortex-aware AnthropicSdkTransport from the nested
 * `{ llm, audit }` ctx shape — the harmonised surface that mirrors
 * `CortexCtx` elsewhere.
 *
 * Each `setup()` call boots an independent localhost HTTP proxy. Safe
 * to call concurrently from multiple agent invocations.
 *
 * Implementation-wise this is a thin wrapper: it flattens the nested
 * ctx into the intersection shape the legacy factory accepts, taking
 * care to preserve the optional `reserve/settle` methods (Cortex O1)
 * via duck-typing so the existing `hasReserveSettle` check continues
 * to work.
 */
export function cortexAnthropicTransportV2(
  ctx: CortexAnthropicTransportCtx,
  config: CortexAnthropicTransportConfig,
): AnthropicSdkTransport {
  // Flatten nested → intersection. The legacy factory's ctx parameter
  // type insists on `complete/structured/embed` (PRD-068 surface), but
  // the transport's runtime path never calls them — only
  // `reserve`/`settle` (Cortex O1, duck-typed) and `event`. Provide
  // throwing stubs for the unused slots so the type system is happy
  // and a programmer error (direct ctx.complete call from the
  // transport internals) would surface loudly rather than silently.
  const llm = ctx.llm;
  const audit = ctx.audit;
  const llmWithReserve = llm as Partial<CortexLlmCtxWithReserve>;
  const throwNotUsed = (name: string) => (): never => {
    throw new Error(
      `[cortexAnthropicTransportV2] ctx.llm.${name} should not be ` +
        'invoked — the transport forwards directly to upstream Anthropic.',
    );
  };
  const flat: CortexTransportCtx & Partial<CortexLlmCtxWithReserve> = {
    complete: throwNotUsed('complete') as CortexLlmCtx['complete'],
    structured: throwNotUsed('structured') as CortexLlmCtx['structured'],
    embed: throwNotUsed('embed') as CortexLlmCtx['embed'],
    event: audit.event.bind(audit),
  };
  if (llm.registerBudgetHandlers) {
    flat.registerBudgetHandlers = llm.registerBudgetHandlers.bind(
      llm as unknown as CortexLlmCtx,
    );
  }
  if (
    typeof llmWithReserve.reserve === 'function' &&
    typeof llmWithReserve.settle === 'function'
  ) {
    flat.reserve = llmWithReserve.reserve.bind(llm);
    flat.settle = llmWithReserve.settle.bind(llm);
  }
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- internal delegation is intentional
  return cortexAnthropicTransport(flat, config);
}

// ── Per-request handler ──────────────────────────────────────────

interface HandlerArgs {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly ctx: CortexTransportCtx;
  readonly appId: string;
  readonly apiKey: string;
  readonly upstreamBaseUrl: string;
  readonly fetchFn: typeof globalThis.fetch;
  readonly estimateCost: (req: AnthropicMessagesRequestShape) => number;
  readonly handlers: CortexAnthropicTransportConfig['handlers'];
  readonly log: CortexLogShape | undefined;
}

async function handleProxyRequest(args: HandlerArgs): Promise<void> {
  const { req, res } = args;
  const method = (req.method ?? 'GET').toUpperCase();
  const url = req.url ?? '/';

  // --- HEAD / connectivity probe (spike-findings.md surprise #1) ---
  if (method === 'HEAD' && (url === '/' || url.startsWith('/?'))) {
    res.statusCode = 200;
    res.end();
    return;
  }

  // --- POST /v1/messages[?beta=true] — the real work --------------
  // Match both the beta and non-beta path as a safety net.
  const isMessages =
    method === 'POST' && (url.startsWith('/v1/messages?') || url === '/v1/messages');

  if (!isMessages) {
    // Anything else: 404 with an Anthropic-shaped error body.
    res.statusCode = 404;
    res.setHeader('content-type', 'application/json');
    res.end(anthropicErrorBody('invalid_request_error', `not handled: ${method} ${url}`));
    return;
  }

  await handleMessagesPost(args, url);
}

async function handleMessagesPost(args: HandlerArgs, url: string): Promise<void> {
  const { req, res, ctx, appId, apiKey, upstreamBaseUrl, fetchFn, estimateCost, handlers, log } = args;

  // 1. Read + parse the request body.
  let bodyRaw: string;
  try {
    bodyRaw = await readBody(req);
  } catch (err) {
    log?.error?.('[cortexAnthropicTransport] failed to read request body', {
      message: err instanceof Error ? err.message : String(err),
    });
    res.statusCode = 400;
    res.setHeader('content-type', 'application/json');
    res.end(anthropicErrorBody('invalid_request_error', 'unable to read request body'));
    return;
  }

  let parsedReq: AnthropicMessagesRequestShape;
  try {
    parsedReq = JSON.parse(bodyRaw) as AnthropicMessagesRequestShape;
  } catch {
    res.statusCode = 400;
    res.setHeader('content-type', 'application/json');
    res.end(anthropicErrorBody('invalid_request_error', 'request body is not valid JSON'));
    return;
  }

  const maxCostUsd = (() => {
    try {
      return estimateCost(parsedReq);
    } catch (err) {
      log?.warn?.('[cortexAnthropicTransport] estimateCost threw; using 0', {
        message: err instanceof Error ? err.message : String(err),
      });
      return 0;
    }
  })();

  // 2. Pre-flight reserve (Cortex O1). Degraded mode if not present.
  const llmCtx = ctx as CortexLlmCtx;
  let reservation: ReservationHandle | undefined;
  let degradedMode = true;
  // TODO(O1): when CortexLlmCtx ships .reserve/.settle, this branch
  // becomes unconditional. For now we duck-type.
  if (hasReserveSettle(llmCtx)) {
    degradedMode = false;
    try {
      reservation = await Promise.resolve(llmCtx.reserve({ maxCostUsd }));
    } catch (err) {
      if (isBudgetExceededError(err)) {
        // Fire the handler so app-level subscribers see it.
        try {
          handlers.onBudgetExceeded({
            tenantAppId: appId,
            costUsd: 0,
            maxCostUsd,
            remainingUsd: 0,
          });
        } catch {
          /* handler errors are app's problem, not ours */
        }
        res.statusCode = 429;
        res.setHeader('content-type', 'application/json');
        res.end(anthropicErrorBody('rate_limit_error', 'Budget exceeded'));
        emitTurnAudit(ctx, appId, {
          model: parsedReq.model,
          maxTokens: parsedReq.max_tokens,
          usage: {},
          costUsd: 0,
          maxCostUsd,
          status: 429,
          degradedMode,
        });
        return;
      }
      // Other reservation errors → 500.
      log?.error?.('[cortexAnthropicTransport] ctx.llm.reserve failed', {
        message: err instanceof Error ? err.message : String(err),
      });
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(anthropicErrorBody('api_error', 'budget reservation failed'));
      return;
    }
  }

  // 3. Forward to upstream Anthropic.
  let upstreamResp: Response;
  try {
    const upstreamUrl = `${upstreamBaseUrl}${url}`;
    upstreamResp = await fetchFn(upstreamUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: bodyRaw,
    });
  } catch (err) {
    log?.error?.('[cortexAnthropicTransport] upstream fetch failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    // Settle the reservation at zero cost so we don't double-bill.
    if (reservation !== undefined && hasReserveSettle(llmCtx)) {
      try {
        await Promise.resolve(llmCtx.settle(reservation, 0));
      } catch {
        /* swallow */
      }
    }
    res.statusCode = 502;
    res.setHeader('content-type', 'application/json');
    res.end(anthropicErrorBody('api_error', 'upstream Anthropic request failed'));
    emitTurnAudit(ctx, appId, {
      model: parsedReq.model,
      maxTokens: parsedReq.max_tokens,
      usage: {},
      costUsd: 0,
      maxCostUsd,
      status: 502,
      degradedMode,
    });
    return;
  }

  // 4. Read upstream body (we need it to compute cost AND to forward).
  const upstreamText = await upstreamResp.text().catch(() => '');
  let upstreamBody: AnthropicMessagesResponseShape | null = null;
  try {
    upstreamBody = upstreamText ? (JSON.parse(upstreamText) as AnthropicMessagesResponseShape) : null;
  } catch {
    upstreamBody = null;
  }

  // 5. Compute actual cost from response usage (only on 2xx).
  const isOk = upstreamResp.status >= 200 && upstreamResp.status < 300;
  const { costUsd: actualCostUsd, usage, model: respModel } = isOk
    ? actualCostFromResponse(parsedReq.model, upstreamBody)
    : { costUsd: 0, usage: {}, model: parsedReq.model };

  // 6. Settle reservation (Cortex O1). Skip in degraded mode.
  // TODO(O1): unconditional once CortexLlmCtx.settle exists.
  if (reservation !== undefined && hasReserveSettle(llmCtx)) {
    try {
      await Promise.resolve(llmCtx.settle(reservation, actualCostUsd));
    } catch (err) {
      log?.warn?.('[cortexAnthropicTransport] ctx.llm.settle failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 7. Emit audit event for the turn.
  emitTurnAudit(ctx, appId, {
    model: respModel,
    maxTokens: parsedReq.max_tokens,
    usage,
    costUsd: actualCostUsd,
    maxCostUsd,
    status: upstreamResp.status,
    degradedMode,
  });

  // 8. Pipe the response back to the SDK. Preserve status + headers.
  res.statusCode = upstreamResp.status;
  copyResponseHeaders(upstreamResp.headers, res);
  // Force content-type if upstream omitted it (it shouldn't, but be safe).
  if (!res.hasHeader('content-type')) {
    res.setHeader('content-type', 'application/json');
  }
  res.end(upstreamText);
}
