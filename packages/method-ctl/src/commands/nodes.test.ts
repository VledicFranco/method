// SPDX-License-Identifier: Apache-2.0
// ── method-ctl nodes — Tests ────────────────────────────────────

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { nodesCommand } from './nodes.js';

// ── Helpers ──────────────────────────────────────────────────────

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

// ── Fixtures ─────────────────────────────────────────────────────

function makeNodeList() {
  return [
    {
      nodeId: 'node-1',
      instanceName: 'mission-control',
      address: { host: 'mission-control.ts.net', port: 3456 },
      resources: {
        nodeId: 'node-1',
        instanceName: 'mission-control',
        cpuCount: 8,
        cpuLoadPercent: 25,
        memoryTotalMb: 16384,
        memoryAvailableMb: 12288,
        sessionsActive: 2,
        sessionsMax: 10,
        projectCount: 5,
        uptimeMs: 172800000, // 2 days
        version: '0.1.0',
      },
      status: 'alive',
      lastSeen: Date.now(),
      projects: [
        { projectId: 'pv-method', name: 'pv-method' },
      ],
    },
    {
      nodeId: 'node-2',
      instanceName: 'laptop',
      address: { host: 'laptop.ts.net', port: 3456 },
      resources: {
        nodeId: 'node-2',
        instanceName: 'laptop',
        cpuCount: 4,
        cpuLoadPercent: 60,
        memoryTotalMb: 8192,
        memoryAvailableMb: 2048,
        sessionsActive: 6,
        sessionsMax: 10,
        projectCount: 3,
        uptimeMs: 7200000, // 2 hours
        version: '0.1.0',
      },
      status: 'alive',
      lastSeen: Date.now(),
      projects: [
        { projectId: 'pv-method', name: 'pv-method' },
        { projectId: 'pv-silky', name: 'pv-silky' },
      ],
    },
  ];
}

// ── Tests ────────────────────────────────────────────────────────

describe('method-ctl nodes', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.exitCode = undefined;
  });

  // Scenario: Node list with resources displays correctly
  it('displays node list with resource details in table format', async () => {
    const nodes = makeNodeList();

    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => nodes,
    })) as unknown as typeof fetch;

    const output = await captureStdout(async () => {
      await nodesCommand({ bridge: 'localhost:3456', format: 'table' });
    });

    // Verify table headers
    assert.ok(output.includes('Node'), 'should have Node column');
    assert.ok(output.includes('Address'), 'should have Address column');
    assert.ok(output.includes('CPU'), 'should have CPU column');
    assert.ok(output.includes('Memory'), 'should have Memory column');

    // Verify node data
    assert.ok(output.includes('mission-control'), 'should show mission-control');
    assert.ok(output.includes('laptop'), 'should show laptop');
    assert.ok(output.includes('mission-control.ts.net:3456'), 'should show address');

    // Verify resource data
    assert.ok(output.includes('2/10'), 'should show mission-control sessions');
    assert.ok(output.includes('6/10'), 'should show laptop sessions');
    assert.ok(output.includes('8c'), 'should show CPU count for mission-control');
    assert.ok(output.includes('4c'), 'should show CPU count for laptop');

    // Verify uptime formatting
    assert.ok(output.includes('2d 0h'), 'should format 2-day uptime');
    assert.ok(output.includes('2h 0m'), 'should format 2-hour uptime');
  });
});
