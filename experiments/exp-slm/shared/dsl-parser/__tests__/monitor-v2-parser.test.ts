import { describe, it } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';
import {
  parseMonitorDsl,
  encodeMonitorReport,
  isValidMonitorDsl,
  tryParseMonitorDsl,
} from '../monitor-v2-parser.js';
import type { MonitorReport, Anomaly, ModuleId } from '../../../phase-1-llm-monitor/src/types.js';

/** Helper: create a ModuleId from a string. */
function mid(id: string): ModuleId {
  return id as ModuleId;
}

/** Helper: build an Anomaly. */
function anomaly(
  moduleId: string,
  type: Anomaly['type'],
  detail: string,
): Anomaly {
  return { moduleId: mid(moduleId), type, detail };
}

/** Helper: build a MonitorReport. */
function report(
  anomalies: Anomaly[],
  escalation: string | undefined,
  restrictedActions: string[],
  forceReplan: boolean,
): MonitorReport {
  return { anomalies, escalation, restrictedActions, forceReplan };
}

// ── 1. Parse clean report ─────────────────────────────────────────

describe('parseMonitorDsl', () => {
  it('parses a clean report (all none/no)', () => {
    const dsl = 'ANOMALIES: none\nESCALATE: none\nRESTRICT: none\nREPLAN: no';
    const result = parseMonitorDsl(dsl);
    deepStrictEqual(result, report([], undefined, [], false));
  });

  // ── 2. Parse single anomaly ───────────────────────────────────────

  it('parses a single anomaly', () => {
    const dsl = [
      'ANOMALIES:',
      '@reasoner low-confidence "Confidence below threshold"',
      'ESCALATE: none',
      'RESTRICT: none',
      'REPLAN: no',
    ].join('\n');
    const result = parseMonitorDsl(dsl);
    deepStrictEqual(result, report(
      [anomaly('reasoner', 'low-confidence', 'Confidence below threshold')],
      undefined,
      [],
      false,
    ));
  });

  // ── 3. Parse multiple anomalies ───────────────────────────────────

  it('parses multiple anomalies', () => {
    const dsl = [
      'ANOMALIES:',
      '@reasoner low-confidence "Confidence 0.1 below threshold 0.3"',
      '@actor unexpected-result "Tool returned error"',
      '@llm-monitor compound "Compound anomaly detected"',
      'ESCALATE: none',
      'RESTRICT: none',
      'REPLAN: no',
    ].join('\n');
    const result = parseMonitorDsl(dsl);
    deepStrictEqual(result.anomalies, [
      anomaly('reasoner', 'low-confidence', 'Confidence 0.1 below threshold 0.3'),
      anomaly('actor', 'unexpected-result', 'Tool returned error'),
      anomaly('llm-monitor', 'compound', 'Compound anomaly detected'),
    ]);
  });

  // ── 4. Parse full report ──────────────────────────────────────────

  it('parses a full report with all sections populated', () => {
    const dsl = [
      'ANOMALIES:',
      '@reasoner low-confidence "Confidence dropped"',
      '@actor unexpected-result "Actor error"',
      'ESCALATE: "Multiple anomalies detected"',
      'RESTRICT: file-delete, git-push',
      'REPLAN: yes',
    ].join('\n');
    const result = parseMonitorDsl(dsl);
    deepStrictEqual(result, report(
      [
        anomaly('reasoner', 'low-confidence', 'Confidence dropped'),
        anomaly('actor', 'unexpected-result', 'Actor error'),
      ],
      'Multiple anomalies detected',
      ['file-delete', 'git-push'],
      true,
    ));
  });

  // ── 9. All 3 anomaly types ────────────────────────────────────────

  it('parses all three anomaly types correctly', () => {
    const dsl = [
      'ANOMALIES:',
      '@mod-a low-confidence "low conf detail"',
      '@mod-b unexpected-result "unexpected detail"',
      '@mod-c compound "compound detail"',
      'ESCALATE: none',
      'RESTRICT: none',
      'REPLAN: no',
    ].join('\n');
    const result = parseMonitorDsl(dsl);
    strictEqual(result.anomalies[0].type, 'low-confidence');
    strictEqual(result.anomalies[1].type, 'unexpected-result');
    strictEqual(result.anomalies[2].type, 'compound');
    strictEqual(result.anomalies[0].moduleId, 'mod-a');
    strictEqual(result.anomalies[1].moduleId, 'mod-b');
    strictEqual(result.anomalies[2].moduleId, 'mod-c');
  });
});

