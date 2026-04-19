// SPDX-License-Identifier: Apache-2.0
/**
 * PRD 018: Event Triggers — WebhookTrigger (Phase 2a-3)
 *
 * Registers a Fastify route at a configurable path for receiving
 * external webhook payloads. Validates HMAC-SHA256 signatures using
 * a secret from an environment variable. Optional JS filter expression
 * evaluated via sandbox-eval.ts.
 *
 * Security: HMAC validation uses crypto.timingSafeEqual to prevent
 * timing attacks. Filter expressions run in the sandboxed evaluator
 * (new Function() with shadowed globals).
 *
 * PRD 019.4: Ring buffer of recent webhook requests for the webhook-log
 * API endpoint. Each call to handleWebhook() records the request metadata
 * (timestamp, method, HMAC status, filter result, payload preview/size).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  TriggerWatcher,
  TriggerType,
  WebhookTriggerConfig,
} from './types.js';
import { evaluateSandboxedExpression } from './sandbox-eval.js';

const MAX_PAYLOAD_BYTES = parseInt(
  process.env.TRIGGERS_WEBHOOK_MAX_PAYLOAD_BYTES ?? '1048576',
  10,
);

/** Maximum number of recent webhook requests to retain in the ring buffer. */
const WEBHOOK_LOG_BUFFER_SIZE = 50;

/** Truncation length for payload preview strings. */
const PAYLOAD_PREVIEW_LENGTH = 200;

/**
 * A single recorded webhook request for the request log.
 */
export interface WebhookRequestLogEntry {
  timestamp: string;
  method: string;
  hmac_status: 'pass' | 'fail' | 'none';
  filter_result: 'pass' | 'reject' | 'error' | 'N/A';
  payload_preview: string;
  payload_size_bytes: number;
}

export class WebhookTrigger implements TriggerWatcher {
  readonly type: TriggerType = 'webhook';

  private _active = false;
  private readonly config: WebhookTriggerConfig;
  private onFire: ((payload: Record<string, unknown>) => void) | null = null;

  /** Ring buffer of recent webhook requests (newest last). */
  private readonly requestLog: WebhookRequestLogEntry[] = [];

  constructor(config: WebhookTriggerConfig) {
    this.config = config;
  }

  get active(): boolean {
    return this._active;
  }

  start(onFire: (payload: Record<string, unknown>) => void): void {
    if (this._active) return;
    this.onFire = onFire;
    this._active = true;
  }

  stop(): void {
    this._active = false;
    this.onFire = null;
  }

  /** The configured webhook path */
  get path(): string {
    return this.config.path;
  }

  /** Allowed HTTP methods (defaults to ['POST']) */
  get methods(): string[] {
    return this.config.methods ?? ['POST'];
  }

  /**
   * PRD 019.4: Return recent webhook requests from the ring buffer.
   * @param limit Max entries to return (default 20, capped at buffer size)
   */
  getRequestLog(limit = 20): WebhookRequestLogEntry[] {
    const capped = Math.min(Math.max(1, limit), this.requestLog.length);
    // Return newest first — ring buffer stores oldest first, so slice from the end
    return this.requestLog.slice(-capped).reverse();
  }

  /**
   * Handle an incoming webhook request. Called by the Fastify route handler.
   * Validates HMAC signature (if configured), applies filter expression,
   * and fires the trigger if all checks pass.
   *
   * PRD 019.4: Now accepts an optional httpMethod parameter and records
   * each request in the ring buffer for the webhook-log endpoint.
   *
   * @returns { status: number; body: Record<string, unknown> } for the HTTP response
   */
  handleWebhook(
    body: unknown,
    rawBody: Buffer | string,
    headers: Record<string, string | string[] | undefined>,
    httpMethod?: string,
  ): { status: number; body: Record<string, unknown> } {
    if (!this._active || !this.onFire) {
      return { status: 503, body: { error: 'Trigger is not active' } };
    }

    // Payload size check (use Buffer.byteLength for accurate byte count)
    const bodySize = Buffer.isBuffer(rawBody)
      ? rawBody.length
      : Buffer.byteLength(rawBody, 'utf-8');
    if (bodySize > MAX_PAYLOAD_BYTES) {
      return {
        status: 413,
        body: { error: `Payload exceeds maximum size (${MAX_PAYLOAD_BYTES} bytes)` },
      };
    }

    // ── Track HMAC status for the request log ──
    let hmacStatus: 'pass' | 'fail' | 'none' = 'none';

    // HMAC-SHA256 validation
    if (this.config.secret_env) {
      const secret = process.env[this.config.secret_env];
      if (!secret) {
        // Log specifics server-side only; do not leak env var name to caller
        console.error(`[webhook] Secret env var '${this.config.secret_env}' is not set`);
        hmacStatus = 'fail';
        this.recordRequest(httpMethod ?? 'POST', hmacStatus, 'N/A', rawBody, bodySize);
        return {
          status: 500,
          body: { error: 'Webhook configuration error' },
        };
      }

      const signatureHeader = headers['x-hub-signature-256'] as string | undefined;
      if (!signatureHeader) {
        hmacStatus = 'fail';
        this.recordRequest(httpMethod ?? 'POST', hmacStatus, 'N/A', rawBody, bodySize);
        return { status: 401, body: { error: 'Missing X-Hub-Signature-256 header' } };
      }

      const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
      const sigBuffer = Buffer.from(signatureHeader);
      const expectedBuffer = Buffer.from(expected);

      if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
        hmacStatus = 'fail';
        this.recordRequest(httpMethod ?? 'POST', hmacStatus, 'N/A', rawBody, bodySize);
        return { status: 401, body: { error: 'Invalid HMAC signature' } };
      }

      hmacStatus = 'pass';
    }

