import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateSessionBudget } from '../session-chain.js';

describe('validateSessionBudget', () => {
  it('allows spawn when within budget', () => {
    const result = validateSessionBudget(1, {
      max_depth: 3,
      max_agents: 10,
      agents_spawned: 2,
    });

    assert.deepEqual(result, { allowed: true });
  });

  it('rejects when depth equals max_depth', () => {
    const result = validateSessionBudget(3, {
      max_depth: 3,
      max_agents: 10,
      agents_spawned: 0,
    });

    assert.equal(result.allowed, false);
    if (!result.allowed) {
      assert.equal(result.error, 'DEPTH_EXCEEDED');
      assert.match(result.message, /depth 3/i);
    }
  });

  it('rejects when depth exceeds max_depth', () => {
    const result = validateSessionBudget(5, {
      max_depth: 3,
      max_agents: 10,
      agents_spawned: 0,
    });

    assert.equal(result.allowed, false);
    if (!result.allowed) {
      assert.equal(result.error, 'DEPTH_EXCEEDED');
    }
  });

  it('rejects when agents_spawned equals max_agents', () => {
    const result = validateSessionBudget(0, {
      max_depth: 3,
      max_agents: 10,
      agents_spawned: 10,
    });

    assert.equal(result.allowed, false);
    if (!result.allowed) {
      assert.equal(result.error, 'BUDGET_EXHAUSTED');
      assert.match(result.message, /10\/10/);
    }
  });

  it('allows spawn at depth 0 with fresh budget', () => {
    const result = validateSessionBudget(0, {
      max_depth: 3,
      max_agents: 10,
      agents_spawned: 0,
    });

    assert.deepEqual(result, { allowed: true });
  });

  it('depth check takes priority over agent count', () => {
    // Both limits exceeded — depth should be reported first
    const result = validateSessionBudget(3, {
      max_depth: 3,
      max_agents: 10,
      agents_spawned: 10,
    });

    assert.equal(result.allowed, false);
    if (!result.allowed) {
      assert.equal(result.error, 'DEPTH_EXCEEDED');
    }
  });
});