// ── 5. Encode clean report ──────────────────────────────────────────

describe('encodeMonitorReport', () => {
  it('encodes a clean report to compact DSL', () => {
    const r = report([], undefined, [], false);
    const dsl = encodeMonitorReport(r);
    strictEqual(dsl, 'ANOMALIES: none\nESCALATE: none\nRESTRICT: none\nREPLAN: no');
  });

  // ── 6. Encode full report ─────────────────────────────────────────

  it('encodes a full report to complete DSL', () => {
    const r = report(
      [
        anomaly('reasoner', 'low-confidence', 'Confidence dropped'),
        anomaly('actor', 'unexpected-result', 'Actor error'),
      ],
      'Multiple anomalies detected',
      ['file-delete', 'git-push'],
      true,
    );
    const dsl = encodeMonitorReport(r);
    const expected = [
      'ANOMALIES:',
      '@reasoner low-confidence "Confidence dropped"',
      '@actor unexpected-result "Actor error"',
      'ESCALATE: "Multiple anomalies detected"',
      'RESTRICT: file-delete, git-push',
      'REPLAN: yes',
    ].join('\n');
    strictEqual(dsl, expected);
  });
});

// ── 7. Round-trip fidelity ──────────────────────────────────────────

describe('round-trip fidelity', () => {
  const testCases: MonitorReport[] = [
    // 1. Clean report
    report([], undefined, [], false),
    // 2. Single anomaly, no escalation
    report(
      [anomaly('reasoner', 'low-confidence', 'Low conf')],
      undefined, [], false,
    ),
    // 3. Single anomaly with escalation
    report(
      [anomaly('actor', 'unexpected-result', 'Unexpected')],
      'Escalated', [], true,
    ),
    // 4. Multiple anomalies, full fields
    report(
      [
        anomaly('reasoner', 'low-confidence', 'Below threshold'),
        anomaly('actor', 'unexpected-result', 'Tool error'),
        anomaly('monitor', 'compound', 'Compound issue'),
      ],
      'Critical issue', ['file-delete', 'git-push', 'exec'], true,
    ),
    // 5. Only restrictions
    report([], undefined, ['Read', 'Write'], false),
    // 6. Only escalation
    report([], 'Something bad', [], false),
    // 7. Replan only
    report([], undefined, [], true),
    // 8. Escaped characters in detail
    report(
      [anomaly('parser', 'compound', 'Has \\"quotes\\" inside')],
      undefined, [], false,
    ),
    // 9. Single restricted action
    report([], undefined, ['dangerous-action'], false),
    // 10. Many anomalies of same type
    report(
      [
        anomaly('mod-1', 'low-confidence', 'First'),
        anomaly('mod-2', 'low-confidence', 'Second'),
        anomaly('mod-3', 'low-confidence', 'Third'),
      ],
      'All low confidence', ['halt'], true,
    ),
  ];

  for (let i = 0; i < testCases.length; i++) {
    it(`round-trips case ${i + 1}`, () => {
      const original = testCases[i];
      const encoded = encodeMonitorReport(original);
      const decoded = parseMonitorDsl(encoded);
      deepStrictEqual(decoded, original);
    });
  }
});

// ── 8. Invalid DSL ──────────────────────────────────────────────────

describe('invalid DSL handling', () => {
  it('isValidMonitorDsl returns false for garbage', () => {
    strictEqual(isValidMonitorDsl('garbage'), false);
  });

  it('isValidMonitorDsl returns true for valid DSL', () => {
    strictEqual(
      isValidMonitorDsl('ANOMALIES: none\nESCALATE: none\nRESTRICT: none\nREPLAN: no'),
      true,
    );
  });

  it('tryParseMonitorDsl returns null for garbage', () => {
    strictEqual(tryParseMonitorDsl('garbage'), null);
  });

  it('tryParseMonitorDsl returns parsed result for valid DSL', () => {
    const result = tryParseMonitorDsl(
      'ANOMALIES: none\nESCALATE: none\nRESTRICT: none\nREPLAN: no',
    );
    deepStrictEqual(result, report([], undefined, [], false));
  });

  it('isValidMonitorDsl returns false for partial DSL', () => {
    strictEqual(isValidMonitorDsl('ANOMALIES: none\nESCALATE: none'), false);
  });

  it('isValidMonitorDsl returns false for empty string', () => {
    strictEqual(isValidMonitorDsl(''), false);
  });
});
