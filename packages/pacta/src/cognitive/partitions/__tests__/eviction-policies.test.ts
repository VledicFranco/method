/**
 * Eviction Policy Tests — PRD 044 C-1.
 *
 * Validates all three eviction policies:
 *   NoEvictionPolicy, RecencyEvictionPolicy, GoalSalienceEvictionPolicy
 */

import { describe, it, expect } from 'vitest';
import {
  NoEvictionPolicy,
  RecencyEvictionPolicy,
  GoalSalienceEvictionPolicy,
} from '../eviction-policies.js';
import type { WorkspaceEntry } from '../../algebra/workspace-types.js';
import type { ModuleId } from '../../algebra/module.js';

// ── Test Helpers ────────────────────────────────────────────────

const MOD = 'test-mod' as ModuleId;

function makeEntry(
  timestamp: number,
  overrides?: Partial<WorkspaceEntry>,
): WorkspaceEntry {
  return {
    source: MOD,
    content: `entry-${timestamp}`,
    salience: 0.5,
    timestamp,
    ...overrides,
  };
}

// ── NoEvictionPolicy ───────────────────────────────────────────

describe('NoEvictionPolicy', () => {
  it('always returns null', () => {
    const policy = new NoEvictionPolicy();
    const entries = [makeEntry(100), makeEntry(200), makeEntry(300)];
    expect(policy.selectForEviction(entries)).toBeNull();
  });

  it('returns null even for empty entries', () => {
    const policy = new NoEvictionPolicy();
    expect(policy.selectForEviction([])).toBeNull();
  });
});

// ── RecencyEvictionPolicy ──────────────────────────────────────

describe('RecencyEvictionPolicy', () => {
  it('returns index of entry with oldest timestamp', () => {
    const policy = new RecencyEvictionPolicy();
    const entries = [makeEntry(300), makeEntry(100), makeEntry(200)];
    expect(policy.selectForEviction(entries)).toBe(1);
  });

  it('returns 0 with a single entry', () => {
    const policy = new RecencyEvictionPolicy();
    expect(policy.selectForEviction([makeEntry(500)])).toBe(0);
  });

  it('returns null for empty entries', () => {
    const policy = new RecencyEvictionPolicy();
    expect(policy.selectForEviction([])).toBeNull();
  });

  it('returns first oldest when timestamps tie', () => {
    const policy = new RecencyEvictionPolicy();
    const entries = [makeEntry(100), makeEntry(200), makeEntry(100)];
    // First entry at index 0 has timestamp 100 and is encountered first.
    expect(policy.selectForEviction(entries)).toBe(0);
  });
});

// ── GoalSalienceEvictionPolicy ─────────────────────────────────

describe('GoalSalienceEvictionPolicy', () => {
  it('evicts non-goal before goal', () => {
    const policy = new GoalSalienceEvictionPolicy();
    const entries = [
      makeEntry(100, { contentType: 'goal' }),
      makeEntry(200, { contentType: 'operational' }),
      makeEntry(150, { contentType: 'goal' }),
    ];
    // The only non-goal is at index 1.
    expect(policy.selectForEviction(entries)).toBe(1);
  });

  it('evicts oldest non-goal when multiple exist', () => {
    const policy = new GoalSalienceEvictionPolicy();
    const entries = [
      makeEntry(300, { contentType: 'operational' }),
      makeEntry(100, { contentType: 'constraint' }),
      makeEntry(200, { contentType: 'goal' }),
      makeEntry(150, { contentType: 'operational' }),
    ];
    // Non-goals: index 0 (ts=300), index 1 (ts=100), index 3 (ts=150).
    // Oldest non-goal is index 1 (ts=100).
    expect(policy.selectForEviction(entries)).toBe(1);
  });

  it('evicts oldest goal when all entries are goals', () => {
    const policy = new GoalSalienceEvictionPolicy();
    const entries = [
      makeEntry(300, { contentType: 'goal' }),
      makeEntry(100, { contentType: 'goal' }),
      makeEntry(200, { contentType: 'goal' }),
    ];
    // All goals — oldest is index 1 (ts=100).
    expect(policy.selectForEviction(entries)).toBe(1);
  });

  it('treats entries without contentType as non-goal', () => {
    const policy = new GoalSalienceEvictionPolicy();
    const entries = [
      makeEntry(300, { contentType: 'goal' }),
      makeEntry(200), // no contentType → not a goal → eviction candidate
      makeEntry(100, { contentType: 'goal' }),
    ];
    expect(policy.selectForEviction(entries)).toBe(1);
  });

  it('returns null for empty entries', () => {
    const policy = new GoalSalienceEvictionPolicy();
    expect(policy.selectForEviction([])).toBeNull();
  });
});
