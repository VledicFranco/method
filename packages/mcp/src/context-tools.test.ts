import { describe, it, expect } from 'vitest';
import { createContextTools, CONTEXT_TOOLS } from './context-tools.js';
import {
  RecordingContextQueryPort,
  RecordingCoverageReportPort,
  RecordingComponentDetailPort,
} from '@method/fca-index/testkit';
import { ContextQueryError, CoverageReportError, ComponentDetailError } from '@method/fca-index';
import type { ComponentContext } from '@method/fca-index';

// ── Helpers ──────────────────────────────────────────────────────────────────

const stubResults: ComponentContext[] = [
  {
    path: 'src/auth',
    level: 'L2',
    parts: [{ part: 'documentation', filePath: 'src/auth/README.md', excerpt: 'Auth domain.' }],
    relevanceScore: 0.9,
    coverageScore: 0.8,
  },
];

function makeTools(overrides?: {
  queryPort?: InstanceType<typeof RecordingContextQueryPort>;
  coveragePort?: InstanceType<typeof RecordingCoverageReportPort>;
  detailPort?: InstanceType<typeof RecordingComponentDetailPort>;
}) {
  const queryPort = overrides?.queryPort ?? new RecordingContextQueryPort({ results: stubResults, mode: 'production' });
  const coveragePort = overrides?.coveragePort ?? new RecordingCoverageReportPort();
  const detailPort = overrides?.detailPort ?? new RecordingComponentDetailPort();
  const tools = createContextTools(queryPort, coveragePort, '/default-root', detailPort);
  return { tools, queryPort, coveragePort, detailPort };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CONTEXT_TOOLS array', () => {
  it('has 3 entries: context_query, context_detail, and coverage_check', () => {
    expect(CONTEXT_TOOLS).toHaveLength(3);
    expect(CONTEXT_TOOLS[0].name).toBe('context_query');
    expect(CONTEXT_TOOLS[1].name).toBe('context_detail');
    expect(CONTEXT_TOOLS[2].name).toBe('coverage_check');
  });
});

