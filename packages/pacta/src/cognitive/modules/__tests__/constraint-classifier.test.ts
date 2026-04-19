// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for constraint-classifier — pure classification, prohibition
 * extraction, and violation detection functions.
 *
 * 15 scenarios per commission spec (PRD 043, Phase 2).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  classifyEntry,
  extractProhibitions,
  checkConstraintViolations,
} from '../constraint-classifier.js';

// ── classifyEntry ───────────────────────────────────────────────

describe('Constraint Classifier — classifyEntry', () => {
  it('1. "must NOT import notifications" → constraint, pinned', () => {
    const result = classifyEntry('must NOT import notifications');
    assert.strictEqual(result.contentType, 'constraint');
    assert.strictEqual(result.pinned, true);
    assert.ok(result.matchedPatterns.length > 0, 'should have matched patterns');
  });

  it('2. "do not use the audit service" → constraint, pinned', () => {
    const result = classifyEntry('do not use the audit service');
    assert.strictEqual(result.contentType, 'constraint');
    assert.strictEqual(result.pinned, true);
    assert.ok(result.matchedPatterns.length > 0);
  });

  it('3. "never import sendNotification" → constraint, pinned', () => {
    const result = classifyEntry('never import sendNotification');
    assert.strictEqual(result.contentType, 'constraint');
    assert.strictEqual(result.pinned, true);
  });

  it('4. "shall not modify the database" → constraint, pinned', () => {
    const result = classifyEntry('shall not modify the database');
    assert.strictEqual(result.contentType, 'constraint');
    assert.strictEqual(result.pinned, true);
  });

  it('5. "Your task: implement a v2 handler" → goal, not pinned', () => {
    const result = classifyEntry('Your task: implement a v2 handler');
    assert.strictEqual(result.contentType, 'goal');
    assert.strictEqual(result.pinned, false);
  });

  it('6. "Build a REST endpoint" → operational, not pinned', () => {
    const result = classifyEntry('Build a REST endpoint');
    assert.strictEqual(result.contentType, 'operational');
    assert.strictEqual(result.pinned, false);
  });

  it('7. "File content: const x = 42" → operational, not pinned', () => {
    const result = classifyEntry('File content: const x = 42');
    assert.strictEqual(result.contentType, 'operational');
    assert.strictEqual(result.pinned, false);
  });

  it('8. Non-string content (number/object) → operational, not pinned', () => {
    // classifyEntry takes string, but should handle non-string gracefully
    const resultNum = classifyEntry(42 as unknown as string);
    assert.strictEqual(resultNum.contentType, 'operational');
    assert.strictEqual(resultNum.pinned, false);

    const resultObj = classifyEntry({ key: 'value' } as unknown as string);
    assert.strictEqual(resultObj.contentType, 'operational');
    assert.strictEqual(resultObj.pinned, false);
  });

  it('9. Mixed: "implement X but must NOT import Y" → constraint, pinned', () => {
    const result = classifyEntry('implement X but must NOT import Y');
    assert.strictEqual(result.contentType, 'constraint');
    assert.strictEqual(result.pinned, true);
  });

  it('13. Empty string → operational, not pinned', () => {
    const result = classifyEntry('');
    assert.strictEqual(result.contentType, 'operational');
    assert.strictEqual(result.pinned, false);
    assert.strictEqual(result.matchedPatterns.length, 0);
  });
});

// ── extractProhibitions ─────────────────────────────────────────

describe('Constraint Classifier — extractProhibitions', () => {
  it('10. "must NOT import notifications" returns regex matching "import.*notifications"', () => {
    const prohibitions = extractProhibitions('must NOT import notifications');
    assert.strictEqual(prohibitions.length, 1);
    assert.ok(prohibitions[0].test('import { sendNotification } from notifications'));
  });

  it('11. "must NOT trigger audit logging" returns regex matching "audit logging"', () => {
    const prohibitions = extractProhibitions('must NOT trigger audit logging');
    assert.strictEqual(prohibitions.length, 1);
    assert.ok(prohibitions[0].test('audit logging'));
    assert.ok(prohibitions[0].test('this triggers audit logging in production'));
  });

  it('12. "Your task: implement v2" returns empty array', () => {
    const prohibitions = extractProhibitions('Your task: implement v2');
    assert.strictEqual(prohibitions.length, 0);
  });
});

// ── checkConstraintViolations ───────────────────────────────────

describe('Constraint Classifier — checkConstraintViolations', () => {
  it('14. matching output returns violation', () => {
    const pinnedConstraints = [
      { content: 'must NOT import notifications' },
    ];
    const actorOutput = 'import { send } from notifications';
    const violations = checkConstraintViolations(pinnedConstraints, actorOutput);
    assert.strictEqual(violations.length, 1);
    assert.ok(violations[0].constraint.includes('must NOT import notifications'));
    assert.ok(violations[0].violation.length > 0);
    assert.ok(violations[0].pattern.length > 0);
  });

  it('15. non-matching output returns empty', () => {
    const pinnedConstraints = [
      { content: 'must NOT import notifications' },
    ];
    const actorOutput = 'const handler = createHandler({ type: "rest" })';
    const violations = checkConstraintViolations(pinnedConstraints, actorOutput);
    assert.strictEqual(violations.length, 0);
  });
});
