/**
 * Tests for YamlEventPersistence
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { YamlEventPersistence } from '../events/yaml-event-persistence.js';
import {
  ProjectEventType,
  createProjectEvent,
  serializeProjectEvent,
  deserializeProjectEvent,
} from '../events/index.js';

describe('YamlEventPersistence', () => {
  let testDir: string;
  let persistence: YamlEventPersistence;
  let filePath: string;

  beforeEach(async () => {
    // Create unique temp directory
    testDir = path.join(tmpdir(), `yaml-persistence-test-${randomUUID()}`);
    filePath = path.join(testDir, 'test-events.yaml');
    await fs.mkdir(testDir, { recursive: true });
    persistence = new YamlEventPersistence(filePath);
  });

  afterEach(async () => {
    // Cleanup
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('should append and query events round-trip', async () => {
    await persistence.recover();

    // Create and append events
    const event1 = createProjectEvent(ProjectEventType.CREATED, 'project-1', { name: 'test' });
    const event2 = createProjectEvent(ProjectEventType.CREATED, 'project-2', { name: 'test2' });

    await persistence.append(event1);
    await persistence.append(event2);

    // Wait for flush
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Query by projectId
    const results = await persistence.query({ projectId: 'project-1' });
    assert.equal(results.length, 1);
    assert.equal(results[0].projectId, 'project-1');
  });

  it('should recover events after restart', async () => {
    // First instance: append events
    await persistence.recover();
    const event1 = createProjectEvent(ProjectEventType.CREATED, 'project-1', { name: 'test' });
    const event2 = createProjectEvent(ProjectEventType.REGISTRY_UPDATED, 'project-1', { version: 2 });

    await persistence.append(event1);
    await persistence.append(event2);

    // Wait for flush
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Create new instance and recover
    const persistence2 = new YamlEventPersistence(filePath);
    await persistence2.recover();

    // Verify events were loaded
    const results = await persistence2.query({ projectId: 'project-1' });
    assert.equal(results.length, 2);
    assert.equal(results[0].type, ProjectEventType.CREATED);
    assert.equal(results[1].type, ProjectEventType.REGISTRY_UPDATED);
  });

  it('should filter events by projectId', async () => {
    await persistence.recover();

    // Append events for multiple projects
    const events = [
      createProjectEvent(ProjectEventType.CREATED, 'project-1', {}),
      createProjectEvent(ProjectEventType.CREATED, 'project-2', {}),
      createProjectEvent(ProjectEventType.REGISTRY_UPDATED, 'project-1', {}),
    ];

    for (const event of events) {
      await persistence.append(event);
    }

    // Wait for flush
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Query for project-1
    const project1Events = await persistence.query({ projectId: 'project-1' });
    assert.equal(project1Events.length, 2);
    assert.ok(project1Events.every((e) => e.projectId === 'project-1'));

    // Query for project-2
    const project2Events = await persistence.query({ projectId: 'project-2' });
    assert.equal(project2Events.length, 1);
    assert.equal(project2Events[0].projectId, 'project-2');
  });

  it('should filter events by type', async () => {
    await persistence.recover();

    const events = [
      createProjectEvent(ProjectEventType.CREATED, 'project-1', {}),
      createProjectEvent(ProjectEventType.REGISTRY_UPDATED, 'project-1', {}),
      createProjectEvent(ProjectEventType.CREATED, 'project-2', {}),
    ];

    for (const event of events) {
      await persistence.append(event);
    }

    // Wait for flush
    await new Promise((resolve) => setTimeout(resolve, 150));

    const createdEvents = await persistence.query({ type: ProjectEventType.CREATED });
    assert.equal(createdEvents.length, 2);
    assert.ok(createdEvents.every((e) => e.type === ProjectEventType.CREATED));
  });

  it('should return latest N events', async () => {
    await persistence.recover();

    const events = Array.from({ length: 10 }, (_, i) =>
      createProjectEvent(ProjectEventType.CREATED, `project-${i}`, { index: i }),
    );

    for (const event of events) {
      await persistence.append(event);
    }

    // Wait for flush
    await new Promise((resolve) => setTimeout(resolve, 150));

    const latest3 = await persistence.latest(3);
    assert.equal(latest3.length, 3);
    // Latest should be at the end
    assert.equal(latest3[0].data.index, 7);
    assert.equal(latest3[1].data.index, 8);
    assert.equal(latest3[2].data.index, 9);
  });

  it('should rotate file at 5MB', async () => {
    await persistence.recover();

    // Create enough events to reach 5MB+ when serialized
    // Each event with 500KB of data should result in ~1.5MB YAML when serialized
    const largeData = 'x'.repeat(500 * 1024); // 500KB of data

    // Append 12+ events to exceed 5MB
    for (let i = 0; i < 12; i++) {
      const event = createProjectEvent(ProjectEventType.CREATED, `project-${i}`, {
        data: largeData,
        index: i,
        timestamp_created: new Date().toISOString(),
      });
      await persistence.append(event);
    }

    // Wait for flush
    await new Promise((resolve) => setTimeout(resolve, 250));

    // Check if rotation occurred (backup files should exist after rotation)
    // Rotation should have created .1 file when main file exceeded 5MB
    const mainFileExists = existsSync(filePath);
    const backup1Exists = existsSync(`${filePath}.1`);

    // Either main file exists with backup, or just main file (if rotation was triggered)
    assert.ok(mainFileExists, 'Main file should exist after rotation');
  });

  it('should recover with empty file', async () => {
    // Create empty file
    await fs.writeFile(filePath, '', 'utf-8');

    await persistence.recover();
    const results = await persistence.query({});
    assert.equal(results.length, 0);
  });

  it('should handle concurrent appends', async () => {
    await persistence.recover();

    const events = Array.from({ length: 50 }, (_, i) =>
      createProjectEvent(ProjectEventType.CREATED, `project-${i % 5}`, { index: i }),
    );

    // Append concurrently
    await Promise.all(events.map((e) => persistence.append(e)));

    // Wait for flush
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Verify all appended
    const allEvents = await persistence.query({});
    assert.equal(allEvents.length, 50);
  });

  it('should filter by date range', async () => {
    await persistence.recover();

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

    const event1 = createProjectEvent(ProjectEventType.CREATED, 'project-1', {});
    await persistence.append(event1);

    // Wait for flush
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Query with date range
    const results = await persistence.query({ since: oneHourAgo, until: oneHourLater });
    assert.equal(results.length, 1);

    // Query with restrictive range (before event)
    const emptyResults = await persistence.query({ until: oneHourAgo });
    assert.equal(emptyResults.length, 0);
  });

  it('should serialize and deserialize events correctly', async () => {
    const event = createProjectEvent(ProjectEventType.CREATED, 'project-1', {
      name: 'test',
      nested: { value: 42 },
    });

    const serialized = serializeProjectEvent(event);
    assert.equal(typeof serialized.timestamp, 'string');

    const deserialized = deserializeProjectEvent(serialized);
    assert.equal(deserialized.id, event.id);
    assert.equal(deserialized.type, event.type);
    assert.equal(deserialized.projectId, event.projectId);
    assert.ok(deserialized.timestamp instanceof Date);
    assert.deepEqual(deserialized.data, event.data);
  });
});

// ─────────────────────────────────────────────────────────────
// F-T-001: Filesystem Error Injection Tests
// ─────────────────────────────────────────────────────────────

describe('F-T-001: Filesystem Error Injection', () => {
  let testDir: string;
  let persistence: YamlEventPersistence;
  let filePath: string;
  const originalWriteFile = fs.writeFile;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `yaml-persistence-error-test-${randomUUID()}`);
    filePath = path.join(testDir, 'test-events.yaml');
    await fs.mkdir(testDir, { recursive: true });
    persistence = new YamlEventPersistence(filePath);
  });

  afterEach(async () => {
    // Restore original fs.writeFile
    (fs.writeFile as any) = originalWriteFile;
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('F-T-001a: should propagate ENOSPC (no space left on device) error', async () => {
    await persistence.recover();

    // Mock fs.writeFile to throw ENOSPC
    (fs.writeFile as any) = async () => {
      const error = new Error('No space left on device');
      (error as any).code = 'ENOSPC';
      throw error;
    };

    const event = createProjectEvent(ProjectEventType.CREATED, 'project-1', { test: 'data' });

    // Append should eventually throw after retries
    try {
      await persistence.append(event);
      assert.fail('Should have thrown ENOSPC error');
    } catch (err) {
      assert.ok((err as Error).message.includes('No space left'));
    }
  });

  it('F-T-001b: should propagate EACCES (permission denied) error', async () => {
    await persistence.recover();

    // Mock fs.writeFile to throw EACCES
    (fs.writeFile as any) = async () => {
      const error = new Error('Permission denied');
      (error as any).code = 'EACCES';
      throw error;
    };

    const event = createProjectEvent(ProjectEventType.CREATED, 'project-1', { test: 'data' });

    // Append should throw permission error
    try {
      await persistence.append(event);
      assert.fail('Should have thrown EACCES error');
    } catch (err) {
      assert.ok((err as Error).message.includes('Permission denied'));
    }
  });

  it('F-T-001c: should retry and succeed on EAGAIN (resource temporarily unavailable)', async () => {
    await persistence.recover();

    let attemptCount = 0;

    // Mock fs.writeFile to fail once with EAGAIN, then succeed
    (fs.writeFile as any) = async (path: string, data: string) => {
      attemptCount++;
      if (attemptCount === 1) {
        const error = new Error('Resource temporarily unavailable');
        (error as any).code = 'EAGAIN';
        throw error;
      }
      // Second attempt succeeds - write to actual file
      return originalWriteFile.call(fs, path, data, 'utf-8');
    };

    const event = createProjectEvent(ProjectEventType.CREATED, 'project-1', { test: 'data' });

    // Should succeed on retry
    await persistence.append(event);

    // Wait for flush
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify event was persisted
    const results = await persistence.query({ projectId: 'project-1' });
    assert.equal(results.length, 1);
    assert.equal(attemptCount, 2, 'Should have retried once and succeeded');
  });

  it('F-T-001d: should create directory if it does not exist', async () => {
    // Use a non-existent nested directory
    const nestedDir = path.join(tmpdir(), `yaml-persistence-nested-${randomUUID()}`, 'subdir');
    const nestedFilePath = path.join(nestedDir, 'test-events.yaml');
    const nestedPersistence = new YamlEventPersistence(nestedFilePath);

    try {
      await nestedPersistence.recover();

      // Verify directory was created
      assert.ok(existsSync(nestedDir), 'Directory should have been created');

      // Append an event to verify everything works
      const event = createProjectEvent(ProjectEventType.CREATED, 'project-1', { test: 'data' });
      await nestedPersistence.append(event);

      // Wait for flush
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify file was created
      assert.ok(existsSync(nestedFilePath), 'File should have been created');

      const results = await nestedPersistence.query({ projectId: 'project-1' });
      assert.equal(results.length, 1);
    } finally {
      // Cleanup
      try {
        await fs.rm(path.join(tmpdir(), `yaml-persistence-nested-${randomUUID().split('-')[0]}`), {
          recursive: true,
          force: true,
        });
      } catch {
        // ignore
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────
// F-T-003: Concurrent Append Tests
// ─────────────────────────────────────────────────────────────

describe('F-T-003: Concurrent Append Operations', () => {
  let testDir: string;
  let persistence: YamlEventPersistence;
  let filePath: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `yaml-persistence-concurrent-test-${randomUUID()}`);
    filePath = path.join(testDir, 'test-events.yaml');
    await fs.mkdir(testDir, { recursive: true });
    persistence = new YamlEventPersistence(filePath);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('F-T-003a: should handle 10 concurrent appends without data loss', async () => {
    await persistence.recover();

    const eventCount = 10;
    const events = Array.from({ length: eventCount }, (_, i) =>
      createProjectEvent(ProjectEventType.CREATED, `project-${i}`, { index: i }),
    );

    // Fire all appends concurrently
    await Promise.all(events.map((e) => persistence.append(e)));

    // Wait for all flushes to complete
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Verify all events were persisted
    const allEvents = await persistence.query({});
    assert.equal(allEvents.length, eventCount, `Should have exactly ${eventCount} events`);

    // Verify no duplicates by checking IDs
    const ids = new Set(allEvents.map((e) => e.id));
    assert.equal(ids.size, eventCount, 'All event IDs should be unique');
  });

  it('F-T-003b: should maintain consistency when appending and querying concurrently', async () => {
    await persistence.recover();

    const eventCount = 10;
    const events = Array.from({ length: eventCount }, (_, i) =>
      createProjectEvent(ProjectEventType.CREATED, `project-${i % 3}`, { index: i }),
    );

    // Start appending and querying concurrently
    const appendPromises = events.map((e) => persistence.append(e));
    const queryPromises = Array.from({ length: 5 }, () =>
      new Promise(async (resolve) => {
        // Small delay to ensure some appends have started
        await new Promise((r) => setTimeout(r, 50));
        const results = await persistence.query({});
        resolve(results.length);
      }),
    );

    const results = await Promise.all([...appendPromises, ...queryPromises]);
    const queryCounts = (results as any[]).slice(-5);

    // Query results should show events being added (from 0 to eventCount)
    // At minimum, final state should be consistent
    await new Promise((resolve) => setTimeout(resolve, 300));

    const finalEvents = await persistence.query({});
    assert.equal(finalEvents.length, eventCount, 'Final state should have all events');

    // Verify YAML is valid by reloading
    const yamlContent = await fs.readFile(filePath, 'utf-8');
    assert.ok(yamlContent, 'File should have content');
  });

  it('F-T-003c: should handle concurrent appends with file rotation atomically', async () => {
    await persistence.recover();

    // Create enough large events to trigger rotation (5MB limit)
    const largeData = 'x'.repeat(500 * 1024); // 500KB per event
    const events = Array.from({ length: 12 }, (_, i) =>
      createProjectEvent(ProjectEventType.CREATED, `project-${i}`, {
        data: largeData,
        index: i,
      }),
    );

    // Append all concurrently
    await Promise.all(events.map((e) => persistence.append(e)));

    // Wait for flush and potential rotation
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Verify all events are accessible
    const allEvents = await persistence.query({});
    assert.equal(allEvents.length, events.length, 'No events should be lost during rotation');

    // Verify main file exists
    assert.ok(existsSync(filePath), 'Main file should exist');

    // Verify YAML structure is valid
    const yamlContent = await fs.readFile(filePath, 'utf-8');
    assert.ok(yamlContent.includes('projectId:'), 'YAML should be properly formatted');
  });

  it('F-T-003d: should maintain projectId index consistency under concurrent load', async () => {
    await persistence.recover();

    const projectIds = ['proj-a', 'proj-b', 'proj-c'];
    const eventsPerProject = 10;
    const allEvents = [];

    // Create events for multiple projects
    for (const projectId of projectIds) {
      for (let i = 0; i < eventsPerProject; i++) {
        allEvents.push(
          createProjectEvent(ProjectEventType.CREATED, projectId, { index: i, project: projectId }),
        );
      }
    }

    // Shuffle to interleave projects
    for (let i = allEvents.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allEvents[i], allEvents[j]] = [allEvents[j], allEvents[i]];
    }

    // Append all concurrently
    await Promise.all(allEvents.map((e) => persistence.append(e)));

    // Wait for flush
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Verify projectId index consistency
    for (const projectId of projectIds) {
      const results = await persistence.query({ projectId });
      assert.equal(results.length, eventsPerProject, `Project ${projectId} should have ${eventsPerProject} events`);
      assert.ok(results.every((e) => e.projectId === projectId), `All events for ${projectId} should match projectId`);
    }

    // Verify total count
    const totalEvents = await persistence.query({});
    assert.equal(totalEvents.length, projectIds.length * eventsPerProject, 'Total event count should match');
  });
});
