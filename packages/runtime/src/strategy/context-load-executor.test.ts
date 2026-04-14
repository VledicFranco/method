/**
 * context-load-executor.test.ts
 *
 * Unit tests for ContextLoadExecutorImpl — the bridge adapter that implements
 * the ContextLoadExecutor port (methodts) by delegating to ContextQueryPort (fca-index).
 *
 * Validates:
 * - ComponentContext → RetrievedComponent mapping (relevanceScore → score, docText synthesis)
 * - docText priority order: documentation > interface > port > domain > ...
 * - filterParts is forwarded to queryPort as `parts`
 * - INDEX_NOT_FOUND from ContextQueryPort → ContextLoadError INDEX_NOT_FOUND
 * - Other ContextQueryError codes → ContextLoadError QUERY_FAILED
 * - queryTime and mode are propagated
 */

import { describe, it, expect, vi } from 'vitest';
import { ContextLoadExecutorImpl } from './context-load-executor.js';
import type {
  ContextQueryPort,
  ContextQueryResult,
  ComponentContext,
} from '@method/fca-index';
import { ContextQueryError } from '@method/fca-index';
import type { ContextLoadNodeConfig } from '@method/methodts/strategy/dag-types.js';
import { ContextLoadError } from '@method/methodts/strategy/dag-executor.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<ContextLoadNodeConfig>): ContextLoadNodeConfig {
  return {
    type: 'context-load',
    query: 'strategy executor',
    topK: 5,
    output_key: 'ctx',
    ...overrides,
  };
}

function makeMockPort(result: ContextQueryResult): ContextQueryPort {
  return { query: vi.fn().mockResolvedValue(result) };
}

function makeMockPortRejecting(err: unknown): ContextQueryPort {
  return { query: vi.fn().mockRejectedValue(err) };
}

function makeComponent(
  path: string,
  parts: ComponentContext['parts'],
  opts?: { relevance?: number; coverage?: number; level?: ComponentContext['level'] },
): ComponentContext {
  return {
    path,
    level: opts?.level ?? 'L2',
    parts,
    relevanceScore: opts?.relevance ?? 0.9,
    coverageScore: opts?.coverage ?? 0.7,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ContextLoadExecutorImpl: mapping', () => {
  it('maps relevanceScore to score and returns queryTime + mode', async () => {
    const port = makeMockPort({
      mode: 'production',
      results: [
        makeComponent(
          'packages/bridge/src/domains/strategies',
          [{ part: 'port', filePath: 'port.ts', excerpt: 'interface X {}' }],
          { relevance: 0.88, coverage: 0.6 },
        ),
      ],
    });

    const impl = new ContextLoadExecutorImpl(port);
    const result = await impl.executeContextLoad(makeConfig(), '/root');

    expect(result.mode).toBe('production');
    expect(typeof result.queryTime).toBe('number');
    expect(result.queryTime).toBeGreaterThanOrEqual(0);
    expect(result.components).toHaveLength(1);
    expect(result.components[0].path).toBe('packages/bridge/src/domains/strategies');
    expect(result.components[0].level).toBe('L2');
    expect(result.components[0].score).toBe(0.88);
    expect(result.components[0].coverageScore).toBe(0.6);
  });

  it('forwards filterParts to queryPort as parts', async () => {
    const port = makeMockPort({ mode: 'production', results: [] });
    const impl = new ContextLoadExecutorImpl(port);

    await impl.executeContextLoad(
      makeConfig({ filterParts: ['port', 'interface'] }),
      '/root',
    );

    expect(port.query).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'strategy executor',
        topK: 5,
        parts: ['port', 'interface'],
      }),
    );
  });
});

describe('ContextLoadExecutorImpl: docText synthesis', () => {
  it('prioritises documentation > interface > port in the synthesised docText', async () => {
    const port = makeMockPort({
      mode: 'production',
      results: [
        makeComponent('packages/x', [
          { part: 'port', filePath: 'p.ts', excerpt: 'PORT-EXCERPT' },
          { part: 'interface', filePath: 'i.ts', excerpt: 'INTERFACE-EXCERPT' },
          { part: 'documentation', filePath: 'README.md', excerpt: 'DOC-EXCERPT' },
        ]),
      ],
    });

    const impl = new ContextLoadExecutorImpl(port);
    const result = await impl.executeContextLoad(makeConfig(), '/root');

    const docText = result.components[0].docText;
    const docIdx = docText.indexOf('DOC-EXCERPT');
    const ifaceIdx = docText.indexOf('INTERFACE-EXCERPT');
    const portIdx = docText.indexOf('PORT-EXCERPT');

    expect(docIdx).toBeGreaterThanOrEqual(0);
    expect(ifaceIdx).toBeGreaterThan(docIdx);
    expect(portIdx).toBeGreaterThan(ifaceIdx);
    expect(docText).toContain('[documentation]');
    expect(docText).toContain('[interface]');
    expect(docText).toContain('[port]');
  });

  it('falls back to path when no parts have excerpts', async () => {
    const port = makeMockPort({
      mode: 'production',
      results: [
        makeComponent('packages/empty', [
          { part: 'port', filePath: 'p.ts' }, // no excerpt
        ]),
      ],
    });

    const impl = new ContextLoadExecutorImpl(port);
    const result = await impl.executeContextLoad(makeConfig(), '/root');

    expect(result.components[0].docText).toBe('packages/empty');
  });
});

describe('ContextLoadExecutorImpl: error mapping', () => {
  it('maps ContextQueryError INDEX_NOT_FOUND → ContextLoadError INDEX_NOT_FOUND', async () => {
    const port = makeMockPortRejecting(
      new ContextQueryError('no index', 'INDEX_NOT_FOUND'),
    );
    const impl = new ContextLoadExecutorImpl(port);

    await expect(
      impl.executeContextLoad(makeConfig({ output_key: 'ctx_foo' }), '/root'),
    ).rejects.toMatchObject({
      code: 'INDEX_NOT_FOUND',
      nodeId: 'ctx_foo',
    });
  });

  it('maps other ContextQueryError codes → ContextLoadError QUERY_FAILED', async () => {
    const port = makeMockPortRejecting(
      new ContextQueryError('query exploded', 'QUERY_FAILED'),
    );
    const impl = new ContextLoadExecutorImpl(port);

    await expect(
      impl.executeContextLoad(makeConfig({ output_key: 'ctx_bar' }), '/root'),
    ).rejects.toMatchObject({
      code: 'QUERY_FAILED',
      nodeId: 'ctx_bar',
    });
  });

  it('wraps unknown errors as ContextLoadError QUERY_FAILED', async () => {
    const port = makeMockPortRejecting(new Error('network fried'));
    const impl = new ContextLoadExecutorImpl(port);

    const err = await impl
      .executeContextLoad(makeConfig({ output_key: 'ctx_baz' }), '/root')
      .catch((e) => e);

    expect(err).toBeInstanceOf(ContextLoadError);
    expect(err.code).toBe('QUERY_FAILED');
    expect(err.nodeId).toBe('ctx_baz');
    expect(err.message).toContain('network fried');
  });
});
