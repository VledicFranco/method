// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for PersonaProfile registry (PRD 032, P4).
 *
 * Tests: all 5 built-in personas defined, selection logic by keyword,
 * direct ID lookup, unknown task type handling, case insensitivity.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PERSONAS, selectPersona, getPersona } from '../personas.js';
import type { PersonaProfile } from '../personas.js';

// ── Tests ────────────────────────────────────────────────────────

describe('Persona Registry — PERSONAS', () => {
  it('defines exactly 5 built-in personas', () => {
    const ids = Object.keys(PERSONAS);
    assert.strictEqual(ids.length, 5);
    assert.deepStrictEqual(ids.sort(), [
      'architect',
      'debugger',
      'explorer',
      'reviewer',
      'specialist',
    ]);
  });

  it('debugger persona has correct structure', () => {
    const p = PERSONAS['debugger'];
    assertValidPersona(p, 'debugger', 'Debugger');
    assert.ok(p.expertise.includes('error analysis'));
    assert.ok(p.reasoningStyle.includes('fault isolation'));
    assert.ok(p.strengths.includes('methodical'));
    assert.ok(p.biases.length > 0);
  });

  it('architect persona has correct structure', () => {
    const p = PERSONAS['architect'];
    assertValidPersona(p, 'architect', 'Architect');
    assert.ok(p.expertise.includes('system design'));
    assert.ok(p.reasoningStyle.includes('tradeoff'));
    assert.ok(p.strengths.includes('big-picture thinking'));
  });

  it('reviewer persona has correct structure', () => {
    const p = PERSONAS['reviewer'];
    assertValidPersona(p, 'reviewer', 'Reviewer');
    assert.ok(p.expertise.includes('code quality'));
    assert.ok(p.reasoningStyle.includes('Critical assessment'));
    assert.ok(p.strengths.includes('pattern recognition'));
  });

  it('explorer persona has correct structure', () => {
    const p = PERSONAS['explorer'];
    assertValidPersona(p, 'explorer', 'Explorer');
    assert.ok(p.expertise.includes('breadth-first discovery'));
    assert.ok(p.reasoningStyle.includes('Divergent'));
    assert.ok(p.strengths.includes('creative ideation'));
  });

  it('specialist persona has correct structure', () => {
    const p = PERSONAS['specialist'];
    assertValidPersona(p, 'specialist', 'Specialist');
    assert.ok(p.expertise.includes('deep domain expertise'));
    assert.ok(p.reasoningStyle.includes('domain-specific'));
    assert.ok(p.strengths.includes('precision'));
  });
});

describe('selectPersona — task type keyword matching', () => {
  it('selects debugger for debug-related task types', () => {
    assert.strictEqual(selectPersona('debug')?.id, 'debugger');
    assert.strictEqual(selectPersona('fix this bug')?.id, 'debugger');
    assert.strictEqual(selectPersona('troubleshoot the error')?.id, 'debugger');
  });

  it('selects architect for design-related task types', () => {
    assert.strictEqual(selectPersona('design')?.id, 'architect');
    assert.strictEqual(selectPersona('refactor the module')?.id, 'architect');
    assert.strictEqual(selectPersona('plan the architecture')?.id, 'architect');
  });

  it('selects reviewer for review-related task types', () => {
    assert.strictEqual(selectPersona('review')?.id, 'reviewer');
    assert.strictEqual(selectPersona('audit the code')?.id, 'reviewer');
    assert.strictEqual(selectPersona('validate the output')?.id, 'reviewer');
  });

  it('selects explorer for exploration-related task types', () => {
    assert.strictEqual(selectPersona('explore')?.id, 'explorer');
    assert.strictEqual(selectPersona('research this topic')?.id, 'explorer');
    assert.strictEqual(selectPersona('brainstorm ideas')?.id, 'explorer');
  });

  it('selects specialist for implementation-related task types', () => {
    assert.strictEqual(selectPersona('implement')?.id, 'specialist');
    assert.strictEqual(selectPersona('comply with standard')?.id, 'specialist');
    assert.strictEqual(selectPersona('follow the specification')?.id, 'specialist');
  });

  it('returns undefined for unknown task types', () => {
    assert.strictEqual(selectPersona(''), undefined);
    assert.strictEqual(selectPersona('something random'), undefined);
    assert.strictEqual(selectPersona('xyzzy'), undefined);
  });

  it('matches case-insensitively', () => {
    assert.strictEqual(selectPersona('DEBUG')?.id, 'debugger');
    assert.strictEqual(selectPersona('Design')?.id, 'architect');
    assert.strictEqual(selectPersona('REVIEW')?.id, 'reviewer');
    assert.strictEqual(selectPersona('Explore')?.id, 'explorer');
  });

  it('matches direct persona ID', () => {
    assert.strictEqual(selectPersona('debugger')?.id, 'debugger');
    assert.strictEqual(selectPersona('architect')?.id, 'architect');
    assert.strictEqual(selectPersona('reviewer')?.id, 'reviewer');
    assert.strictEqual(selectPersona('explorer')?.id, 'explorer');
    assert.strictEqual(selectPersona('specialist')?.id, 'specialist');
  });
});

describe('getPersona — direct ID lookup', () => {
  it('returns persona for valid ID', () => {
    const p = getPersona('debugger');
    assert.ok(p);
    assert.strictEqual(p.id, 'debugger');
    assert.strictEqual(p.name, 'Debugger');
  });

  it('returns undefined for invalid ID', () => {
    assert.strictEqual(getPersona('nonexistent'), undefined);
    assert.strictEqual(getPersona(''), undefined);
  });
});

// ── Helpers ─────────────────────────────────────────────────────

function assertValidPersona(p: PersonaProfile, id: string, name: string): void {
  assert.strictEqual(p.id, id);
  assert.strictEqual(p.name, name);
  assert.ok(Array.isArray(p.expertise), 'expertise should be an array');
  assert.ok(p.expertise.length > 0, 'expertise should not be empty');
  assert.ok(typeof p.reasoningStyle === 'string', 'reasoningStyle should be a string');
  assert.ok(p.reasoningStyle.length > 0, 'reasoningStyle should not be empty');
  assert.ok(Array.isArray(p.strengths), 'strengths should be an array');
  assert.ok(p.strengths.length > 0, 'strengths should not be empty');
  assert.ok(Array.isArray(p.biases), 'biases should be an array');
  assert.ok(p.biases.length > 0, 'biases should not be empty');
}
