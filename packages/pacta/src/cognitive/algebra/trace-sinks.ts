// SPDX-License-Identifier: Apache-2.0
/**
 * Built-in Trace Sinks — concrete implementations of the TraceSink port.
 *
 * InMemoryTraceSink: stores traces in an array for retrieval and testing.
 * ConsoleTraceSink: pretty-prints trace records for development observability.
 */

import type { TraceRecord, TraceSink } from './trace.js';
import type { TraceEvent } from './trace-events.js';

// ── InMemoryTraceSink ──────────────────────────────────────────

/**
 * Stores trace records and hierarchical trace events in memory. Suitable for
 * testing and short-lived processes.
 *
 * Both legacy `onTrace` and PRD-058 `onEvent` are implemented — call sites
 * pick whichever shape they emit. `traces()` and `events()` are independent
 * accessors.
 */
export class InMemoryTraceSink implements TraceSink {
  private readonly records: TraceRecord[] = [];
  private readonly captured: TraceEvent[] = [];

  onTrace(record: TraceRecord): void {
    this.records.push(record);
  }

  onEvent(event: TraceEvent): void {
    this.captured.push(event);
  }

  /** Retrieve all stored flat trace records. */
  traces(): readonly TraceRecord[] {
    return [...this.records];
  }

  /** Retrieve all captured hierarchical trace events. */
  events(): readonly TraceEvent[] {
    return [...this.captured];
  }

  /** Clear all stored traces and events. */
  clear(): void {
    this.records.length = 0;
    this.captured.length = 0;
  }
}

// ── ConsoleTraceSink ───────────────────────────────────────────

/** Pretty-prints trace records and events to the console. Suitable for development. */
export class ConsoleTraceSink implements TraceSink {
  onTrace(record: TraceRecord): void {
    const time = new Date(record.timestamp).toISOString();
    const duration = `${record.durationMs}ms`;
    const monitoring = formatMonitoring(record.monitoring);
    const usage = record.tokenUsage
      ? ` | tokens: ${record.tokenUsage.inputTokens}in/${record.tokenUsage.outputTokens}out`
      : '';

    console.log(
      `[${time}] ${record.moduleId} | ${record.phase} | ${duration} | ${monitoring}${usage}`,
    );
  }

  onEvent(event: TraceEvent): void {
    const time = new Date(event.timestamp).toISOString();
    const duration = event.durationMs !== undefined ? `${event.durationMs.toFixed(1)}ms` : '—';
    const phase = event.phase ? `[${event.phase}] ` : '';
    const signals =
      event.signals && event.signals.length > 0 ? ` | ${event.signals.length} signal(s)` : '';
    console.log(
      `[${time}] ${event.kind.padEnd(12)} ${phase}${event.name} | ${duration}${signals}`,
    );
  }
}

// ── Internal Helpers ───────────────────────────────────────────

function formatMonitoring(signal: TraceRecord['monitoring']): string {
  const parts: string[] = [`src=${signal.source}`];

  // Attempt to extract common monitoring properties
  const rec = signal as unknown as Record<string, unknown>;
  if ('type' in rec) {
    parts.push(`type=${String(rec.type)}`);
  }
  if ('confidence' in rec && typeof rec.confidence === 'number') {
    parts.push(`conf=${rec.confidence.toFixed(2)}`);
  }
  if ('success' in rec && typeof rec.success === 'boolean') {
    parts.push(`ok=${rec.success}`);
  }
  if ('anomalyDetected' in rec && typeof rec.anomalyDetected === 'boolean') {
    parts.push(`anomaly=${rec.anomalyDetected}`);
  }
  if ('estimatedProgress' in rec && typeof rec.estimatedProgress === 'number') {
    parts.push(`prog=${(rec.estimatedProgress * 100).toFixed(0)}%`);
  }

  return parts.join(', ');
}
