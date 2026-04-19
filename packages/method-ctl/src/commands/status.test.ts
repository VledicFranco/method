// SPDX-License-Identifier: Apache-2.0
// ── method-ctl status — Tests ───────────────────────────────────

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { statusCommand } from './status.js';

// ── Helpers ──────────────────────────────────────────────────────

/** Capture stdout writes during a function call. */
function captureStdout(fn: () => Promise<void>): Promise<string> {
  let captured = '';
  const original = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    captured += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
    return true;
  }) as typeof process.stdout.write;

  return fn().finally(() => {
    process.stdout.write = original;
  }).then(() => captured);
}

/** Capture stderr writes during a function call. */
function captureStderr(fn: () => Promise<void>): Promise<string> {
  let captured = '';
  const original = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    captured += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
    return true;
  }) as typeof process.stderr.write;

  return fn().finally(() => {
    process.stderr.write = original;
  }).then(() => captured);
}

// ── Fixtures ─────────────────────────────────────────────────────

function makeClusterState() {
  return {
    self: {
      nodeId: 'node-1',
      instanceName: 'mission-control',
      address: { host: 'mission-control.ts.net', port: 3456 },
      resources: {
        nodeId: 'node-1',
        instanceName: 'mission-control',
        cpuCount: 8,
        cpuLoadPercent: 35,
        memoryTotalMb: 16384,
        memoryAvailableMb: 8192,
        sessionsActive: 3,
        sessionsMax: 10,
        projectCount: 5,
        uptimeMs: 86400000, // 1 day
        version: '0.1.0',
      },
      status: 'alive',
      lastSeen: Date.now(),
      projects: [
        { projectId: 'pv-method', name: 'pv-method' },
        { projectId: 'oss-glyphjs', name: 'oss-glyphjs' },
      ],
    },
    peers: {
      'node-2': {
        nodeId: 'node-2',
        instanceName: 'laptop',
        address: { host: 'laptop.ts.net', port: 3456 },
        resources: {
          nodeId: 'node-2',
          instanceName: 'laptop',
          cpuCount: 4,
          cpuLoadPercent: 70,
          memoryTotalMb: 8192,
          memoryAvailableMb: 2048,
          sessionsActive: 7,
          sessionsMax: 10,
          projectCount: 3,
          uptimeMs: 3600000, // 1 hour
          version: '0.1.0',
        },
        status: 'alive',
        lastSeen: Date.now(),
        projects: [
          { projectId: 'pv-method', name: 'pv-method' },
          { projectId: 'pv-silky', name: 'pv-silky' },
          { projectId: 'oss-conclave', name: 'oss-conclave' },
        ],
      },
    },
    generation: 42,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe('method-ctl status', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.exitCode = undefined;
  });

  // Scenario 1: Cluster healthy — displays table with correct data
  it('displays cluster health table when bridge responds with cluster state', async () => {
    const state = makeClusterState();

    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => state,
    })) as unknown as typeof fetch;

    const output = await captureStdout(async () => {
      await statusCommand({ bridge: 'localhost:3456', format: 'table' });
    });

    // Verify header
    assert.ok(output.includes('Cluster Status (generation 42)'), 'should show generation');
    assert.ok(output.includes('Nodes: 2 total'), 'should show total node count');
    assert.ok(output.includes('2 alive'), 'should show alive count');
    assert.ok(output.includes('Sessions: 10 active'), 'should show total sessions (3 + 7)');

    // Verify table columns
    assert.ok(output.includes('Node'), 'should have Node column');
    assert.ok(output.includes('Status'), 'should have Status column');
    assert.ok(output.includes('Sessions'), 'should have Sessions column');
    assert.ok(output.includes('CPU%'), 'should have CPU% column');
    assert.ok(output.includes('Memory%'), 'should have Memory% column');

    // Verify node rows
    assert.ok(output.includes('mission-control'), 'should show mission-control node');
    assert.ok(output.includes('laptop'), 'should show laptop node');
    assert.ok(output.includes('3/10'), 'should show mission-control sessions');
    assert.ok(output.includes('7/10'), 'should show laptop sessions');
    assert.ok(output.includes('1d 0h'), 'should format uptime as days');
    assert.ok(output.includes('1h 0m'), 'should format uptime as hours');
  });

  // Scenario 2: Bridge unreachable — shows error message gracefully
  it('shows error message when bridge is unreachable', async () => {
    globalThis.fetch = (async () => {
      throw new Error('fetch failed');
    }) as unknown as typeof fetch;

    const output = await captureStderr(async () => {
      await statusCommand({ bridge: 'localhost:3456', format: 'table' });
    });

    assert.ok(output.includes('Could not connect to bridge'), 'should show connection error');
    assert.ok(output.includes('localhost:3456'), 'should include bridge address');
    assert.equal(process.exitCode, 1, 'should set exit code to 1');
  });
});
