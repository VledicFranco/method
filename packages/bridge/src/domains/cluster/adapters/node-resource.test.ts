/**
 * Node Resource Adapter — tests.
 *
 * Overrides OS functions to produce deterministic snapshots.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NodeResource } from './node-resource.js';

describe('NodeResource', () => {

  // 1. snapshot() returns valid ResourceSnapshot with reasonable values
  it('returns a valid ResourceSnapshot from OS and callback data', () => {
    const resource = new NodeResource(
      {
        nodeId: 'test-node',
        instanceName: 'test-bridge',
        version: '1.0.0',
        sessionsMax: 10,
      },
      {
        getActiveSessions: () => 3,
        getProjectCount: () => 42,
      },
    );

    // Override OS functions for deterministic output
    resource.osFns = {
      cpus: () => [
        { model: 'test', speed: 3000, times: { user: 800, nice: 0, sys: 100, idle: 100, irq: 0 } },
        { model: 'test', speed: 3000, times: { user: 700, nice: 0, sys: 200, idle: 100, irq: 0 } },
      ],
      totalmem: () => 16 * 1024 * 1024 * 1024, // 16 GB
      freemem: () => 8 * 1024 * 1024 * 1024,   // 8 GB
    };

    const snap = resource.snapshot();

    assert.equal(snap.nodeId, 'test-node');
    assert.equal(snap.instanceName, 'test-bridge');
    assert.equal(snap.cpuCount, 2);
    assert.ok(snap.cpuLoadPercent >= 0 && snap.cpuLoadPercent <= 100, `CPU load ${snap.cpuLoadPercent}% should be 0-100`);
    assert.equal(snap.memoryTotalMb, 16384);
    assert.equal(snap.memoryAvailableMb, 8192);
    assert.equal(snap.sessionsActive, 3);
    assert.equal(snap.sessionsMax, 10);
    assert.equal(snap.projectCount, 42);
    assert.ok(snap.uptimeMs >= 0, 'Uptime should be non-negative');
    assert.equal(snap.version, '1.0.0');
  });
});
