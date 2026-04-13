/**
 * HTTP regression tests for the smoke-test server.
 *
 * Covers the PRD 056 C-5 deliverable: start() runs registry validation +
 * coverage compute before listening, and the /api/{layers,clusters,features,cases}
 * endpoints return populated registry data. Spawns the server in-process on
 * an OS-assigned port (PORT=0 semantics) so the tests are hermetic and do
 * not collide with a developer running `npx tsx src/server.ts` locally.
 */

import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { start } from './server.js';

interface HttpResponse {
  status: number;
  body: string;
}

function httpGet(port: number, path: string): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method: 'GET' },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

let server: http.Server;
let port: number;

beforeAll(async () => {
  server = await start(0);
  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Expected AddressInfo from server.address()');
  }
  port = addr.port;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

describe('GET /api/layers', () => {
  it('returns the 4-entry layer registry', async () => {
    const res = await httpGet(port, '/api/layers');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as Array<{ id: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(4);
    const ids = body.map((l) => l.id).sort();
    expect(ids).toEqual(['agent', 'method', 'methodology', 'strategy']);
  });
});

describe('GET /api/clusters', () => {
  it('returns more than 5 clusters', async () => {
    const res = await httpGet(port, '/api/clusters');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as Array<{ id: string; layerId: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(5);
    for (const c of body) {
      expect(typeof c.id).toBe('string');
      expect(typeof c.layerId).toBe('string');
    }
  });
});

describe('GET /api/features', () => {
  it('returns more than 30 features, each with populated coverage', async () => {
    const res = await httpGet(port, '/api/features');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as Array<{ id: string; coverage: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(30);
    for (const f of body) {
      expect(['covered', 'gap']).toContain(f.coverage);
    }
    // At least one feature should be covered by a real case.
    expect(body.some((f) => f.coverage === 'covered')).toBe(true);
  });
});

describe('GET /api/cases (regression)', () => {
  it('still returns the { cases, features } envelope', async () => {
    const res = await httpGet(port, '/api/cases');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as {
      cases: Array<{ id: string; layer: string; features: string[] }>;
      features: string[];
    };
    expect(Array.isArray(body.cases)).toBe(true);
    expect(body.cases.length).toBeGreaterThan(0);
    expect(Array.isArray(body.features)).toBe(true);
    expect(body.features.length).toBeGreaterThan(0);
    for (const c of body.cases) {
      expect(typeof c.id).toBe('string');
      expect(typeof c.layer).toBe('string');
      expect(Array.isArray(c.features)).toBe(true);
    }
  });
});
