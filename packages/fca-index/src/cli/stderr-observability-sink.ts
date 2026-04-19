// SPDX-License-Identifier: Apache-2.0
/**
 * StderrObservabilitySink — default ObservabilityPort implementation for
 * standalone fca-index runs (CLI). Emits one `[<prefix>.<scope>] {json}\n`
 * line per event to process.stderr.
 *
 * Matches the legacy log shape used in query-engine.ts before port migration
 * (see PR #163), so existing grep/jq pipelines keep working:
 *
 *   [fca-index.query] {"event":"start","ts":"...","query":"...","topK":5}
 *
 * Non-throwing contract: any serialization or I/O failure is swallowed.
 * Observability never breaks the operation being observed.
 */

import type { ObservabilityPort, ObservabilityEvent } from '../ports/observability.js';

export interface StderrObservabilitySinkConfig {
  /** Prefix applied to every line. Defaults to `fca-index`. */
  prefix?: string;

  /** Minimum severity to emit. Omit to emit everything. */
  minSeverity?: ObservabilityEvent['severity'];
}

const SEVERITY_ORDER: Record<NonNullable<ObservabilityEvent['severity']>, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class StderrObservabilitySink implements ObservabilityPort {
  private readonly prefix: string;
  private readonly minSeverityRank: number;

  constructor(config: StderrObservabilitySinkConfig = {}) {
    this.prefix = config.prefix ?? 'fca-index';
    this.minSeverityRank = config.minSeverity ? SEVERITY_ORDER[config.minSeverity] : -1;
  }

  emit(event: ObservabilityEvent): void {
    try {
      const sev = event.severity ?? 'info';
      if (SEVERITY_ORDER[sev] < this.minSeverityRank) return;

      const payload: Record<string, unknown> = {
        event: event.event,
        ts: event.ts,
        severity: sev,
      };
      if (event.fields) {
        for (const [k, v] of Object.entries(event.fields)) {
          payload[k] = v;
        }
      }
      if (event.error) {
        payload.error = event.error;
      }

      const line = `[${this.prefix}.${event.scope}] ${JSON.stringify(payload)}\n`;
      process.stderr.write(line);
    } catch {
      // Observability must never throw. Swallow serialization or I/O errors.
    }
  }
}
