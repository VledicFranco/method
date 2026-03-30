/**
 * Experiments domain — unit tests (PRD 041 Phase 2).
 *
 * Tests cover:
 * - Experiment CRUD (create, get, list)
 * - Run lifecycle (create, complete, fail)
 * - Config and environment capture
 * - JSONL event persistence (appendEvent, readEvents)
 * - Trace filtering (readTraces with cycleNumber, moduleId, phase)
 * - AC-07: experiment must exist before run can be created
 * - EventSink: correctly routes cognitive events to JSONL
 *
 * Uses real file I/O with a temp directory (DR-09: tests use real fixtures,
 * not minimal mocks).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promises as fsPromises } from 'node:fs';

import { NodeFileSystemProvider } from '../../ports/file-system.js';
import { JsYamlLoader } from '../../ports/yaml-loader.js';

import {
  setCorePorts,
  setDataDir,
  createExperiment,
  getExperiment,
  listExperiments,
  createRun,
  getRun,
  listRuns,
  captureRunConfig,
  captureEnvironment,
  completeRun,
  failRun,
} from './core.js';

import {
  setPersistencePorts,
  setPersistenceDataDir,
  appendEvent,
  readEvents,
  readTraces,
  createExperimentEventSink,
} from './persistence.js';

import type { BridgeEvent } from '../../ports/event-bus.js';
import type { Experiment, Run, RunMetrics, Condition } from './types.js';
import type { CreateExperimentInput } from './config.js';

// ── Test setup ──────────────────────────────────────────────────

const testFs = new NodeFileSystemProvider();
const testYaml = new JsYamlLoader();

let testDataDir: string;

before(async () => {
  testDataDir = join(tmpdir(), `method-bridge-exp-test-${Date.now()}`);
  await fsPromises.mkdir(testDataDir, { recursive: true });

  setCorePorts(testFs, testYaml);
  setDataDir(testDataDir);
  setPersistencePorts(testFs);
  setPersistenceDataDir(testDataDir);
});

after(async () => {
  // Cleanup temp directory
  try {
    await fsPromises.rm(testDataDir, { recursive: true, force: true });
  } catch {
    // Non-fatal cleanup failure
  }
});

// ── Helpers ─────────────────────────────────────────────────────

function makeExperimentInput(overrides?: Partial<CreateExperimentInput>): CreateExperimentInput {
  return {
    name: 'Test Experiment',
    hypothesis: 'Cognitive v2 performs better than v1 on reasoning tasks',
    conditions: [
      {
        name: 'v1-baseline',
        preset: 'baseline',
        provider: { type: 'claude-cli' },
      },
      {
        name: 'v2-enriched',
        preset: 'enriched',
        overrides: { monitor: { baseConfidenceThreshold: 0.4 } },
        provider: { type: 'claude-cli' },
        cycle: { maxCycles: 20 },
      },
    ],
    tasks: ['Solve the Tower of Hanoi with 3 disks.', 'Write a bubble sort in TypeScript.'],
    ...overrides,
  };
}

function makeBridgeEvent(overrides?: Partial<BridgeEvent>): BridgeEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    version: 1,
    timestamp: new Date().toISOString(),
    sequence: 1,
    domain: 'cognitive',
    type: 'cognitive.module_step',
    severity: 'info',
    payload: {
      experimentId: 'exp-placeholder',
      runId: 'run-placeholder',
      cycleNumber: 1,
      moduleId: 'monitor',
      phase: 'monitor',
    },
    source: 'test',
    ...overrides,
  };
}

// ── Experiment CRUD ─────────────────────────────────────────────

describe('createExperiment()', () => {
  it('creates an experiment with a generated ID', async () => {
    const input = makeExperimentInput();
    const experiment = await createExperiment(input);

    assert.ok(experiment.id, 'experiment.id should be set');
    assert.equal(experiment.name, input.name);
    assert.equal(experiment.hypothesis, input.hypothesis);
    assert.equal(experiment.conditions.length, 2);
    assert.equal(experiment.tasks.length, 2);
    assert.equal(experiment.status, 'drafting');
    assert.ok(experiment.createdAt, 'createdAt should be set');
    assert.ok(experiment.updatedAt, 'updatedAt should be set');
  });

  it('persists experiment.yaml to the data directory', async () => {
    const experiment = await createExperiment(makeExperimentInput({ name: 'Persisted Experiment' }));
    const filePath = join(testDataDir, experiment.id, 'experiment.yaml');

    const content = await fsPromises.readFile(filePath, 'utf-8');
    assert.ok(content.includes('Persisted Experiment'), 'YAML should contain experiment name');
  });

  it('rejects input with missing name', async () => {
    await assert.rejects(
      () => createExperiment(makeExperimentInput({ name: '' })),
      (err: unknown) => {
        const msg = (err as Error).message;
        return msg.includes('name') || msg.includes('empty') || msg.includes('small');
      },
    );
  });

  it('rejects input with empty conditions array', async () => {
    await assert.rejects(
      () => createExperiment(makeExperimentInput({ conditions: [] })),
      (err: unknown) => {
        const msg = (err as Error).message;
        return msg.includes('condition') || msg.includes('Condition') || msg.includes('least');
      },
    );
  });

  it('rejects input with empty tasks array', async () => {
    await assert.rejects(
      () => createExperiment(makeExperimentInput({ tasks: [] })),
      (err: unknown) => {
        const msg = (err as Error).message;
        return msg.includes('task') || msg.includes('Task') || msg.includes('least');
      },
    );
  });
});

describe('getExperiment()', () => {
  it('reads a previously created experiment', async () => {
    const created = await createExperiment(makeExperimentInput({ name: 'Get Test' }));
    const fetched = await getExperiment(created.id);

    assert.equal(fetched.id, created.id);
    assert.equal(fetched.name, 'Get Test');
    assert.equal(fetched.status, 'drafting');
  });

  it('throws "Experiment not found" for unknown ID', async () => {
    await assert.rejects(
      () => getExperiment('nonexistent-id-xyz'),
      /Experiment not found/,
    );
  });
});

describe('listExperiments()', () => {
  it('returns all created experiments', async () => {
    // Create two experiments with unique names to test listing
    const e1 = await createExperiment(makeExperimentInput({ name: 'List Test Alpha' }));
    const e2 = await createExperiment(makeExperimentInput({ name: 'List Test Beta' }));

    const list = await listExperiments();

    const ids = list.map((e) => e.id);
    assert.ok(ids.includes(e1.id), 'list should contain first experiment');
    assert.ok(ids.includes(e2.id), 'list should contain second experiment');
  });

  it('returns empty array when data directory does not exist', async () => {
    // Temporarily point to a non-existent dir
    const originalDir = testDataDir;
    setDataDir(join(tmpdir(), 'method-does-not-exist-xyz'));
    setPersistenceDataDir(join(tmpdir(), 'method-does-not-exist-xyz'));

    const list = await listExperiments();
    assert.deepEqual(list, []);

    // Restore
    setDataDir(originalDir);
    setPersistenceDataDir(originalDir);
  });
});

// ── Run lifecycle ───────────────────────────────────────────────

describe('createRun()', () => {
  it('creates a run for a valid experiment and condition', async () => {
    const experiment = await createExperiment(makeExperimentInput());
    const run = await createRun(experiment.id, 'v1-baseline', 'Test task');

    assert.ok(run.id, 'run.id should be set');
    assert.equal(run.experimentId, experiment.id);
    assert.equal(run.conditionName, 'v1-baseline');
    assert.equal(run.task, 'Test task');
    assert.equal(run.status, 'running');
    assert.ok(run.startedAt, 'startedAt should be set');
  });

  it('writes status.json on run creation', async () => {
    const experiment = await createExperiment(makeExperimentInput());
    const run = await createRun(experiment.id, 'v2-enriched', 'Another task');

    const statusPath = join(testDataDir, experiment.id, 'runs', run.id, 'status.json');
    const content = await fsPromises.readFile(statusPath, 'utf-8');
    const statusData = JSON.parse(content) as { status: string; runId: string };

    assert.equal(statusData.status, 'running');
    assert.equal(statusData.runId, run.id);
  });

  it('writes environment.yaml on run creation', async () => {
    const experiment = await createExperiment(makeExperimentInput());
    const run = await createRun(experiment.id, 'v1-baseline', 'env test task');

    const envPath = join(testDataDir, experiment.id, 'runs', run.id, 'environment.yaml');
    const content = await fsPromises.readFile(envPath, 'utf-8');
    assert.ok(content.includes('nodeVersion'), 'environment.yaml should contain nodeVersion');
  });

  // AC-07: experiment must exist before run can be created
  it('throws "Experiment not found. Create an experiment first." for nonexistent experimentId', async () => {
    await assert.rejects(
      () => createRun('nonexistent-exp-id', 'v1-baseline', 'Some task'),
      /Experiment not found\. Create an experiment first\./,
    );
  });

  it('throws for a conditionName not in the experiment', async () => {
    const experiment = await createExperiment(makeExperimentInput());
    await assert.rejects(
      () => createRun(experiment.id, 'nonexistent-condition', 'Some task'),
      /Condition "nonexistent-condition" not found/,
    );
  });
});

describe('completeRun()', () => {
  it('writes metrics.json and updates status to completed', async () => {
    const experiment = await createExperiment(makeExperimentInput());
    const run = await createRun(experiment.id, 'v1-baseline', 'Complete test');

    const metrics: RunMetrics = {
      cycles: 5,
      totalTokens: 1200,
      interventions: 1,
      evictions: 0,
      cost: 0.024,
      verdict: 'pass',
    };

    await completeRun(experiment.id, run.id, metrics);

    const updatedRun = await getRun(experiment.id, run.id);
    assert.equal(updatedRun.status, 'completed');
    assert.ok(updatedRun.completedAt, 'completedAt should be set');
    assert.ok(updatedRun.metrics, 'metrics should be present');
    assert.equal(updatedRun.metrics!.cycles, 5);
    assert.equal(updatedRun.metrics!.verdict, 'pass');
  });
});

describe('failRun()', () => {
  it('updates status to failed with error message', async () => {
    const experiment = await createExperiment(makeExperimentInput());
    const run = await createRun(experiment.id, 'v1-baseline', 'Fail test');

    await failRun(experiment.id, run.id, 'Provider unavailable');

    const updatedRun = await getRun(experiment.id, run.id);
    assert.equal(updatedRun.status, 'failed');
    assert.ok(updatedRun.completedAt, 'completedAt should be set');
  });
});

// ── Config and environment capture ─────────────────────────────

describe('captureRunConfig()', () => {
  it('writes config.yaml with the provided configuration', async () => {
    const experiment = await createExperiment(makeExperimentInput());
    const run = await createRun(experiment.id, 'v1-baseline', 'Config test');

    const config = {
      preset: 'baseline',
      provider: { type: 'claude-cli', model: 'claude-sonnet-4-5' },
      cycle: { maxCycles: 15 },
      workspace: { capacity: 10 },
    };

    await captureRunConfig(experiment.id, run.id, config);

    const configPath = join(testDataDir, experiment.id, 'runs', run.id, 'config.yaml');
    const content = await fsPromises.readFile(configPath, 'utf-8');

    assert.ok(content.includes('baseline'), 'config.yaml should contain preset');
    assert.ok(content.includes('claude-cli'), 'config.yaml should contain provider type');
  });
});

describe('captureEnvironment()', () => {
  it('writes environment.yaml with nodeVersion', async () => {
    const experiment = await createExperiment(makeExperimentInput());
    const run = await createRun(experiment.id, 'v1-baseline', 'Env capture test');

    // environment.yaml is written during createRun, but we call it explicitly here too
    await captureEnvironment(experiment.id, run.id);

    const envPath = join(testDataDir, experiment.id, 'runs', run.id, 'environment.yaml');
    const content = await fsPromises.readFile(envPath, 'utf-8');
    const parsed = testYaml.load(content) as Record<string, unknown>;

    assert.ok(parsed.nodeVersion, 'should have nodeVersion');
    assert.equal(parsed.nodeVersion, process.version);
    assert.ok('gitSha' in parsed, 'gitSha key should be present (may be null if git unavailable)');
    assert.ok('packageVersions' in parsed, 'packageVersions should be present');
  });
});

// ── JSONL persistence ───────────────────────────────────────────

describe('appendEvent() + readEvents()', () => {
  it('appends events and reads them back in order', async () => {
    const experiment = await createExperiment(makeExperimentInput());
    const run = await createRun(experiment.id, 'v1-baseline', 'Persistence test');

    const event1 = makeBridgeEvent({
      id: 'evt-001',
      sequence: 1,
      payload: { experimentId: experiment.id, runId: run.id, cycleNumber: 1 },
    });
    const event2 = makeBridgeEvent({
      id: 'evt-002',
      sequence: 2,
      payload: { experimentId: experiment.id, runId: run.id, cycleNumber: 2 },
    });

    await appendEvent(experiment.id, run.id, event1);
    await appendEvent(experiment.id, run.id, event2);

    const events = await readEvents(experiment.id, run.id);
    assert.equal(events.length, 2);
    assert.equal(events[0].id, 'evt-001');
    assert.equal(events[1].id, 'evt-002');
  });

  it('returns empty array when no events exist', async () => {
    const experiment = await createExperiment(makeExperimentInput());
    const run = await createRun(experiment.id, 'v1-baseline', 'Empty events test');

    const events = await readEvents(experiment.id, run.id);
    assert.deepEqual(events, []);
  });

  it('creates the events file and directory if they do not exist', async () => {
    const experiment = await createExperiment(makeExperimentInput());
    const run = await createRun(experiment.id, 'v1-baseline', 'Create file test');

    const event = makeBridgeEvent({
      payload: { experimentId: experiment.id, runId: run.id, cycleNumber: 1 },
    });
    await appendEvent(experiment.id, run.id, event);

    const eventsPath = join(testDataDir, experiment.id, 'runs', run.id, 'events.jsonl');
    const stat = await fsPromises.stat(eventsPath);
    assert.ok(stat.isFile(), 'events.jsonl should be a file');
  });
});

// ── Trace filtering ─────────────────────────────────────────────

describe('readTraces()', () => {
  it('returns only cognitive domain events as TraceRecords', async () => {
    const experiment = await createExperiment(makeExperimentInput());
    const run = await createRun(experiment.id, 'v1-baseline', 'Trace filter test');

    const cognitiveEvent = makeBridgeEvent({
      id: 'cog-evt-001',
      domain: 'cognitive',
      type: 'cognitive.module_step',
      payload: {
        experimentId: experiment.id,
        runId: run.id,
        cycleNumber: 1,
        moduleId: 'monitor',
        phase: 'monitor',
      },
    });
    const nonCognitiveEvent = makeBridgeEvent({
      id: 'non-cog-evt-001',
      domain: 'session',
      type: 'session.spawned',
      payload: {
        experimentId: experiment.id,
        runId: run.id,
      },
    });

    await appendEvent(experiment.id, run.id, cognitiveEvent);
    await appendEvent(experiment.id, run.id, nonCognitiveEvent);

    const traces = await readTraces(experiment.id, run.id);
    assert.equal(traces.length, 1, 'should only return cognitive events');
    assert.equal(traces[0].id, 'cog-evt-001');
    assert.equal(traces[0].type, 'cognitive.module_step');
  });

  it('filters by cycleNumber — only returns events from that cycle', async () => {
    const experiment = await createExperiment(makeExperimentInput());
    const run = await createRun(experiment.id, 'v1-baseline', 'cycleNumber filter test');

    for (let cycle = 1; cycle <= 5; cycle++) {
      await appendEvent(experiment.id, run.id, makeBridgeEvent({
        id: `cycle-evt-${cycle}`,
        payload: {
          experimentId: experiment.id,
          runId: run.id,
          cycleNumber: cycle,
          moduleId: 'reasoner',
          phase: 'reason',
        },
      }));
    }

    const traces = await readTraces(experiment.id, run.id, { cycleNumber: 3 });
    assert.equal(traces.length, 1, 'should return only cycle 3 events');
    assert.equal(traces[0].cycleNumber, 3);
    assert.equal(traces[0].id, 'cycle-evt-3');
  });

  it('filters by moduleId', async () => {
    const experiment = await createExperiment(makeExperimentInput());
    const run = await createRun(experiment.id, 'v2-enriched', 'moduleId filter test');

    await appendEvent(experiment.id, run.id, makeBridgeEvent({
      id: 'monitor-evt',
      payload: { experimentId: experiment.id, runId: run.id, cycleNumber: 1, moduleId: 'monitor', phase: 'monitor' },
    }));
    await appendEvent(experiment.id, run.id, makeBridgeEvent({
      id: 'reasoner-evt',
      payload: { experimentId: experiment.id, runId: run.id, cycleNumber: 1, moduleId: 'reasoner', phase: 'reason' },
    }));

    const traces = await readTraces(experiment.id, run.id, { moduleId: 'monitor' });
    assert.equal(traces.length, 1);
    assert.equal(traces[0].moduleId, 'monitor');
    assert.equal(traces[0].id, 'monitor-evt');
  });

  it('filters by phase', async () => {
    const experiment = await createExperiment(makeExperimentInput());
    const run = await createRun(experiment.id, 'v1-baseline', 'phase filter test');

    await appendEvent(experiment.id, run.id, makeBridgeEvent({
      id: 'monitor-phase',
      payload: { experimentId: experiment.id, runId: run.id, cycleNumber: 1, phase: 'monitor' },
    }));
    await appendEvent(experiment.id, run.id, makeBridgeEvent({
      id: 'act-phase',
      payload: { experimentId: experiment.id, runId: run.id, cycleNumber: 1, phase: 'act' },
    }));

    const actTraces = await readTraces(experiment.id, run.id, { phase: 'act' });
    assert.equal(actTraces.length, 1);
    assert.equal(actTraces[0].phase, 'act');
    assert.equal(actTraces[0].id, 'act-phase');
  });

  it('returns all traces when no filter is provided', async () => {
    const experiment = await createExperiment(makeExperimentInput());
    const run = await createRun(experiment.id, 'v1-baseline', 'no filter test');

    for (let i = 0; i < 4; i++) {
      await appendEvent(experiment.id, run.id, makeBridgeEvent({
        id: `evt-no-filter-${i}`,
        payload: { experimentId: experiment.id, runId: run.id, cycleNumber: i, moduleId: 'monitor' },
      }));
    }

    const traces = await readTraces(experiment.id, run.id);
    assert.equal(traces.length, 4);
  });

  it('combines multiple filters (AND semantics)', async () => {
    const experiment = await createExperiment(makeExperimentInput());
    const run = await createRun(experiment.id, 'v1-baseline', 'combined filter test');

    // cycle 2, monitor
    await appendEvent(experiment.id, run.id, makeBridgeEvent({
      id: 'c2-monitor',
      payload: { experimentId: experiment.id, runId: run.id, cycleNumber: 2, moduleId: 'monitor', phase: 'monitor' },
    }));
    // cycle 2, reasoner
    await appendEvent(experiment.id, run.id, makeBridgeEvent({
      id: 'c2-reasoner',
      payload: { experimentId: experiment.id, runId: run.id, cycleNumber: 2, moduleId: 'reasoner', phase: 'reason' },
    }));
    // cycle 3, monitor
    await appendEvent(experiment.id, run.id, makeBridgeEvent({
      id: 'c3-monitor',
      payload: { experimentId: experiment.id, runId: run.id, cycleNumber: 3, moduleId: 'monitor', phase: 'monitor' },
    }));

    const traces = await readTraces(experiment.id, run.id, { cycleNumber: 2, moduleId: 'monitor' });
    assert.equal(traces.length, 1);
    assert.equal(traces[0].id, 'c2-monitor');
  });
});

// ── EventSink ───────────────────────────────────────────────────

describe('createExperimentEventSink()', () => {
  it('has name "experiment-persistence"', () => {
    const sink = createExperimentEventSink();
    assert.equal(sink.name, 'experiment-persistence');
  });

  it('persists cognitive events with valid experimentId + runId to JSONL', async () => {
    const experiment = await createExperiment(makeExperimentInput());
    const run = await createRun(experiment.id, 'v1-baseline', 'Sink persistence test');

    const sink = createExperimentEventSink();
    const event = makeBridgeEvent({
      id: 'sink-evt-001',
      domain: 'cognitive',
      type: 'cognitive.monitoring_signal',
      payload: {
        experimentId: experiment.id,
        runId: run.id,
        cycleNumber: 1,
        signal: 'confidence_low',
      },
    });

    await sink.onEvent(event);

    const events = await readEvents(experiment.id, run.id);
    assert.ok(events.some((e) => e.id === 'sink-evt-001'), 'event should be persisted');
  });

  it('ignores non-cognitive domain events', async () => {
    const experiment = await createExperiment(makeExperimentInput());
    const run = await createRun(experiment.id, 'v1-baseline', 'Sink ignore test');

    const sink = createExperimentEventSink();
    const sessionEvent = makeBridgeEvent({
      id: 'session-evt-001',
      domain: 'session',
      type: 'session.spawned',
      payload: { experimentId: experiment.id, runId: run.id },
    });

    await sink.onEvent(sessionEvent);

    const events = await readEvents(experiment.id, run.id);
    assert.ok(!events.some((e) => e.id === 'session-evt-001'), 'session event should not be persisted');
  });

  it('silently drops cognitive events without experimentId', async () => {
    const sink = createExperimentEventSink();
    const event = makeBridgeEvent({
      id: 'no-exp-evt',
      domain: 'cognitive',
      payload: { runId: 'some-run-id' }, // missing experimentId
    });

    // Should not throw
    await assert.doesNotReject(async () => { await sink.onEvent(event); });
  });

  it('silently drops cognitive events without runId', async () => {
    const sink = createExperimentEventSink();
    const event = makeBridgeEvent({
      id: 'no-run-evt',
      domain: 'cognitive',
      payload: { experimentId: 'some-exp-id' }, // missing runId
    });

    // Should not throw
    await assert.doesNotReject(async () => { await sink.onEvent(event); });
  });
});

// ── listRuns() ──────────────────────────────────────────────────

describe('listRuns()', () => {
  it('lists all runs for an experiment', async () => {
    const experiment = await createExperiment(makeExperimentInput());
    const run1 = await createRun(experiment.id, 'v1-baseline', 'Task 1');
    const run2 = await createRun(experiment.id, 'v2-enriched', 'Task 2');

    const runs = await listRuns(experiment.id);
    const runIds = runs.map((r) => r.id);

    assert.ok(runIds.includes(run1.id), 'should include run 1');
    assert.ok(runIds.includes(run2.id), 'should include run 2');
  });

  it('returns empty array when experiment has no runs', async () => {
    const experiment = await createExperiment(makeExperimentInput());
    const runs = await listRuns(experiment.id);
    assert.deepEqual(runs, []);
  });
});
