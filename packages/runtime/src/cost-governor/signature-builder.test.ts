import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSignature, inputSizeBucket, signatureKey } from './signature-builder.js';

describe('inputSizeBucket', () => {
  it('xs for < 1000 chars', () => assert.equal(inputSizeBucket(500), 'xs'));
  it('s for < 10000 chars', () => assert.equal(inputSizeBucket(5000), 's'));
  it('m for < 100000 chars', () => assert.equal(inputSizeBucket(50000), 'm'));
  it('l for < 1000000 chars', () => assert.equal(inputSizeBucket(500000), 'l'));
  it('xl for >= 1000000 chars', () => assert.equal(inputSizeBucket(1500000), 'xl'));
  it('boundary: exactly 1000 is s', () => assert.equal(inputSizeBucket(1000), 's'));
  it('boundary: exactly 0 is xs', () => assert.equal(inputSizeBucket(0), 'xs'));
});

describe('buildSignature', () => {
  it('produces deterministic output', () => {
    const a = buildSignature({
      methodologyId: 'P2-SD',
      capabilities: ['write', 'read', 'analyze'],
      model: 'claude-opus-4-6',
      promptCharCount: 5000,
    });
    const b = buildSignature({
      methodologyId: 'P2-SD',
      capabilities: ['analyze', 'read', 'write'], // different order
      model: 'claude-opus-4-6',
      promptCharCount: 5000,
    });
    // Capabilities should be sorted
    assert.deepEqual(a.capabilities, ['analyze', 'read', 'write']);
    assert.deepEqual(a, b);
  });

  it('maps promptCharCount to correct bucket', () => {
    const sig = buildSignature({
      methodologyId: 'test',
      capabilities: [],
      model: 'test-model',
      promptCharCount: 150_000,
    });
    assert.equal(sig.inputSizeBucket, 'l');
  });
});

describe('signatureKey', () => {
  it('produces stable key', () => {
    const sig = buildSignature({
      methodologyId: 'P2-SD',
      capabilities: ['b', 'a'],
      model: 'opus',
      promptCharCount: 100,
    });
    assert.equal(signatureKey(sig), 'P2-SD|a,b|opus|xs');
  });

  it('different signatures produce different keys', () => {
    const a = buildSignature({ methodologyId: 'A', capabilities: [], model: 'x', promptCharCount: 0 });
    const b = buildSignature({ methodologyId: 'B', capabilities: [], model: 'x', promptCharCount: 0 });
    assert.notEqual(signatureKey(a), signatureKey(b));
  });
});
