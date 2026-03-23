/**
 * Tests for JsonLineEventPersistence
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import YAML from 'js-yaml';
import { JsonLineEventPersistence } from './events/jsonl-event-persistence.js';
import {
  ProjectEventType,
  createProjectEvent,
  serializeProjectEvent,
  deserializeProjectEvent,
} from './events/index.js';

describe('JsonLineEventPersistence', () => {
  let testDir: string;
  let persistence: JsonLineEventPersistence;
  let filePath: string;

  beforeEach(async () => {
    // Create unique temp directory
    testDir = path.join(tmpdir(), `jsonl-persistence-test-${randomUUID()}`);
    filePath = path.join(testDir, 'test-events.jsonl');
    await fs.mkdir(testDir, { recursive: true });
    persistence = new JsonLineEventPersistence(filePath);
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
    const event2 = createProjectEvent(ProjectEventType.REGISTRY_UPDATED, 'project-1', {
      version: 2,
    });

    await persistence.append(event1);
    await persistence.append(event2);

    // Wait for flush
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Create new instance and recover
    const persistence2 = new JsonLineEventPersistence(filePath);
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
    // Each event with ~500KB of data should result in ~600KB JSON when serialized
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
    const mainFileExists = existsSync(filePath);

    // Main file should exist after rotation
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

  it('should write JSONL format (one object per line)', async () => {
    await persistence.recover();

    const event1 = createProjectEvent(ProjectEventType.CREATED, 'project-1', { name: 'test1' });
    const event2 = createProjectEvent(ProjectEventType.REGISTRY_UPDATED, 'project-2', {
      name: 'test2',
    });

    await persistence.append(event1);
    await persistence.append(event2);

    // Wait for flush
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Read file and verify JSONL format
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');

    // Should have 2 lines
    assert.equal(lines.length, 2);

    // Each line should be valid JSON
    const obj1 = JSON.parse(lines[0]);
    const obj2 = JSON.parse(lines[1]);

    assert.equal(obj1.projectId, 'project-1');
    assert.equal(obj2.projectId, 'project-2');
  });

  it('should migrate from YAML format on first run', async () => {
    // Create a legacy YAML file
    const yamlPath = filePath.replace(/\.jsonl$/, '.yaml');
    const yamlEvents = [
      {
        id: randomUUID(),
        type: ProjectEventType.CREATED,
        projectId: 'project-1',
        timestamp: new Date().toISOString(),
        data: { name: 'test1' },
        metadata: {},
      },
      {
        id: randomUUID(),
        type: ProjectEventType.REGISTRY_UPDATED,
        projectId: 'project-2',
        timestamp: new Date().toISOString(),
        data: { name: 'test2' },
        metadata: {},
      },
    ];

    const yamlContent = YAML.dump(yamlEvents, { lineWidth: -1 });
    await fs.writeFile(yamlPath, yamlContent, 'utf-8');

    // Create persistence with YAML fallback path
    const migrationPersistence = new JsonLineEventPersistence(filePath, yamlPath);
    await migrationPersistence.recover();

    // Verify JSONL file was created
    assert.ok(existsSync(filePath), 'JSONL file should be created');

    // Verify YAML file was deleted
    assert.ok(!existsSync(yamlPath), 'YAML file should be deleted after migration');

    // Verify events were migrated
    const results = await migrationPersistence.query({});
    assert.equal(results.length, 2);
    assert.equal(results[0].projectId, 'project-1');
    assert.equal(results[1].projectId, 'project-2');
  });

  it('should skip migration if JSONL already exists', async () => {
    // Create both JSONL and YAML files
    const yamlPath = filePath.replace(/\.jsonl$/, '.yaml');

    const event = createProjectEvent(ProjectEventType.CREATED, 'project-1', { name: 'test' });
    const serialized = serializeProjectEvent(event);
    const jsonlContent = JSON.stringify(serialized);

    await fs.writeFile(filePath, jsonlContent, 'utf-8');

    // Create a YAML file that should NOT be migrated
    const yamlContent = YAML.dump([serialized], { lineWidth: -1 });
    await fs.writeFile(yamlPath, yamlContent, 'utf-8');

    // Recover with YAML fallback path
    const migrationPersistence = new JsonLineEventPersistence(filePath, yamlPath);
    await migrationPersistence.recover();

    // YAML file should still exist (not migrated since JSONL exists)
    assert.ok(existsSync(yamlPath), 'YAML file should NOT be migrated when JSONL exists');
  });

  it('should handle malformed JSONL lines gracefully', async () => {
    // Write a JSONL file with some invalid lines
    const event1 = createProjectEvent(ProjectEventType.CREATED, 'project-1', {});
    const serialized1 = serializeProjectEvent(event1);

    const event2 = createProjectEvent(ProjectEventType.REGISTRY_UPDATED, 'project-2', {});
    const serialized2 = serializeProjectEvent(event2);

    const content = [
      JSON.stringify(serialized1),
      'invalid json {',
      JSON.stringify(serialized2),
      '',
    ].join('\n');

    await fs.writeFile(filePath, content, 'utf-8');

    // Should load valid events, skip invalid ones
    await persistence.recover();
    const results = await persistence.query({});

    // Should have loaded 2 valid events despite 1 invalid line
    assert.equal(results.length, 2);
    assert.equal(results[0].projectId, 'project-1');
    assert.equal(results[1].projectId, 'project-2');
  });

  it('should use streaming reader for large files', async () => {
    // Write a large JSONL file
    const events = Array.from({ length: 1000 }, (_, i) =>
      createProjectEvent(ProjectEventType.CREATED, `project-${i % 10}`, { index: i }),
    );

    const lines = events.map((e) => JSON.stringify(serializeProjectEvent(e)));
    await fs.writeFile(filePath, lines.join('\n'), 'utf-8');

    // Load and verify
    await persistence.recover();
    const results = await persistence.query({});

    assert.equal(results.length, 1000);
  });

  it('should preserve event order in JSONL', async () => {
    await persistence.recover();

    const events = Array.from({ length: 20 }, (_, i) =>
      createProjectEvent(ProjectEventType.CREATED, `project-${i}`, { index: i }),
    );

    for (const event of events) {
      await persistence.append(event);
    }

    // Wait for flush
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Recover from disk
    const persistence2 = new JsonLineEventPersistence(filePath);
    await persistence2.recover();

    // Verify order
    const results = await persistence2.query({});
    for (let i = 0; i < results.length; i++) {
      assert.equal(results[i].data.index, i, `Event at index ${i} should have index ${i}`);
    }
  });
});
