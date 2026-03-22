/**
 * Cursor Maintenance Job Tests
 *
 * Tests for the scheduled 1-hour background job that removes cursors > 7 days old.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CursorMaintenanceJob, type GenesisCursors } from '../genesis/cursor-manager.js';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';

const TEST_CURSOR_DIR = join(process.cwd(), '.test-cursors-maintenance');

describe('Cursor Maintenance Job', () => {
  let cursorPath: string;
  let job: CursorMaintenanceJob;

  beforeEach(() => {
    // Create test directory
    if (!existsSync(TEST_CURSOR_DIR)) {
      mkdirSync(TEST_CURSOR_DIR, { recursive: true });
    }

    cursorPath = join(TEST_CURSOR_DIR, 'test-cursors.yaml');

    // Create job instance with test path
    job = new CursorMaintenanceJob(cursorPath, 100); // 100ms interval for testing
  });

  afterEach(() => {
    // Stop any running job
    job.stop();

    // Clean up test files
    if (existsSync(TEST_CURSOR_DIR)) {
      rmSync(TEST_CURSOR_DIR, { recursive: true, force: true });
    }
  });

  // ───────────────────────────────────────────────────────────────
  // Test Case 1: Job Lifecycle (start/stop)
  // ───────────────────────────────────────────────────────────────

  describe('Job lifecycle (start/stop)', () => {
    it('Job can be started', () => {
      assert(!job.isRunning(), 'Job should not be running initially');

      job.start();

      assert(job.isRunning(), 'Job should be running after start()');
    });

    it('Job can be stopped cleanly', () => {
      job.start();
      assert(job.isRunning(), 'Job should be running after start()');

      job.stop();

      assert(!job.isRunning(), 'Job should not be running after stop()');
    });

    it('Starting an already-running job is a no-op', () => {
      job.start();
      const running1 = job.isRunning();

      job.start(); // Try to start again
      const running2 = job.isRunning();

      assert.strictEqual(running1, running2, 'Should remain running');
      assert(running2, 'Job should still be running');
    });

    it('Stopping a stopped job is a no-op', () => {
      job.stop();
      assert(!job.isRunning(), 'Job should not be running');

      job.stop(); // Stop again
      assert(!job.isRunning(), 'Job should still not be running');
    });

    it('Job can be restarted after being stopped', () => {
      job.start();
      job.stop();

      assert(!job.isRunning(), 'Job should be stopped');

      job.start();
      assert(job.isRunning(), 'Job should be running again');

      job.stop();
    });
  });

  // ───────────────────────────────────────────────────────────────
  // Test Case 2: Cleanup Logic
  // ───────────────────────────────────────────────────────────────

  describe('Cleanup logic', () => {
    it('Removes cursors > 7 days old', async () => {
      // Create a cursor file with mixed age cursors
      const cursors: GenesisCursors = {
        lastPolled: new Date().toISOString(),
        cursors: [
          {
            projectId: 'fresh',
            cursor: '{"version":"1","projectId":"fresh"}',
            lastUpdate: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), // 1 hour old
            eventCount: 10,
          },
          {
            projectId: 'old',
            cursor: '{"version":"1","projectId":"old"}',
            lastUpdate: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(), // 8 days old
            eventCount: 20,
          },
        ],
      };

      // Write initial cursor file
      const yamlContent = yaml.dump(cursors, { lineWidth: -1 });
      const { writeFileSync, mkdirSync } = await import('node:fs');
      const { dirname } = await import('node:path');
      mkdirSync(dirname(cursorPath), { recursive: true });
      writeFileSync(cursorPath, yamlContent, 'utf-8');

      // Run cleanup
      const removed = await job.cleanupOnce();

      assert.strictEqual(removed, 1, 'Should remove 1 stale cursor');

      // Verify file was updated
      const content = readFileSync(cursorPath, 'utf-8');
      const parsed = yaml.load(content) as GenesisCursors;
      assert.strictEqual(parsed.cursors.length, 1, 'Should have 1 cursor remaining');
      assert.strictEqual(parsed.cursors[0].projectId, 'fresh', 'Fresh cursor should remain');
    });

    it('Preserves cursors < 7 days old', async () => {
      const cursors: GenesisCursors = {
        lastPolled: new Date().toISOString(),
        cursors: [
          {
            projectId: 'active-1',
            cursor: '{"version":"1","projectId":"active-1"}',
            lastUpdate: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(), // 6 days old
            eventCount: 10,
          },
          {
            projectId: 'active-2',
            cursor: '{"version":"1","projectId":"active-2"}',
            lastUpdate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day old
            eventCount: 20,
          },
        ],
      };

      const { writeFileSync, mkdirSync } = await import('node:fs');
      const { dirname } = await import('node:path');
      mkdirSync(dirname(cursorPath), { recursive: true });
      const yamlContent = yaml.dump(cursors, { lineWidth: -1 });
      writeFileSync(cursorPath, yamlContent, 'utf-8');

      const removed = await job.cleanupOnce();

      assert.strictEqual(removed, 0, 'Should remove 0 cursors');

      const content = readFileSync(cursorPath, 'utf-8');
      const parsed = yaml.load(content) as GenesisCursors;
      assert.strictEqual(parsed.cursors.length, 2, 'Should have 2 cursors remaining');
    });

    it('Handles empty cursor file gracefully', async () => {
      const removed = await job.cleanupOnce();
      assert.strictEqual(removed, 0, 'Should remove 0 cursors from empty file');
    });

    it('Handles missing cursor file gracefully', async () => {
      const pathThatDoesNotExist = join(TEST_CURSOR_DIR, 'nonexistent', 'cursors.yaml');
      const job2 = new CursorMaintenanceJob(pathThatDoesNotExist, 100);

      const removed = await job2.cleanupOnce();
      assert.strictEqual(removed, 0, 'Should return 0 for missing file');

      job2.stop();
    });
  });

  // ───────────────────────────────────────────────────────────────
  // Test Case 3: Scheduled Cleanup (runs on interval)
  // ───────────────────────────────────────────────────────────────

  describe('Scheduled cleanup (interval timer)', () => {
    it('Cleanup runs at specified interval', async () => {
      const cursors: GenesisCursors = {
        lastPolled: new Date().toISOString(),
        cursors: [
          {
            projectId: 'test',
            cursor: '{"version":"1","projectId":"test"}',
            lastUpdate: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(), // 8 days old
            eventCount: 10,
          },
        ],
      };

      const { writeFileSync, mkdirSync: mkdirSync2 } = await import('node:fs');
      const { dirname: dirname2 } = await import('node:path');
      mkdirSync2(dirname2(cursorPath), { recursive: true });
      const yamlContent = yaml.dump(cursors, { lineWidth: -1 });
      writeFileSync(cursorPath, yamlContent, 'utf-8');

      // Create job with very short interval (50ms) for testing
      const testJob = new CursorMaintenanceJob(cursorPath, 50);

      // Start job
      testJob.start();

      // Wait for at least 2 intervals to ensure cleanup runs
      await new Promise(resolve => setTimeout(resolve, 150));

      // Check if cleanup happened (cursor should be gone)
      const content = readFileSync(cursorPath, 'utf-8');
      const parsed = yaml.load(content) as GenesisCursors;

      testJob.stop();

      // Verify the job stops cleanly
      assert(!testJob.isRunning(), 'Job should be stopped');
    });

    it('getLastCleanupAt() returns timestamp after cleanup runs', async () => {
      assert.strictEqual(job.getLastCleanupAt(), null, 'Should be null before cleanup');

      const cursors: GenesisCursors = {
        lastPolled: new Date().toISOString(),
        cursors: [],
      };

      const { writeFileSync, mkdirSync: mkdirSync2 } = await import('node:fs');
      const { dirname: dirname2 } = await import('node:path');
      mkdirSync2(dirname2(cursorPath), { recursive: true });
      const yamlContent = yaml.dump(cursors, { lineWidth: -1 });
      writeFileSync(cursorPath, yamlContent, 'utf-8');

      await job.cleanupOnce();
      const lastCleanup = job.getLastCleanupAt();
      assert(lastCleanup instanceof Date, 'Should return a Date after cleanup');
      assert(lastCleanup.getTime() <= Date.now(), 'Cleanup timestamp should be in the past');
    });
  });

  // ───────────────────────────────────────────────────────────────
  // Test Case 4: Edge Cases & TTL Boundaries
  // ───────────────────────────────────────────────────────────────

  describe('Edge cases and TTL boundaries', () => {
    it('Cursor at exactly 7 days is removed', async () => {
      const cursors: GenesisCursors = {
        lastPolled: new Date().toISOString(),
        cursors: [
          {
            projectId: 'boundary',
            cursor: '{"version":"1","projectId":"boundary"}',
            lastUpdate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // Exactly 7 days
            eventCount: 10,
          },
        ],
      };

      const { writeFileSync, mkdirSync: mkdirSync2 } = await import('node:fs');
      const { dirname: dirname2 } = await import('node:path');
      mkdirSync2(dirname2(cursorPath), { recursive: true });
      const yamlContent = yaml.dump(cursors, { lineWidth: -1 });
      writeFileSync(cursorPath, yamlContent, 'utf-8');

      const removed = await job.cleanupOnce();

      // At exactly 7 days (age >= TTL), the cursor is removed
      assert.strictEqual(removed, 1, 'Cursor at exactly 7 days should be removed');
    });

    it('Cursor at 6 days is kept', async () => {
      const cursors: GenesisCursors = {
        lastPolled: new Date().toISOString(),
        cursors: [
          {
            projectId: 'boundary',
            cursor: '{"version":"1","projectId":"boundary"}',
            lastUpdate: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(), // 6 days old
            eventCount: 10,
          },
        ],
      };

      const { writeFileSync, mkdirSync: mkdirSync2 } = await import('node:fs');
      const { dirname: dirname2 } = await import('node:path');
      mkdirSync2(dirname2(cursorPath), { recursive: true });
      const yamlContent = yaml.dump(cursors, { lineWidth: -1 });
      writeFileSync(cursorPath, yamlContent, 'utf-8');

      const removed = await job.cleanupOnce();

      // 6 days is under 7 days so should be kept
      assert.strictEqual(removed, 0, 'Cursor at 6 days should be kept');
    });

    it('Handles multiple cursors with mixed ages', async () => {
      const cursors: GenesisCursors = {
        lastPolled: new Date().toISOString(),
        cursors: [
          {
            projectId: 'very-old',
            cursor: '{"version":"1","projectId":"very-old"}',
            lastUpdate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
            eventCount: 1,
          },
          {
            projectId: 'old',
            cursor: '{"version":"1","projectId":"old"}',
            lastUpdate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days
            eventCount: 2,
          },
          {
            projectId: 'recent',
            cursor: '{"version":"1","projectId":"recent"}',
            lastUpdate: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), // 1 hour
            eventCount: 3,
          },
          {
            projectId: 'new',
            cursor: '{"version":"1","projectId":"new"}',
            lastUpdate: new Date().toISOString(), // Just now
            eventCount: 4,
          },
        ],
      };

      const { writeFileSync, mkdirSync } = await import('node:fs');
      const { dirname } = await import('node:path');
      mkdirSync(dirname(cursorPath), { recursive: true });
      const yamlContent = yaml.dump(cursors, { lineWidth: -1 });
      writeFileSync(cursorPath, yamlContent, 'utf-8');

      const removed = await job.cleanupOnce();

      assert.strictEqual(removed, 2, 'Should remove very-old and old cursors');

      const content = readFileSync(cursorPath, 'utf-8');
      const parsed = yaml.load(content) as GenesisCursors;
      assert.strictEqual(parsed.cursors.length, 2, 'Should have 2 cursors remaining');
      assert(parsed.cursors.some(c => c.projectId === 'recent'), 'recent should remain');
      assert(parsed.cursors.some(c => c.projectId === 'new'), 'new should remain');
    });
  });

  // ───────────────────────────────────────────────────────────────
  // Test Case 5: File Persistence & Atomicity
  // ───────────────────────────────────────────────────────────────

  describe('File persistence and atomicity', () => {
    it('Cleanup creates cursor file with empty cursors list', async () => {
      assert(!existsSync(cursorPath), 'Cursor file should not exist initially');

      const removed = await job.cleanupOnce();

      assert.strictEqual(removed, 0, 'Should remove 0 cursors from empty state');

      // File should be created with empty cursors
      assert(existsSync(cursorPath), 'Cursor file should be created');

      const content = readFileSync(cursorPath, 'utf-8');
      const parsed = yaml.load(content) as GenesisCursors;
      assert(Array.isArray(parsed.cursors), 'Should have cursors array');
      assert.strictEqual(parsed.cursors.length, 0, 'Should have empty cursors list');
    });

    it('Saves cleanup result atomically (no temp file left behind)', async () => {
      const cursors: GenesisCursors = {
        lastPolled: new Date().toISOString(),
        cursors: [
          {
            projectId: 'test',
            cursor: '{"version":"1","projectId":"test"}',
            lastUpdate: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
            eventCount: 10,
          },
        ],
      };

      const { writeFileSync, mkdirSync } = await import('node:fs');
      const { dirname } = await import('node:path');
      mkdirSync(dirname(cursorPath), { recursive: true });
      const yamlContent = yaml.dump(cursors, { lineWidth: -1 });
      writeFileSync(cursorPath, yamlContent, 'utf-8');

      await job.cleanupOnce();

      // Verify no temp file left behind
      const tempFile = `${cursorPath}.tmp`;
      assert(!existsSync(tempFile), 'Temp file should not exist after atomic rename');
    });

    it('Preserves YAML structure after cleanup', async () => {
      const cursors: GenesisCursors = {
        lastPolled: new Date(Date.now() - 1000).toISOString(),
        cursors: [
          {
            projectId: 'keep',
            cursor: '{"version":"1","projectId":"keep","index":42}',
            lastUpdate: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
            eventCount: 42,
          },
        ],
      };

      const { writeFileSync, mkdirSync } = await import('node:fs');
      const { dirname } = await import('node:path');
      mkdirSync(dirname(cursorPath), { recursive: true });
      const yamlContent = yaml.dump(cursors, { lineWidth: -1 });
      writeFileSync(cursorPath, yamlContent, 'utf-8');

      await job.cleanupOnce();

      const content = readFileSync(cursorPath, 'utf-8');
      const parsed = yaml.load(content) as GenesisCursors;

      assert(parsed.lastPolled, 'Should preserve lastPolled');
      assert(Array.isArray(parsed.cursors), 'Should preserve cursors array');
      assert.strictEqual(parsed.cursors.length, 1, 'Should have 1 cursor');
      assert.strictEqual(parsed.cursors[0].projectId, 'keep', 'Cursor should have projectId');
      assert.strictEqual(parsed.cursors[0].eventCount, 42, 'Should preserve eventCount');
    });
  });

  // ───────────────────────────────────────────────────────────────
  // Test Case 6: Concurrency & Thread Safety
  // ───────────────────────────────────────────────────────────────

  describe('Concurrency and thread safety', () => {
    it('Multiple cleanupOnce() calls do not corrupt file', async () => {
      const cursors: GenesisCursors = {
        lastPolled: new Date().toISOString(),
        cursors: [
          {
            projectId: 'test',
            cursor: '{"version":"1","projectId":"test"}',
            lastUpdate: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
            eventCount: 10,
          },
        ],
      };

      const { writeFileSync, mkdirSync } = await import('node:fs');
      const { dirname } = await import('node:path');
      mkdirSync(dirname(cursorPath), { recursive: true });
      const yamlContent = yaml.dump(cursors, { lineWidth: -1 });
      writeFileSync(cursorPath, yamlContent, 'utf-8');

      // Run cleanup multiple times in parallel
      const results = await Promise.all([
        job.cleanupOnce(),
        job.cleanupOnce(),
        job.cleanupOnce(),
      ]);

      // All should succeed (total removed = 1 + 0 + 0)
      assert.strictEqual(results.reduce((a, b) => a + b, 0), 1, 'Total removed should be 1');

      // File should still be valid
      const content = readFileSync(cursorPath, 'utf-8');
      const parsed = yaml.load(content) as GenesisCursors;
      assert(Array.isArray(parsed.cursors), 'File should still be valid YAML');
    });
  });

  // ───────────────────────────────────────────────────────────────
  // Test Case 7: Integration with Polling Loop
  // ───────────────────────────────────────────────────────────────

  describe('Integration scenarios', () => {
    it('Job can run while polling loop writes to file', async () => {
      // Simulate polling loop writing cursors
      const cursors: GenesisCursors = {
        lastPolled: new Date().toISOString(),
        cursors: [
          {
            projectId: 'old',
            cursor: '{"version":"1","projectId":"old"}',
            lastUpdate: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
            eventCount: 10,
          },
          {
            projectId: 'new',
            cursor: '{"version":"1","projectId":"new"}',
            lastUpdate: new Date().toISOString(),
            eventCount: 20,
          },
        ],
      };

      const { writeFileSync, mkdirSync } = await import('node:fs');
      const { dirname } = await import('node:path');
      mkdirSync(dirname(cursorPath), { recursive: true });
      const yamlContent = yaml.dump(cursors, { lineWidth: -1 });
      writeFileSync(cursorPath, yamlContent, 'utf-8');

      // Run cleanup
      const removed = await job.cleanupOnce();

      // Old cursor should be removed
      assert.strictEqual(removed, 1, 'Should remove old cursor');

      // New cursor should remain
      const content = readFileSync(cursorPath, 'utf-8');
      const parsed = yaml.load(content) as GenesisCursors;
      assert(parsed.cursors.some(c => c.projectId === 'new'), 'New cursor should remain');
    });
  });
});
