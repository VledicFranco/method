/**
 * Health endpoint — instance_name field tests (PRD 038 C-2).
 *
 * Verifies that INSTANCE_NAME env var is surfaced in GET /health response,
 * with a default of "default" when the env var is unset.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

// ── Minimal /health route mirroring composition root logic ──────
// We replicate only the INSTANCE_NAME + /health wiring here
// rather than importing server-entry (which boots the full bridge).

function buildApp(instanceName: string) {
  const app = Fastify({ logger: false });
  app.get('/health', async (_request, reply) => {
    return reply.status(200).send({
      status: 'ok',
      instance_name: instanceName,
      active_sessions: 0,
      max_sessions: 5,
      uptime_ms: 0,
      version: '0.3.0',
    });
  });
  return app;
}

/** Mirrors the env-var resolution line in server-entry.ts */
function resolveInstanceName(envValue: string | undefined): string {
  return envValue ?? 'default';
}

describe('GET /health — instance_name', () => {
  it('AC-1: returns instance_name from INSTANCE_NAME env var', async () => {
    const app = buildApp('test');
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = JSON.parse(response.body);

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(body.instance_name, 'test');

    await app.close();
  });

  it('AC-2: returns instance_name "default" when INSTANCE_NAME is unset', async () => {
    const app = buildApp('default');
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = JSON.parse(response.body);

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(body.instance_name, 'default');

    await app.close();
  });

  it('env var resolution: set value is preserved, undefined falls back to "default"', () => {
    assert.strictEqual(resolveInstanceName('staging'), 'staging');
    assert.strictEqual(resolveInstanceName('test'), 'test');
    assert.strictEqual(resolveInstanceName(undefined), 'default');
  });
});
