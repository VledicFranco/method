/**
 * result-formatter.test.ts — Unit tests for ResultFormatter.
 *
 * Covers per-rank excerpt budget logic introduced for PRD 053 SC-1
 * (top-1 result enrichment — council 2026-04-12).
 */

import { describe, it, expect } from 'vitest';
import {
  ResultFormatter,
  TOP_RESULT_EXCERPT_PER_PART,
  TOP_RESULT_TOTAL_BUDGET,
  REST_RESULT_EXCERPT_PER_PART,
} from './result-formatter.js';
import type { IndexEntry } from '../ports/internal/index-store.js';
import type { ComponentPart, FcaPart } from '../ports/context-query.js';

// ── Fixture builders ─────────────────────────────────────────────────────────

const PROJECT_ROOT = '/test-project';

function makePart(part: FcaPart, excerptLen: number): ComponentPart {
  return {
    part,
    filePath: `src/${part}/file.ts`,
    excerpt: 'x'.repeat(excerptLen),
  };
}

function makeEntry(path: string, parts: ComponentPart[]): IndexEntry {
  return {
    id: path.replace(/[^a-z0-9]/gi, '').slice(0, 16).padEnd(16, '0'),
    projectRoot: PROJECT_ROOT,
    path,
    level: 'L2',
    parts,
    coverageScore: 1,
    embedding: [0.1, 0.2, 0.3],
    indexedAt: '2026-04-12T00:00:00.000Z',
  };
}

const totalExcerptChars = (parts: ComponentPart[]): number =>
  parts.reduce((sum, p) => sum + (p.excerpt?.length ?? 0), 0);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ResultFormatter — per-rank excerpt budget', () => {
  const formatter = new ResultFormatter();

  it('top-1 excerpts are bounded by TOP_RESULT_EXCERPT_PER_PART per part', () => {
    // 3 parts, each with excerpts much longer than the per-part cap
    const top = makeEntry('packages/a', [
      makePart('documentation', 2000),
      makePart('interface', 2000),
      makePart('port', 2000),
    ]);
    const second = makeEntry('packages/b', [makePart('documentation', 2000)]);

    const results = formatter.format([top, second]);

    for (const part of results[0].parts) {
      expect(part.excerpt!.length).toBeLessThanOrEqual(TOP_RESULT_EXCERPT_PER_PART);
    }
  });

  it('top-1 total excerpt characters are bounded by TOP_RESULT_TOTAL_BUDGET', () => {
    // 8 parts × 500 chars each = 4000 chars worth of excerpt source
    // After budgeting: should be ≤ 1800
    const top = makeEntry('packages/a', [
      makePart('documentation', 500),
      makePart('interface', 500),
      makePart('port', 500),
      makePart('verification', 500),
      makePart('observability', 500),
      makePart('architecture', 500),
      makePart('domain', 500),
      makePart('boundary', 500),
    ]);
    const second = makeEntry('packages/b', [makePart('documentation', 100)]);

    const results = formatter.format([top, second]);
    expect(totalExcerptChars(results[0].parts)).toBeLessThanOrEqual(TOP_RESULT_TOTAL_BUDGET);
  });

  it('non-top results still cap each excerpt at REST_RESULT_EXCERPT_PER_PART', () => {
    // 3 results, all have parts with long excerpts
    const top = makeEntry('packages/a', [makePart('documentation', 2000)]);
    const second = makeEntry('packages/b', [
      makePart('documentation', 2000),
      makePart('interface', 2000),
    ]);
    const third = makeEntry('packages/c', [makePart('port', 2000)]);

    const results = formatter.format([top, second, third]);

    for (let i = 1; i < results.length; i++) {
      for (const part of results[i].parts) {
        expect(part.excerpt!.length).toBeLessThanOrEqual(REST_RESULT_EXCERPT_PER_PART);
      }
    }
  });

  it('pathological 8-part top-1 caps cleanly without exceeding budget', () => {
    // 8 parts × 1000 chars each = 8000 chars of source. Verify the cap holds
    // and that the truncation is graceful (some parts get full 500, later
    // parts get partial or undefined as the budget exhausts).
    const top = makeEntry('packages/a', [
      makePart('documentation', 1000),
      makePart('interface', 1000),
      makePart('port', 1000),
      makePart('verification', 1000),
      makePart('observability', 1000),
      makePart('architecture', 1000),
      makePart('domain', 1000),
      makePart('boundary', 1000),
    ]);

    const results = formatter.format([top]);

    expect(totalExcerptChars(results[0].parts)).toBeLessThanOrEqual(TOP_RESULT_TOTAL_BUDGET);
    // No excerpt exceeds the per-part cap
    for (const part of results[0].parts) {
      if (part.excerpt !== undefined) {
        expect(part.excerpt.length).toBeLessThanOrEqual(TOP_RESULT_EXCERPT_PER_PART);
      }
    }
    // The total source was 8000 chars but budget is 1800, so several parts
    // should have their excerpts stripped (set to undefined).
    const strippedCount = results[0].parts.filter((p) => p.excerpt === undefined).length;
    expect(strippedCount).toBeGreaterThan(0);
  });

  it('parts with no excerpt pass through unchanged (top-1)', () => {
    const top = makeEntry('packages/a', [
      { part: 'port', filePath: 'src/ports/p.ts' }, // no excerpt
      makePart('documentation', 200),
    ]);

    const results = formatter.format([top]);

    expect(results[0].parts[0]).toEqual({ part: 'port', filePath: 'src/ports/p.ts' });
    expect(results[0].parts[0].excerpt).toBeUndefined();
    expect(results[0].parts[1].excerpt).toBe('x'.repeat(200));
  });

  it('parts with no excerpt pass through unchanged (non-top)', () => {
    const top = makeEntry('packages/a', [makePart('documentation', 100)]);
    const second = makeEntry('packages/b', [
      { part: 'port', filePath: 'src/ports/p.ts' },
      makePart('documentation', 500),
    ]);

    const results = formatter.format([top, second]);

    expect(results[1].parts[0].excerpt).toBeUndefined();
    expect(results[1].parts[1].excerpt!.length).toBe(REST_RESULT_EXCERPT_PER_PART);
  });

  it('single-result query treats the only result as top-1', () => {
    const only = makeEntry('packages/a', [
      makePart('documentation', 300),
      makePart('interface', 300),
    ]);

    const results = formatter.format([only]);

    // Both parts should retain their full 300 chars (well under the per-part cap)
    expect(results[0].parts[0].excerpt!.length).toBe(300);
    expect(results[0].parts[1].excerpt!.length).toBe(300);
  });

  it('parts ordering is always preserved', () => {
    const order: FcaPart[] = ['domain', 'documentation', 'verification', 'interface', 'port'];
    const top = makeEntry('packages/a', order.map((p) => makePart(p, 50)));
    const second = makeEntry('packages/b', order.map((p) => makePart(p, 200)));

    const results = formatter.format([top, second]);

    expect(results[0].parts.map((p) => p.part)).toEqual(order);
    expect(results[1].parts.map((p) => p.part)).toEqual(order);
  });
});
