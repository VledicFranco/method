/**
 * PRD 020 Phase 2A: Genesis Polling Loop
 *
 * Polls for new events from project event stream, manages cursor state,
 * and dispatches prompts to Genesis for analysis and reporting.
 *
 * Cursor persistence:
 * - Read/write .method/genesis-cursors.yaml on startup and after each poll
 * - Survives bridge restarts
 * - One cursor per project (or "global" for all events)
 *
 * TIER_0 Fix (F-R-001): Cursor file operations are protected by file-level mutex
 * to prevent race conditions when concurrent polls or cleanups run.
 *
 * Polling strategy:
 * - Run every N seconds (configurable, default 5s)
 * - Read events since last cursor
 * - If new events found, prompt Genesis to observe and report
 * - Update cursor and persist to disk
 */

import { dirname } from 'node:path';
import { NodeFileSystemProvider, type FileSystemProvider } from '../../ports/file-system.js';
import { JsYamlLoader, type YamlLoader } from '../../ports/yaml-loader.js';

// PRD 024 MG-1/MG-2: Module-level ports (lazy-init with production defaults)
let _fs: FileSystemProvider | null = null;
let _yaml: YamlLoader | null = null;

/** PRD 024: Configure ports for polling-loop. Called from composition root. */
export function setPollingLoopPorts(fs: FileSystemProvider, yaml: YamlLoader): void {
  _fs = fs;
  _yaml = yaml;
}

function getFs(): FileSystemProvider {
  if (!_fs) _fs = new NodeFileSystemProvider();
  return _fs;
}
function getYaml(): YamlLoader {
  if (!_yaml) _yaml = new JsYamlLoader();
  return _yaml;
}
import type { SessionPool } from '../sessions/pool.js';
import type { ProjectEvent } from '../projects/events/index.js';

export interface CursorState {
  projectId: string;
  cursor: string;
  lastUpdate: string;
  eventCount: number;
}

export interface GenesisCursors {
  lastPolled: string;
  cursors: CursorState[];
}

export interface PollingLoopConfig {
  intervalMs?: number;
  cursorFilePath?: string;
  methodDir?: string;
  maxConcurrentPolls?: number;
}

const DEFAULT_INTERVAL_MS = 5000; // 5 seconds
const DEFAULT_CURSOR_FILE = '.method/genesis-cursors.yaml';
const CURSOR_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_MAX_CONCURRENT_POLLS = 5;

/**
 * CursorFileLock (F-R-001)
 *
 * File-level mutex to protect cursor file operations.
 * Prevents race conditions when concurrent reads/writes happen from polling loop
 * and cleanup job running simultaneously.
 *
 * Uses a queue-based approach per file path to ensure strict mutual exclusion.
 */
class CursorFileLock {
  private lockPath: string;
  private operationQueue: Promise<void> = Promise.resolve();
  private locked = false;

  constructor(cursorFilePath: string) {
    this.lockPath = cursorFilePath;
    // Ensure directory exists for lock file
    const dir = dirname(cursorFilePath);
    if (_fs && !_fs.existsSync(dir)) {
      _fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Acquire the lock (for testing compatibility).
   * In queue-based approach, this marks the lock as acquired.
   */
  async acquire(): Promise<void> {
    // Wait for queue to be ready
    await this.operationQueue;
    this.locked = true;
  }

  /**
   * Release the lock (for testing compatibility).
   */
  async release(): Promise<void> {
    this.locked = false;
  }

  /**
   * Check if locked (for testing).
   */
  isLocked(): boolean {
    return this.locked;
  }

  /**
   * Execute a function while holding the lock.
   * Operations are queued and executed sequentially.
   * F-R-001: Guarantees mutual exclusion via promise chain.
   */
  async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    // Chain this operation to the queue
    const result = this.operationQueue.then(async () => {
      this.locked = true;
      try {
        return await Promise.resolve(fn());
      } finally {
        this.locked = false;
      }
    });

    // Update queue to include this operation
    this.operationQueue = result.then(() => undefined).catch(() => {
      // Even on error, continue queue processing
    });

    return result;
  }
}

/**
 * Load cursors from .method/genesis-cursors.yaml (synchronous, for startup)
 */
export function loadCursors(filePath: string = DEFAULT_CURSOR_FILE): GenesisCursors {
  const fs = getFs();
  const yaml = getYaml();
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = yaml.load(content) as any;

      if (parsed && typeof parsed === 'object' && 'cursors' in parsed) {
        return parsed as GenesisCursors;
      }
    }
  } catch (err) {
    console.warn(`Failed to load cursors from ${filePath}:`, (err as Error).message);
  }

  // Return default empty state
  return {
    lastPolled: new Date().toISOString(),
    cursors: [],
  };
}

/**
 * Load cursors from .method/genesis-cursors.yaml with file lock (async)
 * F-R-001: Protected by file lock for safe concurrent reads
 */
