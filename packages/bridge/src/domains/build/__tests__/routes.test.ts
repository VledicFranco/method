/**
 * Build domain routes — unit tests (PRD 047 C-3).
 *
 * Tests cover:
 * - POST /api/builds/start returns build ID
 * - POST /api/builds/:id/message stores message
 * - POST /api/builds/:id/gate/specify/decide accepts decisions
 * - GET /api/builds returns build list
 * - GET /api/builds/:id returns build detail
 * - GET /api/builds/:id/evidence returns evidence report
 * - POST /api/builds/:id/abort marks build as aborted
 * - POST /api/builds/:id/resume resumes from checkpoint
 * - GET /api/builds/:id/conversation returns conversation history
 * - GET /api/builds/analytics returns cross-build analytics
 * - Validation: missing fields, invalid gates, invalid decisions
 * - Event bus receives build events
 */

import { describe, it, beforeEach as before, afterEach as after } from 'vitest';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promises as fsPromises } from 'node:fs';

import { registerBuildRoutes } from '../routes.js';
import type { BuildEntry, BuildRouteContext } from '../routes.js';
import { BuildOrchestrator } from '../orchestrator.js';
import { ConversationAdapter } from '../conversation-adapter.js';
import { FileCheckpointAdapter } from '../checkpoint-adapter.js';
import { BuildConfigSchema } from '../config.js';
import type { BuildConfig } from '../config.js';
import type { AutonomyLevel, EvidenceReport } from '../types.js';
import type { BridgeEvent, BridgeEventInput, EventBus, EventFilter, EventSink, EventSubscription } from '../../../ports/event-bus.js';

// ── Mock EventBus ──────────────────────────────────────────────

class MockEventBus implements EventBus {
  events: BridgeEventInput[] = [];
  private seq = 0;

  emit(event: BridgeEventInput): BridgeEvent {
    this.events.push(event);
    const full: BridgeEvent = {
      ...event,
      id: `evt-${this.seq}`,
      timestamp: new Date().toISOString(),
      sequence: this.seq++,
    };
    return full;
  }

  importEvent(_event: BridgeEvent): void {
    // no-op
  }

  subscribe(_filter: EventFilter, _handler: (event: BridgeEvent) => void): EventSubscription {
    return { unsubscribe: () => {} };
  }

  query(_filter: EventFilter, _options?: { limit?: number; since?: string }): BridgeEvent[] {
    return [];
  }

  registerSink(_sink: EventSink): void {
    // no-op
  }
}

// ── Mock FileSystem + YamlLoader for CheckpointAdapter ─────────

class MockFileSystem {
  private files = new Map<string, string>();
  private dirs = new Set<string>();

  mkdirSync(path: string, _opts?: { recursive?: boolean }): void {
    this.dirs.add(path);
  }

  writeFileSync(path: string, content: string): void {
    this.files.set(path, content);
  }

  readFileSync(path: string, _encoding: string): string {
    const content = this.files.get(path);
    if (!content) throw new Error(`ENOENT: ${path}`);
    return content;
  }

  existsSync(path: string): boolean {
    return this.files.has(path) || this.dirs.has(path);
  }

  readdirSync(_path: string, _opts?: { withFileTypes: boolean }): Array<{ name: string; isDirectory(): boolean }> {
    return [];
  }
}

class MockYamlLoader {
  dump(obj: Record<string, unknown>): string {
    return JSON.stringify(obj);
  }

  load(content: string): unknown {
    return JSON.parse(content);
  }
}

// ── Test setup ─────────────────────────────────────────────────

let app: FastifyInstance;
let eventBus: MockEventBus;
let builds: Map<string, BuildEntry>;
let config: BuildConfig;
let testSessionDir: string;
let mockFs: MockFileSystem;
let mockYaml: MockYamlLoader;
let checkpointAdapter: FileCheckpointAdapter;

before(async () => {
  testSessionDir = join(tmpdir(), `method-bridge-build-routes-test-${Date.now()}`);
  await fsPromises.mkdir(testSessionDir, { recursive: true });

  eventBus = new MockEventBus();
  builds = new Map();
  config = BuildConfigSchema.parse({});
  mockFs = new MockFileSystem();
  mockYaml = new MockYamlLoader();
  checkpointAdapter = new FileCheckpointAdapter(
    testSessionDir,
    mockFs as any,
    mockYaml as any,
  );

  app = Fastify({ logger: false });

  const ctx: BuildRouteContext = {
    builds,
    checkpointAdapter,
    createOrchestrator: (sessionId?: string) => {
      const conversation = new ConversationAdapter({
        sessionDir: testSessionDir,
        onEvent: () => {},
      });
      const orchestrator = new BuildOrchestrator(
        checkpointAdapter,
        conversation,
        config,
        undefined,
        sessionId,
      );
      return { orchestrator, conversation };
    },
    eventBus,
    config,
  };

  registerBuildRoutes(app, ctx);
  await app.ready();
});

