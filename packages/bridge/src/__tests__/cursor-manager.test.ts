/**
 * Cursor Manager Concurrency Tests
 *
 * F-T-003: Tests covering concurrent cursor operations
 * - Concurrent cursor generation
 * - Concurrent cleanup operations
 * - File consistency under load
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import * as yaml from 'js-yaml';
import { CursorFileLock, CursorMaintenanceJob, type CursorState, type GenesisCursors } from '../genesis/cursor-manager.js';

describe('Cursor Manager Concurrency Tests', () => {
  let testDir: string;
  let cursorFilePath: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `cursor-manager-test-${randomUUID()}`);
    cursorFilePath = path.join(testDir, 'genesis-cursors.yaml');
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe('CursorFileLock', () => {
    it('should acquire and release lock successfully', async () => {
      const lock = new CursorFileLock(cursorFilePath);

      assert.strictEqual(lock.isLocked(), false, 'Should not be locked initially');

      await lock.acquire();
      assert.strictEqual(lock.isLocked(), true, 'Should be locked after acquire');

      await lock.release();
      assert.strictEqual(lock.isLocked(), false, 'Should be unlocked after release');
    });

    it('should run exclusive function with lock', async () => {
      const lock = new CursorFileLock(cursorFilePath);
      let executed = false;

      await lock.runExclusive(async () => {
        executed = true;
        assert.strictEqual(lock.isLocked(), true, 'Should be locked during exclusive execution');
      });

      assert.strictEqual(executed, true, 'Function should have executed');
      assert.strictEqual(lock.isLocked(), false, 'Should be unlocked after exclusive execution');
    });

    it('should handle errors in exclusive function', async () => {
      const lock = new CursorFileLock(cursorFilePath);

      try {
        await lock.runExclusive(async () => {
          throw new Error('Test error');
        });
        assert.fail('Should have thrown error');
      } catch (err) {
        assert.strictEqual((err as Error).message, 'Test error');
      }

      // Lock should still be released
      assert.strictEqual(lock.isLocked(), false, 'Lock should be released even after error');
    });
  });

  describe('F-T-003: Cursor Manager Concurrent Operations', () => {
    it('F-T-003a: should handle 10 concurrent generateCursor-like operations', async () => {
      const lock = new CursorFileLock(cursorFilePath);
      const cursorCount = 10;
      const cursors: CursorState[] = [];

      // Initialize cursor file
      const initialState: GenesisCursors = {
        lastPolled: new Date().toISOString(),
        cursors: [],
      };
      await fs.writeFile(cursorFilePath, yaml.dump(initialState), 'utf-8');

      // Simulate concurrent cursor generation
      const operations = Array.from({ length: cursorCount }, (_, i) =>
        lock.runExclusive(async () => {
          // Load current cursors
          const content = await fs.readFile(cursorFilePath, 'utf-8');
          const state = (yaml.load(content) || {}) as GenesisCursors;

          // Generate new cursor
          const newCursor: CursorState = {
            projectId: `project-${i}`,
            cursor: `cursor-${i}-${randomUUID()}`,
            lastUpdate: new Date().toISOString(),
            eventCount: 0,
          };

          // Add to state
          state.cursors.push(newCursor);

          // Save back
          await fs.writeFile(cursorFilePath, yaml.dump(state), 'utf-8');

          return newCursor;
        }),
      );

      const results = await Promise.all(operations);
      assert.equal(results.length, cursorCount, 'All operations should complete');

      // Verify all cursors were saved
      const finalContent = await fs.readFile(cursorFilePath, 'utf-8');
      const finalState = (yaml.load(finalContent) || {}) as GenesisCursors;

      assert.equal(finalState.cursors.length, cursorCount, `Should have ${cursorCount} cursors saved`);

      // Verify no duplicates
      const projectIds = new Set(finalState.cursors.map((c) => c.projectId));
      assert.equal(projectIds.size, cursorCount, 'All project IDs should be unique');
    });

    it('F-T-003b: should handle concurrent cleanup operations without race conditions', async () => {
      const lock = new CursorFileLock(cursorFilePath);
      const job = new CursorMaintenanceJob(cursorFilePath, 100000); // 100s interval for manual testing

      // Create initial state with some cursors
      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

      const initialState: GenesisCursors = {
        lastPolled: now.toISOString(),
        cursors: [
          {
            projectId: 'fresh-project',
            cursor: 'fresh-cursor',
            lastUpdate: now.toISOString(),
            eventCount: 10,
          },
          {
            projectId: 'stale-project-1',
            cursor: 'stale-cursor-1',
            lastUpdate: twoWeeksAgo.toISOString(),
            eventCount: 5,
          },
          {
            projectId: 'stale-project-2',
            cursor: 'stale-cursor-2',
            lastUpdate: twoWeeksAgo.toISOString(),
            eventCount: 3,
          },
        ],
      };

      await fs.writeFile(cursorFilePath, yaml.dump(initialState), 'utf-8');

      // Run 5 concurrent cleanup operations
      const cleanupCount = 5;
      const cleanupOperations = Array.from({ length: cleanupCount }, () =>
        lock.runExclusive(async () => {
          return job.cleanupOnce();
        }),
      );

      const removedCounts = await Promise.all(cleanupOperations);

      // All cleanup operations should report same removal count (idempotent)
      // After first cleanup, subsequent cleanups should remove 0
      assert.equal(removedCounts[0], 2, 'First cleanup should remove 2 stale cursors');
      for (let i = 1; i < cleanupCount; i++) {
        assert.equal(removedCounts[i], 0, `Cleanup ${i + 1} should remove 0 (already cleaned)`);
      }

      // Verify final state
      const finalContent = await fs.readFile(cursorFilePath, 'utf-8');
      const finalState = (yaml.load(finalContent) || {}) as GenesisCursors;

      assert.equal(finalState.cursors.length, 1, 'Should have only 1 fresh cursor remaining');
      assert.equal(finalState.cursors[0].projectId, 'fresh-project', 'Fresh cursor should be preserved');
    });

    it('F-T-003c: should maintain file consistency under mixed concurrent load', async () => {
      const lock = new CursorFileLock(cursorFilePath);

      // Initialize cursor file
      const initialState: GenesisCursors = {
        lastPolled: new Date().toISOString(),
        cursors: [],
      };
      await fs.writeFile(cursorFilePath, yaml.dump(initialState), 'utf-8');

      // Mix of write and read operations running concurrently
      const writeCount = 5;
      const readCount = 5;

      const writeOperations = Array.from({ length: writeCount }, (_, i) =>
        lock.runExclusive(async () => {
          const content = await fs.readFile(cursorFilePath, 'utf-8');
          const state = (yaml.load(content) || {}) as GenesisCursors;

          state.cursors.push({
            projectId: `project-${i}`,
            cursor: `cursor-${i}`,
            lastUpdate: new Date().toISOString(),
            eventCount: i,
          });

          await fs.writeFile(cursorFilePath, yaml.dump(state), 'utf-8');
          return state.cursors.length;
        }),
      );

      const readOperations = Array.from({ length: readCount }, () =>
        lock.runExclusive(async () => {
          const content = await fs.readFile(cursorFilePath, 'utf-8');
          const state = (yaml.load(content) || {}) as GenesisCursors;
          return state.cursors.length;
        }),
      );

      // Run all operations concurrently
      const allResults = await Promise.all([...writeOperations, ...readOperations]);

      // Verify file is still valid YAML
      const finalContent = await fs.readFile(cursorFilePath, 'utf-8');
      assert.ok(finalContent, 'File should have content');

      // Should be parseable as valid YAML
      let parsedFinal: GenesisCursors;
      try {
        parsedFinal = (yaml.load(finalContent) || {}) as GenesisCursors;
      } catch (err) {
        assert.fail(`File should be valid YAML, got error: ${(err as Error).message}`);
      }

      // Should have exactly writeCount cursors
      assert.equal(parsedFinal.cursors.length, writeCount, `Should have exactly ${writeCount} cursors`);

      // All project IDs should be unique
      const projectIds = new Set(parsedFinal.cursors.map((c) => c.projectId));
      assert.equal(projectIds.size, writeCount, 'All project IDs should be unique');
    });

    it('F-T-003d: should verify lock actually prevents race conditions', async () => {
      const lock = new CursorFileLock(cursorFilePath);
      const raceDetected: string[] = [];

      // Initialize with counter
      const initialState: GenesisCursors = {
        lastPolled: new Date().toISOString(),
        cursors: [],
      };
      await fs.writeFile(cursorFilePath, yaml.dump(initialState), 'utf-8');

      // Create a counter-increment operation that's susceptible to races
      const operations = Array.from({ length: 5 }, (_, opIndex) =>
        lock.runExclusive(async () => {
          // Simulate a compound operation: read -> modify -> write
          const content = await fs.readFile(cursorFilePath, 'utf-8');
          const state = (yaml.load(content) || {}) as GenesisCursors;

          const currentCount = state.cursors.length;

          // Small delay to increase chance of race if no locking
          await new Promise((r) => setTimeout(r, 5));

          // Increment
          state.cursors.push({
            projectId: `project-${opIndex}`,
            cursor: `cursor-${opIndex}`,
            lastUpdate: new Date().toISOString(),
            eventCount: currentCount,
          });

          await fs.writeFile(cursorFilePath, yaml.dump(state), 'utf-8');

          return currentCount;
        }),
      );

      const results = await Promise.all(operations);

      // Verify file correctness
      const finalContent = await fs.readFile(cursorFilePath, 'utf-8');
      const finalState = (yaml.load(finalContent) || {}) as GenesisCursors;

      // Should have exactly 5 cursors (no lost increments due to race)
      assert.equal(finalState.cursors.length, 5, 'All 5 increments should be present (no races)');

      // Verify results array shows correct progression
      assert.equal(results[0], 0, 'First operation should see 0 existing cursors');
      // Results may be out of order due to async scheduling, so just verify they're in range
      assert.ok(results.every((r) => r >= 0 && r < 5), 'All results should be in valid range');
    });
  });
});
