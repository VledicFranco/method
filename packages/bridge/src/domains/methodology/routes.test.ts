/**
 * Methodology HTTP Routes Tests
 *
 * Tests the Fastify route handlers registered by registerMethodologyRoutes().
 * Uses Fastify's inject() method for HTTP-level testing. The store is real
 * (backed by stdlib catalog), while the SessionPool is mocked since it
 * involves PTY infrastructure.
 *
 * Coverage targets: input validation branches, error discrimination (404/409/500),
 * advance step channel emission, and compound condition checks.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerMethodologyRoutes } from './routes.js';
import { MethodologySessionStore } from './store.js';
import { StdlibSource } from '../../ports/stdlib-source.js';
import type { SessionPool } from '../sessions/pool.js';

// ── Helpers ──

function createMockPool(overrides?: Partial<SessionPool>): SessionPool {
  return {
    getChannels: () => ({ progress: {}, control: {}, output: {} }) as any,
    ...overrides,
  } as unknown as SessionPool;
}

function createMockEventBus() {
  const events: Array<Record<string, unknown>> = [];
  return {
    events,
    emit(input: any) {
      const evt = { ...input, id: `evt-${events.length + 1}`, timestamp: new Date().toISOString(), sequence: events.length + 1 };
      events.push(evt);
      return evt;
    },
    subscribe() { return { unsubscribe() {} }; },
    query() { return []; },
    registerSink() {},
    importEvent() {},
  };
}

async function createTestApp(opts?: {
  pool?: SessionPool;
  store?: MethodologySessionStore;
  eventBus?: any;
}): Promise<{ app: FastifyInstance; store: MethodologySessionStore; eventBus: ReturnType<typeof createMockEventBus> }> {
  const app = Fastify({ logger: false });
  const store = opts?.store ?? new MethodologySessionStore(new StdlibSource());
  const pool = opts?.pool ?? createMockPool();
  const eventBus = opts?.eventBus ?? createMockEventBus();
  registerMethodologyRoutes(app, store, { pool, eventBus });
  await app.ready();
  return { app, store, eventBus };
}

// ══════════════════════════════════════════════════════════════
// POST /api/methodology/load — body validation
// ══════════════════════════════════════════════════════════════

describe('POST /api/methodology/load', () => {
  it('returns 400 when body is empty', async () => {
    const { app } = await createTestApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/load',
        payload: {},
      });
      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.body);
      assert.ok(body.error.includes('required'), `Expected "required" in error: ${body.error}`);
    } finally {
      await app.close();
    }
  });

  it('returns 400 when methodology_id is missing', async () => {
    const { app } = await createTestApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/load',
        payload: { method_id: 'M1-MDES' },
      });
      assert.equal(res.statusCode, 400);
    } finally {
      await app.close();
    }
  });

  it('returns 400 when method_id is missing', async () => {
    const { app } = await createTestApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/load',
        payload: { methodology_id: 'P0-META' },
      });
      assert.equal(res.statusCode, 400);
    } finally {
      await app.close();
    }
  });

  it('returns 200 with valid body', async () => {
    const { app } = await createTestApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/load',
        payload: { methodology_id: 'P0-META', method_id: 'M1-MDES' },
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.methodologyId, 'P0-META');
      assert.equal(body.methodId, 'M1-MDES');
    } finally {
      await app.close();
    }
  });

  it('returns 404 when methodology not found', async () => {
    const { app } = await createTestApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/load',
        payload: { methodology_id: 'NONEXISTENT', method_id: 'M1-MDES' },
      });
      assert.equal(res.statusCode, 404);
      const body = JSON.parse(res.body);
      assert.ok(body.error.includes('not found'));
    } finally {
      await app.close();
    }
  });
});

// ══════════════════════════════════════════════════════════════
// POST /api/methodology/sessions/:sid/step/validate — input validation
// ══════════════════════════════════════════════════════════════

describe('POST /api/methodology/sessions/:sid/step/validate', () => {
  it('returns 400 when step_id is missing', async () => {
    const { app } = await createTestApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/sessions/test-sess/step/validate',
        payload: { output: { some: 'data' } },
      });
      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.body);
      assert.ok(body.error.includes('step_id is required'));
    } finally {
      await app.close();
    }
  });

  it('returns 400 when output is missing', async () => {
    const { app } = await createTestApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/sessions/test-sess/step/validate',
        payload: { step_id: 'sigma_0' },
      });
      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.body);
      assert.ok(body.error.includes('output object is required'));
    } finally {
      await app.close();
    }
  });

  it('returns 400 when output is a string instead of object', async () => {
    const { app } = await createTestApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/sessions/test-sess/step/validate',
        payload: { step_id: 'sigma_0', output: 'not-an-object' },
      });
      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.body);
      assert.ok(body.error.includes('output object is required'));
    } finally {
      await app.close();
    }
  });

  it('returns 400 on step_id mismatch', async () => {
    const { app, store } = await createTestApp();
    try {
      // Load a method so the session has a current step
      store.loadMethod('mismatch-sess', 'P0-META', 'M1-MDES');

      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/sessions/mismatch-sess/step/validate',
        payload: { step_id: 'wrong_step_id', output: { data: 'test' } },
      });
      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.body);
      assert.ok(body.error.includes('mismatch'), `Expected "mismatch" in error: ${body.error}`);
    } finally {
      await app.close();
    }
  });

  it('returns 404 when no methodology loaded', async () => {
    const { app } = await createTestApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/sessions/no-load-sess/step/validate',
        payload: { step_id: 'sigma_0', output: { data: 'test' } },
      });
      assert.equal(res.statusCode, 404);
      const body = JSON.parse(res.body);
      assert.ok(body.error.includes('No methodology loaded'));
    } finally {
      await app.close();
    }
  });

  it('returns 200 with valid step_id and output', async () => {
    const { app, store } = await createTestApp();
    try {
      store.loadMethod('valid-sess', 'P0-META', 'M1-MDES');
      const current = store.getCurrentStep('valid-sess') as { step: { id: string } };

      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/sessions/valid-sess/step/validate',
        payload: { step_id: current.step.id, output: { decision: 'proceed' } },
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.ok(typeof body.valid === 'boolean');
      assert.ok(Array.isArray(body.findings));
    } finally {
      await app.close();
    }
  });
});

// ══════════════════════════════════════════════════════════════
// POST /api/methodology/sessions/:sid/step/advance — channel emission + error branches
// ══════════════════════════════════════════════════════════════

describe('POST /api/methodology/sessions/:sid/step/advance', () => {
  it('returns 404 when no methodology loaded', async () => {
    const { app } = await createTestApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/sessions/no-load/step/advance',
      });
      assert.equal(res.statusCode, 404);
      const body = JSON.parse(res.body);
      assert.ok(body.error.includes('No methodology loaded'));
    } finally {
      await app.close();
    }
  });

  it('emits bus events for previousStep and nextStep', async () => {
    const pool = createMockPool();
    const { app, store, eventBus } = await createTestApp({ pool });
    try {
      store.loadMethod('channel-sess', 'P0-META', 'M1-MDES');

      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/sessions/channel-sess/step/advance',
      });
      assert.equal(res.statusCode, 200);

      const body = JSON.parse(res.body);
      assert.ok(body.previousStep, 'should have previousStep');

      // eventBus should have been called with step_completed
      const completedEvent = eventBus.events.find(
        (e) => e.type === 'methodology.step_completed',
      );
      assert.ok(completedEvent, 'eventBus should emit methodology.step_completed');

      // If nextStep exists, should have step_started too
      if (body.nextStep) {
        const startedEvent = eventBus.events.find(
          (e) => e.type === 'methodology.step_started',
        );
        assert.ok(startedEvent, 'eventBus should emit methodology.step_started');
      }
    } finally {
      await app.close();
    }
  });

  it('handles channel errors gracefully (fire-and-forget)', async () => {
    const pool = createMockPool({
      getChannels: () => { throw new Error('pool not available'); },
    } as any);
    const { app, store } = await createTestApp({ pool });
    try {
      store.loadMethod('ch-err-sess', 'P0-META', 'M1-MDES');

      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/sessions/ch-err-sess/step/advance',
      });
      // Should still return 200 — channel errors are swallowed
      assert.equal(res.statusCode, 200);
    } finally {
      await app.close();
    }
  });

  it('returns 409 at terminal step', async () => {
    const { app, store } = await createTestApp();
    try {
      store.loadMethod('terminal-sess', 'P0-META', 'M1-MDES');

      // Advance to terminal step
      const status = store.getStatus('terminal-sess') as { totalSteps: number };
      for (let i = 0; i < status.totalSteps - 1; i++) {
        store.advanceStep('terminal-sess');
      }

      // Now advance past terminal — should fail
      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/sessions/terminal-sess/step/advance',
      });
      assert.equal(res.statusCode, 409);
      const body = JSON.parse(res.body);
      assert.ok(body.error.includes('terminal step'));
    } finally {
      await app.close();
    }
  });

  it('advance without nextStep does not emit step_started', async () => {
    const pool = createMockPool();
    const { app, store, eventBus } = await createTestApp({ pool });
    try {
      store.loadMethod('last-advance-sess', 'P0-META', 'M1-MDES');

      // Advance to the second-to-last step
      const status = store.getStatus('last-advance-sess') as { totalSteps: number };
      for (let i = 0; i < status.totalSteps - 2; i++) {
        store.advanceStep('last-advance-sess');
      }
      // Clear events from direct store.advanceStep calls
      eventBus.events.length = 0;

      // This advance reaches terminal — nextStep = null
      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/sessions/last-advance-sess/step/advance',
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.nextStep, null, 'nextStep should be null at terminal');

      // Should have step_completed but NOT step_started
      const completedEvent = eventBus.events.find((e: any) => e.type === 'methodology.step_completed');
      assert.ok(completedEvent, 'should emit step_completed');
      const startedEvent = eventBus.events.find((e: any) => e.type === 'methodology.step_started');
      assert.equal(startedEvent, undefined, 'should NOT emit step_started when nextStep is null');
    } finally {
      await app.close();
    }
  });
});

// ══════════════════════════════════════════════════════════════
// GET /api/methodology/:mid/routing — error discrimination
// ══════════════════════════════════════════════════════════════

describe('GET /api/methodology/:mid/routing', () => {
  it('returns 404 for non-existent methodology', async () => {
    const { app } = await createTestApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/methodology/NONEXISTENT/routing',
      });
      assert.equal(res.statusCode, 404);
      const body = JSON.parse(res.body);
      assert.ok(body.error.includes('not found'));
    } finally {
      await app.close();
    }
  });

  it('returns 200 for valid methodology', async () => {
    const { app } = await createTestApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/methodology/P2-SD/routing',
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.methodologyId, 'P2-SD');
      assert.ok(Array.isArray(body.predicates));
      assert.ok(Array.isArray(body.arms));
    } finally {
      await app.close();
    }
  });
});

// ══════════════════════════════════════════════════════════════
// GET /api/methodology/sessions/:sid/status — error discrimination
// ══════════════════════════════════════════════════════════════

describe('GET /api/methodology/sessions/:sid/status', () => {
  it('returns 404 when no methodology loaded', async () => {
    const { app } = await createTestApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/methodology/sessions/no-load/status',
      });
      assert.equal(res.statusCode, 404);
      const body = JSON.parse(res.body);
      assert.ok(body.error.includes('No methodology loaded'));
    } finally {
      await app.close();
    }
  });

  it('returns 200 when method is loaded', async () => {
    const { app, store } = await createTestApp();
    try {
      store.loadMethod('status-sess', 'P0-META', 'M1-MDES');
      const res = await app.inject({
        method: 'GET',
        url: '/api/methodology/sessions/status-sess/status',
      });
      assert.equal(res.statusCode, 200);
    } finally {
      await app.close();
    }
  });
});

// ══════════════════════════════════════════════════════════════
// GET /api/methodology/sessions/:sid/step/current — error discrimination
// ══════════════════════════════════════════════════════════════

describe('GET /api/methodology/sessions/:sid/step/current', () => {
  it('returns 404 when no methodology loaded', async () => {
    const { app } = await createTestApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/methodology/sessions/no-load/step/current',
      });
      assert.equal(res.statusCode, 404);
    } finally {
      await app.close();
    }
  });
});

// ══════════════════════════════════════════════════════════════
// GET /api/methodology/sessions/:sid/step/context — error discrimination
// ══════════════════════════════════════════════════════════════

describe('GET /api/methodology/sessions/:sid/step/context', () => {
  it('returns 404 when no methodology loaded', async () => {
    const { app } = await createTestApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/methodology/sessions/no-load/step/context',
      });
      assert.equal(res.statusCode, 404);
    } finally {
      await app.close();
    }
  });
});

// ══════════════════════════════════════════════════════════════
// POST /api/methodology/sessions — body validation + error discrimination
// ══════════════════════════════════════════════════════════════

describe('POST /api/methodology/sessions', () => {
  it('returns 400 when methodology_id is missing', async () => {
    const { app } = await createTestApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/sessions',
        payload: {},
      });
      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.body);
      assert.ok(body.error.includes('methodology_id is required'));
    } finally {
      await app.close();
    }
  });

  it('returns 404 for non-existent methodology', async () => {
    const { app } = await createTestApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/sessions',
        payload: { methodology_id: 'NONEXISTENT' },
      });
      assert.equal(res.statusCode, 404);
      const body = JSON.parse(res.body);
      assert.ok(body.error.includes('not found'));
    } finally {
      await app.close();
    }
  });

  it('returns 201 with valid methodology_id', async () => {
    const { app } = await createTestApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/sessions',
        payload: { methodology_id: 'P2-SD' },
      });
      assert.equal(res.statusCode, 201);
      const body = JSON.parse(res.body);
      assert.equal(body.methodology.id, 'P2-SD');
      assert.equal(body.status, 'initialized');
    } finally {
      await app.close();
    }
  });
});

// ══════════════════════════════════════════════════════════════
// POST /api/methodology/sessions/:sid/select — compound conditions
// ══════════════════════════════════════════════════════════════

describe('POST /api/methodology/sessions/:sid/select', () => {
  it('returns 400 when body is empty', async () => {
    const { app } = await createTestApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/sessions/test-sess/select',
        payload: {},
      });
      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.body);
      assert.ok(body.error.includes('required'));
    } finally {
      await app.close();
    }
  });

  it('returns 400 when selected_method_id is missing', async () => {
    const { app } = await createTestApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/sessions/test-sess/select',
        payload: { methodology_id: 'P2-SD' },
      });
      assert.equal(res.statusCode, 400);
    } finally {
      await app.close();
    }
  });

  it('returns 404 when methodology not found', async () => {
    const { app } = await createTestApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/sessions/test-sess/select',
        payload: { methodology_id: 'NONEXISTENT', selected_method_id: 'M1-FOO' },
      });
      assert.equal(res.statusCode, 404);
      const body = JSON.parse(res.body);
      assert.ok(body.error.includes('not found'));
    } finally {
      await app.close();
    }
  });

  it('returns 404 when method not in methodology repertoire', async () => {
    const { app } = await createTestApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/sessions/test-sess/select',
        payload: { methodology_id: 'P2-SD', selected_method_id: 'NONEXISTENT-METHOD' },
      });
      assert.equal(res.statusCode, 404);
      const body = JSON.parse(res.body);
      assert.ok(
        body.error.includes('not found') || body.error.includes('not in methodology'),
        `Expected "not found" or "not in methodology" in error: ${body.error}`,
      );
    } finally {
      await app.close();
    }
  });

  it('returns 200 with valid methodology and method', async () => {
    const { app, store } = await createTestApp();
    try {
      // Find a valid method
      const list = store.list() as Array<{
        methodologyId: string;
        methods: Array<{ methodId: string }>;
      }>;
      const p2sd = list.find((m) => m.methodologyId === 'P2-SD')!;
      const firstMethodId = p2sd.methods[0].methodId;

      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/sessions/sel-ok/select',
        payload: { methodology_id: 'P2-SD', selected_method_id: firstMethodId },
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.selectedMethod.methodId, firstMethodId);
    } finally {
      await app.close();
    }
  });
});

// ══════════════════════════════════════════════════════════════
// POST /api/methodology/sessions/:sid/load-method — validation + status checks
// ══════════════════════════════════════════════════════════════

describe('POST /api/methodology/sessions/:sid/load-method', () => {
  it('returns 400 when method_id is missing', async () => {
    const { app } = await createTestApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/sessions/test-sess/load-method',
        payload: {},
      });
      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.body);
      assert.ok(body.error.includes('method_id is required'));
    } finally {
      await app.close();
    }
  });

  it('returns 404 when no methodology session active', async () => {
    const { app } = await createTestApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/sessions/no-meth-sess/load-method',
        payload: { method_id: 'M1-MDES' },
      });
      assert.equal(res.statusCode, 404);
      const body = JSON.parse(res.body);
      assert.ok(body.error.includes('No methodology session active'));
    } finally {
      await app.close();
    }
  });

  it('returns 409 when session status is "executing"', async () => {
    const { app, store } = await createTestApp();
    try {
      // Start a methodology session, then load a method to set status to "executing"
      store.startSession('exec-sess', 'P2-SD', null);
      const list = store.list() as Array<{
        methodologyId: string;
        methods: Array<{ methodId: string }>;
      }>;
      const p2sd = list.find((m) => m.methodologyId === 'P2-SD')!;
      const firstMethodId = p2sd.methods[0].methodId;
      store.loadMethodInSession('exec-sess', firstMethodId);

      // Now try to load another method — should fail because status is "executing"
      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/sessions/exec-sess/load-method',
        payload: { method_id: firstMethodId },
      });
      assert.equal(res.statusCode, 409);
      const body = JSON.parse(res.body);
      assert.ok(body.error.includes('Cannot load method'));
    } finally {
      await app.close();
    }
  });

  it('returns 404 when method not in methodology repertoire', async () => {
    const { app, store } = await createTestApp();
    try {
      store.startSession('notfound-sess', 'P2-SD', null);
      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/sessions/notfound-sess/load-method',
        payload: { method_id: 'NONEXISTENT-METHOD' },
      });
      assert.equal(res.statusCode, 404);
      const body = JSON.parse(res.body);
      assert.ok(
        body.error.includes('not found') || body.error.includes('not in methodology'),
        `Expected "not found" or "not in methodology" in error: ${body.error}`,
      );
    } finally {
      await app.close();
    }
  });

  it('returns 200 with valid session and method_id', async () => {
    const { app, store } = await createTestApp();
    try {
      store.startSession('load-ok-sess', 'P2-SD', null);
      const list = store.list() as Array<{
        methodologyId: string;
        methods: Array<{ methodId: string }>;
      }>;
      const p2sd = list.find((m) => m.methodologyId === 'P2-SD')!;
      const firstMethodId = p2sd.methods[0].methodId;

      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/sessions/load-ok-sess/load-method',
        payload: { method_id: firstMethodId },
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.method.id, firstMethodId);
    } finally {
      await app.close();
    }
  });
});

// ══════════════════════════════════════════════════════════════
// POST /api/methodology/sessions/:sid/transition — status checks
// ══════════════════════════════════════════════════════════════

describe('POST /api/methodology/sessions/:sid/transition', () => {
  it('returns 404 when no methodology session active', async () => {
    const { app } = await createTestApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/sessions/no-meth-sess/transition',
        payload: {},
      });
      assert.equal(res.statusCode, 404);
      const body = JSON.parse(res.body);
      assert.ok(body.error.includes('No methodology session active'));
    } finally {
      await app.close();
    }
  });

  it('returns 409 when session is not executing (Cannot transition)', async () => {
    const { app, store } = await createTestApp();
    try {
      // Start a session but do NOT load a method — status is "initialized", not "executing"
      store.startSession('init-sess', 'P2-SD', null);

      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/sessions/init-sess/transition',
        payload: { completion_summary: 'done' },
      });
      assert.equal(res.statusCode, 409);
      const body = JSON.parse(res.body);
      assert.ok(body.error.includes('Cannot transition'));
    } finally {
      await app.close();
    }
  });

  it('returns 200 on valid transition', async () => {
    const { app, store } = await createTestApp();
    try {
      store.startSession('trans-ok-sess', 'P2-SD', 'build something');
      const list = store.list() as Array<{
        methodologyId: string;
        methods: Array<{ methodId: string }>;
      }>;
      const p2sd = list.find((m) => m.methodologyId === 'P2-SD')!;
      const firstMethodId = p2sd.methods[0].methodId;
      store.loadMethodInSession('trans-ok-sess', firstMethodId);

      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/sessions/trans-ok-sess/transition',
        payload: { completion_summary: 'Method completed' },
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.ok(body.completedMethod, 'should have completedMethod');
      assert.ok(body.methodologyProgress, 'should have methodologyProgress');
    } finally {
      await app.close();
    }
  });
});

// ══════════════════════════════════════════════════════════════
// POST /api/methodology/sessions/:sid/route — error discrimination
// ══════════════════════════════════════════════════════════════

describe('POST /api/methodology/sessions/:sid/route', () => {
  it('returns 404 when no methodology session active', async () => {
    const { app } = await createTestApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/sessions/no-sess/route',
        payload: {},
      });
      assert.equal(res.statusCode, 404);
      const body = JSON.parse(res.body);
      assert.ok(body.error.includes('No methodology session active'));
    } finally {
      await app.close();
    }
  });

  it('returns 200 after startSession', async () => {
    const { app, store } = await createTestApp();
    try {
      store.startSession('route-ok-sess', 'P2-SD', 'test');
      const res = await app.inject({
        method: 'POST',
        url: '/api/methodology/sessions/route-ok-sess/route',
        payload: {},
      });
      assert.equal(res.statusCode, 200);
    } finally {
      await app.close();
    }
  });
});

// ══════════════════════════════════════════════════════════════
// GET /api/methodology/list — basic coverage
// ══════════════════════════════════════════════════════════════

describe('GET /api/methodology/list', () => {
  it('returns 200 with array', async () => {
    const { app } = await createTestApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/methodology/list',
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.ok(Array.isArray(body), 'should return an array');
      assert.ok(body.length > 0, 'should have at least one methodology');
    } finally {
      await app.close();
    }
  });
});
