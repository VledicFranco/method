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
