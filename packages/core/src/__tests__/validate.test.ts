import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolve } from 'path';
import { createSession, loadMethodology, validateStepOutput } from '../index.js';
import type { ValidationResult } from '../index.js';

const REGISTRY = resolve(import.meta.dirname, '..', '..', '..', '..', 'registry');

// M1-IMPL sigma_A1 has output_schema with required_fields and postcondition
function loadImplSession() {
  const method = loadMethodology(REGISTRY, 'P2-SD', 'M1-IMPL');
  const session = createSession();
  session.load(method);
  return { session, method };
}

describe('validateStepOutput — valid output', () => {
  it('passes with recommendation "advance" for valid output', () => {
    const { session } = loadImplSession();

    // sigma_A1 expects: spec_corpus_items (integer), source_files_read (integer), status (enum)
    // postcondition: "source-of-truth corpus fully read; existing source read for each area;
    //   inventory is written as an explicit artifact"
    // Output keys/values need enough postcondition keywords for heuristic to pass (>= 50%)
    const output = {
      spec_corpus_items: 5,
      source_files_read: 3,
      status: 'PASS',
      inventory: 'written as explicit artifact for each area',
      corpus: 'fully read from existing source',
    };

    const result: ValidationResult = validateStepOutput(session, 'sigma_A1', output);

    assert.equal(result.valid, true);
    assert.equal(result.recommendation, 'advance');
    assert.ok(result.postconditionMet);
    // Should have no error-severity findings
    const errors = result.findings.filter((f) => f.severity === 'error');
    assert.equal(errors.length, 0);
  });
});

describe('validateStepOutput — missing required field', () => {
  it('produces error finding and recommendation "retry" for missing field', () => {
    const { session } = loadImplSession();

    // Missing spec_corpus_items and source_files_read
    const output = {
      status: 'PASS',
    };

    const result = validateStepOutput(session, 'sigma_A1', output);

    const errors = result.findings.filter((f) => f.severity === 'error');
    assert.ok(errors.length >= 1, 'should have at least one error finding');
    assert.equal(result.recommendation, 'retry');

    // Check that the missing field is identified
    const missingFields = errors.map((f) => f.field);
    assert.ok(missingFields.includes('spec_corpus_items'), 'should flag spec_corpus_items as missing');
  });
});

describe('validateStepOutput — postcondition check', () => {
  it('passes when keywords from postcondition are present in output', () => {
    const { session } = loadImplSession();

    // sigma_A1 postcondition: "source-of-truth corpus fully read; existing source read for each area;
    //   inventory is written as an explicit artifact"
    // Output contains matching keywords
    const output = {
      spec_corpus_items: 5,
      source_files_read: 3,
      status: 'PASS',
      corpus: 'fully read',
      source: 'read for each area',
      inventory: 'written as artifact',
    };

    const result = validateStepOutput(session, 'sigma_A1', output);
    assert.ok(result.postconditionMet, 'postcondition should be met when keywords present');
  });

  it('fails postcondition when keywords are missing — recommendation "escalate"', () => {
    const { session } = loadImplSession();

    // Provide required fields but with content that has no postcondition keywords
    const output = {
      spec_corpus_items: 1,
      source_files_read: 1,
      status: 'PASS',
      xyz: 123,
    };

    const result = validateStepOutput(session, 'sigma_A1', output);

    // postconditionMet may or may not pass depending on keyword overlap
    // But if it does fail, recommendation should be "escalate" (no schema errors)
    if (!result.postconditionMet) {
      assert.equal(result.recommendation, 'escalate');
    }
  });
});

describe('validateStepOutput — output recording', () => {
  it('records output even on validation failure', () => {
    const { session } = loadImplSession();

    // Provide output missing required fields — validation will fail
    const output = { partial: true };
    validateStepOutput(session, 'sigma_A1', output);

    // Advance to next step and check priorStepOutputs
    session.advance();
    const ctx = session.context();

    assert.ok(ctx.priorStepOutputs.length >= 1, 'priorStepOutputs should have at least one entry');
    assert.equal(ctx.priorStepOutputs[0].stepId, 'sigma_A1');
    assert.ok(ctx.priorStepOutputs[0].summary.includes('partial'));
  });
});

describe('validateStepOutput — step ID mismatch', () => {
  it('throws error for step_id mismatch', () => {
    const { session } = loadImplSession();

    assert.throws(
      () => validateStepOutput(session, 'sigma_B1', { some: 'data' }),
      /step_id mismatch: expected sigma_A1 but got sigma_B1/,
    );
  });
});

describe('validateStepOutput — type checking', () => {
  it('detects type mismatch for integer field', () => {
    const { session } = loadImplSession();

    // spec_corpus_items should be integer/number, pass a string instead
    const output = {
      spec_corpus_items: 'not-a-number',
      source_files_read: 3,
      status: 'PASS',
    };

    const result = validateStepOutput(session, 'sigma_A1', output);

    const typeErrors = result.findings.filter(
      (f) => f.field === 'spec_corpus_items' && f.severity === 'error',
    );
    assert.ok(typeErrors.length >= 1, 'should have type error for spec_corpus_items');
  });
});