    // Parse payload
    const rawString = Buffer.isBuffer(rawBody) ? rawBody.toString('utf-8') : rawBody;
    let payload: Record<string, unknown>;
    if (body && typeof body === 'object') {
      payload = body as Record<string, unknown>;
    } else {
      try {
        payload = JSON.parse(rawString) as Record<string, unknown>;
      } catch {
        payload = { raw: rawString };
      }
    }

    // Optional filter expression
    if (this.config.filter) {
      const { result, error } = evaluateSandboxedExpression(
        this.config.filter,
        { payload },
      );

      if (error) {
        this.recordRequest(httpMethod ?? 'POST', hmacStatus, 'error', rawBody, bodySize);
        return {
          status: 200,
          body: { accepted: false, reason: 'Filter expression error', error },
        };
      }

      if (!result) {
        this.recordRequest(httpMethod ?? 'POST', hmacStatus, 'reject', rawBody, bodySize);
        return {
          status: 200,
          body: { accepted: false, reason: 'Filtered out by expression' },
        };
      }
    }

    // Record successful request (filter passed or N/A)
    const filterResult: 'pass' | 'N/A' = this.config.filter ? 'pass' : 'N/A';
    this.recordRequest(httpMethod ?? 'POST', hmacStatus, filterResult, rawBody, bodySize);

    // Fire the trigger
    this.onFire({
      webhook_payload: payload,
      webhook_headers: this.sanitizeHeaders(headers),
      webhook_path: this.config.path,
    });

    return { status: 200, body: { accepted: true } };
  }

  /**
   * PRD 019.4: Record a webhook request in the ring buffer.
   * Evicts the oldest entry when the buffer is full.
   */
  private recordRequest(
    method: string,
    hmacStatus: 'pass' | 'fail' | 'none',
    filterResult: 'pass' | 'reject' | 'error' | 'N/A',
    rawBody: Buffer | string,
    payloadSizeBytes: number,
  ): void {
    const rawString = Buffer.isBuffer(rawBody) ? rawBody.toString('utf-8') : rawBody;
    const preview = rawString.length > PAYLOAD_PREVIEW_LENGTH
      ? rawString.slice(0, PAYLOAD_PREVIEW_LENGTH) + '...'
      : rawString;

    const entry: WebhookRequestLogEntry = {
      timestamp: new Date().toISOString(),
      method: method.toUpperCase(),
      hmac_status: hmacStatus,
      filter_result: filterResult,
      payload_preview: preview,
      payload_size_bytes: payloadSizeBytes,
    };

    this.requestLog.push(entry);

    // Evict oldest entries to maintain ring buffer size
    while (this.requestLog.length > WEBHOOK_LOG_BUFFER_SIZE) {
      this.requestLog.shift();
    }
  }

  /**
   * Sanitize headers for inclusion in trigger context.
   * Convert header values to strings, exclude potentially sensitive headers.
   */
  private sanitizeHeaders(
    headers: Record<string, string | string[] | undefined>,
  ): Record<string, string> {
    const result: Record<string, string> = {};
    const exclude = new Set(['authorization', 'cookie', 'x-hub-signature-256']);

    for (const [key, value] of Object.entries(headers)) {
      if (exclude.has(key.toLowerCase())) continue;
      if (value === undefined) continue;
      result[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
    }

    return result;
  }
}
