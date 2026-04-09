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
