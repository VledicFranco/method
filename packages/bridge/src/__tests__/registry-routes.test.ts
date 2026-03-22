/**
 * PRD 019.2: Registry API Endpoint Tests
 *
 * Tests the registry scanning, method detail resolution, and manifest endpoints.
 * Uses real YAML files from the project's registry/ directory as fixtures (DR-09).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerRegistryRoutes } from '../registry-routes.js';

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
  it('returns a tree with methodologies', async () => {
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
      assert.ok(body.methodologies.length >= 3, 'should find at least 3 methodologies (P0-META, P1-EXEC, P2-SD)');

      assert.ok(body.totals, 'response should have totals');
      assert.ok(body.totals.methodologies >= 3, 'totals.methodologies >= 3');
      assert.ok(body.totals.methods >= 10, 'totals.methods >= 10');
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

  it('includes protocols identified by YAML content', async () => {
    const app = await createTestApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/registry',
      });

      const body = JSON.parse(response.body);
      const p0Meta = body.methodologies.find((m: { id: string }) => m.id === 'P0-META');
      assert.ok(p0Meta, 'should find P0-META');

      const retroProto = p0Meta.methods.find((m: { id: string }) => m.id === 'RETRO-PROTO');
      assert.ok(retroProto, 'P0-META should contain RETRO-PROTO');
      assert.equal(retroProto.type, 'protocol');

      const steerProto = p0Meta.methods.find((m: { id: string }) => m.id === 'STEER-PROTO');
      assert.ok(steerProto, 'P0-META should contain STEER-PROTO');
      assert.equal(steerProto.type, 'protocol');
    } finally {
      await app.close();
    }
  });

  it('skips non-methodology directories (instances, submissions)', async () => {
    const app = await createTestApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/registry',
      });

      const body = JSON.parse(response.body);
      const ids = body.methodologies.map((m: { id: string }) => m.id);
      assert.ok(!ids.includes('instances'), 'should not include instances directory');
      assert.ok(!ids.includes('submissions'), 'should not include submissions directory');
    } finally {
      await app.close();
    }
  });
});

describe('GET /api/registry/:methodology/:method', () => {
  it('returns full parsed method YAML', async () => {
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
      assert.ok(body.domain_theory, 'should have domain_theory');
      assert.ok(body.compilation_record, 'should have compilation_record');
      assert.ok(body.compilation_record.gates, 'should have gates');
      assert.ok(body.compilation_record.gates.length >= 7, 'should have at least 7 gates');
    } finally {
      await app.close();
    }
  });

  it('resolves protocol files by ID', async () => {
    const app = await createTestApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/registry/P0-META/RETRO-PROTO',
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);

      assert.ok(body.protocol, 'should have protocol key');
      assert.equal(body.protocol.id, 'RETRO-PROTO');
      assert.equal(body.protocol.status, 'promoted');
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
});

describe('GET /api/registry/manifest', () => {
  it('returns installed methodologies with sync status', async () => {
    const app = await createTestApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/registry/manifest',
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);

      assert.equal(body.project, 'pv-method');
      assert.ok(body.installed, 'should have installed');
      assert.ok(Array.isArray(body.installed), 'installed should be an array');
      assert.ok(body.installed.length >= 2, 'should have at least 2 installed items');

      // Check that P2-SD is present
      const p2Sd = body.installed.find((e: { id: string }) => e.id === 'P2-SD');
      assert.ok(p2Sd, 'should include P2-SD');
      assert.equal(p2Sd.type, 'methodology');
      assert.ok(['current', 'outdated', 'ahead'].includes(p2Sd.sync_status), 'should have sync_status');

      // Check that RETRO-PROTO is present
      const retroProto = body.installed.find((e: { id: string }) => e.id === 'RETRO-PROTO');
      assert.ok(retroProto, 'should include RETRO-PROTO');
      assert.equal(retroProto.type, 'protocol');
    } finally {
      await app.close();
    }
  });
});

describe('GET /api/registry/:methodology/:protocol/promotion', () => {
  it('resolves promotion file for RETRO-PROTO', async () => {
    const app = await createTestApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/registry/P0-META/RETRO-PROTO/promotion',
      });

      // The promotion file exists (RETRO-PROTO-PROMOTION.yaml).
      // It may return 200 (valid YAML) or 422 (YAML parse error in the refinements section).
      // Either way, a 404 would indicate a file resolution problem.
      assert.ok(
        response.statusCode === 200 || response.statusCode === 422,
        `expected 200 or 422, got ${response.statusCode}`,
      );

      if (response.statusCode === 200) {
        const body = JSON.parse(response.body);
        assert.ok(body.proposal, 'should have proposal key');
        assert.equal(body.proposal.id, 'RETRO-PROTO-PROMOTION');
        assert.ok(body.proposal.criteria_met, 'should have criteria_met');
        assert.ok(Array.isArray(body.proposal.criteria_met), 'criteria_met should be an array');
      }

      if (response.statusCode === 422) {
        const body = JSON.parse(response.body);
        assert.equal(body.error, 'YAML parse error');
        assert.ok(body.message, 'should include parse error message');
      }
    } finally {
      await app.close();
    }
  });

  it('returns 404 for protocol without promotion record', async () => {
    const app = await createTestApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/registry/P0-META/STEER-PROTO/promotion',
      });

      assert.equal(response.statusCode, 404);
      const body = JSON.parse(response.body);
      assert.ok(body.error.includes('not found'));
    } finally {
      await app.close();
    }
  });

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
