// SPDX-License-Identifier: Apache-2.0
/**
 * GenesisSink — PRD 026 Phase 4.
 *
 * Feeds events to the Genesis agent session via a narrow callback interface.
 * Events are batched in a configurable time window (default 30s) and
 * summarized into a human-readable prompt. Only events matching the severity
 * filter are buffered (default: warning + error + critical).
 *
 * The sink receives a promptSession callback — NOT the SessionPool itself
 * — to respect G-BOUNDARY. The composition root wires the callback.
 */

import type { RuntimeEvent, EventSink, EventSeverity } from '../ports/event-bus.js';

// ── Configuration ───────────────────────────────────────────────

/**
 * Narrow callback for prompting the Genesis session.
 * Composition root wires this to pool.prompt(sessionId, text, timeout).
 */
export type GenesisPromptCallback = (sessionId: string, prompt: string) => Promise<void>;

export interface GenesisSinkOptions {
  /** Callback to prompt the Genesis session. */
  promptSession: GenesisPromptCallback;
  /** Genesis session ID. */
  sessionId: string;
  /** Batch window in milliseconds (default: 30_000). */
  batchWindowMs?: number;
  /** Severity levels to include (default: ['warning', 'error', 'critical']). */
  severityFilter?: EventSeverity[];
}

const DEFAULT_BATCH_WINDOW_MS = 30_000;
const DEFAULT_SEVERITY_FILTER: EventSeverity[] = ['warning', 'error', 'critical'];

// ── GenesisSink ─────────────────────────────────────────────────

export class GenesisSink implements EventSink {
  readonly name = 'genesis';

  private readonly promptSession: GenesisPromptCallback;
  private readonly sessionId: string;
  private readonly batchWindowMs: number;
  private readonly severityFilter: Set<EventSeverity>;

  private buffer: RuntimeEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(options: GenesisSinkOptions) {
    this.promptSession = options.promptSession;
    this.sessionId = options.sessionId;
    this.batchWindowMs = options.batchWindowMs ?? DEFAULT_BATCH_WINDOW_MS;
    this.severityFilter = new Set(options.severityFilter ?? DEFAULT_SEVERITY_FILTER);
  }

  // ── EventSink interface ──────────────────────────────────────

  onEvent(event: RuntimeEvent): void {
    if (this.disposed) return;

    // Severity filter
    if (!this.severityFilter.has(event.severity)) return;

    this.buffer.push(event);

    // Start batch window timer if not already running
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.batchWindowMs);
    }
  }

  onError(error: Error, event: RuntimeEvent): void {
    console.error(`[genesis-sink] Error processing event ${event.id}:`, error.message);
  }

  // ── Flush & summarize ────────────────────────────────────────

  /**
   * Flush the buffer and prompt Genesis with a summary.
   * Exposed for testing — normally called by the batch timer.
   */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const events = this.buffer;
    this.buffer = [];

    if (events.length === 0) return;

    const summary = GenesisSink.summarize(events);

    try {
      await this.promptSession(this.sessionId, summary);
    } catch {
      // Genesis is dead or unavailable — gracefully ignore.
      // Events are lost, which is acceptable (best-effort delivery).
    }
  }

  /**
   * Summarize buffered events into a human-readable prompt for Genesis.
   * Groups by domain and severity for efficient consumption.
   */
  static summarize(events: RuntimeEvent[]): string {
    // Group by domain
    const byDomain = new Map<string, RuntimeEvent[]>();
    for (const e of events) {
      const group = byDomain.get(e.domain) ?? [];
      group.push(e);
      byDomain.set(e.domain, group);
    }

    // Count by severity
    const severityCounts = { warning: 0, error: 0, critical: 0 };
    for (const e of events) {
      if (e.severity in severityCounts) {
        severityCounts[e.severity as keyof typeof severityCounts]++;
      }
    }

    const lines: string[] = [
      `SYSTEM EVENT SUMMARY — ${events.length} event(s) in last batch`,
      `Severity: ${severityCounts.critical > 0 ? `${severityCounts.critical} critical, ` : ''}${severityCounts.error} error, ${severityCounts.warning} warning`,
      '',
    ];

    for (const [domain, domainEvents] of byDomain) {
      lines.push(`[${domain}] (${domainEvents.length} event${domainEvents.length > 1 ? 's' : ''}):`);
      for (const e of domainEvents) {
        const session = e.sessionId ? ` session=${e.sessionId.substring(0, 8)}` : '';
        const project = e.projectId ? ` project=${e.projectId}` : '';
        const detail = summarizePayload(e.payload);
        lines.push(`  - ${e.type} [${e.severity}]${session}${project}${detail ? ` — ${detail}` : ''}`);
      }
    }

    lines.push('');
    lines.push('Use bus query tools or project_read_events() to investigate further.');

    return lines.join('\n');
  }

  // ── Lifecycle ────────────────────────────────────────────────

  /** Clean up timer. Call on shutdown. */
  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Discard any remaining buffered events
    this.buffer = [];
  }

  /** Number of events currently buffered (for testing/monitoring). */
  get bufferedCount(): number {
    return this.buffer.length;
  }
}

// ── Helpers ───────────────────────────────────────────────────

/** Extract a short detail string from the event payload. */
function summarizePayload(payload: Record<string, unknown>): string {
  const parts: string[] = [];

  if (typeof payload.error === 'string') {
    parts.push(payload.error.substring(0, 100));
  } else if (typeof payload.message === 'string') {
    parts.push(payload.message.substring(0, 100));
  } else if (typeof payload.reason === 'string') {
    parts.push(payload.reason.substring(0, 100));
  }

  if (typeof payload.gate === 'string') {
    parts.push(`gate=${payload.gate}`);
  }

  return parts.join(', ');
}
