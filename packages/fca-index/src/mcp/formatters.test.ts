/**
 * formatters.test.ts — Unit tests for the standalone MCP formatters.
 *
 * Mirrors the rendering tests in @method/mcp/src/context-tools.test.ts
 * but tests the fca-index-local copy to prevent drift.
 */

import { describe, it, expect } from 'vitest';
import {
  formatContextQueryResult,
  formatCoverageReport,
  formatComponentDetail,
} from './formatters.js';
import type { ContextQueryResult } from '../ports/context-query.js';
import type { CoverageReport } from '../ports/coverage-report.js';
import type { ComponentDetail } from '../ports/component-detail.js';

// ── context_query ────────────────────────────────────────────────────────────

describe('formatContextQueryResult', () => {
  const result: ContextQueryResult = {
    mode: 'production',
    results: [
      {
        path: 'src/top',
        level: 'L2',
        parts: [
          { part: 'documentation', filePath: 'src/top/README.md', excerpt: '# Top\nThis is a multi-line doc.' },
          { part: 'interface', filePath: 'src/top/index.ts', excerpt: 'export class Foo {}' },
        ],
        relevanceScore: 1,
        coverageScore: 1,
      },
      {
        path: 'src/second',
        level: 'L2',
        parts: [
          { part: 'documentation', filePath: 'src/second/README.md', excerpt: 'Second component.' },
        ],
        relevanceScore: 0.5,
        coverageScore: 0.8,
      },
    ],
  };

  it('starts with [mode:] header', () => {
    const text = formatContextQueryResult(result, 'foo');
    expect(text).toMatch(/^\[mode: production\]/);
  });

  it('renders top-1 with multi-line | prefix', () => {
    const text = formatContextQueryResult(result, 'foo');
    expect(text).toContain('     | # Top');
    expect(text).toContain('     | This is a multi-line doc.');
  });

  it('renders non-top with single-line > prefix', () => {
    const text = formatContextQueryResult(result, 'foo');
    expect(text).toContain('     > Second component.');
  });

  it('caps non-top excerpts at 120 chars', () => {
    const longResult: ContextQueryResult = {
      mode: 'production',
      results: [
        { path: 'a', level: 'L2', parts: [{ part: 'documentation', filePath: 'a.md', excerpt: 'short' }], relevanceScore: 1, coverageScore: 1 },
        { path: 'b', level: 'L2', parts: [{ part: 'documentation', filePath: 'b.md', excerpt: 'x'.repeat(500) }], relevanceScore: 0.5, coverageScore: 1 },
      ],
    };
    const text = formatContextQueryResult(longResult, 'q');
    const lines = text.split('\n');
    const excerptLine = lines.find(l => l.includes('     > ') && l.includes('xxx'))!;
    const xCount = (excerptLine.match(/x/g) ?? []).length;
    expect(xCount).toBeLessThanOrEqual(120);
  });
});

// ── coverage_check ───────────────────────────────────────────────────────────

describe('formatCoverageReport', () => {
  const report: CoverageReport = {
    projectRoot: '/test',
    mode: 'production',
    generatedAt: '2026-04-13T00:00:00Z',
    summary: {
      overallScore: 0.85,
      threshold: 0.8,
      meetsThreshold: true,
      totalComponents: 10,
      fullyDocumented: 8,
      partiallyDocumented: 1,
      undocumented: 1,
      byPart: {
        documentation: 0.9,
        interface: 0.8,
        port: 0.3,
        verification: 0.5,
        observability: 0,
        architecture: 0.1,
        domain: 0,
        boundary: 0.4,
      },
    },
  };

  it('includes mode and overall score', () => {
    const text = formatCoverageReport(report);
    expect(text).toContain('[mode: production]');
    expect(text).toContain('Coverage: 0.85');
  });

  it('includes per-part bars', () => {
    const text = formatCoverageReport(report);
    expect(text).toContain('documentation');
    expect(text).toContain('interface');
    expect(text).toContain('█');
  });

  it('includes component totals', () => {
    const text = formatCoverageReport(report);
    expect(text).toContain('10 total');
    expect(text).toContain('8 fully documented');
  });
});

// ── context_detail ───────────────────────────────────────────────────────────

describe('formatComponentDetail', () => {
  const detail: ComponentDetail = {
    path: 'src/auth',
    level: 'L2',
    parts: [
      { part: 'documentation', filePath: 'src/auth/README.md', excerpt: 'Auth domain handles auth.' },
      { part: 'port', filePath: 'src/auth/ports/auth-port.ts' },
    ],
    docText: 'Auth domain handles auth.',
    indexedAt: '2026-04-13T00:00:00Z',
  };

  it('starts with path:', () => {
    const text = formatComponentDetail(detail);
    expect(text).toMatch(/^path: src\/auth/);
  });

  it('includes level and indexedAt', () => {
    const text = formatComponentDetail(detail);
    expect(text).toContain('level: L2');
    expect(text).toContain('indexedAt: 2026-04-13');
  });

  it('includes parts with excerpts', () => {
    const text = formatComponentDetail(detail);
    expect(text).toContain('documentation: src/auth/README.md');
    expect(text).toContain('> Auth domain handles auth.');
  });

  it('includes docText section', () => {
    const text = formatComponentDetail(detail);
    expect(text).toContain('docText:');
    expect(text).toContain('Auth domain handles auth.');
  });

  it('truncates docText over 2000 chars', () => {
    const longDetail: ComponentDetail = {
      ...detail,
      docText: 'z'.repeat(3000),
    };
    const text = formatComponentDetail(longDetail);
    expect(text).toContain('... (truncated)');
    expect((text.match(/z/g) ?? []).length).toBeLessThanOrEqual(2000);
  });
});
