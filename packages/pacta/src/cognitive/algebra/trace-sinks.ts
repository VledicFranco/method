/**
 * Built-in Trace Sinks — concrete implementations of the TraceSink port.
 *
 * InMemoryTraceSink: stores traces in an array for retrieval and testing.
 * ConsoleTraceSink: pretty-prints trace records for development observability.
 */

import type { TraceRecord, TraceSink } from './trace.js';

// ── InMemoryTraceSink ──────────────────────────────────────────

/** Stores trace records in memory. Suitable for testing and short-lived processes. */
export class InMemoryTraceSink implements TraceSink {
  private readonly records: TraceRecord[] = [];

  onTrace(record: TraceRecord): void {
    this.records.push(record);
  }

  /** Retrieve all stored traces. */
  traces(): readonly TraceRecord[] {
    return [...this.records];
  }

  /** Clear all stored traces. */
  clear(): void {
    this.records.length = 0;
  }
}

// ── ConsoleTraceSink ───────────────────────────────────────────

/** Pretty-prints trace records to the console. Suitable for development. */
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
