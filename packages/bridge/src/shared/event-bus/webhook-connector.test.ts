/**
 * Unit tests for WebhookConnector (PRD 026 Phase 5).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebhookConnector } from './webhook-connector.js';
import type { BridgeEvent } from '../../ports/event-bus.js';

// ── Test helpers ───────────────────────────────────────────────

function makeEvent(seq: number, overrides: Partial<BridgeEvent> = {}): BridgeEvent {
  return {
    id: `evt-${seq}`,
    version: 1,
    timestamp: new Date().toISOString(),
    sequence: seq,
    domain: 'session',
    type: 'session.spawned',
    severity: 'info',
    payload: { test: true },
    source: 'test',
    ...overrides,
  };
}

/** Create a simple HTTP server that records received requests. */
function createMockServer(): {
  server: Server;
  port: number;
  requests: Array<{ method: string; body: string; headers: Record<string, string | string[] | undefined> }>;
  setStatus: (code: number) => void;
  start: () => Promise<number>;
  stop: () => Promise<void>;
} {
  const requests: Array<{ method: string; body: string; headers: Record<string, string | string[] | undefined> }> = [];
  let statusCode = 200;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({
        method: req.method ?? 'UNKNOWN',
        body: Buffer.concat(chunks).toString('utf-8'),
        headers: req.headers as Record<string, string | string[] | undefined>,
      });
      res.writeHead(statusCode);
      res.end();
    });
  });

  return {
    server,
    port: 0,
    requests,
    setStatus: (code: number) => { statusCode = code; },
    start: () => new Promise<number>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve(port);
      });
    }),
    stop: () => new Promise<void>((resolve) => {
      server.close(() => resolve());
    }),
  };
}

// ── Tests ──────────────────────────────────────────────────────

describe('WebhookConnector', () => {
  let mock: ReturnType<typeof createMockServer>;
  let connector: WebhookConnector;

  beforeEach(async () => {
    mock = createMockServer();
    const port = await mock.start();
    connector = new WebhookConnector({
      url: `http://127.0.0.1:${port}/events`,
      maxRetries: 1,
      retryBaseMs: 10, // Fast retries for tests
      timeoutMs: 2000,
    });
  });

  afterEach(async () => {
    await connector.disconnect();
    await mock.stop();
  });

  describe('connect / disconnect / health', () => {
    it('connect marks as connected when URL reachable', async () => {
      await connector.connect();
      const h = connector.health();
      assert.equal(h.connected, true);
      assert.equal(h.errorCount, 0);
      assert.equal(h.lastEventAt, null);
    });

    it('connect marks as not connected when URL unreachable', async () => {
      await mock.stop();
      const unreachable = new WebhookConnector({
        url: 'http://127.0.0.1:1/unreachable',
        timeoutMs: 100,
      });
      await unreachable.connect();
      assert.equal(unreachable.health().connected, false);
    });

    it('disconnect sets connected to false', async () => {
      await connector.connect();
      await connector.disconnect();
      assert.equal(connector.health().connected, false);
    });
  });

  describe('onEvent', () => {
    it('POSTs event as JSON to configured URL', async () => {
      await connector.connect();
      const event = makeEvent(1);
      connector.onEvent(event);

      // Wait for async POST
      await new Promise((r) => setTimeout(r, 200));

      // First request is HEAD from connect(), second is POST from onEvent
      const posts = mock.requests.filter((r) => r.method === 'POST');
      assert.equal(posts.length, 1);

      const body = JSON.parse(posts[0].body);
      assert.equal(body.id, 'evt-1');
      assert.equal(body.type, 'session.spawned');
      assert.equal(posts[0].headers['content-type'], 'application/json');
    });

    it('updates lastEventAt on successful POST', async () => {
      await connector.connect();
      connector.onEvent(makeEvent(1));
      await new Promise((r) => setTimeout(r, 200));

      const h = connector.health();
      assert.ok(h.lastEventAt !== null);
      assert.equal(h.errorCount, 0);
    });
  });

  describe('filtering', () => {
    it('skips events not matching filter', async () => {
      await mock.stop();
      const port = await mock.start();
      connector = new WebhookConnector({
        url: `http://127.0.0.1:${port}/events`,
        filter: { domain: 'strategy' },
      });
      await connector.connect();

      connector.onEvent(makeEvent(1, { domain: 'session' }));
      connector.onEvent(makeEvent(2, { domain: 'strategy' }));
      await new Promise((r) => setTimeout(r, 200));

      const posts = mock.requests.filter((r) => r.method === 'POST');
      assert.equal(posts.length, 1);
      assert.equal(JSON.parse(posts[0].body).domain, 'strategy');
    });

    it('filters by severity', async () => {
      await mock.stop();
      const port = await mock.start();
      connector = new WebhookConnector({
        url: `http://127.0.0.1:${port}/events`,
        filter: { severity: ['error', 'critical'] },
      });
      await connector.connect();

      connector.onEvent(makeEvent(1, { severity: 'info' }));
      connector.onEvent(makeEvent(2, { severity: 'error' }));
      await new Promise((r) => setTimeout(r, 200));

      const posts = mock.requests.filter((r) => r.method === 'POST');
      assert.equal(posts.length, 1);
    });
  });

  describe('retry', () => {
    it('retries on server error and succeeds', async () => {
      let callCount = 0;
      mock.server.removeAllListeners('request');
      mock.server.on('request', (req: IncomingMessage, res: ServerResponse) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          callCount++;
          // Fail first POST, succeed second
          if (req.method === 'POST' && callCount <= 2) {
            res.writeHead(500);
          } else {
            res.writeHead(200);
          }
          res.end();
        });
      });

      await connector.connect();
      connector.onEvent(makeEvent(1));
      await new Promise((r) => setTimeout(r, 500));

      // Should have retried: HEAD (connect) + POST (fail) + POST (success)
      assert.ok(callCount >= 2, `Expected >= 2 calls, got ${callCount}`);
      assert.equal(connector.health().errorCount, 0);
    });

    it('increments errorCount after all retries exhausted', async () => {
      mock.setStatus(500);
      await connector.connect();
      connector.onEvent(makeEvent(1));
      await new Promise((r) => setTimeout(r, 500));

      assert.equal(connector.health().errorCount, 1);
      assert.equal(connector.health().connected, false);
    });
  });

  describe('rate limiting', () => {
    it('drops events exceeding rate limit', async () => {
      await mock.stop();
      const port = await mock.start();
      connector = new WebhookConnector({
        url: `http://127.0.0.1:${port}/events`,
        maxEventsPerSecond: 3,
        maxRetries: 0,
      });
      await connector.connect();

      // Send 6 events rapidly
      for (let i = 0; i < 6; i++) {
        connector.onEvent(makeEvent(i));
      }
      await new Promise((r) => setTimeout(r, 500));

      const posts = mock.requests.filter((r) => r.method === 'POST');
      assert.ok(posts.length <= 3, `Expected <= 3 POSTs, got ${posts.length}`);
    });
  });

  describe('name', () => {
    it('derives name from URL hostname', () => {
      assert.ok(connector.name.startsWith('webhook:'));
    });
  });
});
