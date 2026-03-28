/**
 * TypeScript wrapper around the peggy-generated Monitor DSL parser.
 *
 * Provides parse / encode / validate functions for the Monitor DSL format
 * defined in phase-2-dsl/grammars/monitor-v2.peggy.
 */

import { createRequire } from 'node:module';
import type { MonitorReport, Anomaly, ModuleId } from '../../phase-1-llm-monitor/src/types.js';

// Load the CommonJS peggy parser in ESM context.
const require = createRequire(import.meta.url);
const peggyParser = require('../../phase-2-dsl/grammars/monitor-v2.cjs') as {
  parse: (input: string) => RawParseResult;
};

/** Raw result shape from the peggy parser (plain strings, not branded). */
interface RawAnomaly {
  moduleId: string;
  type: 'low-confidence' | 'unexpected-result' | 'compound';
  detail: string;
}

interface RawParseResult {
  anomalies: RawAnomaly[];
  escalation: string | undefined;
  restrictedActions: string[];
  forceReplan: boolean;
}

/**
 * Cast the raw parse result to MonitorReport with branded ModuleId types.
 */
function toMonitorReport(raw: RawParseResult): MonitorReport {
  return {
    anomalies: raw.anomalies.map((a): Anomaly => ({
      moduleId: a.moduleId as ModuleId,
      type: a.type,
      detail: a.detail,
    })),
    escalation: raw.escalation,
    restrictedActions: raw.restrictedActions,
    forceReplan: raw.forceReplan,
  };
}

/** Parse a Monitor DSL string into a MonitorReport. Throws on invalid DSL. */
export function parseMonitorDsl(dsl: string): MonitorReport {
  const raw = peggyParser.parse(dsl);
  return toMonitorReport(raw);
}

/**
 * Encode a MonitorReport as a Monitor DSL string.
 *
 * Produces output that round-trips: `parseMonitorDsl(encodeMonitorReport(r))`
 * deep-equals `r` for any valid MonitorReport.
 */
export function encodeMonitorReport(report: MonitorReport): string {
  const lines: string[] = [];

  // ── Anomalies section ──
  if (report.anomalies.length === 0) {
    lines.push('ANOMALIES: none');
  } else {
    lines.push('ANOMALIES:');
    for (const a of report.anomalies) {
      lines.push(`@${a.moduleId} ${a.type} ${quoteString(a.detail)}`);
    }
  }

  // ── Escalation section ──
  if (report.escalation === undefined) {
    lines.push('ESCALATE: none');
  } else {
    lines.push(`ESCALATE: ${quoteString(report.escalation)}`);
  }

  // ── Restrict section ──
  if (report.restrictedActions.length === 0) {
    lines.push('RESTRICT: none');
  } else {
    lines.push(`RESTRICT: ${report.restrictedActions.join(', ')}`);
  }

  // ── Replan section ──
  lines.push(`REPLAN: ${report.forceReplan ? 'yes' : 'no'}`);

  return lines.join('\n');
}

/**
 * Escape and quote a string for the DSL format.
 * Backslashes and double-quotes are escaped. Result is wrapped in double quotes.
 */
function quoteString(s: string): string {
  const escaped = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/** Check if a string is valid Monitor DSL without throwing. */
export function isValidMonitorDsl(dsl: string): boolean {
  try {
    peggyParser.parse(dsl);
    return true;
  } catch {
    return false;
  }
}

/** Parse and return null on failure instead of throwing. */
export function tryParseMonitorDsl(dsl: string): MonitorReport | null {
  try {
    const raw = peggyParser.parse(dsl);
    return toMonitorReport(raw);
  } catch {
    return null;
  }
}
