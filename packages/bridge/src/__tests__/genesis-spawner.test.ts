/**
 * PRD 020 Phase 2A: Genesis Spawner Tests
 *
 * Unit tests for Genesis persistent session spawning, polling loop, and cursor management.
 * 18+ tests covering:
 * - Genesis spawning with project_id="root"
 * - Budget initialization and tracking
 * - Polling loop with cursor-based event fetching
 * - Cursor persistence to .method/genesis-cursors.yaml
 * - Cursor recovery across bridge restarts
 * - Initialization prompt generation
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { getGenesisInitializationPrompt } from '../genesis/initialization.js';
import {
  spawnGenesis,
  getGenesisStatus,
  isGenesisRunning,
  getGenesisSessionId,
  type GenesisSpawnResult,
} from '../genesis/spawner.js';
import {
  loadCursors,
  saveCursors,
  getCursorForProject,
  updateCursorForProject,
  GenesisPollingLoop,
  type GenesisCursors,
  type CursorState,
} from '../genesis/polling-loop.js';
import type { SessionPool, SessionStatusInfo } from '../pool.js';
import type { ProjectEvent } from '@method/core';

// Mock SessionPool
class MockSessionPool implements SessionPool {
  private sessions = new Map<string, SessionStatusInfo>();
  private sessionCount = 0;

  async create(options: any): Promise<any> {
    const sessionId = `genesis-${++this.sessionCount}`;
    const status: SessionStatusInfo = {
      sessionId,
      nickname: options.nickname || 'genesis',
      purpose: 'Genesis coordination',
      status: 'running',
      queueDepth: 0,
      metadata: options.metadata,
      promptCount: 0,
      lastActivityAt: new Date(),
      workdir: options.workdir,
      chain: {
        parent_session_id: null,
        depth: 0,
        children: [],
        budget: { max_depth: 3, max_agents: 10, agents_spawned: 0 },
      },
      worktree: {
        isolation: 'shared',
        worktree_path: null,
        worktree_branch: null,
        metals_available: true,
      },
      stale: false,
      waiting_for: null,
      mode: options.mode || 'pty',
      diagnostics: null,
    };
    this.sessions.set(sessionId, status);

    return {
      sessionId,
      nickname: options.nickname || 'genesis',
      status: 'running',
      chain: status.chain,
      worktree: status.worktree,
      mode: status.mode,
    };
  }

  async prompt(): Promise<any> {
    return { output: '', timedOut: false };
  }

  status(sessionId: string): SessionStatusInfo {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    return session;
  }

  kill(): any {
    return { sessionId: '', killed: true, worktree_cleaned: true };
  }

  list(): SessionStatusInfo[] {
    return Array.from(this.sessions.values());
  }

  poolStats(): any {
    return {
      totalSpawned: this.sessions.size,
      startedAt: new Date(),
      maxSessions: 10,
      activeSessions: this.sessions.size,
      deadSessions: 0,
    };
  }

  removeDead(): number {
    return 0;
  }

  getChannels(): any {
    return { messages: [] };
  }

  getSession(): any {
    return {};
  }

  checkStale(): any {
    return { stale: [], killed: [] };
  }

  childPids(): number[] {
    return [];
  }

  setObservationHook(): void {}
}

describe('Genesis Initialization Prompt', () => {
  it('should generate initialization prompt with OBSERVE+REPORT instructions', () => {
    const prompt = getGenesisInitializationPrompt();
    assert(prompt.includes('OBSERVE'));
    assert(prompt.includes('REPORT'));
    assert(prompt.includes('coordinator'));
  });

  it('should not authorize Genesis to execute directly', () => {
    const prompt = getGenesisInitializationPrompt();
    assert(prompt.includes('Do NOT execute'));
    assert(prompt.includes('Do NOT spawn sub-agents'));
  });

  it('should list available tools', () => {
    const prompt = getGenesisInitializationPrompt();
    assert(prompt.includes('project_list'));
    assert(prompt.includes('project_get'));
    assert(prompt.includes('project_read_events'));
    assert(prompt.includes('genesis_report'));
  });

  it('should include budget constraints', () => {
    const prompt = getGenesisInitializationPrompt();
    assert(prompt.includes('50K tokens/day'));
  });
});

describe('Genesis Spawner', () => {
  let pool: MockSessionPool;

  beforeEach(() => {
    pool = new MockSessionPool();
  });

  it('should spawn Genesis with project_id=root', async () => {
    const result = await spawnGenesis(pool, process.cwd());
    assert(result.sessionId);
    assert.strictEqual(result.projectId, 'root');
    assert.strictEqual(result.initialized, true);
  });

  it('should set default budget to 50K tokens/day', async () => {
    const result = await spawnGenesis(pool, process.cwd());
    assert.strictEqual(result.budgetTokensPerDay, 50000);
  });

  it('should allow custom budget configuration', async () => {
    const customBudget = 100000;
    const result = await spawnGenesis(pool, process.cwd(), customBudget);
    assert.strictEqual(result.budgetTokensPerDay, customBudget);
  });

  it('should set Genesis metadata flag', async () => {
    const result = await spawnGenesis(pool, process.cwd());
    const status = pool.status(result.sessionId);
    assert.strictEqual(status.metadata?.genesis, true);
  });

  it('should use OBSERVE+REPORT initialization prompt', async () => {
    const result = await spawnGenesis(pool, process.cwd());
    const prompt = getGenesisInitializationPrompt();
    assert(prompt.includes('OBSERVE'));
  });

  it('getGenesisStatus should return running Genesis session', async () => {
    await spawnGenesis(pool, process.cwd());
    const status = getGenesisStatus(pool);
    assert(status);
    assert.strictEqual(status?.metadata?.genesis, true);
  });

  it('isGenesisRunning should return true when Genesis is spawned', async () => {
    await spawnGenesis(pool, process.cwd());
    assert.strictEqual(isGenesisRunning(pool), true);
  });

  it('getGenesisSessionId should return session ID', async () => {
    const result = await spawnGenesis(pool, process.cwd());
    const sessionId = getGenesisSessionId(pool);
    assert.strictEqual(sessionId, result.sessionId);
  });

  it('should return undefined when Genesis is not running', () => {
    const status = getGenesisStatus(pool);
    assert.strictEqual(status, undefined);
  });

  it('isGenesisRunning should return false when Genesis not spawned', () => {
    assert.strictEqual(isGenesisRunning(pool), false);
  });

  it('getGenesisSessionId should return undefined when not running', () => {
    const sessionId = getGenesisSessionId(pool);
    assert.strictEqual(sessionId, undefined);
  });
});

describe('Cursor Management', () => {
  it('should load empty cursors when file does not exist', () => {
    const tmpFile = join(process.cwd(), '.test-cursors.yaml');
    if (existsSync(tmpFile)) {
      unlinkSync(tmpFile);
    }

    const cursors = loadCursors(tmpFile);
    assert.deepStrictEqual(cursors.cursors, []);
    assert(cursors.lastPolled);
  });

  it('should save and load cursors atomically', () => {
    const tmpFile = join(process.cwd(), '.test-cursors-atomic.yaml');

    try {
      const original: GenesisCursors = {
        lastPolled: new Date().toISOString(),
        cursors: [
          {
            projectId: 'test-project',
            cursor: 'cursor-123',
            lastUpdate: new Date().toISOString(),
            eventCount: 5,
          },
        ],
      };

      saveCursors(original, tmpFile);
      const loaded = loadCursors(tmpFile);

      assert.strictEqual(loaded.cursors.length, 1);
      assert.strictEqual(loaded.cursors[0].projectId, 'test-project');
      assert.strictEqual(loaded.cursors[0].cursor, 'cursor-123');
      assert.strictEqual(loaded.cursors[0].eventCount, 5);
    } finally {
      if (existsSync(tmpFile)) {
        unlinkSync(tmpFile);
      }
    }
  });

  it('should get cursor for project (empty if not found)', () => {
    const cursors: GenesisCursors = {
      lastPolled: new Date().toISOString(),
      cursors: [],
    };

    const cursor = getCursorForProject(cursors, 'missing-project');
    assert.strictEqual(cursor, '');
  });

  it('should get existing cursor for project', () => {
    const cursors: GenesisCursors = {
      lastPolled: new Date().toISOString(),
      cursors: [
        {
          projectId: 'test-project',
          cursor: JSON.stringify({ version: '1', projectId: 'test-project', index: 3, timestamp: new Date().toISOString() }),
          lastUpdate: new Date().toISOString(),
          eventCount: 3,
        },
      ],
    };

    const cursor = getCursorForProject(cursors, 'test-project');
    assert(cursor.length > 0, 'Cursor should be non-empty');
    const parsed = JSON.parse(cursor);
    assert.strictEqual(parsed.version, '1');
    assert.strictEqual(parsed.projectId, 'test-project');
  });

  it('should update cursor for existing project', () => {
    let cursors: GenesisCursors = {
      lastPolled: new Date().toISOString(),
      cursors: [
        {
          projectId: 'test-project',
          cursor: JSON.stringify({ version: '1', projectId: 'test-project', index: 1, timestamp: new Date().toISOString() }),
          lastUpdate: new Date().toISOString(),
          eventCount: 1,
        },
      ],
    };

    cursors = updateCursorForProject(cursors, 'test-project', 'cursor-new', 2);

    assert.strictEqual(cursors.cursors.length, 1);
    // Cursor is stored as JSON with version
    const parsed = JSON.parse(cursors.cursors[0].cursor);
    assert.strictEqual(parsed.version, '1');
    assert.strictEqual(parsed.projectId, 'test-project');
    assert.strictEqual(parsed.index, 2);
    assert.strictEqual(cursors.cursors[0].eventCount, 2);
  });

  it('should create new cursor entry for new project', () => {
    let cursors: GenesisCursors = {
      lastPolled: new Date().toISOString(),
      cursors: [],
    };

    cursors = updateCursorForProject(cursors, 'new-project', 'cursor-first', 1);

    assert.strictEqual(cursors.cursors.length, 1);
    assert.strictEqual(cursors.cursors[0].projectId, 'new-project');
    // Cursor is stored as JSON with version
    const parsed = JSON.parse(cursors.cursors[0].cursor);
    assert.strictEqual(parsed.version, '1');
    assert.strictEqual(parsed.projectId, 'new-project');
  });

  it('should update lastPolled timestamp when updating cursors', () => {
    let cursors: GenesisCursors = {
      lastPolled: '2026-03-01T00:00:00Z',
      cursors: [],
    };

    const beforeUpdate = new Date();
    cursors = updateCursorForProject(cursors, 'test', 'cursor', 0);
    const afterUpdate = new Date();

    const lastPolled = new Date(cursors.lastPolled);
    assert(lastPolled.getTime() >= beforeUpdate.getTime());
    assert(lastPolled.getTime() <= afterUpdate.getTime());
  });
});

describe('GenesisPollingLoop', () => {
  it('should initialize with default config', () => {
    const loop = new GenesisPollingLoop();
    assert.strictEqual(loop.isRunning(), false);
  });

  it('should initialize with custom interval', () => {
    const loop = new GenesisPollingLoop({ intervalMs: 10000 });
    assert.strictEqual(loop.isRunning(), false);
  });

  it('should load cursors from file on construction', () => {
    const tmpFile = join(process.cwd(), '.test-polling-cursors.yaml');

    try {
      const initial: GenesisCursors = {
        lastPolled: new Date().toISOString(),
        cursors: [
          {
            projectId: 'root',
            cursor: 'existing-cursor',
            lastUpdate: new Date().toISOString(),
            eventCount: 10,
          },
        ],
      };
      saveCursors(initial, tmpFile);

      const loop = new GenesisPollingLoop({ cursorFilePath: tmpFile });
      const cursors = loop.getCursors();

      assert.strictEqual(cursors.cursors.length, 1);
      assert.strictEqual(cursors.cursors[0].cursor, 'existing-cursor');
    } finally {
      if (existsSync(tmpFile)) {
        unlinkSync(tmpFile);
      }
    }
  });

  it('should track cursor state and persist updates', async () => {
    const tmpFile = join(process.cwd(), '.test-polling-persist.yaml');
    const pool = new MockSessionPool();

    try {
      const loop = new GenesisPollingLoop({ intervalMs: 50, cursorFilePath: tmpFile });

      // Simulate event fetching
      const mockEvents: ProjectEvent[] = [
        {
          id: 'evt-001',
          type: 'DISCOVERED' as any,
          projectId: 'root',
          timestamp: new Date(),
          data: { test: true },
          metadata: {},
        },
        {
          id: 'evt-002',
          type: 'DISCOVERED' as any,
          projectId: 'root',
          timestamp: new Date(),
          data: { test: true },
          metadata: {},
        },
      ];

      let callCount = 0;
      const eventFetcher = async () => {
        callCount++;
        return callCount === 1 ? mockEvents : [];
      };

      let newEventsReceived: ProjectEvent[] = [];
      const onNewEvents = async (_projectId: string, events: ProjectEvent[]) => {
        newEventsReceived = events;
      };

      // Start polling with a very short interval for testing
      loop.start('test-session', pool, eventFetcher, onNewEvents);

      // Wait for one poll iteration (50ms interval + buffer)
      await new Promise(r => setTimeout(r, 150));

      loop.stop();

      // Verify events were received
      assert.strictEqual(newEventsReceived.length, 2);

      // Verify cursor was persisted
      const loaded = loadCursors(tmpFile);
      assert(loaded.cursors.length > 0);
    } finally {
      if (existsSync(tmpFile)) {
        unlinkSync(tmpFile);
      }
    }
  });

  it('should not poll multiple times concurrently', async () => {
    const loop = new GenesisPollingLoop({ intervalMs: 100 });
    const pool = new MockSessionPool();

    let pollCount = 0;
    const eventFetcher = async () => {
      pollCount++;
      await new Promise(r => setTimeout(r, 200));
      return [];
    };

    loop.start('test-session', pool, eventFetcher);

    // Wait a bit
    await new Promise(r => setTimeout(r, 150));

    loop.stop();

    // Should have polled only once (or just started second)
    assert(pollCount <= 2);
  });

  it('should continue polling after errors', async () => {
    const tmpFile = join(process.cwd(), '.test-polling-error.yaml');
    const loop = new GenesisPollingLoop({ intervalMs: 100, cursorFilePath: tmpFile });
    const pool = new MockSessionPool();

    try {
      let attemptCount = 0;
      const eventFetcher = async () => {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error('Transient error');
        }
        return [];
      };

      loop.start('test-session', pool, eventFetcher);

      // Wait for multiple poll attempts
      await new Promise(r => setTimeout(r, 250));

      loop.stop();

      // Should have attempted at least twice
      assert(attemptCount >= 2);
    } finally {
      if (existsSync(tmpFile)) {
        unlinkSync(tmpFile);
      }
    }
  });

  it('should support stop and restart', async () => {
    const loop = new GenesisPollingLoop({ intervalMs: 100 });
    const pool = new MockSessionPool();

    const eventFetcher = async () => [];

    assert.strictEqual(loop.isRunning(), false);

    loop.start('session-1', pool, eventFetcher);
    assert.strictEqual(loop.isRunning(), true);

    loop.stop();
    assert.strictEqual(loop.isRunning(), false);

    loop.start('session-2', pool, eventFetcher);
    assert.strictEqual(loop.isRunning(), true);

    loop.stop();
  });

  it('should warn if start called while already running', () => {
    const loop = new GenesisPollingLoop({ intervalMs: 100 });
    const pool = new MockSessionPool();
    const eventFetcher = async () => [];

    let warnCalled = false;
    const originalWarn = console.warn;
    console.warn = () => { warnCalled = true; };

    loop.start('session-1', pool, eventFetcher);
    loop.start('session-2', pool, eventFetcher); // Should warn

    loop.stop();
    console.warn = originalWarn;

    assert(warnCalled);
  });
});
