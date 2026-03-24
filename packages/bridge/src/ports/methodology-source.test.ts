/**
 * MethodologySource port tests.
 *
 * Tests both implementations:
 * 1. StdlibSource — production implementation backed by @method/methodts stdlib
 * 2. InMemorySource — test implementation proving port substitutability (WS-1 SC-6)
 *
 * The key test: any consumer code that takes a MethodologySource can work with
 * either implementation, proving the interface is a real seam.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { MethodologySource } from './methodology-source.js';
import { StdlibSource } from './stdlib-source.js';
import { InMemorySource } from './in-memory-source.js';
import type { CatalogMethodologyEntry } from '@method/methodts/stdlib';

// ── Shared contract tests (run against any MethodologySource) ──

function runContractTests(name: string, createSource: () => MethodologySource) {
  describe(`MethodologySource contract: ${name}`, () => {
    it('list() returns an array', () => {
      const source = createSource();
      const result = source.list();
      assert.ok(Array.isArray(result), 'list() should return an array');
    });

    it('list() entries have required fields', () => {
      const source = createSource();
      const result = source.list();
      for (const entry of result) {
        assert.ok(typeof entry.methodologyId === 'string', 'methodologyId should be string');
        assert.ok(typeof entry.name === 'string', 'name should be string');
        assert.ok(Array.isArray(entry.methods), 'methods should be array');
      }
    });

    it('getMethodology returns undefined for unknown ID', () => {
      const source = createSource();
      const result = source.getMethodology('NONEXISTENT-999');
      assert.strictEqual(result, undefined);
    });

    it('getMethod returns undefined for unknown method', () => {
      const source = createSource();
      const result = source.getMethod('NONEXISTENT-999', 'M1-FAKE');
      assert.strictEqual(result, undefined);
    });
  });
}

// ── StdlibSource tests ──

runContractTests('StdlibSource', () => new StdlibSource());

describe('StdlibSource — production specifics', () => {
  it('list() includes P0-META, P1-EXEC, and P2-SD', () => {
    const source = new StdlibSource();
    const ids = source.list().map(e => e.methodologyId);
    assert.ok(ids.includes('P0-META'), 'should include P0-META');
    assert.ok(ids.includes('P1-EXEC'), 'should include P1-EXEC');
    assert.ok(ids.includes('P2-SD'), 'should include P2-SD');
  });

  it('getMethodology returns P2-SD with arms', () => {
    const source = new StdlibSource();
    const p2 = source.getMethodology('P2-SD');
    assert.ok(p2 !== undefined, 'P2-SD should exist');
    assert.strictEqual(p2!.id, 'P2-SD');
    assert.ok(p2!.arms.length > 0, 'P2-SD should have routing arms');
  });

  it('getMethod returns M1-IMPL from P2-SD', () => {
    const source = new StdlibSource();
    const method = source.getMethod('P2-SD', 'M1-IMPL');
    assert.ok(method !== undefined, 'M1-IMPL should exist');
    assert.strictEqual(method!.id, 'M1-IMPL');
    assert.ok(method!.dag !== undefined, 'method should have a DAG');
  });

  it('StdlibSource returns same data as direct stdlib calls', async () => {
    // Equivalence test: StdlibSource must return identical data to direct imports
    const { getStdlibCatalog, getMethod, getMethodology } = await import('@method/methodts/stdlib');
    const source = new StdlibSource();

    const directCatalog = getStdlibCatalog();
    const portCatalog = source.list();
    assert.deepStrictEqual(portCatalog, directCatalog, 'catalog should be identical');

    const directMethod = getMethod('P2-SD', 'M1-IMPL');
    const portMethod = source.getMethod('P2-SD', 'M1-IMPL');
    assert.strictEqual(portMethod, directMethod, 'should be the same object reference');

    const directMethodology = getMethodology('P2-SD');
    const portMethodology = source.getMethodology('P2-SD');
    assert.strictEqual(portMethodology, directMethodology, 'should be the same object reference');
  });
});

// ── InMemorySource tests ──

const testCatalog: CatalogMethodologyEntry[] = [
  {
    methodologyId: 'TEST-M1',
    name: 'Test Methodology',
    description: 'A test methodology for port substitutability',
    version: '1.0',
    status: 'compiled',
    methods: [
      {
        methodId: 'M1-TEST',
        name: 'Test Method',
        description: 'A test method',
        stepCount: 2,
        status: 'compiled' as const,
        version: '1.0',
      },
    ],
  },
];

runContractTests('InMemorySource', () => new InMemorySource(testCatalog));

describe('InMemorySource — substitutability proof', () => {
  it('list() returns the injected catalog', () => {
    const source = new InMemorySource(testCatalog);
    const result = source.list();
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].methodologyId, 'TEST-M1');
  });

  it('empty source returns empty list and undefined lookups', () => {
    const source = new InMemorySource([]);
    assert.strictEqual(source.list().length, 0);
    assert.strictEqual(source.getMethod('X', 'Y'), undefined);
    assert.strictEqual(source.getMethodology('X'), undefined);
  });

  it('consumer code works identically with either implementation', () => {
    // This test proves substitutability: a function that accepts MethodologySource
    // works with both StdlibSource and InMemorySource
    function countMethods(source: MethodologySource): number {
      return source.list().reduce((sum, m) => sum + m.methods.length, 0);
    }

    const stdlib = new StdlibSource();
    const inMem = new InMemorySource(testCatalog);

    const stdlibCount = countMethods(stdlib);
    const inMemCount = countMethods(inMem);

    assert.ok(stdlibCount > 20, `StdlibSource should have many methods (got ${stdlibCount})`);
    assert.strictEqual(inMemCount, 1, 'InMemorySource should have 1 method');
  });
});
