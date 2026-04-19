// SPDX-License-Identifier: Apache-2.0
/**
 * Result checker — validates StrategyExecutionResult against SmokeExpected.
 *
 * Returns a list of assertion results (pass/fail with details) for
 * display in the verification panel.
 */

import type { StrategyExecutionResult } from '@methodts/methodts/strategy/dag-types.js';
import type { SmokeExpected } from '../cases/index.js';

export interface AssertionResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
}

/**
 * Check a StrategyExecutionResult against expected outcomes.
 * Returns one AssertionResult per check.
 */
export function checkResult(
  result: StrategyExecutionResult,
  expected: SmokeExpected,
): AssertionResult[] {
  const assertions: AssertionResult[] = [];

  // Status check
  assertions.push({
    name: 'Execution status',
    passed: result.status === expected.status,
    expected: expected.status,
    actual: result.status,
  });

  // Node statuses
  if (expected.nodeStatuses) {
    for (const [nodeId, expectedStatus] of Object.entries(expected.nodeStatuses)) {
      const nodeResult = result.node_results[nodeId];
      const actualStatus = nodeResult?.status ?? 'missing';
      assertions.push({
        name: `Node "${nodeId}" status`,
        passed: actualStatus === expectedStatus,
        expected: expectedStatus,
        actual: actualStatus,
      });
    }
  }

  // Artifacts produced
  if (expected.artifactsProduced) {
    for (const key of expected.artifactsProduced) {
      const exists = key in result.artifacts;
      assertions.push({
        name: `Artifact "${key}" produced`,
        passed: exists,
        expected: 'present',
        actual: exists ? 'present' : 'missing',
      });
    }
  }

  // Gates passed
  if (expected.gatesPassed) {
    for (const gateId of expected.gatesPassed) {
      const gateResult = result.gate_results.find((g) => g.gate_id === gateId);
      // Also check node-level gates
      let found = gateResult?.passed === true;
      if (!found) {
        for (const nr of Object.values(result.node_results)) {
          const nodeGate = nr.gate_results.find((g) => g.gate_id === gateId);
          if (nodeGate?.passed) { found = true; break; }
        }
      }
      assertions.push({
        name: `Gate "${gateId}" passed`,
        passed: found,
        expected: 'passed',
        actual: found ? 'passed' : 'not found or failed',
      });
    }
  }

  // Gates failed
  if (expected.gatesFailed) {
    for (const gateId of expected.gatesFailed) {
      const gateResult = result.gate_results.find((g) => g.gate_id === gateId);
      const failed = gateResult?.passed === false;
      assertions.push({
        name: `Gate "${gateId}" failed`,
        passed: failed,
        expected: 'failed',
        actual: failed ? 'failed' : 'not found or passed',
      });
    }
  }

  // Oversight triggered
  if (expected.oversightTriggered !== undefined) {
    const triggered = result.oversight_events.length > 0;
    assertions.push({
      name: 'Oversight event triggered',
      passed: triggered === expected.oversightTriggered,
      expected: expected.oversightTriggered ? 'triggered' : 'not triggered',
      actual: triggered ? `triggered (${result.oversight_events.length} events)` : 'not triggered',
    });
  }

  // Retro generated (we check for timing fields as proxy)
  if (expected.retroGenerated) {
    const hasRetroData = !!result.started_at && !!result.completed_at;
    assertions.push({
      name: 'Retro data present',
      passed: hasRetroData,
      expected: 'timing data present',
      actual: hasRetroData ? 'present' : 'missing',
    });
  }

  // Cost range
  if (expected.costRange) {
    const [min, max] = expected.costRange;
    const inRange = result.cost_usd >= min && result.cost_usd <= max;
    assertions.push({
      name: 'Cost in expected range',
      passed: inRange,
      expected: `$${min.toFixed(4)} – $${max.toFixed(4)}`,
      actual: `$${result.cost_usd.toFixed(4)}`,
    });
  }

  // Error contains
  if (expected.errorContains) {
    const failedNodes = Object.values(result.node_results)
      .filter((nr) => nr.status === 'failed' || nr.status === 'gate_failed');
    const anyMatch = failedNodes.some((nr) =>
      nr.error?.toLowerCase().includes(expected.errorContains!.toLowerCase()),
    );
    assertions.push({
      name: `Error contains "${expected.errorContains}"`,
      passed: anyMatch,
      expected: `error containing "${expected.errorContains}"`,
      actual: anyMatch
        ? 'found'
        : `no match in: ${failedNodes.map((n) => n.error ?? '(no error)').join('; ') || '(no failed nodes)'}`,
    });
  }

  // Retries on node
  if (expected.retriesOnNode) {
    const { nodeId, count } = expected.retriesOnNode;
    const nodeResult = result.node_results[nodeId];
    const actual = nodeResult?.retries ?? 0;
    assertions.push({
      name: `Retries on "${nodeId}"`,
      passed: actual === count,
      expected: `${count} retries`,
      actual: `${actual} retries`,
    });
  }

  // Artifact values
  if (expected.artifactValues) {
    for (const [key, expectedVal] of Object.entries(expected.artifactValues)) {
      const artifact = result.artifacts[key];
      const actualVal = artifact?.content;
      const match = JSON.stringify(actualVal) === JSON.stringify(expectedVal);
      assertions.push({
        name: `Artifact "${key}" value`,
        passed: match,
        expected: JSON.stringify(expectedVal),
        actual: JSON.stringify(actualVal),
      });
    }
  }

  return assertions;
}

/**
 * Summary: did all assertions pass?
 */
export function allPassed(assertions: AssertionResult[]): boolean {
  return assertions.every((a) => a.passed);
}
