// SPDX-License-Identifier: Apache-2.0
/**
 * PRD 019.2: Registry API Endpoint Tests
 *
 * Tests the registry API endpoints. The tree and method detail endpoints
 * now serve from the @methodts/methodts stdlib catalog and metadata.
 * Manifest and promotion endpoints still use YAML files.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerRegistryRoutes } from './routes.js';

// Set env vars for registry paths before creating app
process.env.REGISTRY_DIR = 'registry';
process.env.MANIFEST_PATH = '.method/manifest.yaml';
process.env.REGISTRY_CACHE_TTL_MS = '0'; // Disable caching for tests

async function createTestApp() {
  const app = Fastify({ logger: false });
  registerRegistryRoutes(app);
  await app.ready();
  return app;
}

describe('GET /api/registry', () => {
  it('returns a tree with methodologies from stdlib catalog', async () => {
    const app = await createTestApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/registry',
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);

      assert.ok(body.methodologies, 'response should have methodologies');
      assert.ok(Array.isArray(body.methodologies), 'methodologies should be an array');
      assert.equal(body.methodologies.length, 6, 'should have exactly 6 stdlib methodologies');

      assert.ok(body.totals, 'response should have totals');
      assert.equal(body.totals.methodologies, 6);
      assert.ok(body.totals.methods >= 28, 'totals.methods >= 28');
      assert.ok(typeof body.cached_at === 'string', 'should have cached_at timestamp');
    } finally {
      await app.close();
    }
  });

  it('includes methods within each methodology', async () => {
    const app = await createTestApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/registry',
      });

      const body = JSON.parse(response.body);
      const p1Exec = body.methodologies.find((m: { id: string }) => m.id === 'P1-EXEC');
      assert.ok(p1Exec, 'should find P1-EXEC');
      assert.ok(p1Exec.methods.length >= 4, 'P1-EXEC should have at least 4 methods');

      const m1Council = p1Exec.methods.find((m: { id: string }) => m.id === 'M1-COUNCIL');
      assert.ok(m1Council, 'P1-EXEC should contain M1-COUNCIL');
      assert.equal(m1Council.type, 'method');
      assert.equal(m1Council.status, 'compiled');
    } finally {
      await app.close();
    }
  });

  it('includes all 6 methodologies from stdlib', async () => {
    const app = await createTestApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/registry',
      });

      const body = JSON.parse(response.body);
      const ids = body.methodologies.map((m: { id: string }) => m.id);
      assert.ok(ids.includes('P0-META'), 'should include P0-META');
      assert.ok(ids.includes('P1-EXEC'), 'should include P1-EXEC');
      assert.ok(ids.includes('P2-SD'), 'should include P2-SD');
      assert.ok(ids.includes('P-GH'), 'should include P-GH');
      assert.ok(ids.includes('P3-GOV'), 'should include P3-GOV');
      assert.ok(ids.includes('P3-DISPATCH'), 'should include P3-DISPATCH');
    } finally {
      await app.close();
    }
  });
});

describe('GET /api/registry/:methodology/:method', () => {
  it('returns method detail from stdlib metadata', async () => {
    const app = await createTestApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/registry/P1-EXEC/M1-COUNCIL',
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);

      assert.ok(body.method, 'should have method key');
      assert.equal(body.method.id, 'M1-COUNCIL');
      assert.ok(body.navigation, 'should have navigation');
      assert.ok(body.navigation.what, 'should have navigation.what');
      assert.ok(body.navigation.who, 'should have navigation.who');
      assert.ok(body.domain_theory, 'should have domain_theory');
      assert.ok(body.domain_theory.sorts, 'should have sorts');
      assert.ok(body.domain_theory.predicates, 'should have predicates');
      assert.ok(body.phases, 'should have phases');
      assert.ok(body.roles, 'should have roles');
    } finally {
      await app.close();
    }
  });

  it('includes compilation record when available', async () => {
    const app = await createTestApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/registry/P1-EXEC/M1-COUNCIL',
      });

      const body = JSON.parse(response.body);
      // M1-COUNCIL metadata includes compilation_record
      if (body.compilation_record) {
        assert.ok(body.compilation_record.gates, 'should have gates');
        assert.ok(Array.isArray(body.compilation_record.gates), 'gates should be an array');
      }
    } finally {
      await app.close();
    }
  });

  it('returns 404 for nonexistent method', async () => {
    const app = await createTestApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/registry/P1-EXEC/M99-FAKE',
      });

      assert.equal(response.statusCode, 404);
      const body = JSON.parse(response.body);
      assert.ok(body.error.includes('not found'));
    } finally {
      await app.close();
    }
  });

  it('returns method detail for all methodologies', async () => {
    const app = await createTestApp();
    try {
      const cases = [
        ['P0-META', 'M1-MDES'],
        ['P2-SD', 'M1-IMPL'],
        ['P-GH', 'M1-TRIAGE'],
        ['P3-GOV', 'M1-DRAFT'],
        ['P3-DISPATCH', 'M1-INTERACTIVE'],
      ];

      for (const [methodology, method] of cases) {
        const response = await app.inject({
          method: 'GET',
          url: `/api/registry/${methodology}/${method}`,
        });

        assert.equal(response.statusCode, 200, `${methodology}/${method} should return 200`);
        const body = JSON.parse(response.body);
        assert.ok(body.method || body.protocol, `${methodology}/${method} should have method or protocol`);
      }
    } finally {
      await app.close();
    }
  });
});

describe('GET /api/registry/manifest', () => {
  it('returns manifest response (may be empty if manifest not found from CWD)', async () => {
    const app = await createTestApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/registry/manifest',
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);

      // Manifest reading depends on CWD — may return 'unknown' if not found
      assert.ok(typeof body.project === 'string', 'should have project string');
      assert.ok(Array.isArray(body.installed), 'installed should be an array');
    } finally {
      await app.close();
    }
  });
});

describe('GET /api/registry/:methodology/:protocol/promotion', () => {
  it('returns 404 for nonexistent methodology', async () => {
    const app = await createTestApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/registry/P99-FAKE/FAKE-PROTO/promotion',
      });

      assert.equal(response.statusCode, 404);
    } finally {
      await app.close();
    }
  });
});

describe('POST /api/registry/reload', () => {
  it('invalidates cache and returns confirmation', async () => {
    const app = await createTestApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/registry/reload',
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.status, 'ok');
      assert.ok(body.message.includes('invalidated'));
    } finally {
      await app.close();
    }
  });
});
