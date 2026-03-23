/**
 * Unit tests for ProjectRegistry
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { InMemoryProjectRegistry, type MethodologySpec } from './project-registry.js';

const REGISTRY_PATH = path.join(process.cwd(), 'registry');

describe('InMemoryProjectRegistry', () => {
  let registry: InMemoryProjectRegistry;

  beforeEach(async () => {
    registry = new InMemoryProjectRegistry(REGISTRY_PATH);
  });

  describe('initialize', () => {
    it('initializes without throwing', async () => {
      await registry.initialize();
    });

    it('idempotent — can be called multiple times', async () => {
      await registry.initialize();
      await registry.initialize();
      await registry.initialize();

      const list = registry.list();
      assert.ok(list);
    });
  });

  describe('find', () => {
    beforeEach(async () => {
      await registry.initialize();
    });

    it('throws if registry not initialized', () => {
      const uninitRegistry = new InMemoryProjectRegistry(REGISTRY_PATH);
      assert.throws(() => uninitRegistry.find('any'), /Registry not initialized/);
    });

    it('returns undefined for non-existent specs', () => {
      const spec = registry.find('nonexistent-spec-that-does-not-exist-xyz');
      assert.equal(spec, undefined);
    });

    it('finds real specs from registry by ID', () => {
      const specs = registry.list();
      if (specs.length > 0) {
        const firstSpec = specs[0];
        const found = registry.find(firstSpec.id);
        assert.deepEqual(found, firstSpec);
      }
    });

    it('finds real specs from registry by name', () => {
      const specs = registry.list();
      const namedSpec = specs.find((s) => s.name);

      if (namedSpec) {
        const found = registry.find(namedSpec.name);
        assert.deepEqual(found, namedSpec);
      }
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      await registry.initialize();
    });

    it('returns array of specs', () => {
      const specs = registry.list();
      assert.ok(Array.isArray(specs));
    });

    it('does not return duplicate specs', () => {
      const specs = registry.list();
      const ids = specs.map((s) => s.id);
      const uniqueIds = new Set(ids);
      assert.equal(uniqueIds.size, ids.length);
    });

    it('all specs have required fields', () => {
      const specs = registry.list();
      specs.forEach((spec) => {
        assert.equal(typeof spec.id, 'string');
        assert.equal(typeof spec.name, 'string');
        assert.equal(typeof spec.version, 'string');
      });
    });

    it('throws if not initialized', () => {
      const uninitRegistry = new InMemoryProjectRegistry(REGISTRY_PATH);
      assert.throws(() => uninitRegistry.list(), /Registry not initialized/);
    });
  });

  describe('getByName', () => {
    beforeEach(async () => {
      await registry.initialize();
    });

    it('alias for find', () => {
      const specs = registry.list();
      if (specs.length > 0) {
        const spec = specs[0];
        assert.deepEqual(registry.getByName(spec.id), registry.find(spec.id));
      }
    });
  });

  describe('verify', () => {
    it('accepts valid spec', () => {
      const spec: MethodologySpec = {
        id: 'P1-TEST',
        name: 'Test Methodology',
        version: '1.0.0',
      };

      const result = registry.verify(spec);
      assert.equal(result.valid, true);
      assert.equal(result.errors.length, 0);
    });

    it('rejects spec with missing id', () => {
      const spec: any = {
        name: 'Test',
        version: '1.0.0',
      };

      const result = registry.verify(spec);
      assert.equal(result.valid, false);
      assert.ok(result.errors.includes('Missing or invalid field: id'));
    });

    it('rejects spec with missing name', () => {
      const spec: any = {
        id: 'P1-TEST',
        version: '1.0.0',
      };

      const result = registry.verify(spec);
      assert.equal(result.valid, false);
      assert.ok(result.errors.includes('Missing or invalid field: name'));
    });

    it('rejects spec with missing version', () => {
      const spec: any = {
        id: 'P1-TEST',
        name: 'Test',
      };

      const result = registry.verify(spec);
      assert.equal(result.valid, false);
      assert.ok(result.errors.includes('Missing or invalid field: version'));
    });

    it('warns on non-semver version', () => {
      const spec: MethodologySpec = {
        id: 'P1-TEST',
        name: 'Test',
        version: 'latest',
      };

      const result = registry.verify(spec);
      assert.equal(result.valid, true);
      assert.ok(result.warnings.length > 0);
    });

    it('accepts semver versions', () => {
      for (const version of ['1.0.0', '2.1.3', '0.0.1', '10.20.30']) {
        const spec: MethodologySpec = {
          id: 'P1-TEST',
          name: 'Test',
          version,
        };

        const result = registry.verify(spec);
        assert.equal(result.valid, true);
        assert.equal(result.warnings.length, 0);
      }
    });

    it('allows extra fields in spec', () => {
      const spec: MethodologySpec = {
        id: 'P1-TEST',
        name: 'Test',
        version: '1.0.0',
        description: 'Optional field',
        customField: 'allowed',
      };

      const result = registry.verify(spec);
      assert.equal(result.valid, true);
    });
  });
});
