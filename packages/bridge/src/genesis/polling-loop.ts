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
 * Polling strategy:
 * - Run every N seconds (configurable, default 5s)
 * - Read events since last cursor
 * - If new events found, prompt Genesis to observe and report
 * - Update cursor and persist to disk
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import * as yaml from 'js-yaml';
import type { SessionPool } from '../pool.js';
import type { ProjectEvent } from '@method/core';

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
}

const DEFAULT_INTERVAL_MS = 5000; // 5 seconds
const DEFAULT_CURSOR_FILE = '.method/genesis-cursors.yaml';
const CURSOR_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Load cursors from .method/genesis-cursors.yaml
 */
export function loadCursors(filePath: string = DEFAULT_CURSOR_FILE): GenesisCursors {
  try {
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8');
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
 * Save cursors to .method/genesis-cursors.yaml
 */
export function saveCursors(cursors: GenesisCursors, filePath: string = DEFAULT_CURSOR_FILE): void {
  try {
    // Ensure .method directory exists
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Write YAML atomically (temp file + rename)
    const tmpFile = `${filePath}.tmp`;
    const yamlContent = yaml.dump(cursors, { lineWidth: -1 });

    writeFileSync(tmpFile, yamlContent, 'utf-8');
    renameSync(tmpFile, filePath);
  } catch (err) {
    console.error(`Failed to save cursors to ${filePath}:`, (err as Error).message);
  }
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

  constructor(config?: PollingLoopConfig) {
    this.intervalMs = config?.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.cursorFilePath = config?.cursorFilePath ?? DEFAULT_CURSOR_FILE;
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
   */
  start(
    sessionId: string,
    pool: SessionPool,
    eventFetcher: (projectId: string, cursor: string) => Promise<ProjectEvent[]>,
    onNewEvents?: (projectId: string, events: ProjectEvent[]) => Promise<void>,
  ): void {
    if (this.running) {
      console.warn('Polling loop already running');
      return;
    }

    this.running = true;

    this.pollingIntervalId = setInterval(async () => {
      try {
        await this.pollOnce(pool, sessionId, eventFetcher, onNewEvents);
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
   */
  private async pollOnce(
    pool: SessionPool,
    sessionId: string,
    eventFetcher: (projectId: string, cursor: string) => Promise<ProjectEvent[]>,
    onNewEvents?: (projectId: string, events: ProjectEvent[]) => Promise<void>,
  ): Promise<void> {
    // For now, simple implementation: just poll "root" project
    // In production, this would iterate over discovered projects

    const projectId = 'root';
    const currentCursor = getCursorForProject(this.cursors, projectId);

    try {
      const events = await eventFetcher(projectId, currentCursor);

      if (events.length > 0) {
        console.log(`Genesis: Found ${events.length} new events for project ${projectId}`);

        // Update cursor
        const lastEvent = events[events.length - 1];
        const newCursor = lastEvent.id || `cursor-${Date.now()}`;
        this.cursors = updateCursorForProject(this.cursors, projectId, newCursor, events.length);

        // Save cursors to disk
        saveCursors(this.cursors, this.cursorFilePath);

        // Invoke callback if provided
        if (onNewEvents) {
          await onNewEvents(projectId, events);
        }
      }
    } catch (err) {
      console.warn(
        `Genesis polling error for project ${projectId}:`,
        (err as Error).message,
      );
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
