/**
 * Type Mapping: MonitorReport <-> DSL string
 *
 * Provides encode/decode functions for round-trip conversion between
 * the MonitorReport TypeScript type and the compact DSL format defined
 * by the monitor-v2.peggy grammar.
 *
 * Usage:
 *   npx tsx scripts/type-mapping.ts          # Run round-trip verification
 *   import { encodeMonitorReport, decodeMonitorDsl } from './type-mapping.ts'
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deepStrictEqual } from 'node:assert';

// ── Types (mirrored from phase-1-llm-monitor/src/types.ts) ────

type AnomalyType = 'low-confidence' | 'unexpected-result' | 'compound';

interface Anomaly {
  moduleId: string;
  type: AnomalyType;
  detail: string;
}

interface MonitorReport {
  anomalies: Anomaly[];
  escalation: string | undefined;
  restrictedActions: string[];
  forceReplan: boolean;
}

// ── Encoder: MonitorReport → DSL string ────────────────────────

function escapeDetail(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function encodeMonitorReport(report: MonitorReport): string {
  const lines: string[] = [];

  // Anomalies section
  if (report.anomalies.length === 0) {
    lines.push('ANOMALIES: none');
  } else {
    lines.push('ANOMALIES:');
    for (const a of report.anomalies) {
      lines.push(`@${a.moduleId} ${a.type} "${escapeDetail(a.detail)}"`);
    }
  }

  // Escalation section
  if (report.escalation === undefined || report.escalation === null) {
    lines.push('ESCALATE: none');
  } else {
    lines.push(`ESCALATE: "${escapeDetail(report.escalation)}"`);
  }

  // Restrict section
  if (report.restrictedActions.length === 0) {
    lines.push('RESTRICT: none');
  } else {
    lines.push(`RESTRICT: ${report.restrictedActions.join(', ')}`);
  }

  // Replan section
  lines.push(`REPLAN: ${report.forceReplan ? 'yes' : 'no'}`);

  return lines.join('\n');
}

// ── Decoder: DSL string → MonitorReport ────────────────────────

// Load the peggy-compiled parser (CommonJS module)
const __filename_local = fileURLToPath(import.meta.url);
const __dirname_local = dirname(__filename_local);
const require_cjs = createRequire(import.meta.url);
const parserPath = resolve(__dirname_local, '../grammars/monitor-v2.cjs');
const parser = require_cjs(parserPath);

export function decodeMonitorDsl(dsl: string): MonitorReport {
  return parser.parse(dsl) as MonitorReport;
}

// ── Round-trip Verification ────────────────────────────────────

/** Normalize a MonitorReport for comparison (null → undefined). */
function normalize(report: MonitorReport): MonitorReport {
  return {
    anomalies: report.anomalies.map(a => ({
      moduleId: a.moduleId,
      type: a.type as AnomalyType,
      detail: a.detail,
    })),
    escalation: report.escalation ?? undefined,
    restrictedActions: [...report.restrictedActions],
    forceReplan: report.forceReplan,
  };
}

/** Verify round-trip for a single report. Returns true if successful. */
export function verifyRoundTrip(original: MonitorReport): boolean {
  const normalized = normalize(original);
  const encoded = encodeMonitorReport(normalized);
  const decoded = decodeMonitorDsl(encoded);

  try {
    deepStrictEqual(decoded, normalized);
    return true;
  } catch {
    console.error('Round-trip failed:');
    console.error('  Original:', JSON.stringify(normalized));
    console.error('  Encoded:\n' + encoded);
    console.error('  Decoded:', JSON.stringify(decoded));
    return false;
  }
}

// ── CLI: verify against sample reports ─────────────────────────

async function main() {
  // Load sample reports
  const samplesPath = resolve(__dirname_local, '../../shared/fixtures/sample-reports.json');
  const samples: Array<{ name: string; report: MonitorReport }> = JSON.parse(
    readFileSync(samplesPath, 'utf-8')
  );

  console.log(`Verifying round-trip for ${samples.length} sample reports...\n`);

  let pass = 0;
  let fail = 0;

  for (const sample of samples) {
    const ok = verifyRoundTrip(sample.report);
    if (ok) {
      pass++;
      console.log(`  PASS: ${sample.name}`);
    } else {
      fail++;
      console.log(`  FAIL: ${sample.name}`);
    }
  }

  // Also verify against traces
  const tracesPath = resolve(__dirname_local, '../../phase-1-llm-monitor/traces/monitor-v2-traces.jsonl');
  const traceLines = readFileSync(tracesPath, 'utf-8').trim().split('\n');

  console.log(`\nVerifying round-trip for ${traceLines.length} trace records...`);

  let tracePass = 0;
  let traceFail = 0;

  for (const line of traceLines) {
    const trace = JSON.parse(line);
    const ok = verifyRoundTrip(trace.output);
    if (ok) {
      tracePass++;
    } else {
      traceFail++;
      console.log(`  FAIL: trace #${trace.id} (${trace.scenario})`);
    }
  }

  console.log(`\nResults:`);
  console.log(`  Samples: ${pass}/${samples.length} passed`);
  console.log(`  Traces:  ${tracePass}/${traceLines.length} passed`);

  if (fail > 0 || traceFail > 0) {
    console.log('\nROUND-TRIP VERIFICATION FAILED');
    process.exit(1);
  } else {
    console.log('\nAll round-trip verifications passed.');
  }
}

// Run if executed directly
main().catch(err => {
  console.error(err);
  process.exit(1);
});
