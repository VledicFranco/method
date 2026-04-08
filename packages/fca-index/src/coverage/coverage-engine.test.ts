/**
 * CoverageEngine — unit tests.
 *
 * All tests use InMemoryIndexStore as the store double.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CoverageEngine } from './coverage-engine.js';
import { InMemoryIndexStore } from '../index-store/in-memory-store.js';
import { CoverageReportError } from '../ports/coverage-report.js';
import type { IndexEntry } from '../ports/internal/index-store.js';
import type { FcaPart } from '../ports/context-query.js';

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeEntry(path: string, coverageScore: number, parts: FcaPart[]): IndexEntry {
  return {
    id: path,
    projectRoot: '/test',
    path,
    level: 'L2',
    parts: parts.map((p) => ({ part: p, filePath: `${path}/${p}.ts`, excerpt: '' })),
    coverageScore,
    embedding: [],
    indexedAt: new Date().toISOString(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CoverageEngine', () => {
  let store: InMemoryIndexStore;

  beforeEach(() => {
    store = new InMemoryIndexStore();
  });

  // 1. getReport(verbose=false) returns summary-only
  it('getReport(verbose=false) returns summary without components', async () => {
    await store.upsertComponent(makeEntry('src/a', 0.8, ['interface', 'documentation']));

    const engine = new CoverageEngine(store);
    const report = await engine.getReport({ projectRoot: '/test', verbose: false });

    expect(report.summary).toBeDefined();
    expect(report.components).toBeUndefined();
  });

  // 2. getReport(verbose=true) returns summary + components sorted by coverageScore ASC
  it('getReport(verbose=true) returns components sorted by coverageScore ascending', async () => {
    await store.upsertComponent(makeEntry('src/a', 0.9, ['interface', 'documentation']));
    await store.upsertComponent(makeEntry('src/b', 0.3, ['interface']));
    await store.upsertComponent(makeEntry('src/c', 0.6, ['documentation']));

    const engine = new CoverageEngine(store);
    const report = await engine.getReport({ projectRoot: '/test', verbose: true });

    expect(report.components).toBeDefined();
    const scores = report.components!.map((c) => c.coverageScore);
    expect(scores).toEqual([0.3, 0.6, 0.9]);
  });

  // 3. CoverageSummary.byPart fractions match IndexCoverageStats.byPart
  it('summary.byPart matches store getCoverageStats.byPart', async () => {
    await store.upsertComponent(makeEntry('src/a', 0.8, ['interface', 'documentation']));
    await store.upsertComponent(makeEntry('src/b', 0.5, ['interface']));

    const engine = new CoverageEngine(store);
    const report = await engine.getReport({ projectRoot: '/test' });
    const stats = await store.getCoverageStats('/test');

    expect(report.summary.byPart).toEqual(stats.byPart);
  });

  // 4. meetsThreshold=true when overallScore >= threshold
  it('meetsThreshold is true when overallScore >= threshold', async () => {
    await store.upsertComponent(makeEntry('src/a', 0.9, ['interface', 'documentation']));
    await store.upsertComponent(makeEntry('src/b', 0.9, ['interface', 'documentation']));

    const engine = new CoverageEngine(store, { threshold: 0.8 });
    const report = await engine.getReport({ projectRoot: '/test' });

    expect(report.summary.overallScore).toBeGreaterThanOrEqual(0.8);
    expect(report.summary.meetsThreshold).toBe(true);
  });

  // 5. meetsThreshold=false when overallScore < threshold
  it('meetsThreshold is false when overallScore < threshold', async () => {
    await store.upsertComponent(makeEntry('src/a', 0.5, ['interface']));
    await store.upsertComponent(makeEntry('src/b', 0.5, ['interface']));

    const engine = new CoverageEngine(store, { threshold: 0.8 });
    const report = await engine.getReport({ projectRoot: '/test' });

    expect(report.summary.overallScore).toBeLessThan(0.8);
    expect(report.summary.meetsThreshold).toBe(false);
  });

  // 6. CoverageReportError('INDEX_NOT_FOUND') thrown when index is empty
  it('throws CoverageReportError INDEX_NOT_FOUND when index is empty', async () => {
    const engine = new CoverageEngine(store);

    await expect(engine.getReport({ projectRoot: '/test' })).rejects.toThrow(CoverageReportError);

    try {
      await engine.getReport({ projectRoot: '/test' });
    } catch (err) {
      expect(err).toBeInstanceOf(CoverageReportError);
      expect((err as CoverageReportError).code).toBe('INDEX_NOT_FOUND');
    }
  });

  // 7. Threshold boundary: overallScore exactly equals threshold → meetsThreshold=true
  it('meetsThreshold is true when overallScore equals threshold exactly', async () => {
    // Two entries each scoring 0.8 → average = 0.8 = threshold
    await store.upsertComponent(makeEntry('src/a', 0.8, ['interface', 'documentation']));
    await store.upsertComponent(makeEntry('src/b', 0.8, ['interface', 'documentation']));

    const engine = new CoverageEngine(store, { threshold: 0.8 });
    const report = await engine.getReport({ projectRoot: '/test' });

    expect(report.summary.overallScore).toBeCloseTo(0.8, 10);
    expect(report.summary.meetsThreshold).toBe(true);
  });

  // 8. fullyDocumented / partiallyDocumented / undocumented bucket counts
  it('correctly counts fully, partially, and undocumented components', async () => {
    await store.upsertComponent(makeEntry('src/a', 1.0, ['interface', 'documentation']));
    await store.upsertComponent(makeEntry('src/b', 1.0, ['interface', 'documentation']));
    await store.upsertComponent(makeEntry('src/c', 1.0, ['interface', 'documentation']));
    await store.upsertComponent(makeEntry('src/d', 0.5, ['interface']));
    await store.upsertComponent(makeEntry('src/e', 0.7, ['documentation']));
    await store.upsertComponent(makeEntry('src/f', 0.0, []));

    const engine = new CoverageEngine(store);
    const report = await engine.getReport({ projectRoot: '/test' });

    expect(report.summary.fullyDocumented).toBe(3);
    expect(report.summary.partiallyDocumented).toBe(2);
    expect(report.summary.undocumented).toBe(1);
  });

  // 9. mode is 'production' when overallScore >= 0.8
  it('mode is production when overallScore >= 0.8', async () => {
    await store.upsertComponent(makeEntry('src/a', 0.9, ['interface', 'documentation']));

    const engine = new CoverageEngine(store, { threshold: 0.8 });
    const report = await engine.getReport({ projectRoot: '/test' });

    expect(report.mode).toBe('production');
  });

  // 10. mode is 'discovery' when overallScore < 0.8
  it('mode is discovery when overallScore < 0.8', async () => {
    await store.upsertComponent(makeEntry('src/a', 0.5, ['interface']));

    const engine = new CoverageEngine(store, { threshold: 0.8 });
    const report = await engine.getReport({ projectRoot: '/test' });

    expect(report.mode).toBe('discovery');
  });

  // 11. missingParts in verbose report
  it('verbose report computes missingParts correctly from requiredParts', async () => {
    // Component has only 'documentation', requiredParts default is ['interface', 'documentation']
    await store.upsertComponent(makeEntry('src/a', 0.5, ['documentation']));

    const engine = new CoverageEngine(store);
    const report = await engine.getReport({ projectRoot: '/test', verbose: true });

    expect(report.components).toBeDefined();
    const entry = report.components!.find((c) => c.path === 'src/a')!;
    expect(entry.presentParts).toContain('documentation');
    expect(entry.missingParts).toEqual(['interface']);
  });
});
