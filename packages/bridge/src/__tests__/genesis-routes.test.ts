/**
 * Test suite for Genesis HTTP Routes
 * Covers: GET /genesis/status, POST /genesis/prompt, DELETE /genesis/prompt
 * Tests session existence, error handling, input validation
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { describe } from 'node:test';
import type { FastifyInstance } from 'fastify';
import fastify from 'fastify';
import { registerGenesisRoutes, type GenesisRouteContext } from '../genesis-routes.js';
import type { SessionPool, SessionStatusInfo } from '../pool.js';

// ── Mock Session Pool ────

function createMockSessionPool(
  genesisSessionId?: string,
): SessionPool {
  return {
    status: (sessionId: string): SessionStatusInfo => {
      if (!genesisSessionId || sessionId !== genesisSessionId) {
        // Return a dummy status rather than undefined
        return {
          sessionId: 'invalid',
          nickname: 'invalid',
          purpose: null,
          status: 'dead',
          queueDepth: 0,
          promptCount: 0,
          lastActivityAt: new Date(),
          workdir: process.cwd(),
          chain: {
            parent_session_id: null,
            depth: 0,
            children: [],
            budget: { max_depth: 1, max_agents: 1, agents_spawned: 0 },
          },
          worktree: {
            isolation: 'shared' as const,
            worktree_path: null,
            worktree_branch: null,
            metals_available: false,
          },
          stale: false,
          waiting_for: null,
          mode: 'pty' as const,
          diagnostics: null,
        } as SessionStatusInfo;
      }

      return {
        sessionId,
        nickname: 'Genesis',
        purpose: 'Persistent project coordination',
        status: 'ready',
        queueDepth: 0,
        promptCount: 5,
        lastActivityAt: new Date(),
        workdir: process.cwd(),
        chain: {
          parent_session_id: null,
          depth: 0,
          children: [],
          budget: { max_depth: 1, max_agents: 1, agents_spawned: 0 },
        },
        worktree: {
          isolation: 'shared' as const,
          worktree_path: null,
          worktree_branch: null,
          metals_available: false,
        },
        stale: false,
        waiting_for: null,
        mode: 'pty' as const,
        diagnostics: null,
      } as SessionStatusInfo;
    },

    prompt: async (sessionId: string, prompt: string, timeoutMs?: number) => {
      if (!genesisSessionId || sessionId !== genesisSessionId) {
        throw new Error('Session not found');
      }

      return {
        output: `Genesis processed: ${prompt}`,
        timedOut: false,
      };
    },

    create: async () => { throw new Error('Not implemented'); },
    kill: () => { throw new Error('Not implemented'); },
    list: () => [],
    poolStats: () => { throw new Error('Not implemented'); },
    removeDead: () => 0,
    getChannels: () => { throw new Error('Not implemented'); },
    getSession: () => { throw new Error('Not implemented'); },
    checkStale: () => ({ stale: [], killed: [] }),
    childPids: () => [],
    setObservationHook: () => {},
  };
}

// ── Test Suite ────

describe('Genesis HTTP Routes', () => {
  test('GET /genesis/status: Returns session status when Genesis is running', async () => {
    const app: FastifyInstance = fastify();
    const genesisSessionId = 'genesis-session-123';
    const pool = createMockSessionPool(genesisSessionId) as SessionPool;

    await registerGenesisRoutes(app, {
      sessionPool: pool,
      genesisSessionId,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/genesis/status',
    });

    assert.strictEqual(response.statusCode, 200);
    const data = JSON.parse(response.body);
    assert.strictEqual(data.sessionId, genesisSessionId);
    assert.strictEqual(data.nickname, 'Genesis');
    assert.strictEqual(data.status, 'ready');

    await app.close();
  });

  test('GET /genesis/status: Returns 503 when Genesis not initialized', async () => {
    const app: FastifyInstance = fastify();
    const pool = createMockSessionPool() as SessionPool;

    await registerGenesisRoutes(app, {
      sessionPool: pool,
      genesisSessionId: null,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/genesis/status',
    });

    assert.strictEqual(response.statusCode, 503);
    const data = JSON.parse(response.body);
    assert.strictEqual(data.error, 'Genesis not running');

    await app.close();
  });

  test('GET /genesis/status: Returns 503 when session not found', async () => {
    const app: FastifyInstance = fastify();
    const pool = createMockSessionPool('different-session');

    await registerGenesisRoutes(app, {
      sessionPool: pool,
      genesisSessionId: 'genesis-session-123',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/genesis/status',
    });

    assert.strictEqual(response.statusCode, 503);
    const data = JSON.parse(response.body);
    assert.strictEqual(data.error, 'Genesis session lost');

    await app.close();
  });

  test('POST /genesis/prompt: Sends prompt to Genesis session', async () => {
    const app: FastifyInstance = fastify();
    const genesisSessionId = 'genesis-session-123';
    const pool = createMockSessionPool(genesisSessionId) as SessionPool;

    await registerGenesisRoutes(app, {
      sessionPool: pool,
      genesisSessionId,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/genesis/prompt',
      payload: { message: 'Observe current state' },
    });

    assert.strictEqual(response.statusCode, 200);
    const data = JSON.parse(response.body);
    assert.strictEqual(data.timedOut, false);
    assert(data.output.includes('Observe current state'));

    await app.close();
  });

  test('POST /genesis/prompt: Returns 400 for missing message', async () => {
    const app: FastifyInstance = fastify();
    const genesisSessionId = 'genesis-session-123';
    const pool = createMockSessionPool(genesisSessionId) as SessionPool;

    await registerGenesisRoutes(app, {
      sessionPool: pool,
      genesisSessionId,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/genesis/prompt',
      payload: {},
    });

    assert.strictEqual(response.statusCode, 400);
    const data = JSON.parse(response.body);
    assert.strictEqual(data.error, 'Invalid request');

    await app.close();
  });

  test('POST /genesis/prompt: Returns 400 for empty message', async () => {
    const app: FastifyInstance = fastify();
    const genesisSessionId = 'genesis-session-123';
    const pool = createMockSessionPool(genesisSessionId) as SessionPool;

    await registerGenesisRoutes(app, {
      sessionPool: pool,
      genesisSessionId,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/genesis/prompt',
      payload: { message: '' },
    });

    assert.strictEqual(response.statusCode, 400);
    const data = JSON.parse(response.body);
    assert.strictEqual(data.error, 'Invalid request');

    await app.close();
  });

  test('POST /genesis/prompt: Returns 400 for whitespace-only message', async () => {
    const app: FastifyInstance = fastify();
    const genesisSessionId = 'genesis-session-123';
    const pool = createMockSessionPool(genesisSessionId) as SessionPool;

    await registerGenesisRoutes(app, {
      sessionPool: pool,
      genesisSessionId,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/genesis/prompt',
      payload: { message: '   ' },
    });

    assert.strictEqual(response.statusCode, 400);

    await app.close();
  });

  test('POST /genesis/prompt: Returns 503 when Genesis not initialized', async () => {
    const app: FastifyInstance = fastify();
    const pool = createMockSessionPool() as SessionPool;

    await registerGenesisRoutes(app, {
      sessionPool: pool,
      genesisSessionId: null,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/genesis/prompt',
      payload: { message: 'Test prompt' },
    });

    assert.strictEqual(response.statusCode, 503);

    await app.close();
  });

  test('POST /genesis/prompt: Accepts optional timeoutMs parameter', async () => {
    const app: FastifyInstance = fastify();
    const genesisSessionId = 'genesis-session-123';
    const pool = createMockSessionPool(genesisSessionId) as SessionPool;

    await registerGenesisRoutes(app, {
      sessionPool: pool,
      genesisSessionId,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/genesis/prompt',
      payload: { message: 'Test', timeoutMs: 5000 },
    });

    assert.strictEqual(response.statusCode, 200);

    await app.close();
  });

  test('DELETE /genesis/prompt: Aborts in-flight prompt', async () => {
    const app: FastifyInstance = fastify();
    const genesisSessionId = 'genesis-session-123';
    const pool = createMockSessionPool(genesisSessionId) as SessionPool;

    await registerGenesisRoutes(app, {
      sessionPool: pool,
      genesisSessionId,
    });

    const response = await app.inject({
      method: 'DELETE',
      url: '/genesis/prompt',
    });

    assert.strictEqual(response.statusCode, 200);
    const data = JSON.parse(response.body);
    assert.strictEqual(data.aborted, true);

    await app.close();
  });

  test('DELETE /genesis/prompt: Returns 503 when Genesis not initialized', async () => {
    const app: FastifyInstance = fastify();
    const pool = createMockSessionPool() as SessionPool;

    await registerGenesisRoutes(app, {
      sessionPool: pool,
      genesisSessionId: null,
    });

    const response = await app.inject({
      method: 'DELETE',
      url: '/genesis/prompt',
    });

    assert.strictEqual(response.statusCode, 503);

    await app.close();
  });

  test('POST /genesis/prompt: Trims whitespace from message', async () => {
    const app: FastifyInstance = fastify();
    const genesisSessionId = 'genesis-session-123';
    const pool = createMockSessionPool(genesisSessionId) as SessionPool;

    await registerGenesisRoutes(app, {
      sessionPool: pool,
      genesisSessionId,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/genesis/prompt',
      payload: { message: '  Test with whitespace  ' },
    });

    assert.strictEqual(response.statusCode, 200);
    const data = JSON.parse(response.body);
    assert(data.output.includes('Test with whitespace'));

    await app.close();
  });
});
