import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseResourceSnapshot, safeParseResourceSnapshot } from './resource-schema.js';

describe('ResourceSnapshot schema', () => {
  const validSnapshot = {
    nodeId: 'node-1',
    instanceName: 'mission-control',
    cpuCount: 8,
    cpuLoadPercent: 42.5,
    memoryTotalMb: 16384,
    memoryAvailableMb: 8192,
    sessionsActive: 3,
    sessionsMax: 10,
    projectCount: 15,
    uptimeMs: 3600000,
    version: '0.1.0',
  };

  it('parses a valid snapshot successfully', () => {
    const result = parseResourceSnapshot(validSnapshot);

    assert.equal(result.nodeId, 'node-1');
    assert.equal(result.instanceName, 'mission-control');
    assert.equal(result.cpuCount, 8);
    assert.equal(result.cpuLoadPercent, 42.5);
    assert.equal(result.memoryTotalMb, 16384);
    assert.equal(result.memoryAvailableMb, 8192);
    assert.equal(result.sessionsActive, 3);
    assert.equal(result.sessionsMax, 10);
    assert.equal(result.projectCount, 15);
    assert.equal(result.uptimeMs, 3600000);
    assert.equal(result.version, '0.1.0');
  });

  it('rejects invalid snapshots with missing or wrong-typed fields', () => {
    // Missing required field
    const missingNodeId = { ...validSnapshot, nodeId: undefined };
    const result1 = safeParseResourceSnapshot(missingNodeId);
    assert.equal(result1.success, false);

    // Wrong type: cpuCount must be positive integer
    const negativeCpu = { ...validSnapshot, cpuCount: -1 };
    const result2 = safeParseResourceSnapshot(negativeCpu);
    assert.equal(result2.success, false);

    // Empty string where min(1) required
    const emptyVersion = { ...validSnapshot, version: '' };
    const result3 = safeParseResourceSnapshot(emptyVersion);
    assert.equal(result3.success, false);

    // Completely wrong shape
    const result4 = safeParseResourceSnapshot('not an object');
    assert.equal(result4.success, false);
  });
});
