/**
 * Unit tests for the error taxonomy — PRD-058 §6.5.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ConfigurationError,
  IllegalStateError,
  MissingCtxError,
  UnknownSessionError,
} from './errors.js';

describe('error taxonomy', () => {
  it('ConfigurationError carries code + reasons', () => {
    const err = new ConfigurationError('invalid', ['r1', 'r2']);
    assert.strictEqual(err.code, 'CONFIGURATION');
    assert.deepStrictEqual(err.reasons, ['r1', 'r2']);
    assert.strictEqual(err.name, 'ConfigurationError');
  });

  it('MissingCtxError lists missing facades in the message', () => {
    const err = new MissingCtxError(['llm', 'audit']);
    assert.strictEqual(err.code, 'MISSING_CTX');
    assert.deepStrictEqual(err.missing, ['llm', 'audit']);
    assert.match(err.message, /llm, audit/);
  });

  it('UnknownSessionError carries sessionId', () => {
    const err = new UnknownSessionError('s-42');
    assert.strictEqual(err.code, 'UNKNOWN_SESSION');
    assert.strictEqual(err.sessionId, 's-42');
  });

  it('IllegalStateError has ILLEGAL_STATE code', () => {
    const err = new IllegalStateError('x');
    assert.strictEqual(err.code, 'ILLEGAL_STATE');
  });
});
