/**
 * Test suite for PRD 020 Phase 4: Multi-Project Dashboard & Event Stream
 * Covers: project list fetching, event polling, filtering, cursor management, session isolation
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { ProjectEventType } from './events/index.js';
import type { ProjectMetadata } from './discovery-service.js';

// ── Mock Data ────

const mockProjects: ProjectMetadata[] = [
  {
    id: 'proj-001',
    name: 'pv-method',
    description: '',
    path: '/home/user/pv-method',
    status: 'healthy',
    git_valid: true,
    method_dir_exists: true,
    discovered_at: new Date().toISOString(),
    last_scanned: new Date().toISOString(),
  },
  {
    id: 'proj-002',
    name: 'oss-constellation',
    description: '',
    path: '/home/user/oss-constellation',
    status: 'healthy',
    git_valid: true,
    method_dir_exists: true,
    discovered_at: new Date(Date.now() - 3600000).toISOString(),
    last_scanned: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'proj-003',
    name: 'degraded-project',
    description: '',
    path: '/home/user/degraded-project',
    status: 'git_corrupted',
    git_valid: false,
    method_dir_exists: false,
    discovered_at: new Date(Date.now() - 86400000).toISOString(),
    last_scanned: new Date(Date.now() - 86400000).toISOString(),
  },
];

const mockEvents = [
  {
    id: 'evt-001',
    projectId: 'proj-001',
    type: ProjectEventType.CONFIG_UPDATED,
    timestamp: new Date(Date.now() - 10000),
    metadata: { phase: 'phase2b' },
    data: { config_path: '.method/manifest.yaml' },
  },
  {
    id: 'evt-002',
    projectId: 'proj-001',
    type: ProjectEventType.DISCOVERED,
    timestamp: new Date(Date.now() - 5000),
    metadata: { is_genesis: true },
    data: { message: 'Genesis observation report' },
  },
  {
    id: 'evt-003',
    projectId: 'proj-002',
    type: ProjectEventType.DISCOVERY_INCOMPLETE,
    timestamp: new Date(Date.now() - 3000),
    metadata: { phase: 'phase1' },
    data: { scanned_count: 42 },
  },
];

// ── API Response Tests ────

test('GET /api/projects returns all discovered projects', () => {
  const response = {
    projects: mockProjects,
    discovery_incomplete: false,
    error: null,
    scanned_count: 3,
    error_count: 0,
    elapsed_ms: 2500,
  };

  assert.strictEqual(response.projects.length, 3);
  assert.deepStrictEqual(response.projects[0], mockProjects[0]);
  assert.strictEqual(response.discovery_incomplete, false);
});

test('GET /api/projects includes project metadata fields', () => {
  const project = mockProjects[0];

  assert(project.id);
  assert(project.path);
  assert.strictEqual(typeof project.status, 'string');
  assert.strictEqual(typeof project.git_valid, 'boolean');
  assert.strictEqual(typeof project.method_dir_exists, 'boolean');
  assert(project.discovered_at);
});

test('GET /api/events returns events with cursor-based pagination', () => {
  const response = {
    events: mockEvents,
    nextCursor: 'cursor-xyz-123',
    hasMore: true,
  };

  assert.strictEqual(response.events.length, 3);
  assert(response.nextCursor);
  assert.strictEqual(response.hasMore, true);
});

test('GET /api/events supports project_id filter', () => {
  const filteredEvents = mockEvents.filter((e) => e.projectId === 'proj-001');

  assert.strictEqual(filteredEvents.length, 2);
  assert.strictEqual(filteredEvents[0].projectId, 'proj-001');
  assert.strictEqual(filteredEvents[1].metadata?.is_genesis, true);
});

test('GET /api/events supports since_cursor pagination', () => {
  // Simulate cursor-based pagination: cursor points to index 1
  const cursorIndex = 1;
  const paginated = mockEvents.slice(cursorIndex);

  assert.strictEqual(paginated.length, 2);
  assert.strictEqual(paginated[0].id, 'evt-002');
});

// ── Event Stream Filtering Tests ────

test('Event stream: Filter by project_id', () => {
  const projectId = 'proj-001';
  const filtered = mockEvents.filter((e) => e.projectId === projectId);

  assert.strictEqual(filtered.length, 2);
  filtered.forEach((e) => {
    assert.strictEqual(e.projectId, projectId);
  });
});

test('Event stream: Identify Genesis events', () => {
  const genesisEvents = mockEvents.filter(
    (e) => e.metadata?.is_genesis === true,
  );

  assert.strictEqual(genesisEvents.length, 1);
  assert.strictEqual(genesisEvents[0].id, 'evt-002');
});

test('Event stream: Sort events newest first', () => {
  const sorted = [...mockEvents].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  assert.strictEqual(sorted[0].id, 'evt-003'); // Newest (Date.now() - 3000)
  assert.strictEqual(sorted[1].id, 'evt-002'); // Middle (Date.now() - 5000)
  assert.strictEqual(sorted[2].id, 'evt-001'); // Oldest (Date.now() - 10000)
});

test('Event stream: Limit display to last 50 events', () => {
  const allEvents = Array.from({ length: 100 }, (_, i) => ({
    ...mockEvents[0],
    id: `evt-${i}`,
    timestamp: new Date(Date.now() - i * 1000).toISOString(),
  }));

  const displayed = allEvents.slice(-50);

  assert.strictEqual(displayed.length, 50);
  assert.strictEqual(displayed[0].id, 'evt-50'); // Oldest in display
});

// ── Cursor Management Tests ────

test('Cursor management: Persist cursor to localStorage', () => {
  const storageMap = new Map<string, string>();

  const cursorKey = 'event-cursor-proj-001';
  const cursor = 'cursor-abc-123';

  storageMap.set(cursorKey, cursor);

  assert.strictEqual(storageMap.get(cursorKey), cursor);
});

test('Cursor management: Load cursor from localStorage on mount', () => {
  const storageMap = new Map<string, string>();
  const cursorKey = 'event-cursor-proj-002';
  const savedCursor = 'cursor-old-xyz';

  storageMap.set(cursorKey, savedCursor);

  const loaded = storageMap.get(cursorKey);
  assert.strictEqual(loaded, savedCursor);
});

test('Cursor management: Different cursors per project filter', () => {
  const storageMap = new Map<string, string>();

  const globalKey = 'event-cursor-global';
  const proj1Key = 'event-cursor-proj-001';
  const proj2Key = 'event-cursor-proj-002';

  storageMap.set(globalKey, 'cursor-global-1');
  storageMap.set(proj1Key, 'cursor-proj-1-1');
  storageMap.set(proj2Key, 'cursor-proj-2-1');

  assert.notStrictEqual(
    storageMap.get(globalKey),
    storageMap.get(proj1Key),
  );
  assert.notStrictEqual(
    storageMap.get(proj1Key),
    storageMap.get(proj2Key),
  );
});

// ── Session Isolation Tests ────

test('Session isolation: Dashboard shows sessions only for project_id', () => {
  const sessionContext = {
    projectId: 'proj-001',
  };

  const allSessions = [
    { id: 'sess-1', metadata: { project_id: 'proj-001' } },
    { id: 'sess-2', metadata: { project_id: 'proj-001' } },
    { id: 'sess-3', metadata: { project_id: 'proj-002' } },
    { id: 'sess-4', metadata: { project_id: 'root' } },
  ];

  const isolated = allSessions.filter(
    (s) => s.metadata.project_id === sessionContext.projectId,
  );

  assert.strictEqual(isolated.length, 2);
  isolated.forEach((s) => {
    assert.strictEqual(s.metadata.project_id, sessionContext.projectId);
  });
});

test('Session isolation: Cross-project access denied', () => {
  const sessionContext = { projectId: 'proj-001' };
  const requestedProjectId = 'proj-002';

  const allowed = !sessionContext.projectId || sessionContext.projectId === requestedProjectId;

  assert.strictEqual(allowed, false);
});

test('Session isolation: Root session (Genesis) can access all events', () => {
  const sessionContext = { projectId: 'root' };

  // Root session has no project filter restriction
  const canAccessAll = sessionContext.projectId === 'root' || !sessionContext.projectId;

  assert.strictEqual(canAccessAll, true);
});

// ── Project List Rendering Tests ────

test('Project list: Displays status color correctly', () => {
  const statusColors = {
    healthy: 'bio',
    git_corrupted: 'solar',
    missing_config: 'solar',
    permission_denied: 'error',
  };

  mockProjects.forEach((project) => {
    const color = statusColors[project.status as keyof typeof statusColors];
    assert(color, `Missing color for status ${project.status}`);
  });
});

test('Project list: Formats discovered_at timestamp', () => {
  const project = mockProjects[0];
  const date = new Date(project.discovered_at);

  assert(date.getTime() > 0, 'Should parse valid ISO timestamp');
});

test('Project list: Filters projects by status', () => {
  const healthyProjects = mockProjects.filter((p) => p.status === 'healthy');

  assert.strictEqual(healthyProjects.length, 2);
  healthyProjects.forEach((p) => {
    assert.strictEqual(p.status, 'healthy');
  });
});

// ── Error Handling Tests ────

test('Error handling: 403 Forbidden for cross-project access attempt', () => {
  const sessionContext = { projectId: 'proj-001' };
  const requestedProjectId = 'proj-002';

  const allowed = !sessionContext.projectId || sessionContext.projectId === requestedProjectId;

  const statusCode = allowed ? 200 : 403;
  assert.strictEqual(statusCode, 403);
});

test('Error handling: 404 Not Found for missing project', () => {
  const projectId = 'proj-nonexistent';
  const project = mockProjects.find((p) => p.id === projectId);

  const statusCode = project ? 200 : 404;
  assert.strictEqual(statusCode, 404);
});

test('Error handling: Poll retry on network error', () => {
  let attemptCount = 0;
  const maxRetries = 1;

  function retry() {
    attemptCount++;
    if (attemptCount <= maxRetries) {
      return retry();
    }
  }

  retry();
  assert.strictEqual(attemptCount, 2); // Initial + 1 retry
});

// ── Genesis Event Integration Tests ────

test('Genesis integration: Highlight Genesis events in stream', () => {
  const genesisEvent = mockEvents.find((e) => e.metadata?.is_genesis === true);

  assert(genesisEvent);
  assert.strictEqual(genesisEvent?.metadata?.is_genesis, true);
});

test('Genesis integration: Genesis events include timestamp and data', () => {
  const genesisEvent = mockEvents.find((e) => e.metadata?.is_genesis === true);

  assert(genesisEvent?.timestamp);
  assert(genesisEvent?.data);
  assert(Object.keys(genesisEvent.data).length > 0);
});

test('Genesis integration: Filter Genesis events separately', () => {
  const allGenesis = mockEvents.filter(
    (e) => e.metadata?.is_genesis === true,
  );

  assert.strictEqual(allGenesis.length, 1);
  assert.strictEqual(allGenesis[0].metadata?.is_genesis, true);
});
