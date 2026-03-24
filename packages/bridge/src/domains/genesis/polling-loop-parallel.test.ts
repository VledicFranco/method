/**
 * F-A-3: Parallel Polling Tests
 *
 * Tests for the parallelized polling implementation:
 * - Up to 5 concurrent projects polled in parallel
 * - Results merged correctly after parallel completion
 * - Partial failures handled gracefully
 * - Max concurrency respected
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { GenesisPollingLoop } from './polling-loop.js';
import type { ProjectEvent } from '../projects/events/index.js';
import { ProjectEventType, createProjectEvent } from '../projects/events/index.js';

// Helper to create mock events
function createMockEvent(projectId: string, index: number): ProjectEvent {
  return createProjectEvent(ProjectEventType.DISCOVERED, projectId, {
    index,
  });
}

test('GenesisPollingLoop: Polls all projects when count <= maxConcurrentPolls', async () => {
  const tempDir = join(tmpdir(), `test-polling-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    const cursorFile = join(tempDir, 'cursors.yaml');
    const loop = new GenesisPollingLoop({
      cursorFilePath: cursorFile,
      maxConcurrentPolls: 5,
    });

    const projectIds = ['proj-1', 'proj-2', 'proj-3'];
    const pollCalls: Array<{ projectId: string; timestamp: number }> = [];
    const startTime = Date.now();

    // Track concurrent polls
    const eventFetcher = async (projectId: string): Promise<ProjectEvent[]> => {
      pollCalls.push({ projectId, timestamp: Date.now() - startTime });
      // Simulate network delay
      await new Promise((resolve) => setTimeout(resolve, 100));
      return [createMockEvent(projectId, 1)];
    };

    // Use minimal pool and callbacks
    const mockPool = {} as any;
    const onNewEvents = async () => {};

    // Poll once with 3 projects
    await loop.pollOnce(mockPool, 'test-session', eventFetcher, onNewEvents, () => projectIds);

    // All projects should have been polled
    assert.strictEqual(pollCalls.length, 3);
    const polledProjects = pollCalls.map((c) => c.projectId);
    assert(polledProjects.includes('proj-1'));
    assert(polledProjects.includes('proj-2'));
    assert(polledProjects.includes('proj-3'));
  } finally {
    rmSync(tempDir, { recursive: true });
  }
});

test('GenesisPollingLoop: Respects max concurrency with large project count', async () => {
  const tempDir = join(tmpdir(), `test-polling-concurrency-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    const cursorFile = join(tempDir, 'cursors.yaml');
    const loop = new GenesisPollingLoop({
      cursorFilePath: cursorFile,
      maxConcurrentPolls: 2, // Only 2 concurrent
    });

    const projectIds = ['proj-1', 'proj-2', 'proj-3', 'proj-4', 'proj-5'];
    const concurrentCalls = new Set<string>();
    let maxConcurrent = 0;

    const eventFetcher = async (projectId: string): Promise<ProjectEvent[]> => {
      concurrentCalls.add(projectId);
      maxConcurrent = Math.max(maxConcurrent, concurrentCalls.size);

      // Simulate work
      await new Promise((resolve) => setTimeout(resolve, 50));

      concurrentCalls.delete(projectId);
      return [createMockEvent(projectId, 1)];
    };

    const mockPool = {} as any;
    await loop.pollOnce(mockPool, 'test-session', eventFetcher, async () => {}, () => projectIds);

    // Max concurrent should not exceed configured limit
    assert(maxConcurrent <= 2, `Max concurrent ${maxConcurrent} exceeds limit of 2`);
  } finally {
    rmSync(tempDir, { recursive: true });
  }
});

test('GenesisPollingLoop: Handles partial failures gracefully', async () => {
  const tempDir = join(tmpdir(), `test-polling-partial-fail-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    const cursorFile = join(tempDir, 'cursors.yaml');
    const loop = new GenesisPollingLoop({
      cursorFilePath: cursorFile,
      maxConcurrentPolls: 5,
    });

    const projectIds = ['proj-1', 'proj-2', 'proj-3'];
    const successfulPolls: string[] = [];

    const eventFetcher = async (projectId: string): Promise<ProjectEvent[]> => {
      // proj-2 fails
      if (projectId === 'proj-2') {
        throw new Error('Network error');
      }
      successfulPolls.push(projectId);
      return [createMockEvent(projectId, 1)];
    };

    const mockPool = {} as any;
    // Should not throw even with one failure
    await loop.pollOnce(mockPool, 'test-session', eventFetcher, async () => {}, () => projectIds);

    // proj-1 and proj-3 should have succeeded
    assert.strictEqual(successfulPolls.length, 2);
    assert(successfulPolls.includes('proj-1'));
    assert(successfulPolls.includes('proj-3'));
  } finally {
    rmSync(tempDir, { recursive: true });
  }
});

test('GenesisPollingLoop: Merges results correctly from parallel polls', async () => {
  const tempDir = join(tmpdir(), `test-polling-merge-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    const cursorFile = join(tempDir, 'cursors.yaml');
    const loop = new GenesisPollingLoop({
      cursorFilePath: cursorFile,
      maxConcurrentPolls: 2,
    });

    const projectIds = ['proj-1', 'proj-2', 'proj-3', 'proj-4'];
    const eventsReported: Array<{ projectId: string; count: number }> = [];

    const eventFetcher = async (projectId: string): Promise<ProjectEvent[]> => {
      // Return different number of events per project
      const eventCount = projectIds.indexOf(projectId) + 1;
      return Array.from({ length: eventCount }, (_, i) => createMockEvent(projectId, i));
    };

    const onNewEvents = async (projectId: string, events: ProjectEvent[]) => {
      eventsReported.push({ projectId, count: events.length });
    };

    const mockPool = {} as any;
    await loop.pollOnce(mockPool, 'test-session', eventFetcher, onNewEvents, () => projectIds);

    // All events should be reported with correct counts
    assert.strictEqual(eventsReported.length, 4);
    assert(eventsReported.some((e) => e.projectId === 'proj-1' && e.count === 1));
    assert(eventsReported.some((e) => e.projectId === 'proj-2' && e.count === 2));
    assert(eventsReported.some((e) => e.projectId === 'proj-3' && e.count === 3));
    assert(eventsReported.some((e) => e.projectId === 'proj-4' && e.count === 4));
  } finally {
    rmSync(tempDir, { recursive: true });
  }
});

test('GenesisPollingLoop: Respects max concurrency config from env var', async () => {
  const oldEnv = process.env.MAX_CONCURRENT_POLLS;
  try {
    process.env.MAX_CONCURRENT_POLLS = '3';
    const tempDir = join(tmpdir(), `test-polling-env-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    const cursorFile = join(tempDir, 'cursors.yaml');
    const loop = new GenesisPollingLoop({
      cursorFilePath: cursorFile,
    });

    // The env var should be respected
    assert(loop['maxConcurrentPolls'] === 3);

    rmSync(tempDir, { recursive: true });
  } finally {
    if (oldEnv !== undefined) {
      process.env.MAX_CONCURRENT_POLLS = oldEnv;
    } else {
      delete process.env.MAX_CONCURRENT_POLLS;
    }
  }
});
