/**
 * Assertion helpers for Pacta agent test verification.
 *
 * Each helper throws a descriptive error on failure, compatible
 * with any test runner (node:test, vitest, etc.).
 */

import type { AgentResult, SchemaDefinition } from '@method/pacta';
import type { Recording } from './recording-provider.js';

// ── assertToolsCalled ───────────────────────────────────────────

/**
 * Assert that the recording contains calls to exactly the expected tools
 * (in order). Compares tool names only.
 *
 * @param recording - The recording from RecordingProvider
 * @param expectedTools - Ordered list of tool names expected
 */
export function assertToolsCalled(recording: Recording, expectedTools: string[]): void {
  const actualTools = recording.toolCalls.map(tc => tc.name);

  if (actualTools.length !== expectedTools.length) {
    throw new Error(
      `assertToolsCalled: expected ${expectedTools.length} tool calls [${expectedTools.join(', ')}], ` +
      `got ${actualTools.length} [${actualTools.join(', ')}]`
    );
  }

  for (let i = 0; i < expectedTools.length; i++) {
    if (actualTools[i] !== expectedTools[i]) {
      throw new Error(
        `assertToolsCalled: at index ${i}, expected tool '${expectedTools[i]}', got '${actualTools[i]}'. ` +
        `Full sequence: [${actualTools.join(', ')}]`
      );
    }
  }
}

// ── assertToolsCalledUnordered ──────────────────────────────────

/**
 * Assert that the recording contains calls to exactly the expected tools
 * (in any order). Compares tool names as sets with counts.
 */
export function assertToolsCalledUnordered(recording: Recording, expectedTools: string[]): void {
  const actualSorted = [...recording.toolCalls.map(tc => tc.name)].sort();
  const expectedSorted = [...expectedTools].sort();

  if (actualSorted.length !== expectedSorted.length || actualSorted.some((v, i) => v !== expectedSorted[i])) {
    throw new Error(
      `assertToolsCalledUnordered: expected tools [${expectedSorted.join(', ')}], ` +
      `got [${actualSorted.join(', ')}]`
    );
  }
}

// ── assertBudgetUnder ───────────────────────────────────────────

export interface BudgetLimits {
  maxTokens?: number;
  maxCostUsd?: number;
  maxDurationMs?: number;
  maxTurns?: number;
}

/**
 * Assert that the agent result stayed within the given budget limits.
 */
export function assertBudgetUnder(result: AgentResult, limits: BudgetLimits): void {
  const violations: string[] = [];

  if (limits.maxTokens !== undefined && result.usage.totalTokens > limits.maxTokens) {
    violations.push(
      `tokens: ${result.usage.totalTokens} > ${limits.maxTokens}`
    );
  }

  if (limits.maxCostUsd !== undefined && result.cost.totalUsd > limits.maxCostUsd) {
    violations.push(
      `cost: $${result.cost.totalUsd.toFixed(4)} > $${limits.maxCostUsd.toFixed(4)}`
    );
  }

  if (limits.maxDurationMs !== undefined && result.durationMs > limits.maxDurationMs) {
    violations.push(
      `duration: ${result.durationMs}ms > ${limits.maxDurationMs}ms`
    );
  }

  if (limits.maxTurns !== undefined && result.turns > limits.maxTurns) {
    violations.push(
      `turns: ${result.turns} > ${limits.maxTurns}`
    );
  }

  if (violations.length > 0) {
    throw new Error(
      `assertBudgetUnder: budget exceeded — ${violations.join('; ')}`
    );
  }
}

// ── assertOutputMatches ─────────────────────────────────────────

/**
 * Assert that the agent result's output matches a schema definition.
 * Uses the same SchemaDefinition interface from @method/pacta.
 */
export function assertOutputMatches<T>(result: AgentResult, schema: SchemaDefinition<T>): T {
  const parsed = schema.parse(result.output);

  if (!parsed.success) {
    throw new Error(
      `assertOutputMatches: output validation failed — ${parsed.errors.join('; ')}`
    );
  }

  return parsed.data;
}
