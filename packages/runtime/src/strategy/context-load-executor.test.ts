// SPDX-License-Identifier: Apache-2.0
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

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ContextLoadExecutorImpl } from './context-load-executor.js';
import type {
  ContextQueryPort,
  ContextQueryRequest,
  ContextQueryResult,
  ComponentContext,
} from '@fractal-co-design/fca-index';
import { ContextQueryError } from '@fractal-co-design/fca-index';
import type { ContextLoadNodeConfig } from '@methodts/methodts/strategy/dag-types.js';
import { ContextLoadError } from '@methodts/methodts/strategy/dag-executor.js';

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

interface RecordingPort extends ContextQueryPort {
  calls: ContextQueryRequest[];
}

function makeMockPort(result: ContextQueryResult): RecordingPort {
  const calls: ContextQueryRequest[] = [];
  return {
    calls,
    query: async (req) => {
      calls.push(req);
      return result;
    },
  };
}

function makeMockPortRejecting(err: unknown): ContextQueryPort {
  return {
    query: async () => {
      throw err;
    },
  };
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

    assert.equal(result.mode, 'production');
    assert.equal(typeof result.queryTime, 'number');
    assert.ok(result.queryTime >= 0);
    assert.equal(result.components.length, 1);
    assert.equal(result.components[0].path, 'packages/bridge/src/domains/strategies');
    assert.equal(result.components[0].level, 'L2');
    assert.equal(result.components[0].score, 0.88);
    assert.equal(result.components[0].coverageScore, 0.6);
  });

  it('forwards filterParts to queryPort as parts', async () => {
    const port = makeMockPort({ mode: 'production', results: [] });
    const impl = new ContextLoadExecutorImpl(port);

    await impl.executeContextLoad(
      makeConfig({ filterParts: ['port', 'interface'] }),
      '/root',
    );

    assert.equal(port.calls.length, 1);
    const call = port.calls[0];
    assert.equal(call.query, 'strategy executor');
    assert.equal(call.topK, 5);
    assert.deepEqual(call.parts, ['port', 'interface']);
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

    assert.ok(docIdx >= 0);
    assert.ok(ifaceIdx > docIdx);
    assert.ok(portIdx > ifaceIdx);
    assert.ok(docText.includes('[documentation]'));
    assert.ok(docText.includes('[interface]'));
    assert.ok(docText.includes('[port]'));
  });

  it('falls back to path when no parts have excerpts', async () => {
    const port = makeMockPort({
      mode: 'production',
      results: [
        makeComponent('packages/empty', [
          { part: 'port', filePath: 'p.ts' },
        ]),
      ],
    });

    const impl = new ContextLoadExecutorImpl(port);
    const result = await impl.executeContextLoad(makeConfig(), '/root');

    assert.equal(result.components[0].docText, 'packages/empty');
  });
});

describe('ContextLoadExecutorImpl: error mapping', () => {
  it('maps ContextQueryError INDEX_NOT_FOUND → ContextLoadError INDEX_NOT_FOUND', async () => {
    const port = makeMockPortRejecting(
      new ContextQueryError('no index', 'INDEX_NOT_FOUND'),
    );
    const impl = new ContextLoadExecutorImpl(port);

    await assert.rejects(
      () => impl.executeContextLoad(makeConfig({ output_key: 'ctx_foo' }), '/root'),
      (err: ContextLoadError) => {
        assert.equal(err.code, 'INDEX_NOT_FOUND');
        assert.equal(err.nodeId, 'ctx_foo');
        return true;
      },
    );
  });

  it('maps other ContextQueryError codes → ContextLoadError QUERY_FAILED', async () => {
    const port = makeMockPortRejecting(
      new ContextQueryError('query exploded', 'QUERY_FAILED'),
    );
    const impl = new ContextLoadExecutorImpl(port);

    await assert.rejects(
      () => impl.executeContextLoad(makeConfig({ output_key: 'ctx_bar' }), '/root'),
      (err: ContextLoadError) => {
        assert.equal(err.code, 'QUERY_FAILED');
        assert.equal(err.nodeId, 'ctx_bar');
        return true;
      },
    );
  });

  it('wraps unknown errors as ContextLoadError QUERY_FAILED', async () => {
    const port = makeMockPortRejecting(new Error('network fried'));
    const impl = new ContextLoadExecutorImpl(port);

    const err = await impl
      .executeContextLoad(makeConfig({ output_key: 'ctx_baz' }), '/root')
      .catch((e) => e);

    assert.ok(err instanceof ContextLoadError);
    assert.equal(err.code, 'QUERY_FAILED');
    assert.equal(err.nodeId, 'ctx_baz');
    assert.ok(err.message.includes('network fried'));
  });
});
