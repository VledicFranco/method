/**
 * PRD 019.2: Registry Frontend Smoke Tests
 *
 * Validates the registry API responses have the shape expected by frontend components.
 * These are integration tests that verify the API contract the frontend depends on.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerRegistryRoutes } from './routes.js';

process.env.REGISTRY_DIR = 'registry';
process.env.MANIFEST_PATH = '.method/manifest.yaml';
process.env.REGISTRY_CACHE_TTL_MS = '0';

async function createTestApp() {
  const app = Fastify({ logger: false });
  registerRegistryRoutes(app);
  await app.ready();
  return app;
}

describe('Registry API contract for frontend', () => {
  it('tree response has shape expected by RegistryTree component', async () => {
    const app = await createTestApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/registry' });
      const body = JSON.parse(res.body);

      // RegistryTree expects: methodologies[].id, .name, .method_count, .methods[]
      for (const m of body.methodologies) {
        assert.ok(typeof m.id === 'string', `methodology ${m.id} has string id`);
        assert.ok(typeof m.name === 'string', `methodology ${m.id} has string name`);
        assert.ok(typeof m.method_count === 'number', `methodology ${m.id} has number method_count`);
        assert.ok(Array.isArray(m.methods), `methodology ${m.id} has array methods`);

        for (const method of m.methods) {
          assert.ok(typeof method.id === 'string', `method has string id`);
          assert.ok(typeof method.name === 'string', `method has string name`);
          assert.ok(typeof method.version === 'string', `method has string version`);
          assert.ok(typeof method.status === 'string', `method has string status`);
          assert.ok(['method', 'protocol'].includes(method.type), `method has valid type`);
          assert.ok(typeof method.wip_count === 'number', `method has number wip_count`);
        }
      }

      // Totals shape
      assert.ok(typeof body.totals.methodologies === 'number');
      assert.ok(typeof body.totals.methods === 'number');
      assert.ok(typeof body.totals.protocols === 'number');
    } finally {
      await app.close();
    }
  });

  it('method detail has shape expected by MethodDetail component', async () => {
    const app = await createTestApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/registry/P1-EXEC/M1-COUNCIL',
      });
      const body = JSON.parse(res.body);

      // MethodDetail expects: method.id, navigation, domain_theory, phases, compilation_record, known_wip
      assert.ok(body.method?.id, 'has method.id');
      assert.ok(body.method?.name, 'has method.name');
      assert.ok(body.method?.version, 'has method.version');
      assert.ok(body.method?.status, 'has method.status');

      // Navigation tab
      assert.ok(body.navigation, 'has navigation');
      assert.ok(typeof body.navigation.what === 'string', 'navigation.what is string');

      // Domain theory tab
      assert.ok(body.domain_theory, 'has domain_theory');
      assert.ok(Array.isArray(body.domain_theory.sorts), 'domain_theory.sorts is array');
      assert.ok(Array.isArray(body.domain_theory.predicates), 'domain_theory.predicates is array');
      assert.ok(Array.isArray(body.domain_theory.axioms), 'domain_theory.axioms is array');

      // Steps tab
      assert.ok(body.phases || body.step_dag, 'has phases or step_dag');
      if (body.phases) {
        assert.ok(Array.isArray(body.phases), 'phases is array');
        assert.ok(body.phases[0]?.id, 'first phase has id');
        assert.ok(body.phases[0]?.name, 'first phase has name');
      }

      // Compilation tab
      assert.ok(body.compilation_record, 'has compilation_record');
      assert.ok(Array.isArray(body.compilation_record.gates), 'gates is array');
      const gate = body.compilation_record.gates[0];
      assert.ok(gate.gate, 'gate has gate field');
      assert.ok(gate.result, 'gate has result field');

      // Known WIP tab
      assert.ok(Array.isArray(body.known_wip), 'has known_wip array');
    } finally {
      await app.close();
    }
  });

  it('protocol detail has shape expected by protocol view', async () => {
    const app = await createTestApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/registry/P0-META/STEER-PROTO',
      });
      const body = JSON.parse(res.body);

      assert.ok(body.protocol, 'has protocol key');
      assert.ok(body.protocol.id, 'has protocol.id');
      assert.ok(body.protocol.name, 'has protocol.name');
      assert.ok(body.protocol.status, 'has protocol.status');
      assert.ok(body.protocol.installation, 'has protocol.installation');
      assert.ok(Array.isArray(body.protocol.installation.artifacts), 'installation.artifacts is array');
    } finally {
      await app.close();
    }
  });

  it('manifest response has shape expected by ManifestView', async () => {
    const app = await createTestApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/registry/manifest',
      });
      const body = JSON.parse(res.body);

      assert.ok(typeof body.project === 'string', 'has project');
      assert.ok(typeof body.last_updated === 'string', 'has last_updated');
      assert.ok(Array.isArray(body.installed), 'has installed array');

      for (const entry of body.installed) {
        assert.ok(typeof entry.id === 'string', 'entry has id');
        assert.ok(typeof entry.type === 'string', 'entry has type');
        assert.ok(typeof entry.version === 'string', 'entry has version');
        assert.ok(
          ['current', 'outdated', 'ahead', 'not_found'].includes(entry.sync_status),
          `entry ${entry.id} has valid sync_status: ${entry.sync_status}`,
        );
        assert.ok(Array.isArray(entry.artifacts), 'entry has artifacts array');
      }
    } finally {
      await app.close();
    }
  });
});
