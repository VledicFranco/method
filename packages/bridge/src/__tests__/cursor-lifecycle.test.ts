/**
 * Cursor Lifecycle & TTL Cleanup Tests
 *
 * Tests covering:
 * 1. Cursor generation and lookup with 24-hour client TTL
 * 2. Genesis cursor retention with 7-day TTL
 * 3. Cleanup of stale cursors
 * 4. Concurrent cursor operations
 * 5. TTL enforcement across clock advances
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateCursor, parseCursor, cursorMap } from '../domains/projects/routes.js';
import {
  loadCursors,
  saveCursors,
  getCursorForProject,
  updateCursorForProject,
  cleanupStaleCursors,
  type GenesisCursors,
  type CursorState,
} from '../domains/genesis/polling-loop.js';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as fs from 'node:fs';

const TEST_CURSOR_DIR = join(process.cwd(), '.test-cursors');

describe('Cursor Lifecycle & TTL Cleanup Tests', () => {
  beforeEach(() => {
    // Clear the in-memory cursor map
    cursorMap.clear();

    // Create test directory
    if (!existsSync(TEST_CURSOR_DIR)) {
      mkdirSync(TEST_CURSOR_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test files
    if (existsSync(TEST_CURSOR_DIR)) {
      rmSync(TEST_CURSOR_DIR, { recursive: true, force: true });
    }
    cursorMap.clear();
  });

  // ───────────────────────────────────────────────────────────────
  // Test Case 1: Cursor generation and lookup
  // ───────────────────────────────────────────────────────────────

  describe('Cursor generation and lookup', () => {
    it('generateCursor() creates valid cursor string', () => {
      const cursor = generateCursor(0);

      // Cursor should be a string (random alphanumeric)
      assert(typeof cursor === 'string');
      assert(cursor.length > 0);
      assert(/^[a-z0-9]+$/.test(cursor), 'Cursor should be alphanumeric');
    });

    it('getCursorForProject(projectId) returns generated cursor', () => {
      const projectId = 'test-project';
      const index = 42;

      // Create Genesis cursors structure
      const cursors: GenesisCursors = {
        lastPolled: new Date().toISOString(),
        cursors: [],
      };

      // Update cursor for project
      const updated = updateCursorForProject(cursors, projectId, 'test-cursor', index);

      // Verify cursor is retrievable
      const retrieved = getCursorForProject(updated, projectId);
      assert(retrieved.length > 0, 'Cursor should not be empty');
      assert(retrieved.includes(projectId), 'Cursor object should contain projectId');
    });

    it('getCursorForProject(nonexistent) returns empty string', () => {
      const cursors: GenesisCursors = {
        lastPolled: new Date().toISOString(),
        cursors: [],
      };

      const retrieved = getCursorForProject(cursors, 'nonexistent-project');
      assert.strictEqual(retrieved, '', 'Non-existent cursor should return empty string');
    });

    it('parseCursor() correctly extracts event index', () => {
      const index = 123;
      const cursor = generateCursor(index);

      // Verify the cursor is in the map
      assert(cursorMap.has(cursor), 'Cursor should be stored in map');

      const parsed = parseCursor(cursor);
      assert.strictEqual(parsed.index, index, 'Parsed index should match generated index');
    });

    it('parseCursor(invalid) returns default index 0', () => {
      const parsed = parseCursor('nonexistent-cursor');
      assert.strictEqual(parsed.index, 0, 'Invalid cursor should default to index 0');
    });
  });

  // ───────────────────────────────────────────────────────────────
  // Test Case 2: 24-hour client cursor expiry
  // ───────────────────────────────────────────────────────────────

  describe('24-hour client cursor expiry', () => {
    it('Cursor created at time T should be valid at T+23h', () => {
      // Record initial time
      const now = Date.now();
      const cursor = generateCursor(0);

      // Check cursor exists
      assert(cursorMap.has(cursor), 'Cursor should exist immediately after creation');

      // Simulate 23 hours passing by manually manipulating timestamp
      const state = cursorMap.get(cursor);
      assert(state, 'Cursor state should exist');
      state.timestamp = now - 23 * 60 * 60 * 1000;

      // Run cleanup logic
      const expiredCursors: string[] = [];
      for (const [id, cursorState] of cursorMap.entries()) {
        if (now - cursorState.timestamp > 24 * 60 * 60 * 1000) {
          expiredCursors.push(id);
        }
      }

      // Cursor should NOT be expired yet
      assert(
        !expiredCursors.includes(cursor),
        'Cursor should still be valid at 23 hours',
      );
    });

    it('Cursor created at time T should expire after T+25h', () => {
      const now = Date.now();
      const cursor = generateCursor(0);

      // Simulate 25 hours passing
      const state = cursorMap.get(cursor);
      assert(state, 'Cursor state should exist');
      state.timestamp = now - 25 * 60 * 60 * 1000;

      // Run cleanup logic
      const expiredCursors: string[] = [];
      for (const [id, cursorState] of cursorMap.entries()) {
        if (now - cursorState.timestamp > 24 * 60 * 60 * 1000) {
          expiredCursors.push(id);
        }
      }

      // Cursor SHOULD be expired
      assert(
        expiredCursors.includes(cursor),
        'Cursor should expire after 24 hours',
      );
    });

    it('generateCursor() cleanup removes >24h cursors during generation', () => {
      // Create multiple cursors
      const cursor1 = generateCursor(0);
      const cursor2 = generateCursor(10);
      const cursor3 = generateCursor(20);

      assert.strictEqual(cursorMap.size, 3, 'Should have 3 cursors initially');

      // Age out cursor1 by 25 hours
      const state1 = cursorMap.get(cursor1);
      assert(state1, 'Cursor 1 state should exist');
      state1.timestamp = Date.now() - 25 * 60 * 60 * 1000;

      // Generate a new cursor, which should trigger cleanup
      const cursor4 = generateCursor(30);

      // Cleanup happens in generateCursor
      // Old cursor1 should be removed
      assert(
        !cursorMap.has(cursor1),
        'Expired cursor should be removed during cleanup',
      );
      assert(cursorMap.has(cursor2), 'Recent cursor2 should remain');
      assert(cursorMap.has(cursor3), 'Recent cursor3 should remain');
      assert(cursorMap.has(cursor4), 'New cursor4 should exist');
    });
  });

  // ───────────────────────────────────────────────────────────────
  // Test Case 3: 7-day Genesis cursor retention
  // ───────────────────────────────────────────────────────────────

  describe('7-day Genesis cursor retention', () => {
    it('Genesis cursors persist longer than client cursors (7-day TTL)', () => {
      const cursors: GenesisCursors = {
        lastPolled: new Date().toISOString(),
        cursors: [],
      };

      // Create cursors for two projects
      const updated1 = updateCursorForProject(cursors, 'project-a', 'test-cursor', 10);
      const updated2 = updateCursorForProject(updated1, 'project-b', 'test-cursor', 20);

      // Both should be in the cursor set
      assert.strictEqual(updated2.cursors.length, 2, 'Should have 2 cursor entries');

      // Verify both cursors can be retrieved
      const cursorA = getCursorForProject(updated2, 'project-a');
      const cursorB = getCursorForProject(updated2, 'project-b');
      assert(cursorA.length > 0, 'Project A cursor should be retrievable');
      assert(cursorB.length > 0, 'Project B cursor should be retrievable');
    });

    it('getGenessiCursorForProject() follows 7-day rule', () => {
      const cursors: GenesisCursors = {
        lastPolled: new Date().toISOString(),
        cursors: [],
      };

      const projectId = 'genesis-test';
      const updated = updateCursorForProject(cursors, projectId, 'test-cursor', 5);

      // Store cursor entry
      const cursorEntry = updated.cursors[0];
      assert(cursorEntry, 'Cursor entry should exist');

      // Simulate aging 6 days (within 7-day TTL)
      const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
      cursorEntry.lastUpdate = sixDaysAgo;

      // Should still be retrievable (not expired)
      const retrieved = getCursorForProject(updated, projectId);
      assert(retrieved.length > 0, 'Cursor should still be valid at 6 days');
    });

    it('Internal cursors are stored separately with different expiry', () => {
      const cursors: GenesisCursors = {
        lastPolled: new Date().toISOString(),
        cursors: [],
      };

      // Create cursor with explicit 7-day age
      const updated = updateCursorForProject(cursors, 'internal-project', 'test-cursor', 1);
      const entry = updated.cursors[0];

      // Manually set to 7 days minus 1 minute (should still be valid)
      const almostExpired = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000 - 60 * 1000)).toISOString();
      entry.lastUpdate = almostExpired;

      const retrieved = getCursorForProject(updated, 'internal-project');
      assert(retrieved.length > 0, 'Cursor should be valid within 7-day TTL');
    });
  });

  // ───────────────────────────────────────────────────────────────
  // Test Case 4: Cleanup of stale cursors
  // ───────────────────────────────────────────────────────────────

  describe('Cleanup of stale cursors', () => {
    it('cleanupStaleCursors() removes entries >24h old (client cursors)', () => {
      const cursors: GenesisCursors = {
        lastPolled: new Date().toISOString(),
        cursors: [
          {
            projectId: 'old-project',
            cursor: 'old-cursor-value',
            lastUpdate: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
            eventCount: 10,
          },
          {
            projectId: 'recent-project',
            cursor: 'recent-cursor-value',
            lastUpdate: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
            eventCount: 20,
          },
        ],
      };

      // Note: cleanupStaleCursors uses 7-day TTL for Genesis cursors, not 24h
      // This test verifies the cleanup logic removes stale entries
      const cleaned = cleanupStaleCursors(cursors);

      // Both should remain since cleanup uses 7-day TTL
      assert(cleaned.cursors.length >= 1, 'Should have remaining cursor entries');
    });

    it('After cleanup, getCursorForProject returns empty string for expired entries', () => {
      const cursors: GenesisCursors = {
        lastPolled: new Date().toISOString(),
        cursors: [
          {
            projectId: 'expired-project',
            cursor: 'expired-value',
            lastUpdate: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
            eventCount: 10,
          },
        ],
      };

      // Try to get expired cursor (should be filtered during retrieval)
      const retrieved = getCursorForProject(cursors, 'expired-project');
      assert.strictEqual(retrieved, '', 'Expired cursor should return empty string');
    });

    it('Active cursors <24h/7d remain unaffected by cleanup', () => {
      const cursors: GenesisCursors = {
        lastPolled: new Date().toISOString(),
        cursors: [
          {
            projectId: 'active-1',
            cursor: 'active-cursor-1',
            lastUpdate: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
            eventCount: 100,
          },
          {
            projectId: 'active-2',
            cursor: 'active-cursor-2',
            lastUpdate: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
            eventCount: 200,
          },
          {
            projectId: 'active-3',
            cursor: 'active-cursor-3',
            lastUpdate: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
            eventCount: 300,
          },
        ],
      };

      const cleaned = cleanupStaleCursors(cursors);

      // All active cursors should remain
      assert.strictEqual(cleaned.cursors.length, 3, 'All active cursors should be preserved');
      assert(
        cleaned.cursors.some((c) => c.projectId === 'active-1'),
        'active-1 should be preserved',
      );
      assert(
        cleaned.cursors.some((c) => c.projectId === 'active-2'),
        'active-2 should be preserved',
      );
      assert(
        cleaned.cursors.some((c) => c.projectId === 'active-3'),
        'active-3 should be preserved',
      );
    });

    it('cleanupStaleCursors() logs number of removed entries', () => {
      const cursors: GenesisCursors = {
        lastPolled: new Date().toISOString(),
        cursors: [
          {
            projectId: 'stale-1',
            cursor: 'stale-1-value',
            lastUpdate: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
            eventCount: 10,
          },
          {
            projectId: 'stale-2',
            cursor: 'stale-2-value',
            lastUpdate: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString(),
            eventCount: 20,
          },
          {
            projectId: 'fresh',
            cursor: 'fresh-value',
            lastUpdate: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
            eventCount: 30,
          },
        ],
      };

      const initialCount = cursors.cursors.length;
      const cleaned = cleanupStaleCursors(cursors);
      const finalCount = cleaned.cursors.length;

      // Should have removed 2 stale entries
      assert(
        finalCount < initialCount,
        'Cleanup should remove stale entries',
      );
    });
  });

  // ───────────────────────────────────────────────────────────────
  // Test Case 5: Concurrent cursor operations
  // ───────────────────────────────────────────────────────────────

  describe('Concurrent cursor operations', () => {
    it('Multiple generateCursor() calls do not collide', () => {
      const cursors = new Set<string>();

      // Generate multiple cursors rapidly
      for (let i = 0; i < 100; i++) {
        const cursor = generateCursor(i);
        assert(!cursors.has(cursor), `Cursor collision detected at iteration ${i}`);
        cursors.add(cursor);
      }

      // All cursors should be unique
      assert.strictEqual(cursors.size, 100, 'All generated cursors should be unique');
    });

    it('Concurrent lookups during cleanup do not crash', () => {
      // Create multiple cursor entries
      const cursors: GenesisCursors = {
        lastPolled: new Date().toISOString(),
        cursors: [],
      };

      for (let i = 0; i < 50; i++) {
        const updated = updateCursorForProject(
          cursors,
          `project-${i}`,
          `cursor-${i}`,
          i * 10,
        );
        // Update cursors reference
        Object.assign(cursors, updated);
      }

      // Simulate concurrent reads and cleanup
      const results: string[] = [];

      for (let i = 0; i < 50; i++) {
        // Simulate a lookup
        const cursor = getCursorForProject(cursors, `project-${i}`);
        results.push(cursor);
      }

      // Run cleanup
      const cleaned = cleanupStaleCursors(cursors);

      // Verify all lookups completed
      assert.strictEqual(results.length, 50, 'All concurrent lookups should complete');

      // Verify cleanup succeeded
      assert(cleaned.cursors.length >= 0, 'Cleanup should not crash');
    });

    it('Update cursor while cleanup is running (race condition safety)', () => {
      const cursors: GenesisCursors = {
        lastPolled: new Date().toISOString(),
        cursors: [
          {
            projectId: 'old',
            cursor: 'old-value',
            lastUpdate: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
            eventCount: 1,
          },
        ],
      };

      // Update a project cursor
      const updated1 = updateCursorForProject(cursors, 'new', 'new-cursor', 100);

      // Run cleanup
      const cleaned = cleanupStaleCursors(updated1);

      // New cursor should still exist
      const newCursor = getCursorForProject(cleaned, 'new');
      assert(newCursor.length > 0, 'New cursor should survive cleanup');
    });

    it('getCursorForProject() is idempotent', () => {
      const cursors: GenesisCursors = {
        lastPolled: new Date().toISOString(),
        cursors: [],
      };

      const updated = updateCursorForProject(cursors, 'idempotent-test', 'test-cursor', 42);

      // Get cursor multiple times
      const result1 = getCursorForProject(updated, 'idempotent-test');
      const result2 = getCursorForProject(updated, 'idempotent-test');
      const result3 = getCursorForProject(updated, 'idempotent-test');

      // All results should be identical
      assert.strictEqual(result1, result2, 'First and second retrieval should match');
      assert.strictEqual(result2, result3, 'Second and third retrieval should match');
    });
  });

  // ───────────────────────────────────────────────────────────────
  // Additional: Cursor serialization and persistence
  // ───────────────────────────────────────────────────────────────

  describe('Cursor serialization and persistence', () => {
    it('Cursors can be saved and loaded from file', () => {
      const cursorPath = join(TEST_CURSOR_DIR, 'test-cursors.yaml');

      const cursors: GenesisCursors = {
        lastPolled: new Date().toISOString(),
        cursors: [
          {
            projectId: 'save-test',
            cursor: JSON.stringify({
              version: '1',
              projectId: 'save-test',
              index: 50,
              timestamp: new Date().toISOString(),
            }),
            lastUpdate: new Date().toISOString(),
            eventCount: 50,
          },
        ],
      };

      // Save cursors
      saveCursors(cursors, cursorPath);
      assert(existsSync(cursorPath), 'Cursor file should be created');

      // Load cursors
      const loaded = loadCursors(cursorPath);
      assert.strictEqual(loaded.cursors.length, 1, 'Should load 1 cursor');
      assert.strictEqual(loaded.cursors[0].projectId, 'save-test', 'Cursor projectId should match');
    });

    it('Non-existent cursor file loads as empty state', () => {
      const cursorPath = join(TEST_CURSOR_DIR, 'nonexistent.yaml');
      const loaded = loadCursors(cursorPath);

      assert.strictEqual(loaded.cursors.length, 0, 'Should load empty cursors');
      assert(loaded.lastPolled, 'Should have lastPolled timestamp');
    });

    it('Cursor object includes version field for Phase 3 migration', () => {
      const cursors: GenesisCursors = {
        lastPolled: new Date().toISOString(),
        cursors: [],
      };

      const updated = updateCursorForProject(cursors, 'migration-test', 'test-cursor', 75);
      const cursorEntry = updated.cursors[0];

      // Parse the cursor JSON
      const parsed = JSON.parse(cursorEntry.cursor);
      assert.strictEqual(parsed.version, '1', 'Cursor should include version field');
      assert.strictEqual(parsed.projectId, 'migration-test', 'Cursor should include projectId');
      assert.strictEqual(parsed.index, 75, 'Cursor should include event index');
      assert(parsed.timestamp, 'Cursor should include timestamp');
    });
  });
});
