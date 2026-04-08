/**
 * query-engine.golden.test.ts — 20-query golden test set.
 *
 * Fixture: 8 diverse components with orthogonal embeddings so cosine similarity
 * reliably identifies the correct top result for each semantic query.
 *
 * Acceptance criterion: ≥ 16/20 queries must find the expected component in top-5.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { QueryEngine } from './query-engine.js';
import type { EmbeddingClientPort } from '../ports/internal/embedding-client.js';
import { InMemoryIndexStore } from '../index-store/in-memory-store.js';

// ── Fixture embedding dictionary ─────────────────────────────────────────────
// Each component has a distinct 8-dimensional "semantic axis".
// The stub embedder maps known query terms to the same space.

const DIM = 8;

// Component embeddings (unit-ish vectors on dedicated axes)
const EMBEDDINGS: Record<string, number[]> = {
  auth:         [1, 0, 0, 0, 0, 0, 0, 0],
  billing:      [0, 1, 0, 0, 0, 0, 0, 0],
  session:      [0, 0, 1, 0, 0, 0, 0, 0],
  gateway:      [0, 0, 0, 1, 0, 0, 0, 0],
  userRepo:     [0, 0, 0, 0, 1, 0, 0, 0],
  orderService: [0, 0, 0, 0, 0, 1, 0, 0],
  notif:        [0, 0, 0, 0, 0, 0, 1, 0],
  monitoring:   [0, 0, 0, 0, 0, 0, 0, 1],
};

// Query term → embedding axis (must match component embedding)
const QUERY_EMBEDDINGS: Record<string, number[]> = {
  'authentication and login':          EMBEDDINGS.auth,
  'user sign-in and identity':         EMBEDDINGS.auth,
  'billing and payments':              EMBEDDINGS.billing,
  'subscription management':           EMBEDDINGS.billing,
  'session tracking and tokens':       EMBEDDINGS.session,
  'user session lifecycle':            EMBEDDINGS.session,
  'api gateway and routing':           EMBEDDINGS.gateway,
  'request routing':                   EMBEDDINGS.gateway,
  'user repository and storage':       EMBEDDINGS.userRepo,
  'order processing and fulfilment':   EMBEDDINGS.orderService,
  'notification handler':              EMBEDDINGS.notif,
  'event notifications':               EMBEDDINGS.notif,
  'monitoring and observability':      EMBEDDINGS.monitoring,
  'metrics and health checks':         EMBEDDINGS.monitoring,
  'port interfaces':                   EMBEDDINGS.auth,       // filtered query — parts=['port']
  'l2 domain components':              EMBEDDINGS.auth,       // filtered query — levels=['L2']
  'well documented components':        EMBEDDINGS.auth,       // minCoverageScore=0.9
  'single top result':                 EMBEDDINGS.billing,    // topK=1
  'broad search all components':       [0.35, 0.35, 0.35, 0.35, 0, 0, 0, 0], // topK=20
  'perfect coverage only':             EMBEDDINGS.auth,       // minCoverageScore=1.0
};

// ── Stub embedder (uses the query dictionary above) ──────────────────────────

class FixtureEmbeddingClient implements EmbeddingClientPort {
  readonly dimensions = DIM;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const known = QUERY_EMBEDDINGS[text];
      if (known) return known;
      // Fallback: zero vector (neutral)
      return new Array(DIM).fill(0.125);
    });
  }
}

// ── Fixture data ─────────────────────────────────────────────────────────────

const PROJECT_ROOT = '/golden-project';

async function buildFixture(store: InMemoryIndexStore): Promise<void> {
  // 1. Auth domain — L2, port + documentation, coverage 0.95
  await store.upsertComponent({
    id: 'auth0000000000001',
    projectRoot: PROJECT_ROOT,
    path: 'src/domains/auth',
    level: 'L2',
    parts: [
      { part: 'documentation', filePath: 'src/domains/auth/README.md', excerpt: 'Auth domain' },
      { part: 'port', filePath: 'src/domains/auth/ports/auth.ts' },
      { part: 'interface', filePath: 'src/domains/auth/index.ts' },
    ],
    coverageScore: 0.95,
    embedding: EMBEDDINGS.auth,
    indexedAt: new Date().toISOString(),
  });

  // 2. Billing domain — L2, domain + documentation, coverage 0.85
  await store.upsertComponent({
    id: 'bill0000000000002',
    projectRoot: PROJECT_ROOT,
    path: 'src/domains/billing',
    level: 'L2',
    parts: [
      { part: 'documentation', filePath: 'src/domains/billing/README.md', excerpt: 'Billing' },
      { part: 'domain', filePath: 'src/domains/billing/billing-service.ts' },
    ],
    coverageScore: 0.85,
    embedding: EMBEDDINGS.billing,
    indexedAt: new Date().toISOString(),
  });

  // 3. Session domain — L3, port + domain, coverage 0.75
  await store.upsertComponent({
    id: 'sess0000000000003',
    projectRoot: PROJECT_ROOT,
    path: 'src/domains/sessions',
    level: 'L3',
    parts: [
      { part: 'port', filePath: 'src/domains/sessions/ports/session.ts' },
      { part: 'domain', filePath: 'src/domains/sessions/session-manager.ts' },
    ],
    coverageScore: 0.75,
    embedding: EMBEDDINGS.session,
    indexedAt: new Date().toISOString(),
  });

  // 4. API Gateway — L4, boundary + architecture, coverage 0.80
  await store.upsertComponent({
    id: 'gate0000000000004',
    projectRoot: PROJECT_ROOT,
    path: 'src/gateway',
    level: 'L4',
    parts: [
      { part: 'boundary', filePath: 'src/gateway/gateway.ts' },
      { part: 'architecture', filePath: 'src/gateway/ARCHITECTURE.md' },
    ],
    coverageScore: 0.80,
    embedding: EMBEDDINGS.gateway,
    indexedAt: new Date().toISOString(),
  });

  // 5. User repository — L1, interface + verification, coverage 0.65
  await store.upsertComponent({
    id: 'user0000000000005',
    projectRoot: PROJECT_ROOT,
    path: 'src/infra/user-repo.ts',
    level: 'L1',
    parts: [
      { part: 'interface', filePath: 'src/infra/user-repo.ts' },
      { part: 'verification', filePath: 'src/infra/user-repo.test.ts' },
    ],
    coverageScore: 0.65,
    embedding: EMBEDDINGS.userRepo,
    indexedAt: new Date().toISOString(),
  });

  // 6. Order service — L3, domain + port, coverage 0.88
  await store.upsertComponent({
    id: 'ordr0000000000006',
    projectRoot: PROJECT_ROOT,
    path: 'src/domains/orders',
    level: 'L3',
    parts: [
      { part: 'domain', filePath: 'src/domains/orders/order-service.ts' },
      { part: 'port', filePath: 'src/domains/orders/ports/order.ts' },
    ],
    coverageScore: 0.88,
    embedding: EMBEDDINGS.orderService,
    indexedAt: new Date().toISOString(),
  });

  // 7. Notification handler — L2, documentation + boundary, coverage 0.70
  await store.upsertComponent({
    id: 'noti0000000000007',
    projectRoot: PROJECT_ROOT,
    path: 'src/domains/notifications',
    level: 'L2',
    parts: [
      { part: 'documentation', filePath: 'src/domains/notifications/README.md' },
      { part: 'boundary', filePath: 'src/domains/notifications/handler.ts' },
    ],
    coverageScore: 0.70,
    embedding: EMBEDDINGS.notif,
    indexedAt: new Date().toISOString(),
  });

  // 8. Monitoring/observability — L4, observability + documentation, coverage 1.0
  await store.upsertComponent({
    id: 'moni0000000000008',
    projectRoot: PROJECT_ROOT,
    path: 'src/infra/monitoring',
    level: 'L4',
    parts: [
      { part: 'observability', filePath: 'src/infra/monitoring/metrics.ts' },
      { part: 'documentation', filePath: 'src/infra/monitoring/README.md' },
    ],
    coverageScore: 1.0,
    embedding: EMBEDDINGS.monitoring,
    indexedAt: new Date().toISOString(),
  });
}

// ── Test helpers ─────────────────────────────────────────────────────────────

function hasPathInTopK(paths: string[], expected: string): boolean {
  return paths.some((p) => p.includes(expected));
}

// ── Golden tests ─────────────────────────────────────────────────────────────

describe('QueryEngine — golden test set (≥ 16/20 must pass)', () => {
  let store: InMemoryIndexStore;
  let engine: QueryEngine;
  let embedder: FixtureEmbeddingClient;

  beforeEach(async () => {
    store = new InMemoryIndexStore();
    embedder = new FixtureEmbeddingClient();
    await buildFixture(store);
    engine = new QueryEngine(store, embedder, {
      projectRoot: PROJECT_ROOT,
      coverageThreshold: 0.8,
    });
  });

  // G-01: Semantic similarity — auth
  it('G-01: "authentication and login" → auth domain in top-3', async () => {
    const result = await engine.query({ query: 'authentication and login', topK: 3 });
    const paths = result.results.map((r) => r.path);
    expect(hasPathInTopK(paths, 'auth')).toBe(true);
  });

  // G-02: Semantic similarity — auth (alternate phrasing)
  it('G-02: "user sign-in and identity" → auth domain in top-5', async () => {
    const result = await engine.query({ query: 'user sign-in and identity', topK: 5 });
    const paths = result.results.map((r) => r.path);
    expect(hasPathInTopK(paths, 'auth')).toBe(true);
  });

  // G-03: Semantic similarity — billing
  it('G-03: "billing and payments" → billing domain in top-3', async () => {
    const result = await engine.query({ query: 'billing and payments', topK: 3 });
    const paths = result.results.map((r) => r.path);
    expect(hasPathInTopK(paths, 'billing')).toBe(true);
  });

  // G-04: Semantic similarity — billing (alternate)
  it('G-04: "subscription management" → billing domain in top-5', async () => {
    const result = await engine.query({ query: 'subscription management', topK: 5 });
    const paths = result.results.map((r) => r.path);
    expect(hasPathInTopK(paths, 'billing')).toBe(true);
  });

  // G-05: Semantic similarity — sessions
  it('G-05: "session tracking and tokens" → sessions domain in top-3', async () => {
    const result = await engine.query({ query: 'session tracking and tokens', topK: 3 });
    const paths = result.results.map((r) => r.path);
    expect(hasPathInTopK(paths, 'sessions')).toBe(true);
  });

  // G-06: Semantic similarity — sessions (alternate)
  it('G-06: "user session lifecycle" → sessions domain in top-5', async () => {
    const result = await engine.query({ query: 'user session lifecycle', topK: 5 });
    const paths = result.results.map((r) => r.path);
    expect(hasPathInTopK(paths, 'sessions')).toBe(true);
  });

  // G-07: Semantic similarity — gateway
  it('G-07: "api gateway and routing" → gateway in top-3', async () => {
    const result = await engine.query({ query: 'api gateway and routing', topK: 3 });
    const paths = result.results.map((r) => r.path);
    expect(hasPathInTopK(paths, 'gateway')).toBe(true);
  });

  // G-08: Semantic similarity — order service
  it('G-08: "order processing and fulfilment" → orders domain in top-3', async () => {
    const result = await engine.query({ query: 'order processing and fulfilment', topK: 3 });
    const paths = result.results.map((r) => r.path);
    expect(hasPathInTopK(paths, 'orders')).toBe(true);
  });

  // G-09: Semantic similarity — notifications
  it('G-09: "notification handler" → notifications domain in top-3', async () => {
    const result = await engine.query({ query: 'notification handler', topK: 3 });
    const paths = result.results.map((r) => r.path);
    expect(hasPathInTopK(paths, 'notifications')).toBe(true);
  });

  // G-10: Semantic similarity — monitoring
  it('G-10: "monitoring and observability" → monitoring in top-3', async () => {
    const result = await engine.query({ query: 'monitoring and observability', topK: 3 });
    const paths = result.results.map((r) => r.path);
    expect(hasPathInTopK(paths, 'monitoring')).toBe(true);
  });

  // G-11: Part filter — only port-bearing components returned
  it('G-11: parts=[port] → all results have a port part', async () => {
    const result = await engine.query({ query: 'port interfaces', parts: ['port'] });
    expect(result.results.length).toBeGreaterThan(0);
    for (const ctx of result.results) {
      expect(ctx.parts.some((p) => p.part === 'port')).toBe(true);
    }
  });

  // G-12: Level filter — only L2 components returned
  it('G-12: levels=[L2] → all results are L2', async () => {
    const result = await engine.query({ query: 'l2 domain components', levels: ['L2'] });
    expect(result.results.length).toBeGreaterThan(0);
    for (const ctx of result.results) {
      expect(ctx.level).toBe('L2');
    }
  });

  // G-13: minCoverageScore filter
  it('G-13: minCoverageScore=0.9 → all results have coverageScore >= 0.9', async () => {
    const result = await engine.query({ query: 'well documented components', minCoverageScore: 0.9 });
    expect(result.results.length).toBeGreaterThan(0);
    for (const ctx of result.results) {
      expect(ctx.coverageScore).toBeGreaterThanOrEqual(0.9);
    }
  });

  // G-14: Combined filter — port + L3
  it('G-14: parts=[port] + levels=[L3] → results have port AND are L3', async () => {
    const result = await engine.query({
      query: 'session tracking and tokens',
      parts: ['port'],
      levels: ['L3'],
    });
    expect(result.results.length).toBeGreaterThan(0);
    for (const ctx of result.results) {
      expect(ctx.level).toBe('L3');
      expect(ctx.parts.some((p) => p.part === 'port')).toBe(true);
    }
  });

  // G-15: topK=1 limits to single result
  it('G-15: topK=1 → exactly 1 result (or 0 if none match)', async () => {
    const result = await engine.query({ query: 'single top result', topK: 1 });
    expect(result.results.length).toBeLessThanOrEqual(1);
  });

  // G-16: topK=20 returns all available components (8 total)
  it('G-16: topK=20 → returns all 8 available components', async () => {
    const result = await engine.query({ query: 'broad search all components', topK: 20 });
    expect(result.results.length).toBe(8);
  });

  // G-17: minCoverageScore=1.0 — only perfect-coverage components
  it('G-17: minCoverageScore=1.0 → returns monitoring (coverage 1.0)', async () => {
    const result = await engine.query({ query: 'perfect coverage only', minCoverageScore: 1.0 });
    expect(result.results.length).toBe(1);
    expect(result.results[0].path).toContain('monitoring');
  });

  // G-18: results are sorted by relevanceScore descending
  it('G-18: results are always sorted by relevanceScore descending', async () => {
    const result = await engine.query({ query: 'metrics and health checks', topK: 5 });
    for (let i = 1; i < result.results.length; i++) {
      expect(result.results[i - 1].relevanceScore).toBeGreaterThanOrEqual(
        result.results[i].relevanceScore,
      );
    }
  });

  // G-19: mode is 'discovery' when avg coverage < threshold
  it('G-19: mode is discovery — avg coverage ≈ 0.82, threshold=0.9', async () => {
    // avg = (0.95+0.85+0.75+0.80+0.65+0.88+0.70+1.0) / 8 = 0.823
    const strictEngine = new QueryEngine(store, embedder, {
      projectRoot: PROJECT_ROOT,
      coverageThreshold: 0.9,
    });
    const result = await strictEngine.query({ query: 'authentication and login' });
    expect(result.mode).toBe('discovery');
  });

  // G-20: mode is 'production' when avg coverage >= threshold
  it('G-20: mode is production — avg coverage ≈ 0.82, threshold=0.7', async () => {
    // avg = (0.95+0.85+0.75+0.80+0.65+0.88+0.70+1.0) / 8 ≈ 0.823 > 0.7
    const looseEngine = new QueryEngine(store, embedder, {
      projectRoot: PROJECT_ROOT,
      coverageThreshold: 0.7,
    });
    const result = await looseEngine.query({ query: 'authentication and login' });
    expect(result.mode).toBe('production');
  });
});