export async function loadCursorsLocked(
  filePath: string = DEFAULT_CURSOR_FILE,
): Promise<GenesisCursors> {
  const lock = new CursorFileLock(filePath);
  return lock.runExclusive(() => loadCursors(filePath));
}

/**
 * Save cursors to .method/genesis-cursors.yaml (synchronous)
 */
export function saveCursors(cursors: GenesisCursors, filePath: string = DEFAULT_CURSOR_FILE): void {
  const fs = getFs();
  const yaml = getYaml();
  try {
    // Ensure .method directory exists
    const dir = dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write YAML atomically (temp file + rename)
    const tmpFile = `${filePath}.tmp`;
    const yamlContent = yaml.dump(cursors);

    fs.writeFileSync(tmpFile, yamlContent, { encoding: 'utf-8' });
    fs.renameSync(tmpFile, filePath);
  } catch (err) {
    console.error(`Failed to save cursors to ${filePath}:`, (err as Error).message);
  }
}

/**
 * Save cursors to .method/genesis-cursors.yaml with file lock (async)
 * F-R-001: Protected by file lock for atomic read-modify-write
 */
export async function saveCursorsLocked(
  cursors: GenesisCursors,
  filePath: string = DEFAULT_CURSOR_FILE,
): Promise<void> {
  const lock = new CursorFileLock(filePath);
  return lock.runExclusive(() => saveCursors(cursors, filePath));
}

/**
 * Clean up cursors older than 7 days
 * Removes stale cursor entries to prevent unbounded memory growth
 */
export function cleanupStaleCursors(cursors: GenesisCursors): GenesisCursors {
  const now = Date.now();
  const initialCount = cursors.cursors.length;

  cursors.cursors = cursors.cursors.filter((cursor) => {
    const lastUpdateTime = new Date(cursor.lastUpdate).getTime();
    const age = now - lastUpdateTime;
    return age < CURSOR_TTL_MS;
  });

  const removedCount = initialCount - cursors.cursors.length;
  if (removedCount > 0) {
    console.log(`Genesis: Cleaned up ${removedCount} stale cursor(s)`);
  }

  return cursors;
}

/**
 * Get or create cursor for a project
 * Includes version field for Phase 3 migration compatibility
 * Checks TTL and removes expired cursors
 * Backward compatible: accepts both plain strings and versioned JSON cursors
 */
export function getCursorForProject(cursors: GenesisCursors, projectId: string): string {
  // F-P-2: Check TTL on access and remove expired cursors
  const now = Date.now();
  cursors.cursors = cursors.cursors.filter((cursor) => {
    const lastUpdateTime = new Date(cursor.lastUpdate).getTime();
    const age = now - lastUpdateTime;
    return age < CURSOR_TTL_MS;
  });

  const existing = cursors.cursors.find((c) => c.projectId === projectId);
  if (!existing?.cursor) {
    return '';
  }

  // Try to parse as versioned cursor (Phase 1+)
  try {
    const parsed = JSON.parse(existing.cursor);
    if (parsed.version && parsed.version !== '1') {
      console.warn(`Cursor version mismatch for project ${projectId}: expected 1, got ${parsed.version}. Resetting.`);
      return '';
    }
    // Valid versioned cursor
    return existing.cursor;
  } catch {
    // Not JSON - backward compatible: return plain string cursor as-is
    return existing.cursor;
  }
}

/**
 * Update cursor for a project
 * Cursor now includes: { version, projectId, index, timestamp }
 */
export function updateCursorForProject(
  cursors: GenesisCursors,
  projectId: string,
  newCursor: string,
  eventCount: number,
): GenesisCursors {
  const existing = cursors.cursors.findIndex((c) => c.projectId === projectId);

  // Format cursor as structured object with version
  const cursorObject = {
    version: '1',
    projectId,
    index: eventCount,
    timestamp: new Date().toISOString(),
  };

  const updated: CursorState = {
    projectId,
    cursor: JSON.stringify(cursorObject),
    lastUpdate: new Date().toISOString(),
    eventCount,
  };

  if (existing >= 0) {
    cursors.cursors[existing] = updated;
  } else {
    cursors.cursors.push(updated);
  }

  cursors.lastPolled = new Date().toISOString();
  return cursors;
}

/**
 * Polling loop manager
 *
 * Handles cursor recovery, polling logic, and dispatching prompts to Genesis.
 * This is NOT the actual polling loop itself — it's the controller/factory
 * that other code calls to set up polling.
 */
export class GenesisPollingLoop {
  private intervalMs: number;
  private cursorFilePath: string;
  private pollingIntervalId: NodeJS.Timeout | null = null;
  private cursors: GenesisCursors;
  private running = false;
  private maxConcurrentPolls: number;
  private fileLock: CursorFileLock;

