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

export class WebhookTrigger implements TriggerWatcher {
  readonly type: TriggerType = 'webhook';

  private _active = false;
  private readonly config: WebhookTriggerConfig;
  private onFire: ((payload: Record<string, unknown>) => void) | null = null;

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
   * Handle an incoming webhook request. Called by the Fastify route handler.
   * Validates HMAC signature (if configured), applies filter expression,
   * and fires the trigger if all checks pass.
   *
   * @returns { status: number; body: Record<string, unknown> } for the HTTP response
   */
  handleWebhook(
    body: unknown,
    rawBody: Buffer | string,
    headers: Record<string, string | string[] | undefined>,
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

    // HMAC-SHA256 validation
    if (this.config.secret_env) {
      const secret = process.env[this.config.secret_env];
      if (!secret) {
        // Log specifics server-side only; do not leak env var name to caller
        console.error(`[webhook] Secret env var '${this.config.secret_env}' is not set`);
        return {
          status: 500,
          body: { error: 'Webhook configuration error' },
        };
      }

      const signatureHeader = headers['x-hub-signature-256'] as string | undefined;
      if (!signatureHeader) {
        return { status: 401, body: { error: 'Missing X-Hub-Signature-256 header' } };
      }

      const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
      const sigBuffer = Buffer.from(signatureHeader);
      const expectedBuffer = Buffer.from(expected);

      if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
        return { status: 401, body: { error: 'Invalid HMAC signature' } };
      }
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
        return {
          status: 200,
          body: { accepted: false, reason: 'Filter expression error', error },
        };
      }

      if (!result) {
        return {
          status: 200,
          body: { accepted: false, reason: 'Filtered out by expression' },
        };
      }
    }

    // Fire the trigger
    this.onFire({
      webhook_payload: payload,
      webhook_headers: this.sanitizeHeaders(headers),
      webhook_path: this.config.path,
    });

    return { status: 200, body: { accepted: true } };
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
