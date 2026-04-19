// SPDX-License-Identifier: Apache-2.0
/**
 * WebhookConnector — PRD 026 Phase 5.
 *
 * POSTs RuntimeEvents to a configured URL. Implements EventConnector with:
 * - Configurable event filter (domain/type/severity, supports glob patterns in type)
 * - Exponential backoff retry (1s, 2s, 4s — max 3 attempts; 4xx errors not retried)
 * - Rate limiting (max 10 events/second, excess dropped with warning)
 * - Health tracking (connected status, last event, error count)
 *
 * Uses built-in fetch (no new port needed — HTTP is the connector's concern).
 *
 * Notes:
 * - health.connected is advisory metadata; onEvent() always attempts delivery
 *   regardless of connect() state. connect() uses HEAD for reachability — HEAD
 *   is used intentionally to avoid spurious POST events on the target endpoint.
 * - The sliding-window rate limiter may allow a brief burst at window boundaries
 *   (up to 2× the limit); this is an accepted approximation for a POC.
 * - onError() is called by the bus dispatcher on synchronous throws only;
 *   async retry exhaustion is counted in _errorCount directly.
 */

import type {
  EventConnector,
  ConnectorHealth,
  RuntimeEvent,
  EventFilter,
  EventDomain,
  EventSeverity,
} from '../ports/event-bus.js';

// ── Configuration ───────────────────────────────────────────────

export interface WebhookConnectorOptions {
  /** Target URL to POST events to (must be a valid absolute URL, e.g. https://example.com/events). */
  url: string;
  /** Event filter — only matching events are sent. Supports glob patterns in type field (e.g. 'strategy.gate_*'). */
  filter?: EventFilter;
  /** Max retry attempts per event (default: 3). 4xx responses are not retried. */
  maxRetries?: number;
  /** Base delay for exponential backoff in ms (default: 1000). */
  retryBaseMs?: number;
  /** Request timeout in ms (default: 5000). */
  timeoutMs?: number;
  /** Max events per second (default: 10). Excess dropped with a warning. */
  maxEventsPerSecond?: number;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_MS = 1000;
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_EVENTS_PER_SECOND = 10;

// ── Filter matching ─────────────────────────────────────────────

/**
 * Convert a simple glob pattern (e.g., 'session.*', 'strategy.gate_*')
 * to a RegExp. Only supports '*' as wildcard (mirrors InMemoryEventBus).
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function matchesFilter(event: RuntimeEvent, filter: EventFilter): boolean {
  if (filter.domain !== undefined) {
    const domains = Array.isArray(filter.domain) ? filter.domain : [filter.domain];
    if (!domains.includes(event.domain as EventDomain)) return false;
  }
  if (filter.type !== undefined) {
    const types = Array.isArray(filter.type) ? filter.type : [filter.type];
    const matched = types.some(pattern => {
      if (pattern.includes('*')) return globToRegex(pattern).test(event.type);
      return pattern === event.type;
    });
    if (!matched) return false;
  }
  if (filter.severity !== undefined) {
    const severities = Array.isArray(filter.severity) ? filter.severity : [filter.severity];
    if (!severities.includes(event.severity as EventSeverity)) return false;
  }
  if (filter.projectId !== undefined && event.projectId !== filter.projectId) return false;
  if (filter.sessionId !== undefined && event.sessionId !== filter.sessionId) return false;
  return true;
}

// ── WebhookConnector ────────────────────────────────────────────

export class WebhookConnector implements EventConnector {
  readonly name: string;

  private readonly url: string;
  private readonly filter: EventFilter | undefined;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly timeoutMs: number;
  private readonly maxEventsPerSecond: number;

  private _connected = false;
  private _lastEventAt: string | null = null;
  private _errorCount = 0;

  // Rate limiting: sliding window (events in current second)
  private _windowStart = 0;
  private _windowCount = 0;

  constructor(options: WebhookConnectorOptions) {
    try {
      const parsed = new URL(options.url);
      this.name = `webhook:${parsed.hostname}`;
    } catch {
      throw new Error(`WebhookConnector: invalid URL '${options.url}' — must be a valid absolute URL`);
    }
    this.url = options.url;
    this.filter = options.filter;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxEventsPerSecond = options.maxEventsPerSecond ?? DEFAULT_MAX_EVENTS_PER_SECOND;
  }

  // ── EventConnector lifecycle ─────────────────────────────────

  async connect(): Promise<void> {
    // Verify the URL is reachable with a HEAD request.
    // HEAD is used intentionally to avoid creating spurious POST events on the target.
    // connect() marks health.connected, but onEvent() will attempt delivery regardless.
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      await fetch(this.url, {
        method: 'HEAD',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      this._connected = true;
    } catch {
      // URL not reachable — still register, will retry on each event
      this._connected = false;
      console.warn(`[webhook-connector] ${this.name}: URL not reachable on connect, will retry per-event`);
    }
  }

  async disconnect(): Promise<void> {
    this._connected = false;
  }

  health(): ConnectorHealth {
    // connected is advisory — onEvent() posts regardless of this value
    return {
      connected: this._connected,
      lastEventAt: this._lastEventAt,
      errorCount: this._errorCount,
    };
  }

  // ── EventSink interface ──────────────────────────────────────

  onEvent(event: RuntimeEvent): void {
    // Filter check
    if (this.filter && !matchesFilter(event, this.filter)) return;

    // Rate limiting
    const now = Date.now();
    if (now - this._windowStart >= 1000) {
      this._windowStart = now;
      this._windowCount = 0;
    }
    this._windowCount++;
    if (this._windowCount > this.maxEventsPerSecond) {
      console.warn(`[webhook-connector] ${this.name}: rate limit exceeded, dropping event ${event.type}`);
      return;
    }

    // Fire-and-forget POST (don't block the bus)
    this.postWithRetry(event);
  }

  onError(error: Error, event: RuntimeEvent): void {
    this._errorCount++;
    console.error(`[webhook-connector] ${this.name}: sink error for ${event.type}: ${error.message}`);
  }

  // ── Internal ─────────────────────────────────────────────────

  /** POST with exponential backoff retry. 4xx responses are not retried. */
  private async postWithRetry(event: RuntimeEvent): Promise<void> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        const response = await fetch(this.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (response.ok) {
          this._connected = true;
          this._lastEventAt = new Date().toISOString();
          return; // Success
        }

        // 4xx client errors (except 429 Too Many Requests) — do not retry
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          break;
        }

        // 5xx / 429 — retry with backoff
        if (attempt < this.maxRetries) {
          await this.backoff(attempt);
        }
      } catch {
        // Network error or timeout — retry
        if (attempt < this.maxRetries) {
          await this.backoff(attempt);
        }
      }
    }

    // All retries exhausted (or 4xx break)
    this._errorCount++;
    this._connected = false;
  }

  private backoff(attempt: number): Promise<void> {
    const delay = this.retryBaseMs * Math.pow(2, attempt);
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