describe('context_query handler', () => {
  it('calls port with correct args', async () => {
    const { tools, queryPort } = makeTools();
    await tools.contextQueryHandler({ query: 'auth', topK: 3 });
    queryPort.assertCallCount(1);
    queryPort.assertLastQuery('auth');
  });

  it('formats result as text starting with [mode:', async () => {
    const { tools } = makeTools();
    const result = await tools.contextQueryHandler({ query: 'auth' });
    expect(result.content[0].text).toMatch(/^\[mode:/);
  });

  it('INDEX_NOT_FOUND returns user-friendly error message', async () => {
    const errorPort = new RecordingContextQueryPort();
    // Override query to throw ContextQueryError
    (errorPort as unknown as { query: unknown }).query = async () => {
      throw new ContextQueryError('No index found', 'INDEX_NOT_FOUND');
    };
    const { tools } = makeTools({ queryPort: errorPort });
    const result = await tools.contextQueryHandler({ query: 'auth' });
    expect(result.content[0].text).toContain('INDEX_NOT_FOUND');
  });
});

// ── Per-rank render shape (PRD 053 SC-1 — council 2026-04-12) ────────────────

describe('context_query rendering — per-rank format', () => {
  // Build a fixture with a top-1 component (multi-line excerpt) and 2 followups
  // so we can assert the | prefix on top-1 and the > prefix on the rest.
  const topMultilineExcerpt =
    '/**\n * Top component documentation.\n * Spans multiple lines.\n */\nexport interface Foo { bar: string; }';

  const fixtureResults: ComponentContext[] = [
    {
      path: 'src/top',
      level: 'L2',
      parts: [
        { part: 'documentation', filePath: 'src/top/README.md', excerpt: topMultilineExcerpt },
        { part: 'interface', filePath: 'src/top/index.ts', excerpt: 'export class Foo {}' },
      ],
      relevanceScore: 1,
      coverageScore: 1,
    },
    {
      path: 'src/second',
      level: 'L2',
      parts: [
        { part: 'documentation', filePath: 'src/second/README.md', excerpt: 'Second component README.' },
      ],
      relevanceScore: 0.8,
      coverageScore: 0.9,
    },
    {
      path: 'src/third',
      level: 'L2',
      parts: [
        { part: 'interface', filePath: 'src/third/index.ts', excerpt: 'export const x = 1;' },
      ],
      relevanceScore: 0.6,
      coverageScore: 0.8,
    },
  ];

  function fixturePort() {
    return new RecordingContextQueryPort({ results: fixtureResults, mode: 'production' });
  }

  it('top-1 result renders multi-line | prefix preserving newlines', async () => {
    const { tools } = makeTools({ queryPort: fixturePort() });
    const result = await tools.contextQueryHandler({ query: 'foo' });
    const text = result.content[0].text;

    // The top documentation excerpt has newlines — they must survive as | lines.
    expect(text).toContain('     | /**');
    expect(text).toContain('     |  * Top component documentation.');
    expect(text).toContain('     |  * Spans multiple lines.');
  });

  it('non-top results render single-line > prefix (regression guard)', async () => {
    const { tools } = makeTools({ queryPort: fixturePort() });
    const result = await tools.contextQueryHandler({ query: 'foo' });
    const text = result.content[0].text;

    // Second and third results use the > prefix; their excerpts must be on one line.
    expect(text).toContain('     > Second component README.');
    expect(text).toContain('     > export const x = 1;');
    // The non-top results must NOT use the | prefix.
    const nonTopSection = text.slice(text.indexOf('2. src/second'));
    expect(nonTopSection).not.toContain('     |');
  });

  it('non-top excerpts cap at 120 chars (regression guard)', async () => {
    const longExcerpt = 'x'.repeat(2000);
    const port = new RecordingContextQueryPort({
      results: [
        {
          path: 'src/top',
          level: 'L2',
          parts: [{ part: 'documentation', filePath: 'src/top/README.md', excerpt: 'short' }],
          relevanceScore: 1,
          coverageScore: 1,
        },
        {
          path: 'src/second',
          level: 'L2',
          parts: [{ part: 'documentation', filePath: 'src/second/README.md', excerpt: longExcerpt }],
          relevanceScore: 0.5,
          coverageScore: 1,
        },
      ],
      mode: 'production',
    });
    const { tools } = makeTools({ queryPort: port });
    const result = await tools.contextQueryHandler({ query: 'q' });
    const text = result.content[0].text;

    // Find the second result's excerpt line and check it's no longer than the cap + prefix
    const lines = text.split('\n');
    const secondResultIdx = lines.findIndex((l) => l.includes('2. src/second'));
    const excerptLine = lines.slice(secondResultIdx).find((l) => l.includes('     > '))!;
    const xCount = (excerptLine.match(/x/g) ?? []).length;
    expect(xCount).toBeLessThanOrEqual(120);
  });

  it('top-1 total rendered chars stay within TOP_TOTAL_RENDER_LIMIT', async () => {
    // Build a top-1 with many parts whose excerpts (combined) would exceed 1800 chars
    const longParts = Array.from({ length: 8 }, (_, i) => ({
      part: 'documentation' as const,
      filePath: `src/top/p${i}.md`,
      excerpt: 'y'.repeat(500),
    }));
    const port = new RecordingContextQueryPort({
      results: [
        {
          path: 'src/top',
          level: 'L2',
          parts: longParts,
          relevanceScore: 1,
          coverageScore: 1,
        },
      ],
      mode: 'production',
    });
    const { tools } = makeTools({ queryPort: port });
    const result = await tools.contextQueryHandler({ query: 'q' });
    const text = result.content[0].text;

    // Sum the y characters across all rendered excerpt lines for the top result.
    // Bound by TOP_TOTAL_RENDER_LIMIT (1400 chars across all parts of the top result).
    const yChars = (text.match(/y/g) ?? []).length;
    expect(yChars).toBeLessThanOrEqual(1400);
  });

  it('parts with no excerpt render the part header but no body line', async () => {
    const port = new RecordingContextQueryPort({
      results: [
        {
          path: 'src/top',
          level: 'L2',
          parts: [
            { part: 'port', filePath: 'src/top/ports/p.ts' }, // no excerpt
            { part: 'documentation', filePath: 'src/top/README.md', excerpt: 'hello' },
          ],
          relevanceScore: 1,
          coverageScore: 1,
        },
      ],
      mode: 'production',
    });
    const { tools } = makeTools({ queryPort: port });
    const result = await tools.contextQueryHandler({ query: 'q' });
    const text = result.content[0].text;

    // The port part should appear without an excerpt line
    expect(text).toContain('   port: src/top/ports/p.ts');
    // The documentation part should appear with the | prefix (top-1)
    expect(text).toContain('     | hello');
  });
});

describe('coverage_check handler', () => {
  it('calls port with the provided projectRoot', async () => {
    const { tools, coveragePort } = makeTools();
    await tools.coverageCheckHandler({ projectRoot: '/my/project' });
    coveragePort.assertCallCount(1);
    expect(coveragePort.calls[0].projectRoot).toBe('/my/project');
  });

  it('uses default projectRoot when not provided', async () => {
    const { tools, coveragePort } = makeTools();
    await tools.coverageCheckHandler({});
    coveragePort.assertCallCount(1);
    expect(coveragePort.calls[0].projectRoot).toBe('/default-root');
  });

  it('formats report as text containing [mode: and Coverage:', async () => {
    const { tools } = makeTools();
    const result = await tools.coverageCheckHandler({});
    expect(result.content[0].text).toMatch(/\[mode:/);
    expect(result.content[0].text).toContain('Coverage:');
  });

  it('INDEX_NOT_FOUND returns user-friendly error message', async () => {
    const errorPort = new RecordingCoverageReportPort();
    (errorPort as unknown as { getReport: unknown }).getReport = async () => {
      throw new CoverageReportError('No index found', 'INDEX_NOT_FOUND');
    };
    const { tools } = makeTools({ coveragePort: errorPort });
    const result = await tools.coverageCheckHandler({});
    expect(result.content[0].text).toContain('INDEX_NOT_FOUND');
  });
});

describe('context_detail handler', () => {
  it('calls port with correct path and projectRoot', async () => {
    const { tools, detailPort } = makeTools();
    await tools.contextDetailHandler({ path: 'src/auth', projectRoot: '/my/project' });
    detailPort.assertCallCount(1);
    expect(detailPort.calls[0].path).toBe('src/auth');
    expect(detailPort.calls[0].projectRoot).toBe('/my/project');
  });

  it('uses default projectRoot when not provided', async () => {
    const { tools, detailPort } = makeTools();
    await tools.contextDetailHandler({ path: 'src/auth' });
    detailPort.assertCallCount(1);
    expect(detailPort.calls[0].projectRoot).toBe('/default-root');
  });

  it('formats result as text starting with path:', async () => {
    const { tools } = makeTools();
    const result = await tools.contextDetailHandler({ path: 'src/auth' });
    expect(result.content[0].text).toMatch(/^path:/);
  });

  it('NOT_FOUND returns user-friendly error message', async () => {
    const notFoundPort = new RecordingComponentDetailPort({ notFound: true });
    const { tools } = makeTools({ detailPort: notFoundPort });
    const result = await tools.contextDetailHandler({ path: 'does/not/exist' });
    expect(result.content[0].text).toContain('NOT_FOUND');
  });

  it('INDEX_NOT_FOUND returns user-friendly error message', async () => {
    const errorPort = new RecordingComponentDetailPort();
    (errorPort as unknown as { getDetail: unknown }).getDetail = async () => {
      throw new ComponentDetailError('No index found', 'INDEX_NOT_FOUND');
    };
    const { tools } = makeTools({ detailPort: errorPort });
    const result = await tools.contextDetailHandler({ path: 'src/auth' });
    expect(result.content[0].text).toContain('INDEX_NOT_FOUND');
  });

  it('missing path returns INVALID_INPUT error', async () => {
    const { tools } = makeTools();
    const result = await tools.contextDetailHandler({});
    expect(result.content[0].text).toContain('INVALID_INPUT');
  });
});