after(async () => {
  await app.close();
  try {
    await fsPromises.rm(testSessionDir, { recursive: true, force: true });
  } catch {
    // Non-fatal cleanup
  }
});

// ── Tests ──────────────────────────────────────────────────────

describe('Build Routes', () => {
  describe('POST /api/builds/start', () => {
    it('returns a build ID on valid request', async () => {
      const resp = await app.inject({
        method: 'POST',
        url: '/api/builds/start',
        payload: { requirement: 'Add dark mode to the dashboard' },
      });

      assert.equal(resp.statusCode, 201);
      const body = resp.json();
      assert.ok(body.buildId, 'should return a buildId');
      assert.ok(typeof body.buildId === 'string');

      // Verify it's tracked in the builds map
      assert.ok(builds.has(body.buildId));
    });

    it('returns 400 when requirement is missing', async () => {
      const resp = await app.inject({
        method: 'POST',
        url: '/api/builds/start',
        payload: {},
      });

      assert.equal(resp.statusCode, 400);
      const body = resp.json();
      assert.equal(body.error, 'Invalid request');
    });

    it('returns 400 when requirement is empty string', async () => {
      const resp = await app.inject({
        method: 'POST',
        url: '/api/builds/start',
        payload: { requirement: '   ' },
      });

      assert.equal(resp.statusCode, 400);
    });

    it('accepts optional autonomyLevel', async () => {
      const resp = await app.inject({
        method: 'POST',
        url: '/api/builds/start',
        payload: { requirement: 'Test build', autonomyLevel: 'full-auto' },
      });

      assert.equal(resp.statusCode, 201);
      const body = resp.json();
      const entry = builds.get(body.buildId);
      assert.equal(entry?.autonomyLevel, 'full-auto');
    });

    it('emits build.started event to event bus', async () => {
      const countBefore = eventBus.events.length;

      const resp = await app.inject({
        method: 'POST',
        url: '/api/builds/start',
        payload: { requirement: 'Event test build' },
      });

      assert.equal(resp.statusCode, 201);

      const startedEvents = eventBus.events.slice(countBefore).filter(
        (e) => e.type === 'build.started',
      );
      assert.ok(startedEvents.length >= 1, 'should emit build.started event');
      assert.equal(startedEvents[0].domain, 'build');
    });
  });

  describe('POST /api/builds/:id/message', () => {
    it('stores a human message', async () => {
      // Start a build first
      const startResp = await app.inject({
        method: 'POST',
        url: '/api/builds/start',
        payload: { requirement: 'Message test build' },
      });
      const { buildId } = startResp.json();

      const resp = await app.inject({
        method: 'POST',
        url: `/api/builds/${buildId}/message`,
        payload: { content: 'Please use TypeScript' },
      });

      assert.equal(resp.statusCode, 200);
      assert.deepEqual(resp.json(), { ok: true });
    });

    it('returns 404 for unknown build', async () => {
      const resp = await app.inject({
        method: 'POST',
        url: '/api/builds/nonexistent-build/message',
        payload: { content: 'Hello' },
      });

      assert.equal(resp.statusCode, 404);
      assert.equal(resp.json().error, 'Build not found');
    });

    it('returns 400 when content is empty', async () => {
      const startResp = await app.inject({
        method: 'POST',
        url: '/api/builds/start',
        payload: { requirement: 'Validation test build' },
      });
      const { buildId } = startResp.json();

      const resp = await app.inject({
        method: 'POST',
        url: `/api/builds/${buildId}/message`,
        payload: { content: '' },
      });

      assert.equal(resp.statusCode, 400);
    });
  });

  describe('POST /api/builds/:id/gate/:gate/decide', () => {
    it('accepts a valid gate decision', async () => {
      const startResp = await app.inject({
        method: 'POST',
        url: '/api/builds/start',
        payload: { requirement: 'Gate test build' },
      });
      const { buildId } = startResp.json();

      const resp = await app.inject({
        method: 'POST',
        url: `/api/builds/${buildId}/gate/specify/decide`,
        payload: { decision: 'approve' },
      });

      assert.equal(resp.statusCode, 200);
      assert.deepEqual(resp.json(), { ok: true });
    });

    it('accepts approve with feedback', async () => {
      const startResp = await app.inject({
        method: 'POST',
        url: '/api/builds/start',
        payload: { requirement: 'Gate feedback test' },
      });
      const { buildId } = startResp.json();

      const resp = await app.inject({
        method: 'POST',
        url: `/api/builds/${buildId}/gate/design/decide`,
        payload: { decision: 'adjust', feedback: 'Use adapter pattern instead' },
      });

      assert.equal(resp.statusCode, 200);
    });

    it('returns 400 for invalid gate type', async () => {
      const startResp = await app.inject({
        method: 'POST',
        url: '/api/builds/start',
        payload: { requirement: 'Invalid gate test' },
      });
      const { buildId } = startResp.json();

      const resp = await app.inject({
        method: 'POST',
        url: `/api/builds/${buildId}/gate/invalid_gate/decide`,
        payload: { decision: 'approve' },
      });

      assert.equal(resp.statusCode, 400);
      assert.equal(resp.json().error, 'Invalid gate');
    });

    it('returns 400 for invalid decision', async () => {
      const startResp = await app.inject({
        method: 'POST',
        url: '/api/builds/start',
        payload: { requirement: 'Invalid decision test' },
      });
      const { buildId } = startResp.json();

      const resp = await app.inject({
        method: 'POST',
        url: `/api/builds/${buildId}/gate/specify/decide`,
        payload: { decision: 'maybe' },
      });

      assert.equal(resp.statusCode, 400);
      assert.equal(resp.json().error, 'Invalid decision');
    });

    it('returns 404 for unknown build', async () => {
      const resp = await app.inject({
        method: 'POST',
        url: '/api/builds/nonexistent/gate/specify/decide',
        payload: { decision: 'approve' },
      });

      assert.equal(resp.statusCode, 404);
    });

    it('emits gate_resolved event', async () => {
      const startResp = await app.inject({
        method: 'POST',
        url: '/api/builds/start',
        payload: { requirement: 'Gate event test' },
      });
      const { buildId } = startResp.json();

      const countBefore = eventBus.events.length;

      await app.inject({
        method: 'POST',
        url: `/api/builds/${buildId}/gate/plan/decide`,
        payload: { decision: 'approve' },
      });

      const gateEvents = eventBus.events.slice(countBefore).filter(
        (e) => e.type === 'build.gate_resolved',
      );
      assert.ok(gateEvents.length >= 1);
      assert.equal((gateEvents[0].payload as any).gate, 'plan');
      assert.equal((gateEvents[0].payload as any).decision, 'approve');
    });
  });

  describe('GET /api/builds', () => {
    it('returns all builds', async () => {
      // Create a build first so the list is non-empty
      const startResp = await app.inject({
        method: 'POST',
        url: '/api/builds/start',
        payload: { requirement: 'List test build' },
      });
      assert.equal(startResp.statusCode, 201);

      const resp = await app.inject({
        method: 'GET',
        url: '/api/builds',
      });

      assert.equal(resp.statusCode, 200);
      const body = resp.json();
      assert.ok(Array.isArray(body.builds));
      assert.ok(body.builds.length > 0, 'should have at least one build');

      // Each build has expected shape
      const match = body.builds.find((b: any) => b.requirement === 'List test build');
      assert.ok(match, 'should find the build we just created');
      assert.ok(match.id);
      assert.ok(match.status);
      assert.ok(match.startedAt);
    });
  });

  describe('GET /api/builds/:id', () => {
    it('returns build detail for existing build', async () => {
      const startResp = await app.inject({
        method: 'POST',
        url: '/api/builds/start',
        payload: { requirement: 'Detail test build' },
      });
      const { buildId } = startResp.json();

      const resp = await app.inject({
        method: 'GET',
        url: `/api/builds/${buildId}`,
      });

      assert.equal(resp.statusCode, 200);
      const body = resp.json();
      assert.equal(body.id, buildId);
      assert.equal(body.requirement, 'Detail test build');
      assert.equal(body.status, 'running');
    });

    it('returns 404 for unknown build', async () => {
      const resp = await app.inject({
        method: 'GET',
        url: '/api/builds/does-not-exist',
      });

      assert.equal(resp.statusCode, 404);
    });
  });

  describe('GET /api/builds/:id/evidence', () => {
    it('returns evidence report for completed build', async () => {
      // Manually create a completed build entry
      const buildId = 'evidence-test-build';
      const conversation = new ConversationAdapter({
        sessionDir: testSessionDir,
        onEvent: () => {},
      });
      const orchestrator = new BuildOrchestrator(
        checkpointAdapter,
        conversation,
        config,
        undefined,
        buildId,
      );

      const evidenceReport: EvidenceReport = {
        requirement: 'Evidence test',
        phases: [],
        validation: { criteriaTotal: 2, criteriaPassed: 2, criteriaFailed: 0, details: [] },
        delivery: {
          totalCost: { tokens: 1000, usd: 0.01 },
          orchestratorCost: { tokens: 500, usd: 0.005 },
          overheadPercent: 50,
          wallClockMs: 5000,
          humanInterventions: 1,
          failureRecoveries: { attempted: 0, succeeded: 0 },
        },
        verdict: 'fully_validated',
        artifacts: {},
        refinements: [],
      };

      builds.set(buildId, {
        orchestrator,
        conversation,
        requirement: 'Evidence test',
        autonomyLevel: 'discuss-all',
        status: 'completed',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        evidenceReport,
      });

      const resp = await app.inject({
        method: 'GET',
        url: `/api/builds/${buildId}/evidence`,
      });

      assert.equal(resp.statusCode, 200);
      const body = resp.json();
      assert.equal(body.verdict, 'fully_validated');
      assert.equal(body.validation.criteriaPassed, 2);
    });

    it('returns 404 when build has no evidence report', async () => {
      const startResp = await app.inject({
        method: 'POST',
        url: '/api/builds/start',
        payload: { requirement: 'Incomplete build' },
      });
      const { buildId } = startResp.json();

      const resp = await app.inject({
        method: 'GET',
        url: `/api/builds/${buildId}/evidence`,
      });

      assert.equal(resp.statusCode, 404);
      assert.equal(resp.json().error, 'No evidence report');
    });

    it('returns 404 for unknown build', async () => {
      const resp = await app.inject({
        method: 'GET',
        url: '/api/builds/nonexistent/evidence',
      });

      assert.equal(resp.statusCode, 404);
    });
  });

  describe('POST /api/builds/:id/abort', () => {
    it('aborts a running build', async () => {
      const startResp = await app.inject({
        method: 'POST',
        url: '/api/builds/start',
        payload: { requirement: 'Abort test build' },
      });
      const { buildId } = startResp.json();

      const resp = await app.inject({
        method: 'POST',
        url: `/api/builds/${buildId}/abort`,
        payload: { reason: 'No longer needed' },
      });

      assert.equal(resp.statusCode, 200);
      assert.deepEqual(resp.json(), { ok: true });
      assert.equal(builds.get(buildId)?.status, 'aborted');
    });

    it('returns 400 when build is not running', async () => {
      const startResp = await app.inject({
        method: 'POST',
        url: '/api/builds/start',
        payload: { requirement: 'Already aborted build' },
      });
      const { buildId } = startResp.json();

      // Abort once
      await app.inject({
        method: 'POST',
        url: `/api/builds/${buildId}/abort`,
        payload: {},
      });

      // Try to abort again
      const resp = await app.inject({
        method: 'POST',
        url: `/api/builds/${buildId}/abort`,
        payload: {},
      });

      assert.equal(resp.statusCode, 400);
      assert.equal(resp.json().error, 'Build not running');
    });

    it('emits build.aborted event', async () => {
      const startResp = await app.inject({
        method: 'POST',
        url: '/api/builds/start',
        payload: { requirement: 'Abort event test' },
      });
      const { buildId } = startResp.json();

      const countBefore = eventBus.events.length;

      await app.inject({
        method: 'POST',
        url: `/api/builds/${buildId}/abort`,
        payload: { reason: 'Testing abort' },
      });

      const abortEvents = eventBus.events.slice(countBefore).filter(
        (e) => e.type === 'build.aborted',
      );
      assert.ok(abortEvents.length >= 1);
      assert.equal((abortEvents[0].payload as any).reason, 'Testing abort');
    });
  });

  describe('GET /api/builds/:id/conversation', () => {
    it('returns conversation history', async () => {
      const startResp = await app.inject({
        method: 'POST',
        url: '/api/builds/start',
        payload: { requirement: 'Conversation test build' },
      });
      const { buildId } = startResp.json();

      // Send a message to populate history
      await app.inject({
        method: 'POST',
        url: `/api/builds/${buildId}/message`,
        payload: { content: 'Test message' },
      });

      const resp = await app.inject({
        method: 'GET',
        url: `/api/builds/${buildId}/conversation`,
      });

      assert.equal(resp.statusCode, 200);
      const body = resp.json();
      assert.ok(Array.isArray(body.messages));
    });

    it('returns 404 for unknown build', async () => {
      const resp = await app.inject({
        method: 'GET',
        url: '/api/builds/nonexistent/conversation',
      });

      assert.equal(resp.statusCode, 404);
    });
  });

  describe('POST /api/builds/:id/resume', () => {
    it('returns 404 when no checkpoint exists', async () => {
      const resp = await app.inject({
        method: 'POST',
        url: '/api/builds/no-checkpoint-build/resume',
      });

      assert.equal(resp.statusCode, 404);
      assert.equal(resp.json().error, 'No checkpoint found');
    });
  });

  describe('GET /api/builds/analytics', () => {
    it('returns analytics data', async () => {
      const resp = await app.inject({
        method: 'GET',
        url: '/api/builds/analytics',
      });

      assert.equal(resp.statusCode, 200);
      const body = resp.json();
      assert.ok(typeof body.totalBuilds === 'number');
      assert.ok(Array.isArray(body.refinements));
    });
  });
});
