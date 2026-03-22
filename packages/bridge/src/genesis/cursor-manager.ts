/**
 * Cursor Maintenance Job
 *
 * PRD 020 Phase 3: Scheduled background job for cursor cleanup.
 *
 * Moves cursor cleanup from inline (unpredictable latency in getCursorForProject)
 * to a scheduled 1-hour background job. This ensures cleanup runs predictably
 * without blocking event fetches.
 *
 * Features:
 * - Runs every 1 hour (configurable via CURSOR_CLEANUP_INTERVAL_MS)
 * - Removes Genesis cursors > 7 days old from .method/genesis-cursors.yaml
 * - Atomic file operations (temp file + rename)
 * - Graceful shutdown (stops immediately without interrupting mid-cleanup)
 * - Logs each cleanup run with count of removed cursors
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import * as yaml from 'js-yaml';

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

const CURSOR_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * CursorMaintenanceJob
 *
 * Scheduled background job for cursor cleanup. Runs every 1 hour,
 * removes cursors > 7 days old, and persists the cleaned state to disk.
 */
export class CursorMaintenanceJob {
  private intervalMs: number;
  private cursorFilePath: string;
  private intervalId: NodeJS.Timeout | null = null;
  private running = false;
  private lastCleanupAt: Date | null = null;

  /**
   * Create a new cursor maintenance job.
   *
   * @param cursorFilePath Path to the cursor file (default: .method/genesis-cursors.yaml)
   * @param intervalMs Cleanup interval in milliseconds (default: 3600000 = 1 hour)
   */
  constructor(cursorFilePath: string = '.method/genesis-cursors.yaml', intervalMs: number = 3600000) {
    this.cursorFilePath = cursorFilePath;
    this.intervalMs = intervalMs;
  }

  /**
   * Start the maintenance job.
   * Cleanup runs every intervalMs milliseconds in the background.
   */
  start(): void {
    if (this.running) {
      console.warn('[Cursor cleanup] Job already running');
      return;
    }

    this.running = true;

    this.intervalId = setInterval(() => {
      this.runCleanup();
    }, this.intervalMs);

    console.log(`[Cursor cleanup] Job started (interval: ${this.intervalMs}ms)`);
  }

  /**
   * Stop the maintenance job.
   * Clears the interval without interrupting an in-progress cleanup.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.running = false;
    console.log('[Cursor cleanup] Job stopped');
  }

  /**
   * Check if the job is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the timestamp of the last cleanup.
   */
  getLastCleanupAt(): Date | null {
    return this.lastCleanupAt;
  }

  /**
   * Load cursors from disk.
   */
  private loadCursors(): GenesisCursors {
    try {
      if (!existsSync(this.cursorFilePath)) {
        return {
          lastPolled: new Date().toISOString(),
          cursors: [],
        };
      }

      const content = readFileSync(this.cursorFilePath, 'utf-8');
      const parsed = yaml.load(content) as any;

      if (parsed && typeof parsed === 'object' && 'cursors' in parsed) {
        return parsed as GenesisCursors;
      }
    } catch (err) {
      console.warn(`[Cursor cleanup] Failed to load cursors: ${(err as Error).message}`);
    }

    return {
      lastPolled: new Date().toISOString(),
      cursors: [],
    };
  }

  /**
   * Save cursors to disk atomically (temp file + rename).
   */
  private saveCursors(cursors: GenesisCursors): void {
    try {
      const dir = dirname(this.cursorFilePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const tmpFile = `${this.cursorFilePath}.tmp`;
      const yamlContent = yaml.dump(cursors, { lineWidth: -1 });

      writeFileSync(tmpFile, yamlContent, 'utf-8');
      renameSync(tmpFile, this.cursorFilePath);
    } catch (err) {
      console.error(`[Cursor cleanup] Failed to save cursors: ${(err as Error).message}`);
    }
  }

  /**
   * Run a cleanup iteration.
   * This is called by the interval timer and should not be called directly
   * unless testing.
   */
  private runCleanup(): void {
    try {
      const cursors = this.loadCursors();
      const initialCount = cursors.cursors.length;

      // Filter out cursors older than 7 days
      const now = Date.now();
      cursors.cursors = cursors.cursors.filter((cursor) => {
        const lastUpdateTime = new Date(cursor.lastUpdate).getTime();
        const age = now - lastUpdateTime;
        return age < CURSOR_TTL_MS;
      });

      const removedCount = initialCount - cursors.cursors.length;

      // Always save (even if nothing changed) to update lastPolled timestamp
      this.saveCursors(cursors);

      this.lastCleanupAt = new Date();

      // Log the result
      if (removedCount > 0) {
        console.log(`[Cursor cleanup] Removed ${removedCount} stale cursor(s)`);
      } else if (initialCount > 0) {
        console.log(`[Cursor cleanup] No stale cursors found (${initialCount} active)`);
      }
    } catch (err) {
      console.error(`[Cursor cleanup] Cleanup failed: ${(err as Error).message}`);
    }
  }

  /**
   * Perform a manual cleanup run (for testing or on-demand).
   * Returns the number of cursors removed.
   */
  async cleanupOnce(): Promise<number> {
    const cursors = this.loadCursors();
    const initialCount = cursors.cursors.length;

    const now = Date.now();
    cursors.cursors = cursors.cursors.filter((cursor) => {
      const lastUpdateTime = new Date(cursor.lastUpdate).getTime();
      const age = now - lastUpdateTime;
      return age < CURSOR_TTL_MS;
    });

    const removedCount = initialCount - cursors.cursors.length;

    // Always save and update lastCleanupAt to record that cleanup ran
    this.saveCursors(cursors);
    this.lastCleanupAt = new Date();

    return removedCount;
  }
}
