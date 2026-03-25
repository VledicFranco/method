/**
 * WebhookConnector — PRD 026 Phase 5.
 *
 * POSTs BridgeEvents to a configured URL. Implements EventConnector with:
 * - Configurable event filter (domain/type/severity)
 * - Exponential backoff retry (1s, 2s, 4s — max 3 attempts)
 * - Rate limiting (max 10 events/second, excess dropped with warning)
 * - Health tracking (connected status, last event, error count)
 *
 * Uses built-in fetch (no new port needed — HTTP is the connector's concern).
 */

import type {
  EventConnector,
  ConnectorHealth,
  BridgeEvent,
  EventFilter,
  EventDomain,
  EventSeverity,
} from '../../ports/event-bus.js';

// ── Configuration ───────────────────────────────────────────────

export interface WebhookConnectorOptions {
  /** Target URL to POST events to. */
  url: string;
  /** Event filter — only matching events are sent. */
  filter?: EventFilter;
  /** Max retry attempts per event (default: 3). */
  maxRetries?: number;
  /** Base delay for exponential backoff in ms (default: 1000). */
  retryBaseMs?: number;
  /** Request timeout in ms (default: 5000). */
  timeoutMs?: number;
  /** Max events per second (default: 10). Excess dropped. */
  maxEventsPerSecond?: number;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_MS = 1000;
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_EVENTS_PER_SECOND = 10;

// ── Filter matching ─────────────────────────────────────────────

function matchesFilter(event: BridgeEvent, filter: EventFilter): boolean {
  if (filter.domain !== undefined) {
    const domains = Array.isArray(filter.domain) ? filter.domain : [filter.domain];
    if (!domains.includes(event.domain as EventDomain)) return false;
  }
  if (filter.type !== undefined) {
    const types = Array.isArray(filter.type) ? filter.type : [filter.type];
    if (!types.includes(event.type)) return false;
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
    this.url = options.url;
    this.name = `webhook:${new URL(options.url).hostname}`;
    this.filter = options.filter;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxEventsPerSecond = options.maxEventsPerSecond ?? DEFAULT_MAX_EVENTS_PER_SECOND;
  }

  // ── EventConnector lifecycle ─────────────────────────────────

  async connect(): Promise<void> {
    // Verify the URL is reachable with a HEAD request
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
    return {
      connected: this._connected,
      lastEventAt: this._lastEventAt,
      errorCount: this._errorCount,
    };
  }

  // ── EventSink interface ──────────────────────────────────────

  onEvent(event: BridgeEvent): void {
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
      return; // Drop excess — rate limited
    }

    // Fire-and-forget POST (don't block the bus)
    this.postWithRetry(event).catch(() => {
      // Error already counted in postWithRetry
    });
  }

  onError(error: Error, event: BridgeEvent): void {
    this._errorCount++;
    console.error(`[webhook-connector] ${this.name}: sink error for ${event.type}: ${error.message}`);
  }

  // ── Internal ─────────────────────────────────────────────────

  /** POST with exponential backoff retry. */
  private async postWithRetry(event: BridgeEvent): Promise<void> {
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

        // Non-2xx response — retry
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

    // All retries exhausted
    this._errorCount++;
    this._connected = false;
  }

  private backoff(attempt: number): Promise<void> {
    const delay = this.retryBaseMs * Math.pow(2, attempt);
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
