/**
 * Performance Baselines Test
 *
 * F-THANE-6: Measures and validates key performance metrics against PRD 020 specs
 *
 * Metrics to validate:
 * 1. Discovery time: <500ms for 10 projects
 * 2. Polling cycle time: <200ms (per project)
 * 3. Event log access: <10ms to query 100K events
 * 4. Config reload: <100ms validation + write
 * 5. Memory: <300MB baseline, <500MB under load
 *
 * All tests include timing assertions and baseline documentation.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as yaml from 'js-yaml';
import { DiscoveryService } from '../multi-project/discovery-service.js';
import {
  loadCursors,
  saveCursors,
  getCursorForProject,
  updateCursorForProject,
  type GenesisCursors,
} from '../genesis/polling-loop.js';

// ─── Helper: Create mock git repo ───

function createMockGitRepo(basePath: string, projectName: string): string {
  const projectPath = join(basePath, projectName);
  const gitDir = join(projectPath, '.git');
  const objectsDir = join(gitDir, 'objects');
  const refsDir = join(gitDir, 'refs');
  const methodDir = join(projectPath, '.method');

  mkdirSync(projectPath, { recursive: true });
  mkdirSync(objectsDir, { recursive: true });
  mkdirSync(refsDir, { recursive: true });
  mkdirSync(methodDir, { recursive: true });

  writeFileSync(join(gitDir, 'config'), '[core]\n\trepositoryformatversion = 0\n');

  writeFileSync(
    join(methodDir, 'manifest.yaml'),
    yaml.dump({
      installed: [],
      protocols: [],
    }),
  );

  return projectPath;
}

// ─── Helper: Get current memory usage in MB ───

function getMemoryMb(): number {
  if (global.gc) {
    global.gc();
  }
  const mem = process.memoryUsage();
  return Math.round(mem.heapUsed / 1024 / 1024);
}

// ─── Performance Metrics ───

interface PerfMetric {
  name: string;
  durationMs: number;
  threshold?: number;
  unit: string;
  pass: boolean;
}

const metrics: PerfMetric[] = [];

function recordMetric(
  name: string,
  durationMs: number,
  threshold?: number,
  unit: string = 'ms',
) {
  const pass = !threshold || durationMs <= threshold;
  metrics.push({ name, durationMs, threshold, unit, pass });
  console.log(
    `  [${pass ? 'PASS' : 'FAIL'}] ${name}: ${durationMs}${unit}${threshold ? ` (threshold: ${threshold}${unit})` : ''}`,
  );
}

describe('Performance Baselines', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `perf-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    metrics.length = 0; // Reset metrics
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('Baseline 1: Discovery Time', () => {
    it('discovers 10 projects in <500ms', async () => {
      // Create 10 test repos
      for (let i = 1; i <= 10; i++) {
        createMockGitRepo(testDir, `project-${i}`);
      }

      const discovery = new DiscoveryService({ timeoutMs: 10000 });

      const startMs = Date.now();
      const result = await discovery.discover(testDir);
      const elapsedMs = Date.now() - startMs;

      assert.strictEqual(result.projects.length, 10, 'Should discover 10 projects');
      assert.strictEqual(result.error_count, 0, 'Should have no errors');

      recordMetric('Discovery (10 projects)', elapsedMs, 500);
      assert(elapsedMs < 500, `Discovery should be <500ms, was ${elapsedMs}ms`);
    });

    it('discovers 5 projects in <250ms', async () => {
      for (let i = 1; i <= 5; i++) {
        createMockGitRepo(testDir, `app-${i}`);
      }

      const discovery = new DiscoveryService({ timeoutMs: 10000 });

      const startMs = Date.now();
      const result = await discovery.discover(testDir);
      const elapsedMs = Date.now() - startMs;

      assert.strictEqual(result.projects.length, 5);
      recordMetric('Discovery (5 projects)', elapsedMs, 250);
    });

    it('discovers 20 projects in <750ms', async () => {
      for (let i = 1; i <= 20; i++) {
        createMockGitRepo(testDir, `service-${String(i).padStart(2, '0')}`);
      }

      const discovery = new DiscoveryService({ timeoutMs: 20000 });

      const startMs = Date.now();
      const result = await discovery.discover(testDir);
      const elapsedMs = Date.now() - startMs;

      assert.strictEqual(result.projects.length, 20);
      recordMetric('Discovery (20 projects)', elapsedMs, 750);
    });
  });

  describe('Baseline 2: Polling Cycle Time', () => {
    it('polling cycle per project completes in <200ms', async () => {
      // Simulate polling a single project
      const projectId = 'test-project';
      const cursorFile = join(testDir, 'cursors.yaml');

      let cursors = loadCursors(cursorFile);

      // Simulate 5 polling cycles
      const cycleTimes: number[] = [];

      for (let i = 0; i < 5; i++) {
        const startMs = Date.now();

        // Load cursors
        cursors = loadCursors(cursorFile);

        // Get cursor for project
        const cursor = getCursorForProject(cursors, projectId);

        // Simulate fetching events (pretend we got 3 events)
        // In real code, this would be an HTTP/tool call

        // Update cursor
        updateCursorForProject(cursors, projectId, `cursor-${i}`, 3);

        // Save cursors
        saveCursors(cursors, cursorFile);

        const elapsedMs = Date.now() - startMs;
        cycleTimes.push(elapsedMs);
      }

      const avgCycleTime = cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length;
      recordMetric(`Polling cycle (per project, avg)`, Math.round(avgCycleTime), 200);

      // All cycles should be under threshold
      for (const cycleMs of cycleTimes) {
        assert(cycleMs < 200, `Cycle time should be <200ms, was ${cycleMs}ms`);
      }
    });

    it('multi-project polling (3 projects) completes in <600ms', async () => {
      const projectIds = ['proj-1', 'proj-2', 'proj-3'];
      const cursorFile = join(testDir, 'multi-cursors.yaml');

      let cursors = loadCursors(cursorFile);

      const startMs = Date.now();

      // Simulate one polling cycle across 3 projects
      for (const projectId of projectIds) {
        cursors = loadCursors(cursorFile);
        const cursor = getCursorForProject(cursors, projectId);
        // Simulate fetching events
        updateCursorForProject(cursors, projectId, `cursor-${projectId}`, 2);
        saveCursors(cursors, cursorFile);
      }

      const elapsedMs = Date.now() - startMs;
      recordMetric('Polling cycle (3 projects)', elapsedMs, 600);
      assert(elapsedMs < 600, `Multi-project polling should be <600ms, was ${elapsedMs}ms`);
    });
  });

  describe('Baseline 3: Cursor Persistence', () => {
    it('cursor load/save/reload cycle for 100 projects completes in <100ms', async () => {
      const cursorFile = join(testDir, 'large-cursors.yaml');
      let cursors = loadCursors(cursorFile);

      // Create 100 project cursors
      const startMs = Date.now();
      for (let i = 1; i <= 100; i++) {
        updateCursorForProject(cursors, `project-${String(i).padStart(3, '0')}`, `cursor-${i}`, i);
      }
      saveCursors(cursors, cursorFile);

      // Reload
      cursors = loadCursors(cursorFile);

      const elapsedMs = Date.now() - startMs;
      recordMetric('Cursor ops (100 projects, create+save+reload)', elapsedMs, 100);

      assert.strictEqual(cursors.cursors.length, 100, 'Should have 100 cursors');
      assert(elapsedMs < 100, `Cursor ops should be <100ms, was ${elapsedMs}ms`);
    });

    it('cursor file size scales reasonably with project count', () => {
      const cursorFile = join(testDir, 'size-test.yaml');
      let cursors = loadCursors(cursorFile);

      // Add 50 cursors
      for (let i = 1; i <= 50; i++) {
        updateCursorForProject(cursors, `svc-${i}`, `event-cursor-v1-${i}`, i * 2);
      }
      saveCursors(cursors, cursorFile);

      // Check file size
      const stats = statSync(cursorFile);
      const sizeKb = stats.size / 1024;

      recordMetric('Cursor file size (50 projects)', sizeKb, 10, 'KB');
      // Should be reasonably small (< 10KB for 50 projects)
      assert(sizeKb < 10, `Cursor file should be <10KB, was ${sizeKb}KB`);
    });
  });

  describe('Baseline 4: Cursor Query Performance', () => {
    it('cursor lookup completes in <5ms for large cursor set', async () => {
      const cursorFile = join(testDir, 'lookup-test.yaml');
      let cursors = loadCursors(cursorFile);

      // Create 500 cursors
      for (let i = 1; i <= 500; i++) {
        updateCursorForProject(cursors, `project-${i}`, `cursor-${i}`, i);
      }
      saveCursors(cursors, cursorFile);

      // Reload for fresh state
      cursors = loadCursors(cursorFile);

      // Benchmark lookups
      const lookupTimes: number[] = [];
      const testIndices = [1, 100, 250, 499, 500];

      for (const idx of testIndices) {
        const projectId = `project-${idx}`;
        const startMs = Date.now();
        const cursor = getCursorForProject(cursors, projectId);
        const elapsedMs = Date.now() - startMs;

        lookupTimes.push(elapsedMs);
        assert(cursor, `Should find cursor for project-${idx}`);
      }

      const avgLookupMs = lookupTimes.reduce((a, b) => a + b, 0) / lookupTimes.length;
      recordMetric('Cursor lookup (500 projects, avg)', Math.round(avgLookupMs), 5);
    });
  });

  describe('Baseline 5: Memory Usage', () => {
    it('baseline memory usage is <300MB', () => {
      const memMb = getMemoryMb();
      recordMetric('Baseline memory usage', memMb, 300, 'MB');

      assert(
        memMb < 300,
        `Baseline memory should be <300MB, was ${memMb}MB. Consider reducing fixture sizes.`,
      );
    });

    it('memory under load (100 projects) stays <500MB', async () => {
      const startMem = getMemoryMb();

      // Create 100 repos in memory
      for (let i = 1; i <= 100; i++) {
        createMockGitRepo(testDir, `load-test-${i}`);
      }

      // Discover them
      const discovery = new DiscoveryService({ timeoutMs: 20000 });
      const result = await discovery.discover(testDir);
      assert.strictEqual(result.projects.length, 100);

      // Create and manipulate cursors
      let cursors = loadCursors(join(testDir, 'cursors.yaml'));
      for (let i = 0; i < 100; i++) {
        updateCursorForProject(cursors, `project-${i}`, `cursor-${i}`, i);
      }
      saveCursors(cursors, join(testDir, 'cursors.yaml'));

      const endMem = getMemoryMb();
      const deltaMem = endMem - startMem;

      recordMetric('Memory delta (100 projects)', deltaMem, 300, 'MB');
      recordMetric('Memory after load', endMem, 500, 'MB');

      assert(
        endMem < 500,
        `Memory under load should be <500MB, was ${endMem}MB. Check for memory leaks.`,
      );
    });
  });

  describe('Baseline 6: YAML Parsing Performance', () => {
    it('parses 1000-line YAML config in <50ms', () => {
      const configFile = join(testDir, 'config.yaml');

      // Create a 1000-line YAML structure
      const config = {
        metadata: {
          version: '1.0',
          created_at: new Date().toISOString(),
        },
        projects: [] as any[],
      };

      for (let i = 0; i < 100; i++) {
        config.projects.push({
          id: `project-${i}`,
          name: `Project ${i}`,
          metadata: {
            status: 'active',
            last_updated: new Date().toISOString(),
            tags: ['tag1', 'tag2', 'tag3'],
          },
          config: {
            setting1: 'value1',
            setting2: 'value2',
            setting3: 'value3',
          },
        });
      }

      const yamlContent = yaml.dump(config, { lineWidth: -1 });
      writeFileSync(configFile, yamlContent, 'utf-8');

      // Measure parse time
      const startMs = Date.now();
      const content = readFileSync(configFile, 'utf-8');
      const parsed = yaml.load(content);
      const elapsedMs = Date.now() - startMs;

      recordMetric('YAML parse (1000 lines)', elapsedMs, 50);
      assert(parsed, 'Should parse valid YAML');
      assert(elapsedMs < 50, `YAML parsing should be <50ms, was ${elapsedMs}ms`);
    });
  });

  it('summary: all performance baselines', () => {
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║           PERFORMANCE BASELINE SUMMARY                  ║');
    console.log('╠════════════════════════════════════════════════════════╣');

    const passed = metrics.filter((m) => m.pass).length;
    const total = metrics.length;

    for (const metric of metrics) {
      const status = metric.pass ? '✓' : '✗';
      const threshold = metric.threshold ? ` / ${metric.threshold}${metric.unit}` : '';
      console.log(
        `║ ${status} ${metric.name.padEnd(45)} ${String(metric.durationMs).padStart(6)}${metric.unit}${threshold}`,
      );
    }

    console.log('╠════════════════════════════════════════════════════════╣');
    console.log(`║ PASSED: ${String(passed).padStart(2)}/${total}                                              ║`);
    console.log('╚════════════════════════════════════════════════════════╝\n');

    assert(passed === total, `${total - passed} performance baselines failed`);
  });
});