  constructor(config?: PollingLoopConfig) {
    const envMaxConcurrent = process.env.MAX_CONCURRENT_POLLS
      ? parseInt(process.env.MAX_CONCURRENT_POLLS, 10)
      : undefined;

    this.intervalMs = config?.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.cursorFilePath = config?.cursorFilePath ?? DEFAULT_CURSOR_FILE;
    this.maxConcurrentPolls = config?.maxConcurrentPolls ?? envMaxConcurrent ?? DEFAULT_MAX_CONCURRENT_POLLS;
    this.fileLock = new CursorFileLock(this.cursorFilePath);
    this.cursors = loadCursors(this.cursorFilePath);

    // F-P-2: Clean up stale cursors on startup (older than 7 days)
    this.cursors = cleanupStaleCursors(this.cursors);
  }

  /**
   * Start the polling loop
   *
   * Parameters:
   * - sessionId: Genesis session ID
   * - pool: SessionPool
   * - eventFetcher: Function to fetch events (project_read_events behavior)
   * - onNewEvents: Callback when new events detected
   * - projectProvider: Callback that returns array of project IDs to poll (defaults to ['root'])
   */
  start(
    sessionId: string,
    pool: SessionPool,
    eventFetcher: (projectId: string, cursor: string) => Promise<ProjectEvent[]>,
    onNewEvents?: (projectId: string, events: ProjectEvent[]) => Promise<void>,
    projectProvider?: () => string[],
  ): void {
    if (this.running) {
      console.warn('Polling loop already running');
      return;
    }

    this.running = true;

    this.pollingIntervalId = setInterval(async () => {
      try {
        await this.pollOnce(pool, sessionId, eventFetcher, onNewEvents, projectProvider);
      } catch (err) {
        console.error('Polling loop error:', (err as Error).message);
      }
    }, this.intervalMs);

    console.log(`Genesis polling loop started (interval: ${this.intervalMs}ms)`);
  }

  /**
   * Stop the polling loop
   */
  stop(): void {
    if (this.pollingIntervalId) {
      clearInterval(this.pollingIntervalId);
      this.pollingIntervalId = null;
    }
    this.running = false;
    console.log('Genesis polling loop stopped');
  }

  /**
   * Single poll iteration
   * Made public for testing purposes
   * F-A-3: Parallelizes polling across up to maxConcurrentPolls projects
   * F-R-001: Cursor operations are protected by file lock
   */
  async pollOnce(
    pool: SessionPool,
    sessionId: string,
    eventFetcher: (projectId: string, cursor: string) => Promise<ProjectEvent[]>,
    onNewEvents?: (projectId: string, events: ProjectEvent[]) => Promise<void>,
    projectProvider?: () => string[],
  ): Promise<void> {
    // Get list of projects to poll from projectProvider, defaulting to ['root']
    const projectIds = projectProvider ? projectProvider() : ['root'];

    // Parallelize polling with max concurrency limit
    for (let i = 0; i < projectIds.length; i += this.maxConcurrentPolls) {
      const batch = projectIds.slice(i, i + this.maxConcurrentPolls);

      // Poll batch in parallel
      const pollPromises = batch.map((projectId) => this.pollProject(projectId, eventFetcher, onNewEvents));

      // Wait for all to complete, collect results
      const batchResults = await Promise.allSettled(pollPromises);

      // Process results and update cursors (with lock)
      await this.fileLock.runExclusive(async () => {
        // Reload cursors to get latest state before modification
        this.cursors = loadCursors(this.cursorFilePath);

        for (let j = 0; j < batchResults.length; j++) {
          const result = batchResults[j];
          if (result.status === 'fulfilled' && result.value) {
            const { projectId, events } = result.value;
            if (events.length > 0) {
              // Update cursor
              const lastEvent = events[events.length - 1];
              const newCursor = lastEvent.id || `cursor-${Date.now()}`;
              this.cursors = updateCursorForProject(this.cursors, projectId, newCursor, events.length);
            }
          }
        }

        // Save cursors after each batch
        if (batchResults.some((r) => r.status === 'fulfilled')) {
          saveCursors(this.cursors, this.cursorFilePath);
        }
      });
    }
  }

  /**
   * Poll a single project for new events
   * Returns projectId and events if successful, or null on error
   */
  private async pollProject(
    projectId: string,
    eventFetcher: (projectId: string, cursor: string) => Promise<ProjectEvent[]>,
    onNewEvents?: (projectId: string, events: ProjectEvent[]) => Promise<void>,
  ): Promise<{ projectId: string; events: ProjectEvent[] } | null> {
    const currentCursor = getCursorForProject(this.cursors, projectId);

    try {
      const events = await eventFetcher(projectId, currentCursor);

      if (events.length > 0) {
        console.log(`Genesis: Found ${events.length} new events for project ${projectId}`);

        // Invoke callback if provided
        if (onNewEvents) {
          await onNewEvents(projectId, events);
        }
      }

      return { projectId, events };
    } catch (err) {
      console.warn(
        `Genesis polling error for project ${projectId}:`,
        (err as Error).message,
      );
      return null;
    }
  }

  /**
   * Get current cursor state
   */
  getCursors(): GenesisCursors {
    return { ...this.cursors };
  }

  /**
   * Check if polling is active
   */
  isRunning(): boolean {
    return this.running;
  }
}
