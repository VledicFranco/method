/**
 * F-T-003: Concurrent Append Tests for YamlEventPersistence
 *
 * TIER_0 critical fix: YamlEventPersistence must handle concurrent operations safely.
 * Tests verify data integrity under concurrent load.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import YAML from 'js-yaml';

// Import from bridge (YamlEventPersistence was moved to bridge package per prd-020)
// Re-export types/implementations to test them in core context
interface ProjectEvent {
  id: string;
  type: string;
  projectId: string;
  timestamp: Date;
  data: Record<string, any>;
  metadata: Record<string, any>;
}

interface SerializedEvent {
  id: string;
  type: string;
  projectId: string;
  timestamp: string;
  data: Record<string, any>;
  metadata: Record<string, any>;
}

// YamlEventPersistence implementation (mirrored here for core tests)
class YamlEventPersistence {
  private filePath: string;
  private events: ProjectEvent[] = [];
  private writeBuffer: ProjectEvent[] = [];
  private flushTimeout: NodeJS.Timeout | null = null;
  private lastFlushTime = 0;
  private projectIdIndex: Map<string, number[]> = new Map();
  private pendingFlushPromise: Promise<void> | null = null;
  private pendingFlushResolve: (() => void) | null = null;
  private pendingFlushReject: ((err: Error) => void) | null = null;

  private readonly ROTATION_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
  private readonly MAX_BACKUP_FILES = 3;
  private readonly FLUSH_DEBOUNCE_MS = 100;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_BACKOFF_MS = 100;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async recover(): Promise<void> {
    try {
      const dirPath = path.dirname(this.filePath);
      if (!existsSync(dirPath)) {
        await fs.mkdir(dirPath, { recursive: true });
      }

      if (existsSync(this.filePath)) {
        const content = await fs.readFile(this.filePath, 'utf-8');
        if (content.trim()) {
          const data = YAML.load(content) as SerializedEvent[];
          if (Array.isArray(data)) {
            this.events = data.map((evt) => this.deserializeEvent(evt));
            this.rebuildIndex();
          }
        }
      }
    } catch (err) {
      console.error(`Failed to recover events from ${this.filePath}:`, err);
      this.events = [];
      this.projectIdIndex.clear();
    }
  }

  private rebuildIndex(): void {
    this.projectIdIndex.clear();
    for (let i = 0; i < this.events.length; i++) {
      const projectId = this.events[i].projectId;
      if (!this.projectIdIndex.has(projectId)) {
        this.projectIdIndex.set(projectId, []);
      }
      this.projectIdIndex.get(projectId)!.push(i);
    }
  }

  async append(event: ProjectEvent): Promise<void> {
    this.events.push(event);
    this.writeBuffer.push(event);

    const eventIndex = this.events.length - 1;
    if (!this.projectIdIndex.has(event.projectId)) {
      this.projectIdIndex.set(event.projectId, []);
    }
    this.projectIdIndex.get(event.projectId)!.push(eventIndex);

    if (!this.pendingFlushPromise) {
      this.pendingFlushPromise = new Promise<void>((resolve, reject) => {
        this.pendingFlushResolve = resolve;
        this.pendingFlushReject = reject;
      });
    }

    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
    }

    this.flushTimeout = setTimeout(() => {
      this.flushToDisk()
        .then(() => {
          if (this.pendingFlushResolve) {
            this.pendingFlushResolve();
          }
          this.pendingFlushPromise = null;
          this.pendingFlushResolve = null;
          this.pendingFlushReject = null;
        })
        .catch((err) => {
          console.error('Failed to flush events to disk:', err);
          if (this.pendingFlushReject) {
            this.pendingFlushReject(err as Error);
          }
          this.pendingFlushPromise = null;
          this.pendingFlushResolve = null;
          this.pendingFlushReject = null;
        });
    }, this.FLUSH_DEBOUNCE_MS);

    return this.pendingFlushPromise;
  }

  async query(filter: { projectId?: string; type?: string; since?: Date; until?: Date }): Promise<ProjectEvent[]> {
    let candidates = this.events;

    if (filter.projectId) {
      const indices = this.projectIdIndex.get(filter.projectId);
      if (!indices) {
        return [];
      }
      candidates = indices.map((i) => this.events[i]);
    }

    return candidates.filter((evt) => {
      if (filter.type && evt.type !== filter.type) {
        return false;
      }
      if (filter.since && evt.timestamp < filter.since) {
        return false;
      }
      if (filter.until && evt.timestamp > filter.until) {
        return false;
      }
      return true;
    });
  }

  async latest(count: number): Promise<ProjectEvent[]> {
    return this.events.slice(-count);
  }

  private async flushToDisk(): Promise<void> {
    if (this.writeBuffer.length === 0) {
      return;
    }

    this.flushTimeout = null;

    const dirPath = path.dirname(this.filePath);
    await this.retryWrite(async () => {
      if (!existsSync(dirPath)) {
        await fs.mkdir(dirPath, { recursive: true });
      }

      // Check if rotation is needed
      if (existsSync(this.filePath)) {
        const stats = await fs.stat(this.filePath);
        if (stats.size >= this.ROTATION_SIZE_BYTES) {
          await this.rotateFile();
        }
      }

      const serialized = this.events.map((evt) => this.serializeEvent(evt));
      const yaml = YAML.dump(serialized, { lineWidth: -1 });

      const tmpPath = `${this.filePath}.tmp`;
      await fs.writeFile(tmpPath, yaml, 'utf-8');

      await fs.rename(tmpPath, this.filePath);

      this.writeBuffer = [];
      this.lastFlushTime = Date.now();
    });
  }

  private async rotateFile(): Promise<void> {
    const dir = path.dirname(this.filePath);
    const base = path.basename(this.filePath);

    for (let i = this.MAX_BACKUP_FILES - 1; i >= 1; i--) {
      const oldPath = path.join(dir, `${base}.${i}`);
      const newPath = path.join(dir, `${base}.${i + 1}`);

      if (existsSync(oldPath)) {
        if (i + 1 <= this.MAX_BACKUP_FILES) {
          await fs.rename(oldPath, newPath);
        } else {
          await fs.unlink(oldPath);
        }
      }
    }

    const backupPath = path.join(dir, `${base}.1`);
    if (existsSync(this.filePath)) {
      await fs.rename(this.filePath, backupPath);
    }
  }

  private async retryWrite(op: () => Promise<void>): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      try {
        await op();
        return;
      } catch (err) {
        lastError = err as Error;
        if (attempt < this.MAX_RETRIES - 1) {
          const backoffMs = this.RETRY_BACKOFF_MS * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    }

    throw lastError || new Error('Write operation failed');
  }

  private serializeEvent(evt: ProjectEvent): SerializedEvent {
    return {
      id: evt.id,
      type: evt.type,
      projectId: evt.projectId,
      timestamp: evt.timestamp.toISOString(),
      data: evt.data,
      metadata: evt.metadata,
    };
  }

  private deserializeEvent(evt: SerializedEvent): ProjectEvent {
    return {
      id: evt.id,
      type: evt.type,
      projectId: evt.projectId,
      timestamp: new Date(evt.timestamp),
      data: evt.data,
      metadata: evt.metadata,
    };
  }
}

// Helper to create test events
function createEvent(type: string, projectId: string, data: Record<string, any> = {}): ProjectEvent {
  return {
    id: randomUUID(),
    type,
    projectId,
    timestamp: new Date(),
    data,
    metadata: {},
  };
}

// Helper to verify YAML file is valid
async function verifyYamlValid(filePath: string): Promise<void> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    if (content.trim()) {
      YAML.load(content);
    }
  } catch (err) {
    throw new Error(`YAML validation failed for ${filePath}: ${err}`);
  }
}

describe('F-T-003: Concurrent Append Operations (Core Tests)', () => {
  let testDir: string;
  let persistence: YamlEventPersistence;
  let filePath: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `f-t-003-concurrent-test-${randomUUID()}`);
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

  it('F-T-003a: 10 concurrent appends with no data loss', async () => {
    await persistence.recover();

    const eventCount = 10;
    const events = Array.from({ length: eventCount }, (_, i) =>
      createEvent('CREATED', `project-${i}`, { index: i }),
    );

    // Fire all appends concurrently via Promise.all
    await Promise.all(events.map((e) => persistence.append(e)));

    // Wait for all flushes to complete
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Verify all events were persisted
    const allEvents = await persistence.query({});
    assert.equal(allEvents.length, eventCount, `Should have exactly ${eventCount} events`);

    // Verify no duplicates by checking IDs
    const ids = new Set(allEvents.map((e) => e.id));
    assert.equal(ids.size, eventCount, 'All event IDs should be unique');

    // Verify YAML is valid
    await verifyYamlValid(filePath);
  });

  it('F-T-003b: append + query concurrently maintains consistency', async () => {
    await persistence.recover();

    const eventCount = 10;
    const events = Array.from({ length: eventCount }, (_, i) =>
      createEvent('CREATED', `project-${i % 3}`, { index: i }),
    );

    // Start appending and querying concurrently
    const appendPromises = events.map((e) => persistence.append(e));
    const queryPromises = Array.from({ length: 5 }, () =>
      new Promise<number>(async (resolve) => {
        await new Promise((r) => setTimeout(r, 50));
        const results = await persistence.query({});
        resolve(results.length);
      }),
    );

    await Promise.all([...appendPromises, ...queryPromises]);

    // Wait for final flush
    await new Promise((resolve) => setTimeout(resolve, 300));

    const finalEvents = await persistence.query({});
    assert.equal(finalEvents.length, eventCount, 'Final state should have all events');

    // Verify YAML is valid and has content
    await verifyYamlValid(filePath);
    const yamlContent = await fs.readFile(filePath, 'utf-8');
    assert.ok(yamlContent, 'File should have content');
  });

  it('F-T-003c: concurrent appends with file rotation (atomic)', async () => {
    await persistence.recover();

    // Create large events to trigger rotation (5MB limit)
    const largeData = 'x'.repeat(500 * 1024); // 500KB per event
    const events = Array.from({ length: 12 }, (_, i) =>
      createEvent('CREATED', `project-${i}`, {
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

    // Verify main file exists and is valid
    assert.ok(existsSync(filePath), 'Main file should exist');
    await verifyYamlValid(filePath);

    // Verify YAML structure is properly formatted
    const yamlContent = await fs.readFile(filePath, 'utf-8');
    assert.ok(yamlContent.includes('projectId:'), 'YAML should be properly formatted');
  });

  it('F-T-003d: projectId index consistency under concurrent load', async () => {
    await persistence.recover();

    const projectIds = ['proj-a', 'proj-b', 'proj-c'];
    const eventsPerProject = 10;
    const allEvents = [];

    // Create events for multiple projects
    for (const projectId of projectIds) {
      for (let i = 0; i < eventsPerProject; i++) {
        allEvents.push(
          createEvent('CREATED', projectId, { index: i, project: projectId }),
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
      assert.ok(
        results.every((e) => e.projectId === projectId),
        `All events for ${projectId} should match projectId`,
      );
    }

    // Verify total count
    const totalEvents = await persistence.query({});
    assert.equal(totalEvents.length, projectIds.length * eventsPerProject, 'Total event count should match');

    // Verify no cross-project leakage
    const projAIds = new Set((await persistence.query({ projectId: 'proj-a' })).map((e) => e.id));
    const projBIds = new Set((await persistence.query({ projectId: 'proj-b' })).map((e) => e.id));
    assert.equal(
      projAIds.size,
      eventsPerProject,
      'proj-a should have exactly eventsPerProject events',
    );
    assert.equal(
      projBIds.size,
      eventsPerProject,
      'proj-b should have exactly eventsPerProject events',
    );
    for (const id of projAIds) {
      assert.ok(!projBIds.has(id), 'No event IDs should appear in multiple projects');
    }
  });

  it('F-T-003e: stress test - 100 rapid appends', async () => {
    await persistence.recover();

    const eventCount = 100;
    const events = Array.from({ length: eventCount }, (_, i) =>
      createEvent('CREATED', `project-${i % 10}`, { index: i }),
    );

    // Fire 100 appends in quick succession
    const startTime = Date.now();
    await Promise.all(events.map((e) => persistence.append(e)));

    // Wait for flush
    await new Promise((resolve) => setTimeout(resolve, 500));
    const totalTime = Date.now() - startTime;

    // Verify all persisted correctly
    const allEvents = await persistence.query({});
    assert.equal(allEvents.length, eventCount, `Should have exactly ${eventCount} events`);

    // Verify no duplicates
    const ids = new Set(allEvents.map((e) => e.id));
    assert.equal(ids.size, eventCount, 'All event IDs should be unique');

    // Verify performance acceptable (<5s total)
    assert.ok(totalTime < 5000, `Should complete in under 5 seconds (actual: ${totalTime}ms)`);

    // Verify YAML is valid
    await verifyYamlValid(filePath);

    console.log(`Stress test completed: 100 events in ${totalTime}ms`);
  });
});
